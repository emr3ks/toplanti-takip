'use strict';

/**
 * Eğitim Yönetimi rotaları (Faz 3).
 *
 * Yıllık eğitim planı, eğitim oluşturma/düzenleme, katılımcı yönetimi,
 * katılım sonuçları, hatırlatma e-postası ve personel eğitim sicili bu
 * modülde yer alır. app.js bu modülü oturum ve ortak yardımcılar hazır
 * olduktan sonra çağırır.
 */

const { metin, mesajliYol } = require('./dogrulama');
const { bugunTz, gunEkle, gecerliTarih, tarihTr } = require('./dates');
const { etkinAyarlar } = require('./settings');

const EGITIM_TURLERI = Object.freeze({
  ic: 'İç Eğitim',
  dis: 'Dış Eğitim',
});

const EGITIM_DURUMLARI = Object.freeze({
  planlandi: 'Planlandı',
  tamamlandi: 'Tamamlandı',
  iptal: 'İptal',
});

const KATILIM_DURUMLARI = Object.freeze({
  bekliyor: 'Bekliyor',
  katildi: 'Katıldı',
  katilmadi: 'Katılmadı',
});

const ETKINLIK_DURUMLARI = Object.freeze({
  bekliyor: 'Bekliyor',
  etkin: 'Etkin',
  etkin_degil: 'Etkin Değil',
});

const DURUM_ANAHTARLARI = Object.freeze(Object.keys(EGITIM_DURUMLARI));

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

function kimlikListesi(deger) {
  const sonuc = new Set();
  for (const parca of dizi(deger)) {
    // URLSearchParams bir dizi değeri virgülle birleştirebilir; ayrıca
    // "1,2" biçiminde gelen kimlik listelerini de kabul et.
    for (const altParca of String(parca).split(',')) {
      const sayi = Number(altParca.trim());
      if (Number.isInteger(sayi) && sayi > 0) sonuc.add(sayi);
    }
  }
  return [...sonuc];
}

function queryMetin(req, ad, varsayilan = '') {
  const deger = tekDeger(req.query[ad]);
  return typeof deger === 'string' ? deger.trim() : varsayilan;
}

/** app.js'deki yonlendir ile aynı davranış: 303 + mesaj sorgu parametresi. */
function yonlendir(res, yol, anahtar, mesaj) {
  return res.redirect(303, mesajliYol(yol, anahtar, mesaj));
}

function sayfaYok(res, baslik = 'Eğitim Bulunamadı') {
  return res.status(404).render('404', {
    aktifSayfa: 'egitim',
    sayfaBaslik: baslik,
  });
}

function tarihSinifi(durum) {
  if (durum === 'tamamlandi') return 'rozet-aktif';
  if (durum === 'iptal') return 'rozet-iptal';
  return 'rozet-beklemede';
}

function katilimSinifi(durum) {
  if (durum === 'katildi') return 'rozet-aktif';
  if (durum === 'katilmadi') return 'rozet-iptal';
  return 'rozet-beklemede';
}

function etkinlikSinifi(durum) {
  if (durum === 'etkin') return 'rozet-aktif';
  if (durum === 'etkin_degil') return 'rozet-iptal';
  return 'rozet-beklemede';
}

// ---------------------------------------------------------------------------
// Sorgu yardımcıları
// ---------------------------------------------------------------------------

function gununTarihi(db, config) {
  return bugunTz(etkinAyarlar(db, config).saatDilimi);
}

function egitimGetir(db, id) {
  return db
    .prepare(
      `SELECT e.*, d.kod AS dokuman_kod, d.baslik AS dokuman_baslik,
              d.durum AS dokuman_durum, o.ad AS olusturan_ad, o.email AS olusturan_email
       FROM egitimler e
       LEFT JOIN dokumanlar d ON d.id = e.dokuman_id
       LEFT JOIN kullanicilar o ON o.id = e.olusturan_id
       WHERE e.id = ?`
    )
    .get(id);
}

function katilimcilariGetir(db, egitimId) {
  return db
    .prepare(
      `SELECT kk.*, k.ad, k.email, k.aktif, d.ad AS departman_ad
       FROM egitim_katilimcilari kk
       JOIN kullanicilar k ON k.id = kk.kullanici_id
       LEFT JOIN departmanlar d ON d.id = k.departman_id
       WHERE kk.egitim_id = ?
       ORDER BY k.ad COLLATE NOCASE, k.id`
    )
    .all(egitimId);
}

function departmanlarGetir(db) {
  return db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM kullanicilar k
                WHERE k.departman_id = d.id AND k.aktif = 1) AS kullanici_sayisi
       FROM departmanlar d
       ORDER BY d.ad COLLATE NOCASE`
    )
    .all();
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

function yayindakiDokumanlar(db) {
  return db
    .prepare(
      `SELECT d.id, d.kod, d.baslik, d.revizyon, d.durum, t.ad AS tur_ad
       FROM dokumanlar d
       JOIN dokuman_turleri t ON t.kod = d.tur_kod
       WHERE d.durum = 'yayinda'
       ORDER BY d.kod COLLATE NOCASE, d.revizyon DESC`
    )
    .all();
}

/**
 * Aktif kullanıcıları departmanlarına göre gruplar.
 * `haricIdler` verilirse bu kullanıcılar listelenmez (ör. zaten katılımcı).
 */
function katilimciGruplari(departmanlar, kullanicilar, haricIdler = new Set()) {
  const harita = new Map();
  const gruplar = departmanlar.map((departman) => {
    const grup = { ...departman, kullanicilar: [] };
    harita.set(departman.id, grup);
    return grup;
  });
  const departmansiz = [];
  for (const kisi of kullanicilar) {
    if (haricIdler.has(kisi.id)) continue;
    const grup = kisi.departman_id ? harita.get(kisi.departman_id) : null;
    if (grup) grup.kullanicilar.push(kisi);
    else departmansiz.push(kisi);
  }
  return {
    gruplar: gruplar.filter((grup) => grup.kullanicilar.length > 0 || grup.kullanici_sayisi > 0),
    departmansiz,
  };
}

function ozetHesapla(katilimcilar) {
  const ozet = {
    toplam: katilimcilar.length,
    katildi: 0,
    katilmadi: 0,
    bekliyor: 0,
    etkin: 0,
    etkinDegil: 0,
    sertifika: 0,
    puanToplam: 0,
    puanSayisi: 0,
  };
  for (const kisi of katilimcilar) {
    if (kisi.katilim_durumu === 'katildi') ozet.katildi += 1;
    else if (kisi.katilim_durumu === 'katilmadi') ozet.katilmadi += 1;
    else ozet.bekliyor += 1;

    if (kisi.etkinlik_durumu === 'etkin') ozet.etkin += 1;
    else if (kisi.etkinlik_durumu === 'etkin_degil') ozet.etkinDegil += 1;

    if (String(kisi.sertifika_no || '').trim()) ozet.sertifika += 1;

    const puan = Number(kisi.degerlendirme_puani);
    if (kisi.degerlendirme_puani !== null && Number.isFinite(puan)) {
      ozet.puanToplam += puan;
      ozet.puanSayisi += 1;
    }
  }
  const katilimPayda = ozet.katildi + ozet.katilmadi;
  const etkinlikPayda = ozet.etkin + ozet.etkinDegil;
  return {
    ...ozet,
    ortalama:
      ozet.puanSayisi > 0
        ? (ozet.puanToplam / ozet.puanSayisi).toFixed(1).replace('.', ',')
        : null,
    katilimOrani: katilimPayda > 0 ? Math.round((ozet.katildi / katilimPayda) * 100) : null,
    etkinlikOrani: etkinlikPayda > 0 ? Math.round((ozet.etkin / etkinlikPayda) * 100) : null,
  };
}

function katilimciIdleriniCoz(db, body) {
  const departmanIdler = kimlikListesi(body.departmanlar);
  const kullaniciIdler = kimlikListesi(body.kullanicilar);
  const sonuc = new Set();

  if (departmanIdler.length) {
    const yerler = departmanIdler.map(() => '?').join(', ');
    const satirlar = db
      .prepare(`SELECT id FROM kullanicilar WHERE aktif = 1 AND departman_id IN (${yerler})`)
      .all(...departmanIdler);
    for (const satir of satirlar) sonuc.add(satir.id);
  }

  const kisiSorgu = db.prepare('SELECT id FROM kullanicilar WHERE id = ? AND aktif = 1');
  for (const id of kullaniciIdler) {
    if (kisiSorgu.get(id)) sonuc.add(id);
  }

  return [...sonuc];
}

function bildirimleriEkle(db, { egitimId, ad, tarih, egitmen, kullaniciIdler }) {
  const ekle = db.prepare(
    `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, dokuman_id)
     VALUES (?, 'egitim', ?, ?, ?, NULL)`
  );
  const baslik = `Yeni eğitim: ${ad}`.slice(0, 200);
  const mesaj = `${tarihTr(tarih)} · ${egitmen || 'Eğitmen belirtilmedi'}. Eğitim detayını görüntüleyin.`.slice(
    0,
    500
  );
  for (const kullaniciId of kullaniciIdler) {
    ekle.run(kullaniciId, baslik, mesaj, `/egitim/${egitimId}`);
  }
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

/** Eğitim alanlarını doğrular. Hata varsa { hata }, yoksa { degerler } döner. */
function egitimDegerleriniDogrula(db, body, izinliDokumanId = null) {
  const ad = metin(body.ad);
  if (ad.length < 3 || ad.length > 160) {
    return { hata: 'Eğitim adı 3-160 karakter arasında olmalıdır.' };
  }

  const tur = metin(body.tur);
  if (!Object.prototype.hasOwnProperty.call(EGITIM_TURLERI, tur)) {
    return { hata: 'Eğitim türü geçersiz. İç veya dış eğitim seçin.' };
  }

  const egitmen = metin(body.egitmen);
  if (egitmen.length > 120) {
    return { hata: 'Eğitmen adı en fazla 120 karakter olabilir.' };
  }

  const planlananTarih = metin(body.planlanan_tarih);
  if (!gecerliTarih(planlananTarih)) {
    return { hata: 'Geçerli bir planlanan tarih seçin (YYYY-AA-GG).' };
  }

  const sureMetni = metin(body.sure_saat).replace(',', '.');
  const sure = Number(sureMetni);
  if (!sureMetni || !Number.isFinite(sure) || sure < 0.5 || sure > 100) {
    return { hata: 'Eğitim süresi 0,5 ile 100 saat arasında olmalıdır.' };
  }

  const aciklama = metin(body.aciklama);
  if (aciklama.length > 1000) {
    return { hata: 'Açıklama en fazla 1000 karakter olabilir.' };
  }

  let dokumanId = null;
  const hamDokuman = metin(body.dokuman_id);
  if (hamDokuman) {
    const secilen = Number(hamDokuman);
    if (!Number.isInteger(secilen) || secilen <= 0) {
      return { hata: 'Seçilen ilgili doküman geçersiz.' };
    }
    if (izinliDokumanId && secilen === izinliDokumanId) {
      dokumanId = secilen;
    } else {
      const dokuman = db
        .prepare("SELECT id FROM dokumanlar WHERE id = ? AND durum = 'yayinda'")
        .get(secilen);
      if (!dokuman) {
        return { hata: 'Seçilen doküman bulunamadı veya yayında değil.' };
      }
      dokumanId = dokuman.id;
    }
  }

  return {
    degerler: {
      ad,
      tur,
      egitmen,
      planlanan_tarih: planlananTarih,
      sure_saat: Math.round(sure * 100) / 100,
      dokuman_id: dokumanId,
      aciklama,
    },
  };
}

function hatirlatmaSayisi(sonuc, varsayilan) {
  if (typeof sonuc === 'number' && Number.isFinite(sonuc)) {
    return Math.max(0, Math.trunc(sonuc));
  }
  if (Array.isArray(sonuc)) return sonuc.length;
  if (sonuc && typeof sonuc === 'object') {
    for (const anahtar of [
      'gonderilen',
      'gonderilenSayi',
      'gonderimSayisi',
      'sayi',
      'adet',
    ]) {
      const deger = sonuc[anahtar];
      if (Array.isArray(deger)) return deger.length;
      const sayi = Number(deger);
      if (Number.isFinite(sayi)) return Math.max(0, Math.trunc(sayi));
    }
    for (const anahtar of ['sonuclar', 'kayitlar', 'alicilar']) {
      if (Array.isArray(sonuc[anahtar])) return sonuc[anahtar].length;
    }
  }
  return varsayilan;
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

function egitimRotalariniKur(app, { db, auth, mail, config }) {
  app.locals.EGITIM_TURLERI = EGITIM_TURLERI;
  app.locals.EGITIM_DURUMLARI = EGITIM_DURUMLARI;
  app.locals.EGITIM_KATILIM_DURUMLARI = KATILIM_DURUMLARI;
  app.locals.EGITIM_ETKINLIK_DURUMLARI = ETKINLIK_DURUMLARI;
  app.locals.egitimDurumSinifi = tarihSinifi;
  app.locals.katilimDurumuSinifi = katilimSinifi;
  app.locals.etkinlikDurumuSinifi = etkinlikSinifi;

  // -------------------------------------------------------------------------
  // Yıllık eğitim planı
  // -------------------------------------------------------------------------
  app.get('/egitim', (req, res) => {
    const bugun = gununTarihi(db, config);
    const buYil = Number(bugun.slice(0, 4));

    const yilHam = Number(queryMetin(req, 'yil'));
    const yil = Number.isInteger(yilHam) && yilHam >= 2000 && yilHam <= 2100 ? yilHam : buYil;

    const durumHam = queryMetin(req, 'durum', 'hepsi');
    const durum = ['hepsi', ...DURUM_ANAHTARLARI].includes(durumHam) ? durumHam : 'hepsi';
    const arama = queryMetin(req, 'q').slice(0, 100);

    const kosullar = ['substr(e.planlanan_tarih, 1, 4) = ?'];
    const parametreler = [String(yil)];
    if (durum !== 'hepsi') {
      kosullar.push('e.durum = ?');
      parametreler.push(durum);
    }
    if (arama) {
      const desen = `%${arama}%`;
      kosullar.push('(e.ad LIKE ? OR e.egitmen LIKE ?)');
      parametreler.push(desen, desen);
    }

    const egitimler = db
      .prepare(
        `SELECT e.*, d.kod AS dokuman_kod, d.baslik AS dokuman_baslik,
                (SELECT COUNT(*) FROM egitim_katilimcilari k WHERE k.egitim_id = e.id) AS katilimci_sayisi,
                (SELECT COUNT(*) FROM egitim_katilimcilari k
                  WHERE k.egitim_id = e.id AND k.katilim_durumu = 'katildi') AS katilan_sayisi
         FROM egitimler e
         LEFT JOIN dokumanlar d ON d.id = e.dokuman_id
         WHERE ${kosullar.join(' AND ')}
         ORDER BY e.planlanan_tarih DESC, e.id DESC
         LIMIT 500`
      )
      .all(...parametreler);

    const durumSayilari = db
      .prepare(
        `SELECT e.durum, COUNT(*) AS sayi
         FROM egitimler e
         WHERE substr(e.planlanan_tarih, 1, 4) = ?
         GROUP BY e.durum`
      )
      .all(String(yil));

    const durumMap = {};
    for (const satir of durumSayilari) durumMap[satir.durum] = satir.sayi;

    const katilimOzeti = db
      .prepare(
        `SELECT
           COUNT(*) AS toplam,
           COALESCE(SUM(CASE WHEN kk.katilim_durumu = 'katildi' THEN 1 ELSE 0 END), 0) AS katildi,
           COALESCE(SUM(CASE WHEN kk.katilim_durumu = 'katilmadi' THEN 1 ELSE 0 END), 0) AS katilmadi,
           AVG(kk.degerlendirme_puani) AS ortalama
         FROM egitim_katilimcilari kk
         JOIN egitimler e ON e.id = kk.egitim_id
         WHERE substr(e.planlanan_tarih, 1, 4) = ? AND e.durum <> 'iptal'`
      )
      .get(String(yil));

    const katilimPayda = Number(katilimOzeti.katildi) + Number(katilimOzeti.katilmadi);
    const ozet = {
      toplam: (durumMap.planlandi || 0) + (durumMap.tamamlandi || 0) + (durumMap.iptal || 0),
      planlanan: durumMap.planlandi || 0,
      tamamlanan: durumMap.tamamlandi || 0,
      iptal: durumMap.iptal || 0,
      katilimci: Number(katilimOzeti.toplam) || 0,
      katilimOrani: katilimPayda > 0 ? Math.round((Number(katilimOzeti.katildi) / katilimPayda) * 100) : null,
      ortalamaPuan:
        katilimOzeti.ortalama !== null && Number.isFinite(Number(katilimOzeti.ortalama))
          ? Number(katilimOzeti.ortalama).toFixed(1).replace('.', ',')
          : null,
    };

    const yaklasanlar = db
      .prepare(
        `SELECT e.*, d.kod AS dokuman_kod,
                (SELECT COUNT(*) FROM egitim_katilimcilari k WHERE k.egitim_id = e.id) AS katilimci_sayisi
         FROM egitimler e
         LEFT JOIN dokumanlar d ON d.id = e.dokuman_id
         WHERE e.durum = 'planlandi' AND e.planlanan_tarih >= ? AND e.planlanan_tarih <= ?
         ORDER BY e.planlanan_tarih ASC, e.id ASC
         LIMIT 12`
      )
      .all(bugun, gunEkle(bugun, 30));

    const yilKayitlari = db
      .prepare("SELECT DISTINCT substr(planlanan_tarih, 1, 4) AS yil FROM egitimler")
      .all()
      .map((satir) => Number(satir.yil))
      .filter((deger) => Number.isInteger(deger) && deger > 0);
    const yillar = [...new Set([...yilKayitlari, buYil - 1, buYil, buYil + 1, yil])].sort(
      (a, b) => b - a
    );

    res.render('egitim', {
      aktifSayfa: 'egitim',
      sayfaBaslik: 'Eğitim Yönetimi',
      yil,
      yillar,
      durum,
      arama,
      egitimler,
      ozet,
      yaklasanlar,
    });
  });

  // -------------------------------------------------------------------------
  // Yeni eğitim
  // -------------------------------------------------------------------------
  app.get('/egitim/yeni', auth.izinGerekli('egitim'), (req, res) => {
    const bugun = gununTarihi(db, config);
    const { gruplar, departmansiz } = katilimciGruplari(
      departmanlarGetir(db),
      aktifKullanicilar(db)
    );

    res.render('egitim-yeni', {
      aktifSayfa: 'egitim',
      sayfaBaslik: 'Yeni Eğitim',
      gruplar,
      departmansiz,
      dokumanlar: yayindakiDokumanlar(db),
      form: {
        ad: '',
        tur: 'ic',
        egitmen: '',
        planlanan_tarih: bugun,
        sure_saat: '1',
        dokuman_id: '',
        aciklama: '',
      },
    });
  });

  app.post('/egitim/yeni', auth.izinGerekli('egitim'), (req, res) => {
    const kontrol = egitimDegerleriniDogrula(db, req.body);
    if (kontrol.hata) return yonlendir(res, '/egitim/yeni', 'hata', kontrol.hata);

    const katilimcilar = katilimciIdleriniCoz(db, req.body);
    if (!katilimcilar.length) {
      return yonlendir(
        res,
        '/egitim/yeni',
        'hata',
        'En az bir katılımcı seçmelisiniz. Departman veya kişi seçimi yapın.'
      );
    }

    const degerler = kontrol.degerler;
    const simdi = new Date().toISOString();
    let egitimId = null;

    db.exec('BEGIN IMMEDIATE');
    try {
      const bilgi = db
        .prepare(
          `INSERT INTO egitimler
             (ad, tur, egitmen, planlanan_tarih, sure_saat, dokuman_id, aciklama, durum,
              olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'planlandi', ?, ?, ?)`
        )
        .run(
          degerler.ad,
          degerler.tur,
          degerler.egitmen,
          degerler.planlanan_tarih,
          degerler.sure_saat,
          degerler.dokuman_id,
          degerler.aciklama,
          req.kullanici.id,
          simdi,
          simdi
        );
      egitimId = Number(bilgi.lastInsertRowid);

      const ekle = db.prepare(
        `INSERT OR IGNORE INTO egitim_katilimcilari (egitim_id, kullanici_id, olusturma_tarihi)
         VALUES (?, ?, ?)`
      );
      for (const kullaniciId of katilimcilar) ekle.run(egitimId, kullaniciId, simdi);

      bildirimleriEkle(db, {
        egitimId,
        ad: degerler.ad,
        tarih: degerler.planlanan_tarih,
        egitmen: degerler.egitmen,
        kullaniciIdler: katilimcilar,
      });

      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[eğitim oluşturma]', hata);
      return yonlendir(
        res,
        '/egitim/yeni',
        'hata',
        'Eğitim kaydedilemedi. Lütfen tekrar deneyin.'
      );
    }

    return yonlendir(
      res,
      `/egitim/${egitimId}`,
      'ok',
      `Eğitim oluşturuldu · ${katilimcilar.length} katılımcı eklendi.`
    );
  });

  // -------------------------------------------------------------------------
  // Personel eğitim sicili (liste) — /egitim/:id'den ÖNCE tanımlanmalı
  // -------------------------------------------------------------------------
  app.get('/egitim/personel', (req, res) => {
    const yonetici = auth.yetkiliMi(req.kullanici, 'egitim');
    if (!yonetici) {
      return res.redirect(303, `/egitim/personel/${req.kullanici.id}`);
    }

    const arama = queryMetin(req, 'q').slice(0, 100);
    const kosullar = ['k.aktif = 1'];
    const parametreler = [];
    if (arama) {
      const desen = `%${arama}%`;
      kosullar.push('(k.ad LIKE ? OR k.email LIKE ? OR d.ad LIKE ?)');
      parametreler.push(desen, desen, desen);
    }

    const kisiler = db
      .prepare(
        `SELECT k.id, k.ad, k.email, k.rol, d.ad AS departman_ad,
                COUNT(e.id) AS toplam,
                COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND kk.katilim_durumu = 'katildi'
                                  THEN 1 ELSE 0 END), 0) AS katildi,
                COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND kk.katilim_durumu = 'katilmadi'
                                  THEN 1 ELSE 0 END), 0) AS katilmadi,
                COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND TRIM(kk.sertifika_no) <> ''
                                  THEN 1 ELSE 0 END), 0) AS sertifika,
                AVG(CASE WHEN e.id IS NOT NULL THEN kk.degerlendirme_puani END) AS ortalama,
                MAX(e.planlanan_tarih) AS son_tarih
         FROM kullanicilar k
         LEFT JOIN departmanlar d ON d.id = k.departman_id
         LEFT JOIN egitim_katilimcilari kk ON kk.kullanici_id = k.id
         LEFT JOIN egitimler e ON e.id = kk.egitim_id AND e.durum <> 'iptal'
         WHERE ${kosullar.join(' AND ')}
         GROUP BY k.id
         ORDER BY k.ad COLLATE NOCASE`
      )
      .all(...parametreler);

    res.render('egitim-personel', {
      aktifSayfa: 'egitim-personel',
      sayfaBaslik: 'Personel Eğitim Sicili',
      mod: 'liste',
      kisi: null,
      kisiler,
      arama,
    });
  });

  app.get('/egitim/personel/:id', (req, res) => {
    const kisiId = kimlik(req.params.id);
    const kisi = kisiId
      ? db
          .prepare(
            `SELECT k.*, d.ad AS departman_ad
             FROM kullanicilar k
             LEFT JOIN departmanlar d ON d.id = k.departman_id
             WHERE k.id = ?`
          )
          .get(kisiId)
      : null;
    if (!kisi) return sayfaYok(res, 'Personel Bulunamadı');

    const yonetici = auth.yetkiliMi(req.kullanici, 'egitim');
    const kendi = req.kullanici.id === kisi.id;
    if (!yonetici && !kendi) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'egitim-personel',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'egitim',
      });
    }

    const kayitlar = db
      .prepare(
        `SELECT kk.*, e.ad, e.tur, e.egitmen, e.planlanan_tarih, e.sure_saat,
                e.durum AS egitim_durumu, e.dokuman_id
         FROM egitim_katilimcilari kk
         JOIN egitimler e ON e.id = kk.egitim_id
         WHERE kk.kullanici_id = ? AND e.durum <> 'iptal'
         ORDER BY e.planlanan_tarih DESC, e.id DESC`
      )
      .all(kisi.id);

    const ozet = ozetHesapla(kayitlar);
    const sonTarih = kayitlar.length ? kayitlar[0].planlanan_tarih : null;

    res.render('egitim-personel', {
      aktifSayfa: 'egitim-personel',
      sayfaBaslik: `${kisi.ad} · Eğitim Sicili`,
      mod: 'kisi',
      kisi,
      kayitlar,
      ozet,
      sonTarih,
      yonetici,
      kendi,
    });
  });

  // -------------------------------------------------------------------------
  // Eğitim detayı
  // -------------------------------------------------------------------------
  app.get('/egitim/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    db.prepare('UPDATE bildirimler SET okundu = 1 WHERE kullanici_id = ? AND baglanti = ?').run(
      req.kullanici.id,
      `/egitim/${egitim.id}`
    );

    const katilimcilar = katilimcilariGetir(db, egitim.id);
    const ozet = ozetHesapla(katilimcilar);
    const yonetici = auth.yetkiliMi(req.kullanici, 'egitim');

    let dokumanlar = yayindakiDokumanlar(db);
    if (egitim.dokuman_id && !dokumanlar.some((dokuman) => dokuman.id === egitim.dokuman_id)) {
      const mevcut = db
        .prepare(
          `SELECT d.id, d.kod, d.baslik, d.revizyon, d.durum, t.ad AS tur_ad
           FROM dokumanlar d
           JOIN dokuman_turleri t ON t.kod = d.tur_kod
           WHERE d.id = ?`
        )
        .get(egitim.dokuman_id);
      if (mevcut) dokumanlar = [mevcut, ...dokumanlar];
    }

    const mevcutIdler = new Set(katilimcilar.map((kisi) => kisi.kullanici_id));
    const { gruplar, departmansiz } = katilimciGruplari(
      departmanlarGetir(db),
      aktifKullanicilar(db),
      mevcutIdler
    );

    const sonHatirlatma = db
      .prepare(
        'SELECT MAX(hatirlatma_tarihi) AS son FROM egitim_katilimcilari WHERE egitim_id = ?'
      )
      .get(egitim.id).son;

    res.render('egitim-detay', {
      aktifSayfa: 'egitim',
      sayfaBaslik: egitim.ad,
      egitim,
      katilimcilar,
      ozet,
      yonetici,
      dokumanlar,
      gruplar,
      departmansiz,
      sonHatirlatma,
    });
  });

  app.post('/egitim/:id', auth.izinGerekli('egitim'), (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    const kontrol = egitimDegerleriniDogrula(db, req.body, egitim.dokuman_id);
    if (kontrol.hata) return yonlendir(res, `/egitim/${egitim.id}`, 'hata', kontrol.hata);

    const degerler = kontrol.degerler;
    try {
      db.prepare(
        `UPDATE egitimler
         SET ad = ?, tur = ?, egitmen = ?, planlanan_tarih = ?, sure_saat = ?,
             dokuman_id = ?, aciklama = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(
        degerler.ad,
        degerler.tur,
        degerler.egitmen,
        degerler.planlanan_tarih,
        degerler.sure_saat,
        degerler.dokuman_id,
        degerler.aciklama,
        new Date().toISOString(),
        egitim.id
      );
    } catch (hata) {
      console.error('[eğitim güncelleme]', hata);
      return yonlendir(res, `/egitim/${egitim.id}`, 'hata', 'Eğitim güncellenemedi.');
    }

    return yonlendir(res, `/egitim/${egitim.id}`, 'ok', 'Eğitim bilgileri güncellendi.');
  });

  app.post('/egitim/:id/katilimcilar', auth.izinGerekli('egitim'), (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    const secilenler = katilimciIdleriniCoz(db, req.body);
    if (!secilenler.length) {
      return yonlendir(
        res,
        `/egitim/${egitim.id}`,
        'hata',
        'Eklenecek en az bir katılımcı seçin.'
      );
    }

    const simdi = new Date().toISOString();
    let eklenen = 0;
    const yeniIdler = [];

    db.exec('BEGIN IMMEDIATE');
    try {
      const ekle = db.prepare(
        `INSERT OR IGNORE INTO egitim_katilimcilari (egitim_id, kullanici_id, olusturma_tarihi)
         VALUES (?, ?, ?)`
      );
      for (const kullaniciId of secilenler) {
        const bilgi = ekle.run(egitim.id, kullaniciId, simdi);
        if (Number(bilgi.changes) > 0) {
          eklenen += 1;
          yeniIdler.push(kullaniciId);
        }
      }
      if (eklenen === 0) {
        db.exec('ROLLBACK');
        return yonlendir(
          res,
          `/egitim/${egitim.id}`,
          'hata',
          'Seçilen kişiler zaten bu eğitimin katılımcısı.'
        );
      }
      if (yeniIdler.length) {
        bildirimleriEkle(db, {
          egitimId: egitim.id,
          ad: egitim.ad,
          tarih: egitim.planlanan_tarih,
          egitmen: egitim.egitmen,
          kullaniciIdler: yeniIdler,
        });
      }
      db.prepare('UPDATE egitimler SET guncelleme_tarihi = ? WHERE id = ?').run(simdi, egitim.id);
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[eğitim katılımcı ekleme]', hata);
      return yonlendir(res, `/egitim/${egitim.id}`, 'hata', 'Katılımcılar eklenemedi.');
    }

    return yonlendir(
      res,
      `/egitim/${egitim.id}`,
      'ok',
      `${eklenen} yeni katılımcı eklendi.`
    );
  });

  app.post('/egitim/:id/sonuclar', auth.izinGerekli('egitim'), (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    const katilimciIdler = kimlikListesi(req.body.katilimci_id);
    if (!katilimciIdler.length) {
      return yonlendir(res, `/egitim/${egitim.id}`, 'hata', 'Kaydedilecek katılımcı bulunamadı.');
    }

    const mevcutlar = new Map(
      db
        .prepare('SELECT * FROM egitim_katilimcilari WHERE egitim_id = ?')
        .all(egitim.id)
        .map((satir) => [satir.id, satir])
    );

    const yazilacak = [];
    for (const katilimciId of [...new Set(katilimciIdler)]) {
      const mevcut = mevcutlar.get(katilimciId);
      if (!mevcut) continue;

      const alanVar = (ad) => Object.prototype.hasOwnProperty.call(req.body, ad);

      const katilim = metin(req.body[`katilim_${katilimciId}`]) || mevcut.katilim_durumu;
      if (!Object.prototype.hasOwnProperty.call(KATILIM_DURUMLARI, katilim)) {
        return yonlendir(
          res,
          `/egitim/${egitim.id}`,
          'hata',
          'Katılım durumu geçersiz. Sayfayı yenileyip tekrar deneyin.'
        );
      }

      const etkinlik = metin(req.body[`etkinlik_${katilimciId}`]) || mevcut.etkinlik_durumu;
      if (!Object.prototype.hasOwnProperty.call(ETKINLIK_DURUMLARI, etkinlik)) {
        return yonlendir(
          res,
          `/egitim/${egitim.id}`,
          'hata',
          'Etkinlik durumu geçersiz. Sayfayı yenileyip tekrar deneyin.'
        );
      }

      const puanAnahtari = `puan_${katilimciId}`;
      let puan = mevcut.degerlendirme_puani;
      if (alanVar(puanAnahtari)) {
        const puanMetni = metin(req.body[puanAnahtari]).replace(',', '.');
        if (!puanMetni) {
          puan = null;
        } else {
          const sayi = Number(puanMetni);
          if (!Number.isFinite(sayi) || sayi < 0 || sayi > 100) {
            return yonlendir(
              res,
              `/egitim/${egitim.id}`,
              'hata',
              'Değerlendirme puanı 0 ile 100 arasında olmalıdır.'
            );
          }
          puan = Math.round(sayi * 10) / 10;
        }
      }

      const sertifikaAnahtari = `sertifika_${katilimciId}`;
      const sertifika = alanVar(sertifikaAnahtari)
        ? metin(req.body[sertifikaAnahtari])
        : mevcut.sertifika_no;
      if (sertifika.length > 80) {
        return yonlendir(
          res,
          `/egitim/${egitim.id}`,
          'hata',
          'Sertifika numarası en fazla 80 karakter olabilir.'
        );
      }

      const notAnahtari = `not_${katilimciId}`;
      const notMetni = alanVar(notAnahtari)
        ? metin(req.body[notAnahtari])
        : mevcut.not_metni;
      if (notMetni.length > 1000) {
        return yonlendir(
          res,
          `/egitim/${egitim.id}`,
          'hata',
          'Katılımcı notu en fazla 1000 karakter olabilir.'
        );
      }

      yazilacak.push({ katilimciId, katilim, puan, etkinlik, sertifika, notMetni });
    }

    if (!yazilacak.length) {
      return yonlendir(
        res,
        `/egitim/${egitim.id}`,
        'hata',
        'Bu eğitime ait güncellenecek katılımcı bulunamadı.'
      );
    }

    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const guncelle = db.prepare(
        `UPDATE egitim_katilimcilari
         SET katilim_durumu = ?, degerlendirme_puani = ?, etkinlik_durumu = ?,
             sertifika_no = ?, not_metni = ?
         WHERE id = ? AND egitim_id = ?`
      );
      for (const kayit of yazilacak) {
        guncelle.run(
          kayit.katilim,
          kayit.puan,
          kayit.etkinlik,
          kayit.sertifika,
          kayit.notMetni,
          kayit.katilimciId,
          egitim.id
        );
      }
      db.prepare('UPDATE egitimler SET guncelleme_tarihi = ? WHERE id = ?').run(simdi, egitim.id);
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[eğitim sonuçları]', hata);
      return yonlendir(
        res,
        `/egitim/${egitim.id}`,
        'hata',
        'Katılım sonuçları kaydedilemedi.'
      );
    }

    return yonlendir(
      res,
      `/egitim/${egitim.id}`,
      'ok',
      `Katılım sonuçları kaydedildi (${yazilacak.length} katılımcı).`
    );
  });

  app.post('/egitim/:id/durum', auth.izinGerekli('egitim'), (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    const durum = metin(req.body.durum);
    if (!Object.prototype.hasOwnProperty.call(EGITIM_DURUMLARI, durum)) {
      return yonlendir(res, `/egitim/${egitim.id}`, 'hata', 'Eğitim durumu geçersiz.');
    }

    try {
      db.prepare('UPDATE egitimler SET durum = ?, guncelleme_tarihi = ? WHERE id = ?').run(
        durum,
        new Date().toISOString(),
        egitim.id
      );
    } catch (hata) {
      console.error('[eğitim durumu]', hata);
      return yonlendir(res, `/egitim/${egitim.id}`, 'hata', 'Eğitim durumu güncellenemedi.');
    }

    return yonlendir(
      res,
      `/egitim/${egitim.id}`,
      'ok',
      `Eğitim durumu “${EGITIM_DURUMLARI[durum]}” olarak güncellendi.`
    );
  });

  // -------------------------------------------------------------------------
  // Hatırlatma e-postası
  // -------------------------------------------------------------------------
  app.post('/egitim/:id/hatirlat', auth.izinGerekli('egitim'), async (req, res) => {
    const id = kimlik(req.params.id);
    const egitim = id ? egitimGetir(db, id) : null;
    if (!egitim) return sayfaYok(res);

    let sonuc;
    try {
      // Bildirim modülü başka bir çalışan tarafından hazırlanıyor olabilir.
      // Modül yoksa veya gönderim desteklenmiyorsa sayfa 500 vermemeli.
      // eslint-disable-next-line global-require
      const bildirimler = require('./bildirimler');
      if (typeof bildirimler.egitimHatirlatmalariGonder !== 'function') {
        throw new Error('Eğitim hatırlatma fonksiyonu bulunamadı.');
      }
      sonuc = await bildirimler.egitimHatirlatmalariGonder({
        db,
        mail,
        config,
        egitimId: egitim.id,
        gun: 7,
      });
      if (sonuc && typeof sonuc === 'object' && sonuc.ok === false) {
        throw new Error(metin(sonuc.hata) || 'Hatırlatma e-postası gönderilemedi.');
      }
    } catch (hata) {
      console.error('[eğitim hatırlatma]', hata);
      return yonlendir(
        res,
        `/egitim/${egitim.id}`,
        'hata',
        'Hatırlatma e-postası gönderilemedi. E-posta bildirim modülü kullanılamıyor olabilir; daha sonra tekrar deneyin.'
      );
    }

    const katilimciSayisi = db
      .prepare('SELECT COUNT(*) AS sayi FROM egitim_katilimcilari WHERE egitim_id = ?')
      .get(egitim.id).sayi;
    const gonderilen = hatirlatmaSayisi(sonuc, katilimciSayisi);
    const testNotu = res.locals.testModu ? ' (test modunda kayıt)' : '';

    return yonlendir(
      res,
      `/egitim/${egitim.id}`,
      'ok',
      `${gonderilen} katılımcıya hatırlatma e-postası gönderildi${testNotu}.`
    );
  });
}

module.exports = { egitimRotalariniKur };
