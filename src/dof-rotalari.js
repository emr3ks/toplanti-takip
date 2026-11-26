'use strict';

/**
 * Düzeltici ve Önleyici Faaliyetler (DÖF) modülü (Faz 4).
 *
 * Kayıt oluşturma ve otomatik kodlama, uygunsuzluk tanımı, kök neden analizi,
 * çok maddeli aksiyon planı, kanıt dosyası yükleme, etkinlik kontrolü ve
 * kapatma akışı, antetli DÖF raporu PDF'i, CSV/XLSX dışa aktarma ve otomatik
 * e-posta bildirimleri bu modülde yer alır. app.js bu modülü oturum ve ortak
 * yardımcılar hazır olduktan sonra çağırır.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const { metin, mesajliYol } = require('./dogrulama');
const { bugunTz, gecerliTarih, tarihTr } = require('./dates');
const { etkinAyarlar, sirketAyarlari } = require('./settings');
const { dofPdfUret } = require('./pdf');
const { csvOlustur, xlsxOlustur } = require('./disa-aktarma');
const bildirimler = require('./bildirimler');
const dof = require('./dof');

const KANIT_UZANTILARI = Object.freeze([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.txt',
]);

const LISTE_LIMIT = 500;
const AKTARMA_LIMIT = 5000;

const DOF_CSV_BASLIKLARI = Object.freeze([
  'DÖF No',
  'Tür',
  'Uygunsuzluk Kaynağı',
  'İlgili Departman',
  'Talep Eden',
  'Tespit Tarihi',
  'Durum',
  'Aksiyon Sayısı',
  'Tamamlanan Aksiyon',
  'Geciken Aksiyon',
  'Kök Neden',
  'Oluşturan',
  'Kapanış Tarihi',
]);

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

function tekDeger(deger) {
  return Array.isArray(deger) ? deger[0] : deger;
}

function dizi(deger) {
  if (Array.isArray(deger)) return deger;
  if (deger === undefined || deger === null) return [];
  return [deger];
}

function kimlik(deger) {
  const sayi = Number(tekDeger(deger));
  return Number.isInteger(sayi) && sayi > 0 ? sayi : null;
}

function queryMetin(req, ad, varsayilan = '') {
  const deger = tekDeger(req.query[ad]);
  return typeof deger === 'string' ? deger.trim() : varsayilan;
}

function yonlendir(res, yol, anahtar, mesaj) {
  return res.redirect(303, mesajliYol(yol, anahtar, mesaj));
}

function sayfaYok(res, baslik = 'DÖF Kaydı Bulunamadı') {
  return res.status(404).render('404', {
    aktifSayfa: 'dof',
    sayfaBaslik: baslik,
  });
}

function bugunOku(db, config) {
  try {
    return bugunTz(etkinAyarlar(db, config).saatDilimi);
  } catch {
    return bugunTz('Europe/Istanbul');
  }
}

// ---------------------------------------------------------------------------
// Sorgu yardımcıları
// ---------------------------------------------------------------------------

function dofGetir(db, id) {
  return db
    .prepare(
      `SELECT d.*,
              dep.ad AS departman_ad,
              doc.kod AS dokuman_kod,
              doc.baslik AS dokuman_baslik,
              doc.durum AS dokuman_durum,
              o.ad AS olusturan_ad,
              o.email AS olusturan_email,
              k.ad AS kapatan_ad,
              (SELECT t.id FROM ic_tetkik_bulgulari ib
                JOIN ic_tetkikler t ON t.id = ib.tetkik_id WHERE ib.dof_id = d.id) AS tetkik_id,
              (SELECT t.kod FROM ic_tetkik_bulgulari ib
                JOIN ic_tetkikler t ON t.id = ib.tetkik_id WHERE ib.dof_id = d.id) AS tetkik_kod,
              (SELECT ib.kod FROM ic_tetkik_bulgulari ib
                WHERE ib.dof_id = d.id) AS tetkik_bulgu_kod
       FROM dof_kayitlari d
       LEFT JOIN departmanlar dep ON dep.id = d.departman_id
       LEFT JOIN dokumanlar doc ON doc.id = d.dokuman_id
       LEFT JOIN kullanicilar o ON o.id = d.olusturan_id
       LEFT JOIN kullanicilar k ON k.id = d.kapatan_id
       WHERE d.id = ?`
    )
    .get(id);
}

function aksiyonGetir(db, dofId, aksiyonId) {
  return db
    .prepare(
      `SELECT a.*, k.ad AS sorumlu_ad, k.email AS sorumlu_email
       FROM dof_aksiyonlari a
       LEFT JOIN kullanicilar k ON k.id = a.sorumlu_id
       WHERE a.id = ? AND a.dof_id = ?`
    )
    .get(aksiyonId, dofId);
}

function aksiyonlariGetir(db, dofId) {
  return db
    .prepare(
      `SELECT a.*, k.ad AS sorumlu_ad, k.email AS sorumlu_email
       FROM dof_aksiyonlari a
       LEFT JOIN kullanicilar k ON k.id = a.sorumlu_id
       WHERE a.dof_id = ?
       ORDER BY a.sira ASC, a.id ASC`
    )
    .all(dofId);
}

function departmanlarGetir(db) {
  return db.prepare('SELECT id, ad FROM departmanlar ORDER BY ad COLLATE NOCASE').all();
}

function aktifKullanicilar(db) {
  return db
    .prepare(
      `SELECT k.id, k.ad, k.email, k.rol, k.departman_id, d.ad AS departman_ad
       FROM kullanicilar k
       LEFT JOIN departmanlar d ON d.id = k.departman_id
       WHERE k.aktif = 1
       ORDER BY d.ad COLLATE NOCASE, k.ad COLLATE NOCASE`
    )
    .all();
}

function yayindakiDokumanlar(db, seciliId = null) {
  return db
    .prepare(
      `SELECT d.id, d.kod, d.baslik, d.revizyon, d.durum, t.ad AS tur_ad
       FROM dokumanlar d
       JOIN dokuman_turleri t ON t.kod = d.tur_kod
       WHERE d.durum = 'yayinda' OR d.id = ?
       ORDER BY
         CASE WHEN d.durum = 'yayinda' THEN 0 ELSE 1 END,
         d.kod COLLATE NOCASE, d.revizyon DESC`
    )
    .all(seciliId || 0);
}

/** Kullanıcının DÖF kaydına erişimi var mı? */
function dofErisimiVar(db, kullanici, kayit, tamErisim = false) {
  if (!kullanici || !kayit) return false;
  if (tamErisim) return true;
  if (Number(kayit.olusturan_id) === Number(kullanici.id)) return true;
  if (kayit.departman_id && Number(kayit.departman_id) === Number(kullanici.departman_id)) return true;
  return Boolean(
    db
      .prepare('SELECT 1 FROM dof_aksiyonlari WHERE dof_id = ? AND sorumlu_id = ?')
      .get(kayit.id, kullanici.id)
  );
}

function bildirimEkle(db, kullaniciId, baslik, mesaj, dofId) {
  db.prepare(
    `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, dokuman_id)
     VALUES (?, 'dof', ?, ?, ?, NULL)`
  ).run(
    kullaniciId,
    String(baslik).slice(0, 200),
    String(mesaj || '').slice(0, 500),
    `/dof/${dofId}`
  );
}

/**
 * Aksiyonların son durumuna göre DÖF durumunu ilerletir.
 *  - Tüm aksiyonlar tamamlandıysa  -> etkinlik_bekliyor
 *  - Aksiyonlar tamamlanmadıysa     -> kok_neden (kök neden veya aksiyon varsa)
 */
function durumuGuncelle(db, dofId) {
  const kayit = db
    .prepare('SELECT id, durum, kok_neden FROM dof_kayitlari WHERE id = ?')
    .get(dofId);
  if (!kayit || kayit.durum === dof.DOF_KAPALI) return kayit ? kayit.durum : null;

  const aksiyonlar = db
    .prepare('SELECT durum FROM dof_aksiyonlari WHERE dof_id = ?')
    .all(dofId);

  let yeni = kayit.durum;
  if (dof.tumAksiyonlarTamamlandi(aksiyonlar)) {
    yeni = 'etkinlik_bekliyor';
  } else if (kayit.durum === 'etkinlik_bekliyor' || kayit.durum === 'acik') {
    const kokNedenVar = String(kayit.kok_neden || '').trim().length > 0;
    yeni = kokNedenVar || aksiyonlar.length > 0 ? 'kok_neden' : 'acik';
  }

  if (yeni !== kayit.durum) {
    db.prepare('UPDATE dof_kayitlari SET durum = ?, guncelleme_tarihi = ? WHERE id = ?').run(
      yeni,
      new Date().toISOString(),
      dofId
    );
  }
  return yeni;
}

// ---------------------------------------------------------------------------
// Filtre ve liste sorguları
// ---------------------------------------------------------------------------

function filtreleriCoz(req) {
  const durumHam = queryMetin(req, 'durum', 'hepsi');
  const durum = ['hepsi', ...dof.DOF_DURUM_ANAHTARLARI].includes(durumHam) ? durumHam : 'hepsi';
  const turHam = queryMetin(req, 'tur');
  const tur = dof.DOF_TURLERI[turHam] ? turHam : '';
  const kaynakHam = queryMetin(req, 'kaynak');
  const kaynak = dof.DOF_KAYNAKLARI[kaynakHam] ? kaynakHam : '';
  const departmanId = kimlik(req.query.departman);
  const geciken = ['1', 'true', 'evet'].includes(queryMetin(req, 'geciken').toLowerCase());
  const arama = queryMetin(req, 'q').slice(0, 100);
  return { durum, tur, kaynak, departmanId, geciken, arama };
}

function filtreSorgusu(filtreler) {
  const kosullar = [];
  const parametreler = [];
  if (filtreler.durum !== 'hepsi') {
    kosullar.push('d.durum = ?');
    parametreler.push(filtreler.durum);
  }
  if (filtreler.tur) {
    kosullar.push('d.tur = ?');
    parametreler.push(filtreler.tur);
  }
  if (filtreler.kaynak) {
    kosullar.push('d.kaynak = ?');
    parametreler.push(filtreler.kaynak);
  }
  if (filtreler.departmanId) {
    kosullar.push('d.departman_id = ?');
    parametreler.push(filtreler.departmanId);
  }
  if (filtreler.geciken) {
    kosullar.push(
      `d.durum <> 'kapandi' AND EXISTS (
        SELECT 1 FROM dof_aksiyonlari ga
        WHERE ga.dof_id = d.id AND ga.durum <> 'tamamlandi' AND ga.hedef_tarih < ?
      )`
    );
    parametreler.push(filtreler.bugun);
  }
  if (filtreler.arama) {
    const desen = `%${filtreler.arama}%`;
    kosullar.push('(d.kod LIKE ? OR d.talep_eden LIKE ? OR d.uygunsuzluk_tanimi LIKE ?)');
    parametreler.push(desen, desen, desen);
  }
  return { kosullar, parametreler };
}

/** Filtrelenmiş ve kullanıcıya görünür DÖF listesini döndürür. */
function dofListesi(db, { kullanici, tamErisim, filtreler, bugun, limit = LISTE_LIMIT }) {
  const erisim = dof.dofGorunurlukSql(kullanici, tamErisim);
  const filtre = filtreSorgusu({ ...filtreler, bugun });
  const kosullar = [erisim.sql, ...filtre.kosullar];
  const parametreler = [...erisim.parametreler, ...filtre.parametreler];
  const sinir = Number.isInteger(limit) && limit > 0 ? Math.min(limit, AKTARMA_LIMIT) : LISTE_LIMIT;

  return db
    .prepare(
      `SELECT d.*,
              dep.ad AS departman_ad,
              doc.kod AS dokuman_kod,
              o.ad AS olusturan_ad,
              (SELECT COUNT(*) FROM dof_aksiyonlari a WHERE a.dof_id = d.id) AS aksiyon_sayisi,
              (SELECT COUNT(*) FROM dof_aksiyonlari a
                WHERE a.dof_id = d.id AND a.durum = 'tamamlandi') AS tamamlanan_aksiyon,
              (SELECT COUNT(*) FROM dof_aksiyonlari a
                WHERE a.dof_id = d.id AND a.durum <> 'tamamlandi' AND a.hedef_tarih < ?) AS geciken_aksiyon
       FROM dof_kayitlari d
       LEFT JOIN departmanlar dep ON dep.id = d.departman_id
       LEFT JOIN dokumanlar doc ON doc.id = d.dokuman_id
       LEFT JOIN kullanicilar o ON o.id = d.olusturan_id
       WHERE ${kosullar.join(' AND ')}
       ORDER BY
         CASE d.durum
           WHEN 'acik' THEN 0
           WHEN 'kok_neden' THEN 1
           WHEN 'etkinlik_bekliyor' THEN 2
           ELSE 3
         END,
         d.tespit_tarihi DESC, d.id DESC
       LIMIT ${sinir}`
    )
    .all(bugun, ...parametreler);
}

/** Dashboard ve liste başlığı için DÖF sayaçlarını üretir. */
function dofOzeti(db, kullanici, tamErisim, bugun) {
  const erisim = dof.dofGorunurlukSql(kullanici, tamErisim);
  const satir = db
    .prepare(
      `SELECT
         COUNT(*) AS toplam,
         COALESCE(SUM(CASE WHEN d.durum <> 'kapandi' THEN 1 ELSE 0 END), 0) AS acik,
         COALESCE(SUM(CASE WHEN d.durum = 'kok_neden' THEN 1 ELSE 0 END), 0) AS kok_neden,
         COALESCE(SUM(CASE WHEN d.durum = 'etkinlik_bekliyor' THEN 1 ELSE 0 END), 0) AS etkinlik,
         COALESCE(SUM(CASE WHEN d.durum = 'kapandi' THEN 1 ELSE 0 END), 0) AS kapandi,
         COALESCE(SUM(CASE WHEN d.durum <> 'kapandi' AND EXISTS (
           SELECT 1 FROM dof_aksiyonlari a
           WHERE a.dof_id = d.id AND a.durum <> 'tamamlandi' AND a.hedef_tarih < ?
         ) THEN 1 ELSE 0 END), 0) AS geciken
       FROM dof_kayitlari d
       WHERE ${erisim.sql}`
    )
    .get(bugun, ...erisim.parametreler);

  return {
    toplam: Number(satir.toplam) || 0,
    acik: Number(satir.acik) || 0,
    kokNeden: Number(satir.kok_neden) || 0,
    etkinlik: Number(satir.etkinlik) || 0,
    kapandi: Number(satir.kapandi) || 0,
    geciken: Number(satir.geciken) || 0,
  };
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

/** DÖF künyesini doğrular. Hata varsa { hata }, yoksa { degerler } döner. */
function dofDegerleriniDogrula(db, body) {
  const tur = metin(body.tur);
  if (!Object.prototype.hasOwnProperty.call(dof.DOF_TURLERI, tur)) {
    return { hata: 'Geçerli bir DÖF türü seçin (düzeltici veya önleyici).' };
  }

  const kaynak = metin(body.kaynak);
  if (!Object.prototype.hasOwnProperty.call(dof.DOF_KAYNAKLARI, kaynak)) {
    return { hata: 'Geçerli bir uygunsuzluk kaynağı seçin.' };
  }

  const departmanId = kimlik(body.departman_id);
  const departman = departmanId
    ? db.prepare('SELECT id FROM departmanlar WHERE id = ?').get(departmanId)
    : null;
  if (!departman) {
    return { hata: 'İlgili departmanı seçin.' };
  }

  const talepEden = metin(body.talep_eden);
  if (talepEden.length < 2 || talepEden.length > 120) {
    return { hata: 'Talep eden kişi 2-120 karakter arasında olmalıdır.' };
  }

  const tespitTarihi = metin(body.tespit_tarihi);
  if (!gecerliTarih(tespitTarihi)) {
    return { hata: 'Geçerli bir tespit tarihi seçin (YYYY-AA-GG).' };
  }

  const uygunsuzlukTanimi = metin(body.uygunsuzluk_tanimi);
  if (uygunsuzlukTanimi.length < 10 || uygunsuzlukTanimi.length > 5000) {
    return { hata: 'Uygunsuzluk tanımı 10-5000 karakter arasında olmalıdır.' };
  }

  let dokumanId = null;
  const hamDokuman = metin(body.dokuman_id);
  if (hamDokuman) {
    const secilen = Number(hamDokuman);
    if (!Number.isInteger(secilen) || secilen <= 0) {
      return { hata: 'Seçilen ilgili kalite dokümanı geçersiz.' };
    }
    const dokuman = db.prepare('SELECT id FROM dokumanlar WHERE id = ?').get(secilen);
    if (!dokuman) {
      return { hata: 'Seçilen ilgili kalite dokümanı bulunamadı.' };
    }
    dokumanId = dokuman.id;
  }

  return {
    degerler: {
      tur,
      kaynak,
      departman_id: departmanId,
      talep_eden: talepEden,
      tespit_tarihi: tespitTarihi,
      uygunsuzluk_tanimi: uygunsuzlukTanimi,
      dokuman_id: dokumanId,
    },
  };
}

function aksiyonDurumuGecerliMi(durum) {
  return Object.prototype.hasOwnProperty.call(dof.DOF_AKSIYON_DURUMLARI, durum);
}

function sorumluCoz(db, deger) {
  const id = kimlik(deger);
  if (!id) return null;
  return db.prepare('SELECT id, ad, email FROM kullanicilar WHERE id = ? AND aktif = 1').get(id) || null;
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

function dofRotalariniKur(app, { db, auth, mail, config }) {
  app.locals.DOF_TURLERI = dof.DOF_TURLERI;
  app.locals.DOF_KAYNAKLARI = dof.DOF_KAYNAKLARI;
  app.locals.DOF_DURUMLARI = dof.DOF_DURUMLARI;
  app.locals.DOF_AKSIYON_DURUMLARI = dof.DOF_AKSIYON_DURUMLARI;
  app.locals.DOF_AKSIYON_DURUM_ANAHTARLARI = dof.DOF_AKSIYON_DURUM_ANAHTARLARI;
  app.locals.DOF_DURUM_ANAHTARLARI = dof.DOF_DURUM_ANAHTARLARI;
  app.locals.DOF_TUR_ANAHTARLARI = dof.DOF_TUR_ANAHTARLARI;
  app.locals.DOF_KAYNAK_ANAHTARLARI = dof.DOF_KAYNAK_ANAHTARLARI;
  app.locals.dofDurumSinifi = dof.dofDurumSinifi;
  app.locals.aksiyonDurumSinifi = dof.aksiyonDurumSinifi;
  app.locals.dofTurEtiketi = dof.turEtiketi;
  app.locals.dofKaynakEtiketi = dof.kaynakEtiketi;
  app.locals.dofDurumEtiketi = dof.durumEtiketi;
  app.locals.dofAksiyonDurumEtiketi = dof.aksiyonDurumEtiketi;

  // -------------------------------------------------------------------------
  // Kanıt dosyası yükleme
  // -------------------------------------------------------------------------
  const dofYuklemeKok = path.join(config.dataDir, 'yuklemeler', 'dof');
  fs.mkdirSync(dofYuklemeKok, { recursive: true });

  const depo = multer.diskStorage({
    destination(req, file, geri) {
      geri(null, dofYuklemeKok);
    },
    filename(req, file, geri) {
      const uzanti = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      geri(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${uzanti}`);
    },
  });

  const yukleyici = multer({
    storage: depo,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, geri) {
      const uzanti = path.extname(file.originalname || '').toLowerCase();
      if (KANIT_UZANTILARI.includes(uzanti)) return geri(null, true);
      return geri(new Error('Kanıt dosyası için PDF, Word, Excel, PNG, JPG veya TXT yükleyin.'));
    },
  });

  function kanitYukle(req, res, next) {
    yukleyici.single('kanit')(req, res, (hata) => {
      if (!hata) return next();
      const geri = `/dof/${kimlik(req.params.id) || ''}`;
      const mesaj =
        hata.code === 'LIMIT_FILE_SIZE' ? 'Kanıt dosyası 10 MB sınırını aşıyor.' : hata.message;
      return yonlendir(res, geri, 'hata', mesaj);
    });
  }

  function kanitDosyaSil(ad) {
    if (!ad) return;
    try {
      const tam = path.join(dofYuklemeKok, path.basename(String(ad)));
      if (fs.existsSync(tam)) fs.unlinkSync(tam);
    } catch {
      /* dosya zaten silinmiş olabilir */
    }
  }

  function kanitTamYolu(ad) {
    if (!ad) return null;
    const temiz = path.basename(String(ad));
    const tam = path.join(dofYuklemeKok, temiz);
    return fs.existsSync(tam) ? tam : null;
  }

  // -------------------------------------------------------------------------
  // DÖF listesi
  // -------------------------------------------------------------------------
  app.get('/dof', (req, res) => {
    const bugun = bugunOku(db, config);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'dof');
    const filtreler = filtreleriCoz(req);
    const liste = dofListesi(db, {
      kullanici: req.kullanici,
      tamErisim,
      filtreler,
      bugun,
    });
    const ozet = dofOzeti(db, req.kullanici, tamErisim, bugun);
    const departmanlar = departmanlarGetir(db);

    const disaAktarmaSorgusu = new URLSearchParams();
    if (filtreler.durum !== 'hepsi') disaAktarmaSorgusu.set('durum', filtreler.durum);
    if (filtreler.tur) disaAktarmaSorgusu.set('tur', filtreler.tur);
    if (filtreler.kaynak) disaAktarmaSorgusu.set('kaynak', filtreler.kaynak);
    if (filtreler.departmanId) disaAktarmaSorgusu.set('departman', filtreler.departmanId);
    if (filtreler.geciken) disaAktarmaSorgusu.set('geciken', '1');
    if (filtreler.arama) disaAktarmaSorgusu.set('q', filtreler.arama);
    const disaAktarmaEki = disaAktarmaSorgusu.toString()
      ? `?${disaAktarmaSorgusu.toString()}`
      : '';

    res.render('dof', {
      aktifSayfa: 'dof',
      sayfaBaslik: 'DÖF Yönetimi',
      filtreler,
      liste,
      ozet,
      departmanlar,
      bugun,
      dofYetkisi: tamErisim,
      disaAktarmaAdresleri: {
        csv: `/dof/disa-aktarma.csv${disaAktarmaEki}`,
        xlsx: `/dof/disa-aktarma.xlsx${disaAktarmaEki}`,
      },
    });
  });

  // -------------------------------------------------------------------------
  // Yeni DÖF
  // -------------------------------------------------------------------------
  app.get('/dof/yeni', auth.izinGerekli('dof'), (req, res) => {
    const bugun = bugunOku(db, config);
    const yil = dof.dofYili(bugun, Number(bugun.slice(0, 4)));
    res.render('dof-yeni', {
      aktifSayfa: 'dof',
      sayfaBaslik: 'Yeni DÖF',
      departmanlar: departmanlarGetir(db),
      dokumanlar: yayindakiDokumanlar(db),
      bugun,
      onKod: dof.dofKoduUret(db, yil),
      form: {
        tur: 'duzeltici',
        kaynak: 'ic_tetkik',
        departman_id: req.kullanici.departman_id || '',
        talep_eden: req.kullanici.ad,
        tespit_tarihi: bugun,
        uygunsuzluk_tanimi: '',
        dokuman_id: '',
      },
    });
  });

  app.post('/dof/yeni', auth.izinGerekli('dof'), async (req, res) => {
    const kontrol = dofDegerleriniDogrula(db, req.body);
    if (kontrol.hata) return yonlendir(res, '/dof/yeni', 'hata', kontrol.hata);

    const degerler = kontrol.degerler;
    const bugun = bugunOku(db, config);
    const simdi = new Date().toISOString();
    let dofId = null;
    let kod = '';

    db.exec('BEGIN IMMEDIATE');
    try {
      const yil = dof.dofYili(degerler.tespit_tarihi, Number(bugun.slice(0, 4)));
      kod = dof.dofKoduUret(db, yil);
      const bilgi = db
        .prepare(
          `INSERT INTO dof_kayitlari
             (kod, tur, kaynak, departman_id, talep_eden, tespit_tarihi, uygunsuzluk_tanimi,
              dokuman_id, durum, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'acik', ?, ?, ?)`
        )
        .run(
          kod,
          degerler.tur,
          degerler.kaynak,
          degerler.departman_id,
          degerler.talep_eden,
          degerler.tespit_tarihi,
          degerler.uygunsuzluk_tanimi,
          degerler.dokuman_id,
          req.kullanici.id,
          simdi,
          simdi
        );
      dofId = Number(bilgi.lastInsertRowid);

      const kisiler = db
        .prepare(
          `SELECT id FROM kullanicilar
           WHERE aktif = 1 AND departman_id = ? AND id <> ?`
        )
        .all(degerler.departman_id, req.kullanici.id);
      for (const kisi of kisiler) {
        bildirimEkle(
          db,
          kisi.id,
          `Yeni DÖF açıldı: ${kod}`,
          `${dof.turEtiketi(degerler.tur)} · ${dof.kaynakEtiketi(degerler.kaynak)}. Uygunsuzluğu inceleyin.`,
          dofId
        );
      }

      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[dof oluşturma]', hata);
      return yonlendir(res, '/dof/yeni', 'hata', 'DÖF kaydı oluşturulamadı. Lütfen tekrar deneyin.');
    }

    let epostaAdet = 0;
    try {
      const kayit = dofGetir(db, dofId);
      const sonuc = await bildirimler.dofAcildiBildiriminiGonder({
        db,
        mail,
        config,
        dof: kayit,
      });
      epostaAdet = sonuc.gonderilen;
    } catch (hata) {
      console.error('[dof açılış e-postası]', hata);
    }

    const mesaj =
      `${kod} numaralı DÖF açıldı.` +
      (epostaAdet > 0 ? ` İlgili departmandan ${epostaAdet} kişiye e-posta gönderildi.` : '');
    return yonlendir(res, `/dof/${dofId}`, 'ok', mesaj);
  });

  // -------------------------------------------------------------------------
  // CSV / XLSX dışa aktarma (parametreli /dof/:id rotasından önce)
  // -------------------------------------------------------------------------
  function disaAktarmaSatirlari(liste) {
    return liste.map((kayit) => [
      kayit.kod,
      dof.turEtiketi(kayit.tur),
      dof.kaynakEtiketi(kayit.kaynak),
      kayit.departman_ad || '—',
      kayit.talep_eden,
      tarihTr(kayit.tespit_tarihi),
      dof.durumEtiketi(kayit.durum),
      Number(kayit.aksiyon_sayisi) || 0,
      Number(kayit.tamamlanan_aksiyon) || 0,
      Number(kayit.geciken_aksiyon) || 0,
      kayit.kok_neden || '',
      kayit.olusturan_ad || '—',
      kayit.kapanis_tarihi ? tarihTr(String(kayit.kapanis_tarihi).slice(0, 10)) : '',
    ]);
  }

  function aktarmaListesi(req) {
    const bugun = bugunOku(db, config);
    return dofListesi(db, {
      kullanici: req.kullanici,
      tamErisim: true,
      filtreler: filtreleriCoz(req),
      bugun,
      limit: AKTARMA_LIMIT,
    });
  }

  function aktarmaYaniti(res, { bicim, dosyaAdi, basliklar, satirlar, genislikler }) {
    try {
      const tampon =
        bicim === 'csv'
          ? csvOlustur({ basliklar, satirlar })
          : xlsxOlustur({ sayfaAdi: 'DÖF Listesi', basliklar, satirlar, genislikler });
      const icerikTuru =
        bicim === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      res.set('Content-Type', icerikTuru);
      res.set('Content-Disposition', `attachment; filename="${dosyaAdi}.${bicim}"`);
      res.set('Cache-Control', 'no-store');
      res.set('Content-Length', String(tampon.length));
      return res.send(tampon);
    } catch (hata) {
      console.error('[dof dışa aktarma]', hata);
      if (!res.headersSent) {
        return res.status(500).type('text/plain; charset=utf-8').send('DÖF listesi dışa aktarılamadı.');
      }
      return undefined;
    }
  }

  app.get('/dof/disa-aktarma.csv', auth.izinGerekli('dof'), (req, res) => {
    const bugun = bugunOku(db, config);
    const liste = aktarmaListesi(req);
    return aktarmaYaniti(res, {
      bicim: 'csv',
      dosyaAdi: `dof-listesi-${bugun}`,
      basliklar: DOF_CSV_BASLIKLARI,
      satirlar: disaAktarmaSatirlari(liste),
    });
  });

  app.get('/dof/disa-aktarma.xlsx', auth.izinGerekli('dof'), (req, res) => {
    const bugun = bugunOku(db, config);
    const liste = aktarmaListesi(req);
    return aktarmaYaniti(res, {
      bicim: 'xlsx',
      dosyaAdi: `dof-listesi-${bugun}`,
      basliklar: DOF_CSV_BASLIKLARI,
      satirlar: disaAktarmaSatirlari(liste),
      genislikler: [16, 18, 22, 20, 20, 14, 28, 14, 18, 16, 50, 20, 14],
    });
  });

  // -------------------------------------------------------------------------
  // DÖF detayı
  // -------------------------------------------------------------------------
  app.get('/dof/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    const tamErisim = auth.yetkiliMi(req.kullanici, 'dof');
    if (!kayit || !dofErisimiVar(db, req.kullanici, kayit, tamErisim)) return sayfaYok(res);

    const bugun = bugunOku(db, config);
    db.prepare('UPDATE bildirimler SET okundu = 1 WHERE kullanici_id = ? AND baglanti = ?').run(
      req.kullanici.id,
      `/dof/${kayit.id}`
    );

    const aksiyonlar = dof.aksiyonlariCoz(aksiyonlariGetir(db, kayit.id), bugun);
    const kapatmaHazir =
      kayit.durum === 'etkinlik_bekliyor' &&
      dof.tumAksiyonlarTamamlandi(aksiyonlar);
    const kendiAksiyonlari = new Set(
      aksiyonlar
        .filter((aksiyon) => Number(aksiyon.sorumlu_id) === Number(req.kullanici.id))
        .map((aksiyon) => aksiyon.id)
    );

    res.render('dof-detay', {
      aktifSayfa: 'dof',
      sayfaBaslik: kayit.kod,
      kayit,
      aksiyonlar,
      bugun,
      dofYetkisi: tamErisim,
      kapatmaYetkisi: auth.yetkiliMi(req.kullanici, 'dof.kapat'),
      kapatmaHazir,
      kendiAksiyonlari,
      kullanicilar: tamErisim ? aktifKullanicilar(db) : [],
      departmanlar: tamErisim ? departmanlarGetir(db) : [],
      dokumanlar: tamErisim ? yayindakiDokumanlar(db, kayit.dokuman_id) : [],
      tamamlananAksiyon: dof.tamamlananAksiyonSayisi(aksiyonlar),
      gecikenAksiyon: aksiyonlar.filter((aksiyon) => aksiyon.gecikti).length,
    });
  });

  // -------------------------------------------------------------------------
  // DÖF künyesini düzenle
  // -------------------------------------------------------------------------
  app.post('/dof/:id', auth.izinGerekli('dof'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    if (kayit.durum === 'kapandi') {
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kapanmış DÖF kaydı düzenlenemez.');
    }

    const kontrol = dofDegerleriniDogrula(db, req.body);
    if (kontrol.hata) return yonlendir(res, `/dof/${kayit.id}`, 'hata', kontrol.hata);

    const degerler = kontrol.degerler;
    try {
      db.prepare(
        `UPDATE dof_kayitlari
         SET tur = ?, kaynak = ?, departman_id = ?, talep_eden = ?, tespit_tarihi = ?,
             uygunsuzluk_tanimi = ?, dokuman_id = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(
        degerler.tur,
        degerler.kaynak,
        degerler.departman_id,
        degerler.talep_eden,
        degerler.tespit_tarihi,
        degerler.uygunsuzluk_tanimi,
        degerler.dokuman_id,
        new Date().toISOString(),
        kayit.id
      );
    } catch (hata) {
      console.error('[dof güncelleme]', hata);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'DÖF bilgileri güncellenemedi.');
    }

    return yonlendir(res, `/dof/${kayit.id}`, 'ok', 'DÖF bilgileri güncellendi.');
  });

  // -------------------------------------------------------------------------
  // Kök neden ve acil önlem
  // -------------------------------------------------------------------------
  app.post('/dof/:id/kok-neden', auth.izinGerekli('dof'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    if (kayit.durum === 'kapandi') {
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kapanmış DÖF kaydında kök neden değiştirilemez.');
    }

    const kokNeden = metin(req.body.kok_neden);
    if (kokNeden.length < 10 || kokNeden.length > 5000) {
      return yonlendir(
        res,
        `/dof/${kayit.id}`,
        'hata',
        'Kök neden analizi 10-5000 karakter arasında olmalıdır.'
      );
    }
    const acilOnlem = metin(req.body.acil_onlem);
    if (acilOnlem.length > 5000) {
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Acil/geçici önlem en fazla 5000 karakter olabilir.');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE dof_kayitlari
         SET kok_neden = ?, acil_onlem = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(kokNeden, acilOnlem, new Date().toISOString(), kayit.id);
      durumuGuncelle(db, kayit.id);
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[dof kök neden]', hata);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kök neden analizi kaydedilemedi.');
    }

    return yonlendir(res, `/dof/${kayit.id}`, 'ok', 'Kök neden analizi ve acil önlem kaydedildi.');
  });

  // -------------------------------------------------------------------------
  // Aksiyon ekleme
  // -------------------------------------------------------------------------
  app.post('/dof/:id/aksiyonlar', auth.izinGerekli('dof'), kanitYukle, async (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    if (!kayit) {
      kanitDosyaSil(req.file?.filename);
      return sayfaYok(res);
    }
    if (kayit.durum === 'kapandi') {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kapanmış DÖF kaydına yeni aksiyon eklenemez.');
    }

    const aciklama = metin(req.body.aciklama);
    if (aciklama.length < 3 || aciklama.length > 800) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon açıklaması 3-800 karakter arasında olmalıdır.');
    }

    const sorumlu = sorumluCoz(db, req.body.sorumlu_id);
    if (!sorumlu) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon için aktif bir sorumlu personel seçin.');
    }

    const hedefTarih = metin(req.body.hedef_tarih);
    if (!gecerliTarih(hedefTarih)) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon için geçerli bir hedef tarih seçin.');
    }

    const durum = metin(req.body.durum) || 'acik';
    if (!aksiyonDurumuGecerliMi(durum)) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon durumu geçersiz.');
    }

    const kanitAciklama = metin(req.body.kanit_aciklama);
    if (kanitAciklama.length > 500) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kanıt açıklaması en fazla 500 karakter olabilir.');
    }

    const simdi = new Date().toISOString();
    let sira = 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      sira =
        Number(
          db
            .prepare('SELECT COALESCE(MAX(sira), 0) + 1 AS sira FROM dof_aksiyonlari WHERE dof_id = ?')
            .get(kayit.id).sira
        ) || 1;
      db.prepare(
        `INSERT INTO dof_aksiyonlari
           (dof_id, sira, aciklama, sorumlu_id, hedef_tarih, durum, kanit_aciklama,
            kanit_dosya, kanit_dosya_adi, tamamlanma_tarihi, olusturan_id,
            olusturma_tarihi, guncelleme_tarihi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .run(
          kayit.id,
          sira,
          aciklama,
          sorumlu.id,
          hedefTarih,
          durum,
          kanitAciklama,
          req.file ? req.file.filename : null,
          req.file ? String(req.file.originalname || '').slice(0, 200) : null,
          durum === dof.DOF_TAMAMLANAN ? simdi : null,
          req.kullanici.id,
          simdi,
          simdi
        );

      durumuGuncelle(db, kayit.id);
      db.prepare('UPDATE dof_kayitlari SET guncelleme_tarihi = ? WHERE id = ?').run(simdi, kayit.id);

      if (Number(sorumlu.id) !== Number(req.kullanici.id)) {
        bildirimEkle(
          db,
          sorumlu.id,
          `DÖF aksiyonu atandı: ${kayit.kod}`,
          `${aciklama} · Hedef tarih: ${tarihTr(hedefTarih)}`,
          kayit.id
        );
      }

      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      kanitDosyaSil(req.file?.filename);
      console.error('[dof aksiyon ekleme]', hata);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon eklenemedi.');
    }

    let epostaAdet = 0;
    try {
      const sonuc = await bildirimler.dofAksiyonAtandiBildiriminiGonder({
        db,
        mail,
        config,
        dof: kayit,
        aksiyon: {
          aciklama,
          hedef_tarih: hedefTarih,
          durum,
          kanit_aciklama: kanitAciklama,
          sorumlu_id: sorumlu.id,
        },
        sorumlu,
        gonderenId: req.kullanici.id,
      });
      epostaAdet = sonuc.gonderilen;
    } catch (hata) {
      console.error('[dof aksiyon e-postası]', hata);
    }

    const mesaj =
      'Aksiyon eklendi.' + (epostaAdet > 0 ? ` Sorumluya e-posta gönderildi.` : '');
    return yonlendir(res, `/dof/${kayit.id}`, 'ok', mesaj);
  });

  // -------------------------------------------------------------------------
  // Aksiyon güncelleme (sorumlu kendi aksiyonunu güncelleyebilir)
  // -------------------------------------------------------------------------
  app.post('/dof/:id/aksiyonlar/:aksiyonId', kanitYukle, async (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    const aksiyonId = kimlik(req.params.aksiyonId);
    const aksiyon = kayit && aksiyonId ? aksiyonGetir(db, kayit.id, aksiyonId) : null;
    if (!kayit || !aksiyon) {
      kanitDosyaSil(req.file?.filename);
      return sayfaYok(res);
    }

    const tamErisim = auth.yetkiliMi(req.kullanici, 'dof');
    const sorumluMu = Number(aksiyon.sorumlu_id) === Number(req.kullanici.id);
    if (!tamErisim && !sorumluMu) {
      kanitDosyaSil(req.file?.filename);
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'dof',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'dof',
      });
    }
    if (kayit.durum === 'kapandi') {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kapanmış DÖF kaydındaki aksiyonlar güncellenemez.');
    }

    const alanVar = (ad) => Object.prototype.hasOwnProperty.call(req.body, ad);
    const aciklama = tamErisim && alanVar('aciklama') ? metin(req.body.aciklama) : aksiyon.aciklama;
    if (aciklama.length < 3 || aciklama.length > 800) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon açıklaması 3-800 karakter arasında olmalıdır.');
    }

    let sorumluId = aksiyon.sorumlu_id;
    let sorumlu = null;
    let sorumluDegisti = false;
    if (tamErisim) {
      sorumlu = sorumluCoz(db, req.body.sorumlu_id);
      if (!sorumlu) {
        kanitDosyaSil(req.file?.filename);
        return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon için aktif bir sorumlu personel seçin.');
      }
      sorumluDegisti = Number(sorumlu.id) !== Number(aksiyon.sorumlu_id);
      sorumluId = sorumlu.id;
    }

    const hedefTarih = tamErisim && alanVar('hedef_tarih') ? metin(req.body.hedef_tarih) : aksiyon.hedef_tarih;
    if (!gecerliTarih(hedefTarih)) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon için geçerli bir hedef tarih seçin.');
    }

    const durum = alanVar('durum') ? metin(req.body.durum) : aksiyon.durum;
    if (!aksiyonDurumuGecerliMi(durum)) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon durumu geçersiz.');
    }

    const kanitAciklama = alanVar('kanit_aciklama')
      ? metin(req.body.kanit_aciklama)
      : aksiyon.kanit_aciklama;
    if (kanitAciklama.length > 500) {
      kanitDosyaSil(req.file?.filename);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Kanıt açıklaması en fazla 500 karakter olabilir.');
    }

    let kanitDosya = aksiyon.kanit_dosya;
    let kanitDosyaAdi = aksiyon.kanit_dosya_adi;
    if (req.file) {
      kanitDosyaSil(aksiyon.kanit_dosya);
      kanitDosya = req.file.filename;
      kanitDosyaAdi = String(req.file.originalname || '').slice(0, 200);
    }

    const simdi = new Date().toISOString();
    const tamamlanmaTarihi =
      durum === dof.DOF_TAMAMLANAN ? aksiyon.tamamlanma_tarihi || simdi : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE dof_aksiyonlari
         SET aciklama = ?, sorumlu_id = ?, hedef_tarih = ?, durum = ?, kanit_aciklama = ?,
             kanit_dosya = ?, kanit_dosya_adi = ?, tamamlanma_tarihi = ?, guncelleme_tarihi = ?
         WHERE id = ? AND dof_id = ?`
      ).run(
        aciklama,
        sorumluId,
        hedefTarih,
        durum,
        kanitAciklama,
        kanitDosya,
        kanitDosyaAdi,
        tamamlanmaTarihi,
        simdi,
        aksiyon.id,
        kayit.id
      );
      durumuGuncelle(db, kayit.id);
      db.prepare('UPDATE dof_kayitlari SET guncelleme_tarihi = ? WHERE id = ?').run(simdi, kayit.id);

      if (sorumluDegisti && sorumlu && Number(sorumlu.id) !== Number(req.kullanici.id)) {
        bildirimEkle(
          db,
          sorumlu.id,
          `DÖF aksiyonu atandı: ${kayit.kod}`,
          `${aciklama} · Hedef tarih: ${tarihTr(hedefTarih)}`,
          kayit.id
        );
      }
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      kanitDosyaSil(req.file?.filename);
      console.error('[dof aksiyon güncelleme]', hata);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Aksiyon güncellenemedi.');
    }

    let epostaAdet = 0;
    if (tamErisim && sorumluDegisti && sorumlu) {
      try {
        const sonuc = await bildirimler.dofAksiyonAtandiBildiriminiGonder({
          db,
          mail,
          config,
          dof: kayit,
          aksiyon: {
            aciklama,
            hedef_tarih: hedefTarih,
            durum,
            kanit_aciklama: kanitAciklama,
            sorumlu_id: sorumlu.id,
          },
          sorumlu,
          gonderenId: req.kullanici.id,
        });
        epostaAdet = sonuc.gonderilen;
      } catch (hata) {
        console.error('[dof aksiyon e-postası]', hata);
      }
    }

    const mesaj =
      'Aksiyon güncellendi.' + (epostaAdet > 0 ? ' Yeni sorumluya e-posta gönderildi.' : '');
    return yonlendir(res, `/dof/${kayit.id}`, 'ok', mesaj);
  });

  // -------------------------------------------------------------------------
  // Kanıt dosyası indirme
  // -------------------------------------------------------------------------
  app.get('/dof/:id/aksiyonlar/:aksiyonId/kanit', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    const aksiyonId = kimlik(req.params.aksiyonId);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'dof');
    if (!kayit || !dofErisimiVar(db, req.kullanici, kayit, tamErisim)) return sayfaYok(res);

    const aksiyon = aksiyonId ? aksiyonGetir(db, kayit.id, aksiyonId) : null;
    const tam = aksiyon ? kanitTamYolu(aksiyon.kanit_dosya) : null;
    if (!tam) {
      return res.status(404).render('404', {
        aktifSayfa: 'dof',
        sayfaBaslik: 'Kanıt Dosyası Bulunamadı',
      });
    }
    const indirmeAdi = String(aksiyon.kanit_dosya_adi || path.basename(tam)).replace(/["\\\r\n]/g, '');
    return res.download(path.basename(tam), indirmeAdi, { root: dofYuklemeKok }, (hata) => {
      if (hata && !res.headersSent) res.status(404).end();
    });
  });

  // -------------------------------------------------------------------------
  // Etkinlik değerlendirmesi ile kapatma
  // -------------------------------------------------------------------------
  app.post('/dof/:id/kapat', auth.izinGerekli('dof.kapat'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);

    if (kayit.durum === 'kapandi') {
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'Bu DÖF zaten kapatılmış.');
    }

    const etkinlikNotu = metin(req.body.etkinlik_degerlendirmesi);
    if (etkinlikNotu.length < 10 || etkinlikNotu.length > 5000) {
      return yonlendir(
        res,
        `/dof/${kayit.id}`,
        'hata',
        'Etkinlik değerlendirmesi 10-5000 karakter arasında olmalıdır.'
      );
    }

    const aksiyonlar = aksiyonlariGetir(db, kayit.id);
    if (!dof.tumAksiyonlarTamamlandi(aksiyonlar)) {
      return yonlendir(
        res,
        `/dof/${kayit.id}`,
        'hata',
        'DÖF kapatılamaz: tüm aksiyonlar tamamlanmış olmalıdır.'
      );
    }
    if (kayit.durum !== 'etkinlik_bekliyor') {
      return yonlendir(
        res,
        `/dof/${kayit.id}`,
        'hata',
        'DÖF yalnızca “Etkinlik Kontrolü Bekliyor” aşamasındayken kapatılabilir.'
      );
    }

    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE dof_kayitlari
         SET durum = 'kapandi', etkinlik_degerlendirmesi = ?, kapatan_id = ?,
             kapanis_tarihi = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(etkinlikNotu, req.kullanici.id, simdi, simdi, kayit.id);
      db.prepare(
        `UPDATE ic_tetkik_bulgulari
         SET durum = 'kapandi', guncelleme_tarihi = ?
         WHERE dof_id = ?`
      ).run(simdi, kayit.id);

      if (kayit.olusturan_id && Number(kayit.olusturan_id) !== Number(req.kullanici.id)) {
        bildirimEkle(
          db,
          kayit.olusturan_id,
          `DÖF kapandı: ${kayit.kod}`,
          `Etkinlik değerlendirmesi tamamlandı ve DÖF kapatıldı.`,
          kayit.id
        );
      }
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[dof kapatma]', hata);
      return yonlendir(res, `/dof/${kayit.id}`, 'hata', 'DÖF kapatılamadı.');
    }

    return yonlendir(res, `/dof/${kayit.id}`, 'ok', `${kayit.kod} numaralı DÖF kapatıldı.`);
  });

  // -------------------------------------------------------------------------
  // Antetli DÖF raporu PDF
  // -------------------------------------------------------------------------
  app.get('/dof/:id/pdf', async (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? dofGetir(db, id) : null;
    const tamErisim = auth.yetkiliMi(req.kullanici, 'dof');
    if (!kayit || !dofErisimiVar(db, req.kullanici, kayit, tamErisim)) return sayfaYok(res);

    const bugun = bugunOku(db, config);
    const aksiyonlar = dof.aksiyonlariCoz(aksiyonlariGetir(db, kayit.id), bugun);
    const sirket = sirketAyarlari(db);
    const indir = ['1', 'true', 'evet'].includes(queryMetin(req, 'indir').toLowerCase());
    const dosyaAdi = `${kayit.kod}.pdf`;

    let logoVerisi = null;
    if (sirket.logo) {
      const logoDosyasi = path.join(
        config.dataDir,
        'yuklemeler',
        'logo',
        path.basename(String(sirket.logo))
      );
      try {
        if (fs.existsSync(logoDosyasi)) logoVerisi = fs.readFileSync(logoDosyasi);
      } catch {
        logoVerisi = null;
      }
    }

    try {
      const pdf = await dofPdfUret({
        dof: kayit,
        aksiyonlar,
        sirket,
        logoVerisi,
        bugun,
        olusturanAd: kayit.olusturan_ad || '',
        kapatanAd: kayit.kapatan_ad || '',
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Cache-Control', 'no-store');
      res.set(
        'Content-Disposition',
        `${indir ? 'attachment' : 'inline'}; filename="${String(dosyaAdi).replace(/[^A-Za-z0-9._-]/g, '-')}"`
      );
      return res.send(pdf);
    } catch (hata) {
      console.error('[dof pdf]', hata);
      return res.status(500).render('hata', {
        aktifSayfa: 'dof',
        sayfaBaslik: 'PDF Üretilemedi',
        hataMesaji: 'DÖF raporu oluşturulurken bir hata oluştu.',
      });
    }
  });
}

module.exports = {
  dofRotalariniKur,
  dofListesi,
  dofOzeti,
};
