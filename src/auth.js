'use strict';

const crypto = require('node:crypto');
const { metin, epostaGecerli } = require('./dogrulama');

const ROLLER = Object.freeze({
  admin: 'Sistem Yöneticisi',
  kalite: 'Kalite Yöneticisi',
  hazirlayan: 'Doküman Hazırlayan',
  onaylayan: 'Onaylayan',
  kullanici: 'Standart Kullanıcı',
});

const ROL_ANAHTARLARI = Object.freeze(Object.keys(ROLLER));

/** Rol bazlı izinler. Admin her zaman tüm izinlere sahiptir. */
const IZINLER = Object.freeze({
  admin: [
    'sistem',
    'kullanici',
    'sablon',
    'dokuman.olustur',
    'dokuman.duzenle',
    'dokuman.onayla',
    'dokuman.dagit',
    'dokuman.sil',
    'egitim',
    'rapor',
  ],
  kalite: [
    'sablon',
    'dokuman.olustur',
    'dokuman.duzenle',
    'dokuman.onayla',
    'dokuman.dagit',
    'dokuman.sil',
    'egitim',
    'rapor',
  ],
  hazirlayan: ['dokuman.olustur', 'dokuman.duzenle'],
  onaylayan: ['dokuman.onayla'],
  kullanici: [],
});

const VARSAYILAN_ADMIN = Object.freeze({
  ad: 'Sistem Yöneticisi',
  email: 'admin@qdms.local',
  sifre: 'Admin123!',
});

const COOKIE_ADI = 'qdms_oturum';
const OTURUM_GUN = 7;

function rolEtiketi(rol) {
  return ROLLER[rol] || rol || '—';
}

function rolGecerliMi(rol) {
  return Object.prototype.hasOwnProperty.call(ROLLER, rol);
}

function sifreHashle(sifre) {
  const tuz = crypto.randomBytes(16);
  const ozet = crypto.scryptSync(String(sifre), tuz, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${tuz.toString('hex')}$${ozet.toString('hex')}`;
}

function sifreDogrula(sifre, kayit) {
  if (typeof kayit !== 'string') return false;
  const parcalar = kayit.split('$');
  if (parcalar.length !== 3 || parcalar[0] !== 'scrypt') return false;
  try {
    const tuz = Buffer.from(parcalar[1], 'hex');
    const beklenen = Buffer.from(parcalar[2], 'hex');
    const ozet = crypto.scryptSync(String(sifre), tuz, beklenen.length, { N: 16384, r: 8, p: 1 });
    return ozet.length === beklenen.length && crypto.timingSafeEqual(ozet, beklenen);
  } catch {
    return false;
  }
}

function sifreGecerliMi(sifre) {
  const deger = metin(sifre);
  return deger.length >= 8 && deger.length <= 200;
}

function yetkiliMi(kullanici, izin) {
  if (!kullanici || !kullanici.aktif) return false;
  if (kullanici.rol === 'admin') return true;
  return (IZINLER[kullanici.rol] || []).includes(izin);
}

function herhangiYetki(kullanici, izinler) {
  return izinler.some((izin) => yetkiliMi(kullanici, izin));
}

function oturumOlustur(db, kullaniciId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const simdi = new Date();
  const bitis = new Date(simdi.getTime() + OTURUM_GUN * 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM oturumlar WHERE son_gecerlilik <= ?').run(simdi.toISOString());
  db.prepare(
    `INSERT INTO oturumlar (token, kullanici_id, olusturma_tarihi, son_gecerlilik)
     VALUES (?, ?, ?, ?)`
  ).run(token, kullaniciId, simdi.toISOString(), bitis.toISOString());
  return { token, bitis };
}

function oturumSil(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM oturumlar WHERE token = ?').run(token);
}

function oturumKullanicisi(db, token) {
  if (!token) return null;
  const satir = db
    .prepare(
      `SELECT k.*, d.ad AS departman_ad
       FROM oturumlar o
       JOIN kullanicilar k ON k.id = o.kullanici_id
       LEFT JOIN departmanlar d ON d.id = k.departman_id
       WHERE o.token = ? AND o.son_gecerlilik > ? AND k.aktif = 1`
    )
    .get(token, new Date().toISOString());
  return satir || null;
}

function cerezOku(cerezBasligi) {
  if (!cerezBasligi) return '';
  for (const parca of String(cerezBasligi).split(';')) {
    const [ad, ...kalan] = parca.trim().split('=');
    if (ad === COOKIE_ADI) return decodeURIComponent(kalan.join('=') || '');
  }
  return '';
}

function oturumCereziYaz(res, token) {
  res.append(
    'Set-Cookie',
    `${COOKIE_ADI}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      OTURUM_GUN * 24 * 60 * 60
    }`
  );
}

function oturumCereziSil(res) {
  res.append('Set-Cookie', `${COOKIE_ADI}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function oturumAra(db) {
  return (req, res, next) => {
    const token = cerezOku(req.headers.cookie);
    const kullanici = oturumKullanicisi(db, token);
    req.oturumToken = token;
    req.kullanici = kullanici;
    res.locals.kullanici = kullanici;
    res.locals.rolEtiketi = rolEtiketi;
    next();
  };
}

function girisGerekli(req, res, next) {
  if (req.kullanici) return next();
  const hedef = req.method === 'GET' ? req.originalUrl : '/';
  return res.redirect(303, `/giris?donus=${encodeURIComponent(hedef)}`);
}

function izinGerekli(izin) {
  return (req, res, next) => {
    if (!req.kullanici) {
      return res.redirect(303, `/giris?donus=${encodeURIComponent(req.originalUrl || '/')}`);
    }
    if (!yetkiliMi(req.kullanici, izin)) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: '',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: izin,
      });
    }
    return next();
  };
}

function kullaniciDogrula(db, email, sifre) {
  const adres = metin(email).toLowerCase();
  if (!epostaGecerli(adres) || !sifre) return null;
  const kullanici = db.prepare('SELECT * FROM kullanicilar WHERE email = ? COLLATE NOCASE').get(adres);
  if (!kullanici || !kullanici.aktif) return null;
  if (!sifreDogrula(sifre, kullanici.sifre_hash)) return null;
  return kullanici;
}

function kullaniciOlustur(db, { ad, email, sifre, rol = 'kullanici', departmanId = null, aktif = 1 }) {
  const adres = metin(email).toLowerCase();
  const adSoyad = metin(ad);
  if (adSoyad.length < 2 || adSoyad.length > 120) {
    throw new Error('Kullanıcı adı 2-120 karakter arasında olmalıdır.');
  }
  if (!epostaGecerli(adres)) {
    throw new Error('Geçerli bir e-posta adresi girin.');
  }
  if (!rolGecerliMi(rol)) {
    throw new Error('Geçersiz kullanıcı rolü.');
  }
  if (!sifreGecerliMi(sifre)) {
    throw new Error('Şifre en az 8, en fazla 200 karakter olmalıdır.');
  }
  const bilgi = db
    .prepare(
      `INSERT INTO kullanicilar (ad, email, sifre_hash, rol, departman_id, aktif)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(adSoyad, adres, sifreHashle(sifre), rol, departmanId || null, aktif ? 1 : 0);
  return Number(bilgi.lastInsertRowid);
}

function aktifAdminSayisi(db, haricId = null) {
  const sql =
    'SELECT COUNT(*) AS sayi FROM kullanicilar WHERE rol = ? AND aktif = 1' +
    (haricId ? ' AND id <> ?' : '');
  return db.prepare(sql).get('admin', ...(haricId ? [haricId] : [])).sayi;
}

/** İlk kurulumda varsayılan yönetici hesabını oluşturur. */
function varsayilanAdminOlustur(db) {
  const sayi = db.prepare('SELECT COUNT(*) AS sayi FROM kullanicilar').get().sayi;
  if (sayi > 0) return false;
  const departman = db
    .prepare('SELECT id FROM departmanlar WHERE ad = ? COLLATE NOCASE')
    .get('Kalite Güvence');
  db.prepare(
    `INSERT INTO kullanicilar (ad, email, sifre_hash, rol, departman_id, aktif)
     VALUES (?, ?, ?, 'admin', ?, 1)`
  ).run(
    VARSAYILAN_ADMIN.ad,
    VARSAYILAN_ADMIN.email,
    sifreHashle(VARSAYILAN_ADMIN.sifre),
    departman ? departman.id : null
  );
  return true;
}

module.exports = {
  ROLLER,
  ROL_ANAHTARLARI,
  IZINLER,
  VARSAYILAN_ADMIN,
  COOKIE_ADI,
  rolEtiketi,
  rolGecerliMi,
  sifreHashle,
  sifreDogrula,
  sifreGecerliMi,
  yetkiliMi,
  herhangiYetki,
  oturumOlustur,
  oturumSil,
  oturumKullanicisi,
  cerezOku,
  oturumCereziYaz,
  oturumCereziSil,
  oturumAra,
  girisGerekli,
  izinGerekli,
  kullaniciDogrula,
  kullaniciOlustur,
  aktifAdminSayisi,
  varsayilanAdminOlustur,
};
