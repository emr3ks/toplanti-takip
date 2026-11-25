'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const {
  bugunTz,
  gunFarki,
  tarihTr,
  zamanTr,
} = require('./dates');
const {
  EPOSTA_DURUMLARI,
  EPOSTA_TURLERI,
} = require('./sabitler');
const { epostaGecerli, guvenliDonus, mesajliYol, metin } = require('./dogrulama');
const {
  ayarlarFormu,
  ayarlariKaydet,
  etkinAyarlar,
  guvenliAyarlar,
  mailModu,
  sirketAyarlari,
  sirketAyarlariKaydet,
  testModuEtkin,
} = require('./settings');
const { MailService } = require('./mailer');
const {
  gonderimZamani,
  testEpostasiHtml,
} = require('./emails');
const auth = require('./auth');
const qdms = require('./qdms');
const { pdfUret, logoVerisiCoz } = require('./pdf');
const bildirimler = require('./bildirimler');
const { dofOzeti } = require('./dof-rotalari');
const { tetkikOzeti } = require('./tetkik-rotalari');

const SAYFA_ADLARI = Object.freeze({
  dashboard: 'Genel Bakış',
  dokumanlar: 'Doküman Yönetimi',
  'dokuman-yeni': 'Yeni Doküman',
  sablonlar: 'Doküman Şablon Tasarımcısı',
  egitim: 'Eğitim Yönetimi',
  'egitim-yeni': 'Yeni Eğitim',
  'egitim-detay': 'Eğitim Detayı',
  'egitim-personel': 'Personel Eğitim Sicili',
  dof: 'DÖF Yönetimi',
  'dof-yeni': 'Yeni DÖF',
  'dof-detay': 'DÖF Detayı',
  tetkik: 'İç Tetkik Yönetimi',
  'tetkik-yeni': 'Yeni İç Tetkik',
  'tetkik-detay': 'İç Tetkik Detayı',
  'tetkik-takvim': 'İç Tetkik Takvimi',
  'tetkik-checklistler': 'Denetim Kontrol Listeleri',
  raporlar: 'Raporlar',
  organizasyon: 'Organizasyon ve Kullanıcılar',
  emailler: 'E-posta Günlüğü',
  ayarlar: 'Sistem Ayarları',
});

const DOKUMAN_SORGU = `
  SELECT d.*, t.ad AS tur_ad,
    h.ad AS hazirlayan_ad, h.email AS hazirlayan_email,
    o.ad AS onaylayan_ad,
    (SELECT COUNT(*) FROM dokuman_okumalari r WHERE r.dokuman_id = d.id) AS okuyucu_sayisi,
    (SELECT COUNT(*) FROM dokuman_okumalari r WHERE r.dokuman_id = d.id AND r.okundu = 1) AS okuyan_sayisi
  FROM dokumanlar d
  JOIN dokuman_turleri t ON t.kod = d.tur_kod
  LEFT JOIN kullanicilar h ON h.id = d.hazirlayan_id
  LEFT JOIN kullanicilar o ON o.id = d.onaylayan_id
`;

function tekDeger(deger) {
  return Array.isArray(deger) ? deger[0] : deger;
}

function dizi(deger) {
  if (Array.isArray(deger)) return deger;
  if (deger === undefined || deger === null) return [];
  return [deger];
}

function queryMetin(req, ad, varsayilan = '') {
  const deger = tekDeger(req.query[ad]);
  return typeof deger === 'string' ? deger.trim() : varsayilan;
}

function kimlik(deger) {
  const sayi = Number(tekDeger(deger));
  return Number.isInteger(sayi) && sayi > 0 ? sayi : null;
}

function kimlikListesi(deger) {
  const sonuc = new Set();
  for (const parca of dizi(deger)) {
    const sayi = Number(parca);
    if (Number.isInteger(sayi) && sayi > 0) sonuc.add(sayi);
  }
  return [...sonuc];
}

function basHarfler(ad) {
  const parcalar = String(ad || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const harfler = ((parcalar[0] || '')[0] || '') + ((parcalar[1] || '')[0] || '');
  return harfler ? harfler.toLocaleUpperCase('tr-TR') : '?';
}

function kisaMetin(deger, uzunluk = 90) {
  const metinDegeri = String(deger || '');
  return metinDegeri.length > uzunluk ? `${metinDegeri.slice(0, uzunluk - 1)}…` : metinDegeri;
}

function createApp({ db, config, mailService = null }) {
  const mail = mailService || new MailService({ db, config });
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.kok, 'views'));

  app.locals.SAYFA_ADLARI = SAYFA_ADLARI;
  app.locals.EPOSTA_DURUMLARI = EPOSTA_DURUMLARI;
  app.locals.EPOSTA_TURLERI = EPOSTA_TURLERI;
  app.locals.DOKUMAN_TURLERI = qdms.DOKUMAN_TURLERI;
  app.locals.DOKUMAN_DURUMLARI = qdms.DOKUMAN_DURUMLARI;
  app.locals.DOKUMAN_DURUM_ANAHTARLARI = qdms.DOKUMAN_DURUM_ANAHTARLARI;
  app.locals.DOKUMAN_DURUM_ACIKLAMALARI = qdms.DOKUMAN_DURUM_ACIKLAMALARI;
  app.locals.TUR_KODLARI = qdms.TUR_KODLARI;
  app.locals.ROLLER = auth.ROLLER;
  app.locals.ROL_ANAHTARLARI = auth.ROL_ANAHTARLARI;
  app.locals.dokumanDurumEtiketi = qdms.durumEtiketi;
  app.locals.dokumanDurumSinifi = qdms.durumSinifi;
  app.locals.revizyonEtiketi = qdms.revizyonEtiketi;
  app.locals.tarihTr = tarihTr;
  app.locals.basHarfler = basHarfler;
  app.locals.kisaMetin = kisaMetin;
  app.locals.gunFarki = gunFarki;
  app.locals.rolEtiketi = auth.rolEtiketi;

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.static(path.join(config.kok, 'public'), { maxAge: '1h' }));

  // -------------------------------------------------------------------------
  // Yüklemeler (şirket/taslak logosu ve hazır PDF/Excel dosyaları)
  // -------------------------------------------------------------------------
  const yuklemeKok = path.join(config.dataDir, 'yuklemeler');
  const logoKok = path.join(yuklemeKok, 'logo');
  const dokumanKok = path.join(yuklemeKok, 'dokuman');
  fs.mkdirSync(logoKok, { recursive: true });
  fs.mkdirSync(dokumanKok, { recursive: true });

  const depo = multer.diskStorage({
    destination(req, file, geri) {
      geri(null, file.fieldname === 'logo' ? logoKok : dokumanKok);
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
      if (file.fieldname === 'logo') {
        if (['.png', '.jpg', '.jpeg'].includes(uzanti)) return geri(null, true);
        return geri(new Error('Logo için yalnızca PNG veya JPG dosyası yükleyin.'));
      }
      if (file.fieldname === 'dosya') {
        if (['.pdf', '.xls', '.xlsx'].includes(uzanti)) return geri(null, true);
        return geri(new Error('Doküman dosyası için yalnızca PDF, XLS veya XLSX yükleyin.'));
      }
      return geri(null, false);
    },
  });

  function dosyaYolu(kok, ad) {
    if (!ad) return null;
    const temiz = path.basename(String(ad));
    if (!temiz) return null;
    const tam = path.join(kok, temiz);
    return fs.existsSync(tam) ? tam : null;
  }

  function dosyaSil(kok, ad) {
    if (!ad) return;
    try {
      const tam = dosyaYolu(kok, ad);
      if (tam) fs.unlinkSync(tam);
    } catch {
      /* dosya zaten silinmiş olabilir */
    }
  }

  app.use(auth.oturumAra(db));

  // -------------------------------------------------------------------------
  // Her istekte hazırlanan ortak görünüm verileri
  // -------------------------------------------------------------------------
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');

    const ayarlar = etkinAyarlar(db, config);
    const bugun = bugunTz(ayarlar.saatDilimi);
    const ok = tekDeger(req.query.ok);
    const hata = tekDeger(req.query.hata);
    const bilgi = tekDeger(req.query.bilgi);
    const kullanici = req.kullanici;
    const sirket = sirketAyarlari(db);

    res.locals.ayarlar = guvenliAyarlar(ayarlar);
    res.locals.sirket = sirket;
    res.locals.sirketBasHarfleri = basHarfler(sirket.ad);
    res.locals.mailModu = mailModu(ayarlar);
    res.locals.testModu = testModuEtkin(ayarlar);
    res.locals.bugunIso = bugun;
    res.locals.bugunTr = tarihTr(bugun);
    res.locals.tamYol = req.originalUrl;
    res.locals.bildirim = ok
      ? { tur: 'basari', metin: String(ok).slice(0, 800) }
      : hata
        ? { tur: 'hata', metin: String(hata).slice(0, 800) }
        : bilgi
          ? { tur: 'bilgi', metin: String(bilgi).slice(0, 800) }
          : null;
    res.locals.zamanTr = (zaman) => zamanTr(zaman, ayarlar.saatDilimi);
    res.locals.geciktiMi = (hedef) => Boolean(hedef) && hedef < bugun;
    res.locals.hedefFarki = (hedef) => gunFarki(hedef, bugun);
    res.locals.yetkiliMi = (izin) => auth.yetkiliMi(kullanici, izin);
    res.locals.okunmamisBildirim = kullanici
      ? db
          .prepare('SELECT COUNT(*) AS sayi FROM bildirimler WHERE kullanici_id = ? AND okundu = 0')
          .get(kullanici.id).sayi
      : 0;
    res.locals.okunmamisDokuman = kullanici
      ? db
          .prepare(
            `SELECT COUNT(*) AS sayi FROM dokuman_okumalari r
             JOIN dokumanlar d ON d.id = r.dokuman_id
             WHERE r.kullanici_id = ? AND r.okundu = 0 AND d.durum = 'yayinda'`
          )
          .get(kullanici.id).sayi
      : 0;
    next();
  });

  app.locals.sunucuPortu = config.port;

  // -------------------------------------------------------------------------
  // Sorgu yardımcıları
  // -------------------------------------------------------------------------
  function kullaniciGetir(id) {
    return db
      .prepare(
        `SELECT k.*, d.ad AS departman_ad
         FROM kullanicilar k LEFT JOIN departmanlar d ON d.id = k.departman_id
         WHERE k.id = ?`
      )
      .get(id);
  }

  function tumDepartmanlar() {
    return db
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM kullanicilar k WHERE k.departman_id = d.id AND k.aktif = 1) AS kullanici_sayisi
         FROM departmanlar d ORDER BY d.ad COLLATE NOCASE`
      )
      .all();
  }

  function tumKullanicilar() {
    return db
      .prepare(
        `SELECT k.*, d.ad AS departman_ad
         FROM kullanicilar k LEFT JOIN departmanlar d ON d.id = k.departman_id
         ORDER BY k.aktif DESC, k.ad COLLATE NOCASE`
      )
      .all();
  }

  function dokumanGetir(id) {
    return db.prepare(`${DOKUMAN_SORGU} WHERE d.id = ?`).get(id);
  }

  function dokumanIcerigi(dokuman) {
    return qdms.bolumleriCoz(dokuman?.icerik);
  }

  function dokumanHedefDepartmanlari(dokumanId) {
    return db
      .prepare(
        `SELECT d.* FROM dokuman_hedef_departmanlar h
         JOIN departmanlar d ON d.id = h.departman_id
         WHERE h.dokuman_id = ? ORDER BY d.ad COLLATE NOCASE`
      )
      .all(dokumanId);
  }

  function dokumanGorunurlukSql(kullanici) {
    if (!kullanici) return { sql: '1 = 0', parametreler: [] };
    if (['admin', 'kalite'].includes(kullanici.rol)) {
      return { sql: '1 = 1', parametreler: [] };
    }
    if (kullanici.rol === 'hazirlayan') {
      return {
        sql: "(d.durum <> 'taslak' OR d.hazirlayan_id = ?)",
        parametreler: [kullanici.id],
      };
    }
    if (kullanici.rol === 'onaylayan') {
      return {
        sql: "(d.durum IN ('kontrol', 'yayinda', 'iptal') OR d.hazirlayan_id = ?)",
        parametreler: [kullanici.id],
      };
    }
    return {
      sql: `d.durum = 'yayinda' AND EXISTS (
        SELECT 1 FROM dokuman_okumalari r WHERE r.dokuman_id = d.id AND r.kullanici_id = ?
      )`,
      parametreler: [kullanici.id],
    };
  }

  function dokumanErisimiVar(kullanici, dokuman) {
    if (!kullanici || !dokuman) return false;
    if (['admin', 'kalite'].includes(kullanici.rol)) return true;
    if (dokuman.hazirlayan_id === kullanici.id) return true;
    if (dokuman.durum === 'taslak') return false;
    if (kullanici.rol === 'kullanici') {
      return (
        dokuman.durum === 'yayinda' &&
        Boolean(
          db
            .prepare('SELECT 1 FROM dokuman_okumalari WHERE dokuman_id = ? AND kullanici_id = ?')
            .get(dokuman.id, kullanici.id)
        )
      );
    }
    return true;
  }

  function onayKaydet(dokumanId, kullaniciId, islem, notMetni = '') {
    db.prepare(
      `INSERT INTO dokuman_onaylari (dokuman_id, kullanici_id, islem, not_metni, tarih)
       VALUES (?, ?, ?, ?, ?)`
    ).run(dokumanId, kullaniciId, islem, String(notMetni || '').slice(0, 1000), new Date().toISOString());
  }

  function bildirimEkle(kullaniciId, tur, baslik, mesaj, baglanti, dokumanId = null) {
    db.prepare(
      `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, dokuman_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(kullaniciId, tur, String(baslik).slice(0, 200), String(mesaj || '').slice(0, 500), baglanti || null, dokumanId);
  }

  function onaylayicilariBildir(dokuman, gonderenId) {
    const kisiler = db
      .prepare(
        `SELECT id FROM kullanicilar
         WHERE aktif = 1 AND rol IN ('onaylayan', 'kalite') AND id <> ?`
      )
      .all(gonderenId || 0);
    for (const kisi of kisiler) {
      bildirimEkle(
        kisi.id,
        'onay',
        `Onay bekleyen doküman: ${dokuman.kod}`,
        `${dokuman.baslik} · ${qdms.revizyonEtiketi(dokuman.revizyon)} onayınızı bekliyor.`,
        `/dokumanlar/${dokuman.id}`,
        dokuman.id
      );
    }
    return kisiler.length;
  }

  function dagitimiBaslat(dokuman) {
    const kisiler = db
      .prepare(
        `SELECT DISTINCT k.id, k.ad
         FROM dokuman_hedef_departmanlar h
         JOIN kullanicilar k ON k.departman_id = h.departman_id
         WHERE h.dokuman_id = ? AND k.aktif = 1`
      )
      .all(dokuman.id);
    let yeni = 0;
    for (const kisi of kisiler) {
      const bilgi = db
        .prepare('INSERT OR IGNORE INTO dokuman_okumalari (dokuman_id, kullanici_id) VALUES (?, ?)')
        .run(dokuman.id, kisi.id);
      if (Number(bilgi.changes) > 0) {
        yeni += 1;
        bildirimEkle(
          kisi.id,
          'dokuman',
          `Yeni doküman yayınlandı: ${dokuman.kod}`,
          `${dokuman.baslik} · ${qdms.revizyonEtiketi(dokuman.revizyon)}. Okuyup "Okudum, Anladım" onayı vermeniz bekleniyor.`,
          `/dokumanlar/${dokuman.id}`,
          dokuman.id
        );
      }
    }
    return yeni;
  }

  function sablonLogoYolu(sablon) {
    return dosyaYolu(logoKok, sablon?.logo_yolu);
  }

  function sirketLogoYolu() {
    return dosyaYolu(logoKok, sirketAyarlari(db).logo);
  }

  /** PDF motoruna yol yerine doğrudan Buffer verir; yol/encoding sorunlarını eler. */
  function logoPdfGirdisi(sablon) {
    const tam = sablonLogoYolu(sablon) || sirketLogoYolu();
    if (!tam) return null;
    try {
      return fs.readFileSync(tam);
    } catch {
      return null;
    }
  }

  /** Yüklenen dosyanın gerçekten PDFKit'in çözebileceği PNG/JPG olduğunu doğrular. */
  function logoDosyasiGecerliMi(tamYol) {
    if (!tamYol) return false;
    try {
      return Boolean(logoVerisiCoz(tamYol));
    } catch {
      return false;
    }
  }

  function logoUyariMetni(ad, tamYol) {
    if (!ad) return '';
    if (!tamYol) {
      return 'Kayıtlı logo dosyası diskte bulunamadı; lütfen logoyu yeniden yükleyin.';
    }
    if (!logoDosyasiGecerliMi(tamYol)) {
      return 'Kayıtlı logo PDF antetine basılamıyor (desteklenmeyen veya bozuk dosya). Lütfen PNG ya da JPG olarak yeniden yükleyin.';
    }
    return '';
  }

  function icerikDogrula(bolumler, body) {
    const sonuc = [];
    let toplam = 0;
    for (let i = 0; i < bolumler.length; i += 1) {
      const baslik = String(bolumler[i].baslik || '').slice(0, 160);
      const deger = metin(body[`bolum_${i}`]);
      toplam += deger.length;
      sonuc.push({ baslik, metin: deger });
      if (bolumler[i].zorunlu && deger.length < 2) {
        return { hata: `"${baslik}" bölümü zorunludur.` };
      }
      if (deger.length > 20000) {
        return { hata: `"${baslik}" bölümü en fazla 20.000 karakter olabilir.` };
      }
    }
    if (toplam > 120000) {
      return { hata: 'Doküman içeriği çok uzun. Lütfen bölümleri kısaltın.' };
    }
    return { bolumler: sonuc, toplam };
  }

  function hedefDepartmanDogrula(body) {
    const idler = kimlikListesi(body.hedef_departmanlar);
    if (!idler.length) return { hata: 'En az bir hedef departman seçin.' };
    const mevcutlar = new Set(tumDepartmanlar().map((d) => d.id));
    const gecerli = idler.filter((id) => mevcutlar.has(id));
    if (!gecerli.length) return { hata: 'Seçilen hedef departmanlar geçersiz.' };
    return { idler: gecerli };
  }

  function hedefDepartmanlariYaz(dokumanId, idler) {
    db.prepare('DELETE FROM dokuman_hedef_departmanlar WHERE dokuman_id = ?').run(dokumanId);
    const ekle = db.prepare(
      'INSERT OR IGNORE INTO dokuman_hedef_departmanlar (dokuman_id, departman_id) VALUES (?, ?)'
    );
    for (const id of idler) ekle.run(dokumanId, id);
  }

  function sayfaYok(res, aktifSayfa = '') {
    return res.status(404).render('404', {
      aktifSayfa,
      sayfaBaslik: 'Sayfa Bulunamadı',
    });
  }

  function dokumanYok(res) {
    return res.status(404).render('404', {
      aktifSayfa: 'dokumanlar',
      sayfaBaslik: 'Doküman Bulunamadı',
    });
  }

  function yonlendir(res, yol, anahtar, mesaj) {
    return res.redirect(303, mesajliYol(yol, anahtar, mesaj));
  }

  /**
   * Logo yükleme hatalarını (yanlış uzantı, 10 MB aşımı) 500 yerine
   * kullanıcıyı bilgilendiren bir yönlendirmeye çevirir.
   */
  function logoYukleyici(req, res, next) {
    yukleyici.single('logo')(req, res, (hata) => {
      if (!hata) return next();
      const geri = req.path.startsWith('/sablonlar/') ? req.path : '/ayarlar';
      const mesaj =
        hata.code === 'LIMIT_FILE_SIZE' ? 'Logo dosyası 10 MB sınırını aşıyor.' : hata.message;
      return yonlendir(res, geri, 'hata', mesaj);
    });
  }

  // -------------------------------------------------------------------------
  // Sağlık ve oturum
  // -------------------------------------------------------------------------
  app.get('/saglik', (req, res) => {
    res.json({ ok: true, uygulama: 'qdms', zaman: new Date().toISOString() });
  });

  app.get('/giris', (req, res) => {
    if (req.kullanici) return res.redirect(303, '/');
    return res.render('giris', {
      sayfaBaslik: 'Giriş',
      hata: queryMetin(req, 'hata') || null,
      email: queryMetin(req, 'email'),
      donus: guvenliDonus(queryMetin(req, 'donus'), '/'),
    });
  });

  app.post('/giris', (req, res) => {
    const email = metin(req.body.email);
    const sifre = String(req.body.sifre || '');
    const donus = guvenliDonus(req.body.donus, '/');
    const kullanici = auth.kullaniciDogrula(db, email, sifre);
    if (!kullanici) {
      return res.status(401).render('giris', {
        sayfaBaslik: 'Giriş',
        hata: 'E-posta adresi veya şifre hatalı.',
        email,
        donus,
      });
    }
    const oturum = auth.oturumOlustur(db, kullanici.id);
    auth.oturumCereziYaz(res, oturum.token);
    return res.redirect(303, donus);
  });

  app.post('/cikis', (req, res) => {
    auth.oturumSil(db, req.oturumToken);
    auth.oturumCereziSil(res);
    return res.redirect(303, '/giris');
  });

  app.use(auth.girisGerekli);

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  app.get('/', (req, res) => {
    const kullanici = req.kullanici;
    const gorunurluk = dokumanGorunurlukSql(kullanici);
    const onaylayabilir = auth.yetkiliMi(kullanici, 'dokuman.onayla');

    const sayilar = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM departmanlar) AS departman_sayisi,
          (SELECT COUNT(*) FROM kullanicilar WHERE aktif = 1) AS kullanici_sayisi`
      )
      .get();

    const dokumanSayilari = db
      .prepare(
        `SELECT
          COUNT(*) AS toplam,
          COALESCE(SUM(CASE WHEN d.durum = 'yayinda' THEN 1 ELSE 0 END), 0) AS yayinda,
          COALESCE(SUM(CASE WHEN d.durum = 'kontrol' THEN 1 ELSE 0 END), 0) AS kontrol,
          COALESCE(SUM(CASE WHEN d.durum = 'taslak' THEN 1 ELSE 0 END), 0) AS taslak
        FROM dokumanlar d WHERE ${gorunurluk.sql}`
      )
      .get(...gorunurluk.parametreler);

    const bekleyenOnay = onaylayabilir
      ? db.prepare("SELECT COUNT(*) AS sayi FROM dokumanlar WHERE durum = 'kontrol'").get().sayi
      : 0;

    const okunacaklar = db
      .prepare(
        `SELECT d.*, t.ad AS tur_ad
         FROM dokuman_okumalari r
         JOIN dokumanlar d ON d.id = r.dokuman_id
         JOIN dokuman_turleri t ON t.kod = d.tur_kod
         WHERE r.kullanici_id = ? AND r.okundu = 0 AND d.durum = 'yayinda'
         ORDER BY d.guncelleme_tarihi DESC, d.id DESC LIMIT 5`
      )
      .all(kullanici.id);

    const onayBekleyenler = onaylayabilir
      ? db
          .prepare(
            `${DOKUMAN_SORGU}
             WHERE d.durum = 'kontrol'
             ORDER BY d.guncelleme_tarihi ASC, d.id ASC LIMIT 5`
          )
          .all()
      : [];

    const sonDokumanlar = db
      .prepare(
        `${DOKUMAN_SORGU}
         WHERE ${gorunurluk.sql}
         ORDER BY d.guncelleme_tarihi DESC, d.id DESC LIMIT 6`
      )
      .all(...gorunurluk.parametreler);

    const bildirimler = db
      .prepare(
        `SELECT * FROM bildirimler WHERE kullanici_id = ?
         ORDER BY okundu ASC, id DESC LIMIT 6`
      )
      .all(kullanici.id);

    const turSayilari = db
      .prepare(
        `SELECT d.tur_kod, COUNT(*) AS sayi FROM dokumanlar d
         WHERE ${gorunurluk.sql} GROUP BY d.tur_kod`
      )
      .all(...gorunurluk.parametreler);

    const dofOzet = dofOzeti(db, kullanici, auth.yetkiliMi(kullanici, 'dof'), res.locals.bugunIso);
    const tetkikOzet = tetkikOzeti(
      db,
      kullanici,
      auth.yetkiliMi(kullanici, 'tetkik'),
      Number(res.locals.bugunIso.slice(0, 4))
    );

    res.render('genel-bakis', {
      aktifSayfa: 'dashboard',
      sayfaBaslik: 'Genel Bakış',
      sayilar,
      dokumanSayilari,
      bekleyenOnay,
      okunacaklar,
      onayBekleyenler,
      sonDokumanlar,
      bildirimler,
      turSayilari,
      onaylayabilir,
      dofOzet,
      tetkikOzet,
    });
  });

  app.post('/bildirimler/oku', (req, res) => {
    db.prepare('UPDATE bildirimler SET okundu = 1 WHERE kullanici_id = ?').run(req.kullanici.id);
    return yonlendir(res, '/', 'ok', 'Bildirimler okundu olarak işaretlendi.');
  });

  // -------------------------------------------------------------------------
  // Doküman listesi
  // -------------------------------------------------------------------------
  app.get('/dokumanlar', (req, res) => {
    const kullanici = req.kullanici;
    const gorunurluk = dokumanGorunurlukSql(kullanici);
    const tur = qdms.turGetir(queryMetin(req, 'tur'));
    const durumParam = queryMetin(req, 'durum', 'hepsi');
    const durum = ['hepsi', ...qdms.DOKUMAN_DURUM_ANAHTARLARI].includes(durumParam) ? durumParam : 'hepsi';
    const arama = queryMetin(req, 'q').slice(0, 100);

    const kosullar = [gorunurluk.sql];
    const parametreler = [...gorunurluk.parametreler];
    if (tur) {
      kosullar.push('d.tur_kod = ?');
      parametreler.push(tur.kod);
    }
    if (durum !== 'hepsi') {
      kosullar.push('d.durum = ?');
      parametreler.push(durum);
    }
    if (arama) {
      const desen = `%${arama}%`;
      kosullar.push('(d.kod LIKE ? OR d.baslik LIKE ? OR d.aciklama LIKE ?)');
      parametreler.push(desen, desen, desen);
    }

    const dokumanlar = db
      .prepare(
        `${DOKUMAN_SORGU}
         WHERE ${kosullar.join(' AND ')}
         ORDER BY
           CASE d.durum WHEN 'kontrol' THEN 0 WHEN 'taslak' THEN 1 WHEN 'yayinda' THEN 2 ELSE 3 END,
           d.guncelleme_tarihi DESC, d.id DESC
         LIMIT 300`
      )
      .all(...parametreler);

    const turSayilari = {};
    for (const satir of db
      .prepare(`SELECT d.tur_kod, COUNT(*) AS sayi FROM dokumanlar d WHERE ${gorunurluk.sql} GROUP BY d.tur_kod`)
      .all(...gorunurluk.parametreler)) {
      turSayilari[satir.tur_kod] = satir.sayi;
    }
    const toplam = Object.values(turSayilari).reduce((a, b) => a + b, 0);

    res.render('dokumanlar', {
      aktifSayfa: 'dokumanlar',
      aktifTur: tur ? tur.kod : '',
      sayfaBaslik: tur ? tur.cogul : 'Doküman Yönetimi',
      dokumanlar,
      tur,
      durum,
      arama,
      turSayilari,
      toplam,
    });
  });

  // -------------------------------------------------------------------------
  // Yeni doküman
  // -------------------------------------------------------------------------
  app.get('/dokumanlar/yeni', auth.izinGerekli('dokuman.olustur'), (req, res) => {
    const tur = qdms.turGetir(queryMetin(req, 'tur')) || qdms.turGetir('PR');
    const sablon = qdms.sablonGetir(db, tur.kod);
    const bolumler = sablon.bolumler.map((bolum) => ({ ...bolum, metin: '' }));
    const varsayilanDepartman =
      req.kullanici.departman_id ||
      (tumDepartmanlar().find((d) => d.ad === 'Kalite Güvence') || tumDepartmanlar()[0] || {}).id;
    res.render('dokuman-yeni', {
      aktifSayfa: 'dokuman-yeni',
      aktifTur: tur.kod,
      sayfaBaslik: `${tur.ad} Oluştur`,
      tur,
      sablon,
      bolumler,
      kod: qdms.sonrakiKod(db, tur.kod),
      departmanlar: tumDepartmanlar(),
      seciliDepartmanlar: varsayilanDepartman ? [varsayilanDepartman] : [],
      form: {
        baslik: '',
        aciklama: '',
        degisiklik_notu: '',
      },
    });
  });

  app.post(
    '/dokumanlar/yeni',
    auth.izinGerekli('dokuman.olustur'),
    yukleyici.single('dosya'),
    (req, res) => {
      const tur = qdms.turKoduCoz(db, req.body.tur_kod ?? req.body.tur ?? req.body.tur_id);
      const geri = tur ? `/dokumanlar/yeni?tur=${tur.kod}` : '/dokumanlar/yeni';
      if (!tur) return yonlendir(res, geri, 'hata', 'Geçerli bir doküman türü seçin.');

      const baslik = metin(req.body.baslik);
      const aciklama = metin(req.body.aciklama);
      if (baslik.length < 3 || baslik.length > 200) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', 'Doküman başlığı 3-200 karakter arasında olmalıdır.');
      }
      if (aciklama.length > 1000) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', 'Açıklama en fazla 1000 karakter olabilir.');
      }
      const sablon = qdms.sablonGetir(db, tur.kod);
      const icerikKontrol = icerikDogrula(sablon.bolumler, req.body);
      if (icerikKontrol.hata && !req.file) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', icerikKontrol.hata);
      }
      const hedefler = hedefDepartmanDogrula(req.body);
      if (hedefler.hata) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', hedefler.hata);
      }

      const simdi = new Date().toISOString();
      const kod = qdms.sonrakiKod(db, tur.kod);
      db.exec('BEGIN IMMEDIATE');
      let yeniId;
      try {
        const bilgi = db
          .prepare(
            `INSERT INTO dokumanlar
              (kod, tur_kod, baslik, aciklama, revizyon, durum, icerik, degisiklik_notu,
               hazirlayan_id, dosya_yolu, dosya_adi, dosya_turu, olusturma_tarihi, guncelleme_tarihi)
             VALUES (?, ?, ?, ?, 0, 'taslak', ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            kod,
            tur.kod,
            baslik,
            aciklama,
            JSON.stringify(icerikKontrol.bolumler || []),
            '',
            req.kullanici.id,
            req.file ? req.file.filename : null,
            req.file ? String(req.file.originalname || '').slice(0, 200) : null,
            req.file ? path.extname(req.file.originalname || '').toLowerCase().replace('.', '') : null,
            simdi,
            simdi
          );
        yeniId = Number(bilgi.lastInsertRowid);
        hedefDepartmanlariYaz(yeniId, hedefler.idler);
        onayKaydet(yeniId, req.kullanici.id, 'olustur', 'Doküman taslağı oluşturuldu.');
        db.exec('COMMIT');
      } catch (hata) {
        db.exec('ROLLBACK');
        dosyaSil(dokumanKok, req.file?.filename);
        console.error('[doküman oluşturma]', hata);
        return yonlendir(res, geri, 'hata', 'Doküman oluşturulamadı.');
      }

      return yonlendir(res, `/dokumanlar/${yeniId}`, 'ok', `${kod} kodlu ${tur.ad.toLowerCase()} taslağı oluşturuldu.`);
    }
  );

  // -------------------------------------------------------------------------
  // Doküman detayı
  // -------------------------------------------------------------------------
  app.get('/dokumanlar/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);

    db.prepare('UPDATE bildirimler SET okundu = 1 WHERE dokuman_id = ? AND kullanici_id = ?').run(
      dokuman.id,
      req.kullanici.id
    );

    const bolumler = dokumanIcerigi(dokuman);
    const hedefDepartmanlar = dokumanHedefDepartmanlari(dokuman.id);
    const okuyucular = db
      .prepare(
        `SELECT r.okundu, r.okunma_tarihi, k.ad, k.email, d.ad AS departman_ad
         FROM dokuman_okumalari r
         JOIN kullanicilar k ON k.id = r.kullanici_id
         LEFT JOIN departmanlar d ON d.id = k.departman_id
         WHERE r.dokuman_id = ?
         ORDER BY r.okundu ASC, k.ad COLLATE NOCASE`
      )
      .all(dokuman.id);
    const onaylar = db
      .prepare(
        `SELECT o.*, k.ad AS kullanici_ad FROM dokuman_onaylari o
         LEFT JOIN kullanicilar k ON k.id = o.kullanici_id
         WHERE o.dokuman_id = ? ORDER BY o.id ASC`
      )
      .all(dokuman.id);
    const revizyonlar = db
      .prepare(
        `SELECT d.*, h.ad AS hazirlayan_ad, o.ad AS onaylayan_ad
         FROM dokumanlar d
         LEFT JOIN kullanicilar h ON h.id = d.hazirlayan_id
         LEFT JOIN kullanicilar o ON o.id = d.onaylayan_id
         WHERE d.kod = ? ORDER BY d.revizyon DESC`
      )
      .all(dokuman.kod);
    const benimOkumam = db
      .prepare('SELECT * FROM dokuman_okumalari WHERE dokuman_id = ? AND kullanici_id = ?')
      .get(dokuman.id, req.kullanici.id);
    const duzenleyebilir =
      dokuman.durum === 'taslak' &&
      (dokuman.hazirlayan_id === req.kullanici.id || auth.yetkiliMi(req.kullanici, 'dokuman.duzenle'));
    const silebilir = dokuman.durum === 'taslak' && auth.yetkiliMi(req.kullanici, 'dokuman.sil');
    const onaylayabilir = dokuman.durum === 'kontrol' && auth.yetkiliMi(req.kullanici, 'dokuman.onayla');
    const yuzde = dokuman.okuyucu_sayisi
      ? Math.round((dokuman.okuyan_sayisi / dokuman.okuyucu_sayisi) * 100)
      : 0;

    res.render('dokuman-detay', {
      aktifSayfa: 'dokumanlar',
      aktifTur: dokuman.tur_kod,
      sayfaBaslik: dokuman.baslik,
      dokuman,
      tur: qdms.turGetir(dokuman.tur_kod),
      bolumler,
      hedefDepartmanlar,
      okuyucular,
      onaylar,
      revizyonlar,
      benimOkumam,
      duzenleyebilir,
      silebilir,
      onaylayabilir,
      yuzde,
      sonRevizyon: revizyonlar.length ? revizyonlar[0].revizyon : dokuman.revizyon,
    });
  });

  app.get('/dokumanlar/:id/duzenle', auth.izinGerekli('dokuman.duzenle'), (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    if (dokuman.durum !== 'taslak') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca taslak dokümanlar düzenlenebilir.');
    }
    if (dokuman.hazirlayan_id !== req.kullanici.id && !auth.yetkiliMi(req.kullanici, 'dokuman.duzenle')) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu dokümanı düzenleme yetkiniz yok.');
    }
    res.render('dokuman-duzenle', {
      aktifSayfa: 'dokumanlar',
      aktifTur: dokuman.tur_kod,
      sayfaBaslik: 'Dokümanı Düzenle',
      dokuman,
      tur: qdms.turGetir(dokuman.tur_kod),
      sablon: qdms.sablonGetir(db, dokuman.tur_kod),
      bolumler: dokumanIcerigi(dokuman),
      departmanlar: tumDepartmanlar(),
      seciliDepartmanlar: dokumanHedefDepartmanlari(dokuman.id).map((d) => d.id),
      form: { baslik: dokuman.baslik, aciklama: dokuman.aciklama },
    });
  });

  app.post(
    '/dokumanlar/:id',
    auth.izinGerekli('dokuman.duzenle'),
    yukleyici.single('dosya'),
    (req, res) => {
      const id = kimlik(req.params.id);
      const dokuman = id ? dokumanGetir(id) : null;
      if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
      const geri = `/dokumanlar/${dokuman.id}/duzenle`;
      if (dokuman.durum !== 'taslak') {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca taslak dokümanlar düzenlenebilir.');
      }
      if (dokuman.hazirlayan_id !== req.kullanici.id && !auth.yetkiliMi(req.kullanici, 'dokuman.duzenle')) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu dokümanı düzenleme yetkiniz yok.');
      }

      const baslik = metin(req.body.baslik);
      const aciklama = metin(req.body.aciklama);
      if (baslik.length < 3 || baslik.length > 200) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', 'Doküman başlığı 3-200 karakter arasında olmalıdır.');
      }
      if (aciklama.length > 1000) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', 'Açıklama en fazla 1000 karakter olabilir.');
      }
      const bolumler = dokumanIcerigi(dokuman);
      const icerikKontrol = icerikDogrula(bolumler, req.body);
      if (icerikKontrol.hata && !req.file && !dokuman.dosya_yolu) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', icerikKontrol.hata);
      }
      const hedefler = hedefDepartmanDogrula(req.body);
      if (hedefler.hata) {
        dosyaSil(dokumanKok, req.file?.filename);
        return yonlendir(res, geri, 'hata', hedefler.hata);
      }

      let dosyaYolu = dokuman.dosya_yolu;
      let dosyaAdi = dokuman.dosya_adi;
      let dosyaTuru = dokuman.dosya_turu;
      if (req.file) {
        dosyaSil(dokumanKok, dosyaYolu);
        dosyaYolu = req.file.filename;
        dosyaAdi = String(req.file.originalname || '').slice(0, 200);
        dosyaTuru = path.extname(req.file.originalname || '').toLowerCase().replace('.', '');
      } else if (req.body.dosya_sil) {
        dosyaSil(dokumanKok, dosyaYolu);
        dosyaYolu = null;
        dosyaAdi = null;
        dosyaTuru = null;
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          `UPDATE dokumanlar
           SET baslik = ?, aciklama = ?, icerik = ?, dosya_yolu = ?, dosya_adi = ?, dosya_turu = ?,
               guncelleme_tarihi = ?
           WHERE id = ?`
        ).run(
          baslik,
          aciklama,
          JSON.stringify(icerikKontrol.bolumler || []),
          dosyaYolu,
          dosyaAdi,
          dosyaTuru,
          new Date().toISOString(),
          dokuman.id
        );
        hedefDepartmanlariYaz(dokuman.id, hedefler.idler);
        onayKaydet(dokuman.id, req.kullanici.id, 'duzenle', 'Taslak güncellendi.');
        db.exec('COMMIT');
      } catch (hata) {
        db.exec('ROLLBACK');
        console.error('[doküman düzenleme]', hata);
        return yonlendir(res, geri, 'hata', 'Doküman güncellenemedi.');
      }
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', 'Taslak güncellendi.');
    }
  );

  app.post('/dokumanlar/:id/onaya-gonder', async (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    if (dokuman.durum !== 'taslak') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca taslak dokümanlar onaya gönderilebilir.');
    }
    if (dokuman.hazirlayan_id !== req.kullanici.id && !auth.yetkiliMi(req.kullanici, 'dokuman.duzenle')) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu dokümanı onaya gönderme yetkiniz yok.');
    }
    if (!dokumanHedefDepartmanlari(dokuman.id).length) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}/duzenle`, 'hata', 'Onaya göndermeden önce hedef departman seçin.');
    }
    const icerikVar = dokumanIcerigi(dokuman).some((bolum) => String(bolum.metin || '').trim());
    if (!icerikVar && !dokuman.dosya_yolu) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}/duzenle`, 'hata', 'Onaya göndermek için bölümleri doldurun veya bir dosya yükleyin.');
    }
    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE dokumanlar SET durum = 'kontrol', guncelleme_tarihi = ? WHERE id = ?").run(simdi, dokuman.id);
      onayKaydet(dokuman.id, req.kullanici.id, 'onaya_gonder', metin(req.body.not_metni));
      onaylayicilariBildir({ ...dokuman, durum: 'kontrol' }, req.kullanici.id);
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[onaya gönderme]', hata);
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Doküman onaya gönderilemedi.');
    }
    let epostaAdet = 0;
    try {
      const epostaSonuc = await bildirimler.onayBekleyenleriBilgilendir({
        db,
        mail,
        config,
        dokuman: { ...dokuman, durum: 'kontrol' },
        gonderenId: req.kullanici.id,
      });
      epostaAdet = epostaSonuc.gonderilen;
    } catch (hata) {
      console.error('[onay e-postası]', hata);
    }
    const mesaj =
      epostaAdet > 0
        ? `Doküman onaya gönderildi. ${epostaAdet} onaylayana e-posta gönderildi.`
        : 'Doküman onaya gönderildi.';
    return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', mesaj);
  });

  app.post('/dokumanlar/:id/onayla', auth.izinGerekli('dokuman.onayla'), async (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman) return dokumanYok(res);
    if (dokuman.durum !== 'kontrol') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu doküman onay beklemiyor.');
    }
    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    let yeniOkuyucu = 0;
    let guncel = null;
    try {
      db.prepare(
        `UPDATE dokumanlar
         SET durum = 'yayinda', onaylayan_id = ?, onay_tarihi = ?, yayin_tarihi = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(req.kullanici.id, simdi, simdi, simdi, dokuman.id);
      onayKaydet(dokuman.id, req.kullanici.id, 'onayla', metin(req.body.not_metni));
      guncel = dokumanGetir(dokuman.id);
      yeniOkuyucu = dagitimiBaslat(guncel);
      if (guncel.hazirlayan_id && guncel.hazirlayan_id !== req.kullanici.id) {
        bildirimEkle(
          guncel.hazirlayan_id,
          'onay',
          `Doküman yayınlandı: ${guncel.kod}`,
          `${guncel.baslik} onaylandı ve dağıtıma açıldı.`,
          `/dokumanlar/${guncel.id}`,
          guncel.id
        );
      }
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[doküman onaylama]', hata);
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Doküman onaylanamadı.');
    }
    let epostaAdet = 0;
    if (guncel) {
      try {
        const epostaSonuc = await bildirimler.yayinBilgileriniGonder({ db, mail, config, dokuman: guncel });
        epostaAdet = epostaSonuc.gonderilen;
      } catch (hata) {
        console.error('[yayın e-postası]', hata);
      }
    }
    const mesaj =
      `Doküman yayınlandı ve ${yeniOkuyucu} kişiye okuma bildirimi gönderildi.` +
      (epostaAdet > 0 ? ` ${epostaAdet} kişiye e-posta gönderildi.` : '');
    return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', mesaj);
  });

  app.post('/dokumanlar/:id/reddet', auth.izinGerekli('dokuman.onayla'), (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman) return dokumanYok(res);
    if (dokuman.durum !== 'kontrol') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu doküman onay beklemiyor.');
    }
    const notMetni = metin(req.body.not_metni);
    if (notMetni.length < 3) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Reddetmek için kısa bir gerekçe yazın.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE dokumanlar SET durum = 'taslak', onaylayan_id = NULL, onay_tarihi = NULL,
           yayin_tarihi = NULL, guncelleme_tarihi = ? WHERE id = ?`
      ).run(new Date().toISOString(), dokuman.id);
      onayKaydet(dokuman.id, req.kullanici.id, 'reddet', notMetni);
      if (dokuman.hazirlayan_id && dokuman.hazirlayan_id !== req.kullanici.id) {
        bildirimEkle(
          dokuman.hazirlayan_id,
          'onay',
          `Doküman revizyon için iade edildi: ${dokuman.kod}`,
          notMetni,
          `/dokumanlar/${dokuman.id}`,
          dokuman.id
        );
      }
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[doküman reddetme]', hata);
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Doküman iade edilemedi.');
    }
    return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', 'Doküman düzeltme için iade edildi.');
  });

  app.post('/dokumanlar/:id/arsivle', auth.izinGerekli('dokuman.onayla'), (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman) return dokumanYok(res);
    if (dokuman.durum === 'iptal') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Doküman zaten arşivde.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE dokumanlar SET durum = 'iptal', guncelleme_tarihi = ? WHERE id = ?").run(
        new Date().toISOString(),
        dokuman.id
      );
      onayKaydet(dokuman.id, req.kullanici.id, 'arsivle', metin(req.body.not_metni));
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Doküman arşivlenemedi.');
    }
    return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', 'Doküman iptal / arşiv durumuna alındı.');
  });

  app.post('/dokumanlar/:id/revizyon', auth.izinGerekli('dokuman.olustur'), (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    if (!['yayinda', 'iptal'].includes(dokuman.durum)) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yeni revizyon yalnızca yayındaki veya arşivdeki dokümanlar için oluşturulabilir.');
    }
    const enSon = db
      .prepare('SELECT MAX(revizyon) AS son FROM dokumanlar WHERE kod = ?')
      .get(dokuman.kod).son;
    if (Number(enSon) !== Number(dokuman.revizyon)) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca en güncel revizyon için yeni revizyon oluşturabilirsiniz.');
    }
    const notMetni = metin(req.body.degisiklik_notu);
    if (notMetni.length < 3) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yeni revizyon için değişiklik notu zorunludur.');
    }

    const simdi = new Date().toISOString();
    const yeniRevizyon = Number(dokuman.revizyon) + 1;
    db.exec('BEGIN IMMEDIATE');
    let yeniId;
    try {
      db.prepare("UPDATE dokumanlar SET durum = 'iptal', guncelleme_tarihi = ? WHERE id = ?").run(simdi, dokuman.id);
      const bilgi = db
        .prepare(
          `INSERT INTO dokumanlar
            (kod, tur_kod, baslik, aciklama, revizyon, durum, icerik, degisiklik_notu,
             hazirlayan_id, dosya_yolu, dosya_adi, dosya_turu, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, ?, 'taslak', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          dokuman.kod,
          dokuman.tur_kod,
          dokuman.baslik,
          dokuman.aciklama,
          yeniRevizyon,
          dokuman.icerik,
          notMetni,
          req.kullanici.id,
          null,
          null,
          null,
          simdi,
          simdi
        );
      yeniId = Number(bilgi.lastInsertRowid);
      const hedefler = dokumanHedefDepartmanlari(dokuman.id).map((d) => d.id);
      hedefDepartmanlariYaz(yeniId, hedefler);
      onayKaydet(yeniId, req.kullanici.id, 'revizyon', notMetni);
      onayKaydet(dokuman.id, req.kullanici.id, 'arsivle', `Yeni revizyon oluşturuldu: ${qdms.revizyonEtiketi(yeniRevizyon)}.`);
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[revizyon]', hata);
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yeni revizyon oluşturulamadı.');
    }
    return yonlendir(
      res,
      `/dokumanlar/${yeniId}`,
      'ok',
      `${dokuman.kod} için ${qdms.revizyonEtiketi(yeniRevizyon)} taslağı oluşturuldu; önceki revizyon arşivlendi.`
    );
  });

  app.post('/dokumanlar/:id/oku', (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    if (dokuman.durum !== 'yayinda') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca yayındaki dokümanlar okundu olarak işaretlenebilir.');
    }
    const okuma = db
      .prepare('SELECT * FROM dokuman_okumalari WHERE dokuman_id = ? AND kullanici_id = ?')
      .get(dokuman.id, req.kullanici.id);
    if (!okuma) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu doküman sizin okuma listenizde değil.');
    }
    if (okuma.okundu) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', 'Bu dokümanı daha önce okudunuz.');
    }
    db.prepare("UPDATE dokuman_okumalari SET okundu = 1, okunma_tarihi = ? WHERE id = ?").run(
      new Date().toISOString(),
      okuma.id
    );
    db.prepare('UPDATE bildirimler SET okundu = 1 WHERE dokuman_id = ? AND kullanici_id = ?').run(
      dokuman.id,
      req.kullanici.id
    );
    return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'ok', '"Okudum, Anladım" onayınız kaydedildi.');
  });

  app.post('/dokumanlar/:id/sil', auth.izinGerekli('dokuman.sil'), (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman) return dokumanYok(res);
    if (dokuman.durum !== 'taslak') {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Yalnızca taslak dokümanlar silinebilir.');
    }
    if (dokuman.hazirlayan_id !== req.kullanici.id && !auth.yetkiliMi(req.kullanici, 'dokuman.sil')) {
      return yonlendir(res, `/dokumanlar/${dokuman.id}`, 'hata', 'Bu dokümanı silme yetkiniz yok.');
    }
    dosyaSil(dokumanKok, dokuman.dosya_yolu);
    db.prepare('DELETE FROM dokumanlar WHERE id = ?').run(dokuman.id);
    return yonlendir(res, '/dokumanlar', 'ok', `${dokuman.kod} taslağı silindi.`);
  });

  // -------------------------------------------------------------------------
  // PDF / dosya indirme
  // -------------------------------------------------------------------------
  app.get('/dokumanlar/:id/pdf', async (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    const indir = ['1', 'true', 'evet'].includes(queryMetin(req, 'indir').toLowerCase());
    const dosyaAdi = `${dokuman.kod}-${qdms.revizyonEtiketi(dokuman.revizyon).replace('.', '')}.pdf`;

    if (dokuman.dosya_yolu) {
      const tam = dosyaYolu(dokumanKok, dokuman.dosya_yolu);
      if (!tam) return dokumanYok(res);
      const yuklenenAd = String(dokuman.dosya_adi || dosyaAdi).replace(/["\\\r\n]/g, '');
      if (dokuman.dosya_turu === 'pdf' && !indir) {
        return res.sendFile(path.basename(tam), { root: dokumanKok, headers: { 'Content-Type': 'application/pdf' } });
      }
      return res.download(path.basename(tam), yuklenenAd, { root: dokumanKok }, (hata) => {
        if (hata && !res.headersSent) res.status(404).end();
      });
    }

    const sablon = qdms.sablonGetir(db, dokuman.tur_kod);
    const sirket = sirketAyarlari(db);
    try {
      const pdf = await pdfUret({
        dokuman: { ...dokuman, icerik: dokumanIcerigi(dokuman) },
        sablon,
        sirket,
        tur: qdms.turGetir(dokuman.tur_kod),
        logoYolu: sablonLogoYolu(sablon) || dosyaYolu(logoKok, sirket.logo),
        logoVerisi: logoPdfGirdisi(sablon),
        hazirlayanAd: dokuman.hazirlayan_ad || '',
        onaylayanAd: dokuman.onaylayan_ad || '',
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Cache-Control', 'no-store');
      res.set(
        'Content-Disposition',
        `${indir ? 'attachment' : 'inline'}; filename="${dosyaAdi.replace(/[^A-Za-z0-9._-]/g, '-')}"`
      );
      return res.send(pdf);
    } catch (hata) {
      console.error('[pdf]', hata);
      return res.status(500).render('hata', {
        aktifSayfa: 'dokumanlar',
        sayfaBaslik: 'PDF Üretilemedi',
        hataMesaji: 'PDF oluşturulurken bir hata oluştu.',
      });
    }
  });

  app.get('/dokumanlar/:id/dosya', (req, res) => {
    const id = kimlik(req.params.id);
    const dokuman = id ? dokumanGetir(id) : null;
    if (!dokuman || !dokumanErisimiVar(req.kullanici, dokuman)) return dokumanYok(res);
    const tam = dosyaYolu(dokumanKok, dokuman.dosya_yolu);
    if (!tam) return dokumanYok(res);
    return res.download(path.basename(tam), String(dokuman.dosya_adi || path.basename(tam)).replace(/["\\\r\n]/g, ''), {
      root: dokumanKok,
    });
  });

  // -------------------------------------------------------------------------
  // Şablon tasarımcısı
  // -------------------------------------------------------------------------
  app.get('/sablonlar', auth.izinGerekli('sablon'), (req, res) => {
    res.render('sablonlar', {
      aktifSayfa: 'sablonlar',
      sayfaBaslik: 'Doküman Şablon Tasarımcısı',
      sablonlar: qdms.tumSablonlar(db),
    });
  });

  app.get('/sablonlar/:tur', auth.izinGerekli('sablon'), (req, res) => {
    const tur = qdms.turGetir(req.params.tur);
    if (!tur) return sayfaYok(res, 'sablonlar');
    const sablon = qdms.sablonGetir(db, tur.kod);
    const sirket = sirketAyarlari(db);
    res.render('sablon-duzenle', {
      aktifSayfa: 'sablonlar',
      sayfaBaslik: `${tur.ad} Şablonu`,
      tur,
      sablon,
      sirket,
      logoVar: Boolean(sablon.logo_yolu),
      logoUyari: sablon.logo_yolu
        ? logoUyariMetni(sablon.logo_yolu, sablonLogoYolu(sablon))
        : '',
      kenarlikStilleri: [
        { deger: 'duz', ad: 'Düz çizgi' },
        { deger: 'kesikli', ad: 'Kesikli çizgi' },
        { deger: 'cift', ad: 'Çift çizgi' },
      ],
    });
  });

  app.post('/sablonlar/:tur', auth.izinGerekli('sablon'), logoYukleyici, (req, res) => {
    const tur = qdms.turGetir(req.params.tur);
    if (!tur) return sayfaYok(res, 'sablonlar');
    const geri = `/sablonlar/${tur.kod}`;
    const sablon = qdms.sablonGetir(db, tur.kod);
    if (!sablon) return sayfaYok(res, 'sablonlar');

    const baslik = metin(req.body.baslik);
    if (baslik.length < 2 || baslik.length > 120) {
      return yonlendir(res, geri, 'hata', 'Şablon adı 2-120 karakter arasında olmalıdır.');
    }
    const antetRenk = /^#[0-9a-fA-F]{6}$/.test(metin(req.body.antet_renk))
      ? metin(req.body.antet_renk)
      : '#1e3a8a';
    const kenarlik = ['duz', 'kesikli', 'cift'].includes(metin(req.body.kenarlik_stili))
      ? metin(req.body.kenarlik_stili)
      : 'duz';
    const basliklar = dizi(req.body.bolum_baslik);
    const ipuclari = dizi(req.body.bolum_ipucu);
    const zorunlular = dizi(req.body.bolum_zorunlu);
    const bolumler = [];
    for (let i = 0; i < basliklar.length; i += 1) {
      const bolumBaslik = metin(basliklar[i]);
      if (!bolumBaslik) continue;
      bolumler.push({
        baslik: bolumBaslik.slice(0, 160),
        ipucu: metin(ipuclari[i]).slice(0, 400),
        zorunlu: String(zorunlular[i] || '0') === '1',
      });
    }
    if (!bolumler.length) {
      return yonlendir(res, geri, 'hata', 'Şablonda en az bir bölüm tanımlanmalıdır.');
    }
    if (bolumler.length > 25) {
      return yonlendir(res, geri, 'hata', 'Bir şablonda en fazla 25 bölüm tanımlanabilir.');
    }

    if (req.file && !logoDosyasiGecerliMi(req.file.path)) {
      dosyaSil(logoKok, req.file.filename);
      return yonlendir(
        res,
        geri,
        'hata',
        'Yüklenen dosya geçerli bir PNG/JPG logo değil. Lütfen görseli PNG veya JPG olarak yükleyin.'
      );
    }

    let logoYolu = sablon.logo_yolu;
    if (req.file) {
      dosyaSil(logoKok, sablon.logo_yolu);
      logoYolu = req.file.filename;
    } else if (req.body.logo_sil) {
      dosyaSil(logoKok, sablon.logo_yolu);
      logoYolu = null;
    }

    db.prepare(
      `UPDATE sablonlar
       SET baslik = ?, bolumler = ?, antet_renk = ?, kenarlik_stili = ?,
           altbilgi_hazirlayan = ?, altbilgi_onaylayan = ?, logo_yolu = ?,
           guncelleme_tarihi = ?, guncelleyen_id = ?
       WHERE tur_kod = ?`
    ).run(
      baslik,
      JSON.stringify(bolumler),
      antetRenk,
      kenarlik,
      metin(req.body.altbilgi_hazirlayan).slice(0, 60) || 'Hazırlayan',
      metin(req.body.altbilgi_onaylayan).slice(0, 60) || 'Onaylayan',
      logoYolu,
      new Date().toISOString(),
      req.kullanici.id,
      tur.kod
    );
    return yonlendir(res, '/sablonlar', 'ok', `${tur.ad} şablonu güncellendi.`);
  });

  app.get('/sablonlar/:tur/onizleme', auth.izinGerekli('sablon'), async (req, res) => {
    const tur = qdms.turGetir(req.params.tur);
    if (!tur) return sayfaYok(res, 'sablonlar');
    const sablon = qdms.sablonGetir(db, tur.kod);
    const sirket = sirketAyarlari(db);
    const ornekIcerik = sablon.bolumler.map((bolum, indeks) => ({
      baslik: bolum.baslik,
      metin:
        bolum.ipucu ||
        `${tur.ad} şablonunun ${indeks + 1}. bölümü için örnek metin. Bu alan, doküman oluşturulurken doldurulacaktır.`,
    }));
    try {
      const pdf = await pdfUret({
        dokuman: {
          kod: `${tur.kod}-000`,
          baslik: `${tur.ad} Şablonu Önizlemesi`,
          aciklama: 'Bu PDF, şablon tasarımını değerlendirmek için üretilmiş bir önizlemedir.',
          revizyon: 0,
          durum: 'taslak',
          icerik: ornekIcerik,
          olusturma_tarihi: new Date().toISOString(),
        },
        sablon,
        sirket,
        tur,
        logoYolu: sablonLogoYolu(sablon) || dosyaYolu(logoKok, sirket.logo),
        logoVerisi: logoPdfGirdisi(sablon),
        hazirlayanAd: 'Örnek Hazırlayan',
        onaylayanAd: '',
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Cache-Control', 'no-store');
      return res.send(pdf);
    } catch (hata) {
      console.error('[şablon önizleme]', hata);
      return res.status(500).render('hata', {
        aktifSayfa: 'sablonlar',
        sayfaBaslik: 'Önizleme Üretilemedi',
        hataMesaji: 'Şablon önizlemesi oluşturulamadı.',
      });
    }
  });

  app.get('/sablonlar/:tur/logo', auth.izinGerekli('sablon'), (req, res) => {
    const tur = qdms.turGetir(req.params.tur);
    if (!tur) return res.status(404).end();
    const sablon = qdms.sablonGetir(db, tur.kod);
    const tam = sablonLogoYolu(sablon);
    if (!tam) return res.status(404).end();
    return res.sendFile(path.basename(tam), { root: logoKok });
  });

  // -------------------------------------------------------------------------
  // Eğitim Yönetimi ve Kurumsal Raporlar (Faz 3)
  // -------------------------------------------------------------------------
  require('./egitim-rotalari').egitimRotalariniKur(app, { db, auth, mail, config });
  require('./rapor-rotalari').raporRotalariniKur(app, { db, auth, mail, config });
  require('./dof-rotalari').dofRotalariniKur(app, { db, auth, mail, config });
  require('./tetkik-rotalari').tetkikRotalariniKur(app, { db, auth, mail, config });

  // -------------------------------------------------------------------------
  // Organizasyon ve kullanıcılar
  // -------------------------------------------------------------------------
  app.get('/organizasyon', (req, res) => {
    res.render('organizasyon', {
      aktifSayfa: 'organizasyon',
      sayfaBaslik: 'Organizasyon ve Kullanıcılar',
      departmanlar: tumDepartmanlar(),
      kullanicilar: tumKullanicilar(),
      roller: auth.ROLLER,
      duzenleyebilir: auth.yetkiliMi(req.kullanici, 'kullanici'),
    });
  });

  app.post('/organizasyon/departmanlar', auth.izinGerekli('kullanici'), (req, res) => {
    const ad = metin(req.body.ad);
    const aciklama = metin(req.body.aciklama).slice(0, 300);
    if (ad.length < 2 || ad.length > 80) {
      return yonlendir(res, '/organizasyon', 'hata', 'Departman adı 2-80 karakter arasında olmalıdır.');
    }
    try {
      db.prepare('INSERT INTO departmanlar (ad, aciklama) VALUES (?, ?)').run(ad, aciklama);
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu adla kayıtlı bir departman zaten var.'
        : 'Departman eklenemedi.';
      return yonlendir(res, '/organizasyon', 'hata', mesaj);
    }
    return yonlendir(res, '/organizasyon', 'ok', `"${ad}" departmanı eklendi.`);
  });

  app.post('/organizasyon/departmanlar/:id', auth.izinGerekli('kullanici'), (req, res) => {
    const id = kimlik(req.params.id);
    const departman = id ? db.prepare('SELECT * FROM departmanlar WHERE id = ?').get(id) : null;
    if (!departman) return yonlendir(res, '/organizasyon', 'hata', 'Departman bulunamadı.');
    const ad = metin(req.body.ad);
    if (ad.length < 2 || ad.length > 80) {
      return yonlendir(res, '/organizasyon', 'hata', 'Departman adı 2-80 karakter arasında olmalıdır.');
    }
    try {
      db.prepare('UPDATE departmanlar SET ad = ?, aciklama = ? WHERE id = ?').run(
        ad,
        metin(req.body.aciklama).slice(0, 300),
        id
      );
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu adla kayıtlı başka bir departman var.'
        : 'Departman güncellenemedi.';
      return yonlendir(res, '/organizasyon', 'hata', mesaj);
    }
    return yonlendir(res, '/organizasyon', 'ok', 'Departman güncellendi.');
  });

  app.post('/organizasyon/departmanlar/:id/sil', auth.izinGerekli('kullanici'), (req, res) => {
    const id = kimlik(req.params.id);
    const departman = id ? db.prepare('SELECT * FROM departmanlar WHERE id = ?').get(id) : null;
    if (!departman) return yonlendir(res, '/organizasyon', 'hata', 'Departman bulunamadı.');
    const kullaniciSayisi = db
      .prepare('SELECT COUNT(*) AS sayi FROM kullanicilar WHERE departman_id = ?')
      .get(id).sayi;
    if (kullaniciSayisi > 0) {
      return yonlendir(
        res,
        '/organizasyon',
        'hata',
        `"${departman.ad}" departmanında ${kullaniciSayisi} kullanıcı var; önce kullanıcıları başka departmana taşıyın.`
      );
    }
    db.prepare('DELETE FROM departmanlar WHERE id = ?').run(id);
    return yonlendir(res, '/organizasyon', 'ok', `"${departman.ad}" departmanı silindi.`);
  });

  app.post('/organizasyon/kullanicilar', auth.izinGerekli('kullanici'), (req, res) => {
    const departmanId = kimlik(req.body.departman_id) || null;
    try {
      const yeniId = auth.kullaniciOlustur(db, {
        ad: req.body.ad,
        email: req.body.email,
        sifre: req.body.sifre,
        rol: metin(req.body.rol),
        departmanId,
        aktif: req.body.aktif ? 1 : 0,
      });
      const kullanici = kullaniciGetir(yeniId);
      return yonlendir(res, '/organizasyon', 'ok', `"${kullanici.ad}" kullanıcısı oluşturuldu.`);
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var.'
        : hata.message;
      return yonlendir(res, '/organizasyon', 'hata', mesaj);
    }
  });

  app.post('/organizasyon/kullanicilar/:id', auth.izinGerekli('kullanici'), (req, res) => {
    const id = kimlik(req.params.id);
    const kullanici = id ? kullaniciGetir(id) : null;
    if (!kullanici) return yonlendir(res, '/organizasyon', 'hata', 'Kullanıcı bulunamadı.');
    const ad = metin(req.body.ad);
    const email = metin(req.body.email).toLowerCase();
    const rol = metin(req.body.rol);
    const aktif = req.body.aktif ? 1 : 0;
    if (ad.length < 2 || ad.length > 120) {
      return yonlendir(res, '/organizasyon', 'hata', 'Kullanıcı adı 2-120 karakter arasında olmalıdır.');
    }
    if (!epostaGecerli(email)) {
      return yonlendir(res, '/organizasyon', 'hata', 'Geçerli bir e-posta adresi girin.');
    }
    if (!auth.rolGecerliMi(rol)) {
      return yonlendir(res, '/organizasyon', 'hata', 'Geçersiz kullanıcı rolü.');
    }
    if (kullanici.id === req.kullanici.id && (!aktif || rol !== 'admin')) {
      return yonlendir(res, '/organizasyon', 'hata', 'Kendi yönetici hesabınızın rolünü kaldıramaz veya hesabı kapatamazsınız.');
    }
    if (kullanici.rol === 'admin' && (rol !== 'admin' || !aktif) && auth.aktifAdminSayisi(db, kullanici.id) === 0) {
      return yonlendir(res, '/organizasyon', 'hata', 'Sistemde en az bir aktif yönetici kalmalıdır.');
    }
    const sifre = String(req.body.sifre || '');
    if (sifre && !auth.sifreGecerliMi(sifre)) {
      return yonlendir(res, '/organizasyon', 'hata', 'Şifre en az 8 karakter olmalıdır.');
    }
    const departmanId = kimlik(req.body.departman_id) || null;
    try {
      db.prepare(
        `UPDATE kullanicilar SET ad = ?, email = ?, rol = ?, departman_id = ?, aktif = ? WHERE id = ?`
      ).run(ad, email, rol, departmanId, aktif, id);
      if (sifre) {
        db.prepare('UPDATE kullanicilar SET sifre_hash = ? WHERE id = ?').run(auth.sifreHashle(sifre), id);
        db.prepare('DELETE FROM oturumlar WHERE kullanici_id = ? AND token <> ?').run(id, req.oturumToken || '');
      }
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu e-posta adresiyle kayıtlı başka bir kullanıcı var.'
        : 'Kullanıcı güncellenemedi.';
      return yonlendir(res, '/organizasyon', 'hata', mesaj);
    }
    return yonlendir(res, '/organizasyon', 'ok', 'Kullanıcı güncellendi.');
  });

  app.post('/organizasyon/sifre', (req, res) => {
    const mevcut = String(req.body.mevcut_sifre || '');
    const yeni = String(req.body.yeni_sifre || '');
    const tekrar = String(req.body.yeni_sifre_tekrar || '');
    const kullanici = kullaniciGetir(req.kullanici.id);
    if (!auth.sifreDogrula(mevcut, kullanici.sifre_hash)) {
      return yonlendir(res, '/organizasyon', 'hata', 'Mevcut şifre hatalı.');
    }
    if (!auth.sifreGecerliMi(yeni)) {
      return yonlendir(res, '/organizasyon', 'hata', 'Yeni şifre en az 8 karakter olmalıdır.');
    }
    if (yeni !== tekrar) {
      return yonlendir(res, '/organizasyon', 'hata', 'Yeni şifreler birbiriyle eşleşmiyor.');
    }
    db.prepare('UPDATE kullanicilar SET sifre_hash = ? WHERE id = ?').run(auth.sifreHashle(yeni), kullanici.id);
    db.prepare('DELETE FROM oturumlar WHERE kullanici_id = ? AND token <> ?').run(kullanici.id, req.oturumToken || '');
    return yonlendir(res, '/organizasyon', 'ok', 'Şifreniz güncellendi.');
  });

  // -------------------------------------------------------------------------
  // Sistem ayarları
  // -------------------------------------------------------------------------
  app.get('/ayarlar', auth.izinGerekli('sistem'), (req, res) => {
    const form = ayarlarFormu(db, config);
    const sirket = sirketAyarlari(db);
    const logoDosyasi = sirketLogoYolu();
    res.render('ayarlar', {
      aktifSayfa: 'ayarlar',
      sayfaBaslik: 'Sistem Ayarları',
      form,
      sirket,
      logoUyari: logoUyariMetni(sirket.logo, logoDosyasi),
      sonEmailler: db
        .prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 5')
        .all(),
    });
  });

  app.post('/ayarlar/sirket', auth.izinGerekli('sistem'), logoYukleyici, (req, res) => {
    const eski = sirketAyarlari(db);
    try {
      if (req.file && !logoDosyasiGecerliMi(req.file.path)) {
        dosyaSil(logoKok, req.file.filename);
        return yonlendir(
          res,
          '/ayarlar',
          'hata',
          'Yüklenen dosya geçerli bir PNG/JPG logo değil. Lütfen görseli PNG veya JPG olarak yükleyin.'
        );
      }
      let logo = undefined;
      if (req.file) {
        logo = req.file.filename;
      } else if (req.body.logo_sil) {
        logo = '';
      }
      const yeni = sirketAyarlariKaydet(db, { ad: req.body.sirket_adi, logo });
      if (logo !== undefined && eski.logo && eski.logo !== yeni.logo) {
        dosyaSil(logoKok, eski.logo);
      }
      return yonlendir(res, '/ayarlar', 'ok', 'Şirket bilgileri kaydedildi.');
    } catch (hata) {
      dosyaSil(logoKok, req.file?.filename);
      return yonlendir(res, '/ayarlar', 'hata', hata.message);
    }
  });

  app.get('/sirket-logo', (req, res) => {
    const tam = sirketLogoYolu();
    if (!tam) return res.status(404).end();
    return res.sendFile(path.basename(tam), { root: logoKok });
  });

  // Şirket logosunun PDF antetinde nasıl basıldığını doğrudan gösteren önizleme.
  app.get('/ayarlar/logo-onizleme', auth.izinGerekli('sistem'), async (req, res) => {
    const sirket = sirketAyarlari(db);
    const tur = qdms.turGetir('PR');
    const sablon = qdms.sablonGetir(db, tur.kod);
    const ornek = sablon.bolumler.map((bolum) => ({
      baslik: bolum.baslik,
      metin: bolum.ipucu || 'Logo önizlemesi için örnek bölüm metni.',
    }));
    try {
      const pdf = await pdfUret({
        dokuman: {
          kod: 'PR-000',
          baslik: 'Logo ve Antet Önizlemesi',
          aciklama: 'Bu PDF, şirket logosunun antetteki görünümünü doğrulamak için üretilmiştir.',
          revizyon: 0,
          durum: 'taslak',
          icerik: ornek,
          olusturma_tarihi: new Date().toISOString(),
        },
        sablon,
        sirket,
        tur,
        logoYolu: sirketLogoYolu(),
        logoVerisi: logoPdfGirdisi(),
        hazirlayanAd: req.kullanici.ad,
        onaylayanAd: '',
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Cache-Control', 'no-store');
      res.set('Content-Disposition', 'inline; filename="logo-onizleme.pdf"');
      return res.send(pdf);
    } catch (hata) {
      console.error('[logo önizleme]', hata);
      return res.status(500).render('hata', {
        aktifSayfa: 'ayarlar',
        sayfaBaslik: 'Önizleme Üretilemedi',
        hataMesaji: 'Logo önizlemesi oluşturulamadı.',
      });
    }
  });

  app.post('/ayarlar', auth.izinGerekli('sistem'), (req, res) => {
    try {
      ayarlariKaydet(db, req.body, config);
      return yonlendir(res, '/ayarlar', 'ok', 'Ayarlar kaydedildi.');
    } catch (hata) {
      return yonlendir(res, '/ayarlar', 'hata', hata.message);
    }
  });

  app.post('/ayarlar/smtp-test', auth.izinGerekli('sistem'), async (req, res) => {
    const sonuc = await mail.baglantiTest();
    return yonlendir(res, '/ayarlar', sonuc.ok ? 'ok' : 'hata', sonuc.mesaj);
  });

  app.post('/ayarlar/test-eposta', auth.izinGerekli('sistem'), async (req, res) => {
    const ayarlar = etkinAyarlar(db, config);
    const alici = metin(req.body.test_alici) || ayarlar.smtp.user;
    if (!epostaGecerli(alici)) {
      return yonlendir(res, '/ayarlar', 'hata', 'Test e-postası için geçerli bir alıcı adresi girin.');
    }

    const html = testEpostasiHtml({
      mod: mailModu(ayarlar),
      alici,
      saatDilimi: ayarlar.saatDilimi,
      gonderimTarihi: gonderimZamani(new Date(), ayarlar.saatDilimi),
    });
    const sonuc = await mail.gonder({
      tur: 'test',
      alici,
      konu: 'Kalite Yönetim Sistemi — Test E-postası',
      html,
    });

    const mesaj = sonuc.ok
      ? sonuc.durum === 'test_modu'
        ? `Test e-postası test modunda kaydedildi (${alici}). E-posta Günlüğü sayfasından görüntüleyebilirsiniz.`
        : `Test e-postası ${alici} adresine gönderildi.`
      : `Test e-postası gönderilemedi: ${sonuc.hata}`;
    return yonlendir(res, '/ayarlar', sonuc.ok ? 'ok' : 'hata', mesaj);
  });

  // -------------------------------------------------------------------------
  // E-postalar
  // -------------------------------------------------------------------------
  app.get('/emailler', auth.izinGerekli('sistem'), (req, res) => {
    const kayitlar = db
      .prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 150')
      .all();
    res.render('emailler', {
      aktifSayfa: 'emailler',
      sayfaBaslik: 'E-posta Günlüğü',
      kayitlar,
      testModu: res.locals.testModu,
    });
  });

  app.get('/emailler/:id', auth.izinGerekli('sistem'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? db.prepare('SELECT * FROM email_kayitlari WHERE id = ?').get(id) : null;
    if (!kayit) {
      return res.status(404).render('404', { aktifSayfa: 'emailler', sayfaBaslik: 'E-posta Bulunamadı' });
    }
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:;");
    res.set('X-Content-Type-Options', 'nosniff');
    res.type('html').send(kayit.icerik || '<p>Bu e-postanın içeriği kaydedilmemiş.</p>');
  });

  // -------------------------------------------------------------------------
  // 404 ve hata yakalama
  // -------------------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).render('404', {
      aktifSayfa: '',
      sayfaBaslik: 'Sayfa Bulunamadı',
    });
  });

  app.use((hata, req, res, next) => {
    console.error('[uygulama hatası]', hata);
    if (res.headersSent) return next(hata);
    if (!req.kullanici) {
      return res.redirect(303, `/giris?hata=${encodeURIComponent('Oturum açmanız gerekiyor.')}`);
    }
    let mesaj = 'Beklenmeyen bir hata oluştu. Ayrıntılar sunucu konsoluna yazıldı.';
    if (hata instanceof multer.MulterError) {
      mesaj =
        hata.code === 'LIMIT_FILE_SIZE'
          ? 'Yüklenen dosya 10 MB sınırını aşıyor.'
          : 'Dosya yüklenirken bir hata oluştu.';
    } else if (hata?.message) {
      mesaj = hata.message;
    }
    res.status(500).render('hata', {
      aktifSayfa: '',
      sayfaBaslik: 'Beklenmeyen Bir Hata Oluştu',
      hataMesaji: mesaj,
    });
  });

  return app;
}

module.exports = { createApp, SAYFA_ADLARI };
