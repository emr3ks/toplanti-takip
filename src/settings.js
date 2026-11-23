'use strict';

const { mantiksal } = require('./config');
const { gecerliSaat, gecerliSaatDilimi } = require('./dates');
const { metin, epostaGecerli } = require('./dogrulama');

const SAAT_DILIMLERI = Object.freeze([
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'UTC',
]);

const ANAHTARLAR = Object.freeze([
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_user',
  'smtp_pass',
  'smtp_from_email',
  'smtp_from_name',
  'rapor_alici',
  'hatirlatma_saati',
  'saat_dilimi',
  'test_modu',
]);

function dbAyarlari(db) {
  const sonuc = {};
  for (const satir of db.prepare('SELECT anahtar, deger FROM ayarlar').all()) {
    sonuc[satir.anahtar] = satir.deger;
  }
  return sonuc;
}

function ortamDegeri(config, anahtar) {
  const env = config.env;
  switch (anahtar) {
    case 'smtp_host':
      return env.smtp.host;
    case 'smtp_port':
      return String(env.smtp.port);
    case 'smtp_secure':
      return env.smtp.secure ? '1' : '0';
    case 'smtp_user':
      return env.smtp.user;
    case 'smtp_pass':
      return env.smtp.pass;
    case 'smtp_from_email':
      return env.smtp.fromEmail;
    case 'smtp_from_name':
      return env.smtp.fromName;
    case 'rapor_alici':
      return env.raporAlici;
    case 'hatirlatma_saati':
      return env.hatirlatmaSaati;
    case 'saat_dilimi':
      return env.saatDilimi;
    case 'test_modu':
      return env.testModu ? '1' : '0';
    default:
      return '';
  }
}

function kaynak(dbMap, config, anahtar) {
  const dbDegeri = dbMap[anahtar];
  if (dbDegeri !== undefined && String(dbDegeri).trim() !== '') return 'veritabani';
  const envDegeri = ortamDegeri(config, anahtar);
  if (envDegeri !== undefined && String(envDegeri).trim() !== '') return 'ortam';
  return 'varsayilan';
}

/**
 * Veritabanı ayarlarını ortam değişkenleriyle birleştirir.
 * Boş veritabanı değeri ortam değişkenine düşer.
 * Dönen nesne SMTP şifresini de içerir; şablonlara doğrudan verilmemelidir.
 */
function etkinAyarlar(db, config) {
  const dbMap = dbAyarlari(db);
  const sec = (anahtar, varsayilan = '') => {
    const dbDegeri = dbMap[anahtar];
    if (dbDegeri !== undefined && String(dbDegeri).trim() !== '') return String(dbDegeri).trim();
    const envDegeri = ortamDegeri(config, anahtar);
    if (envDegeri !== undefined && String(envDegeri).trim() !== '') return String(envDegeri).trim();
    return varsayilan;
  };

  const port = Number(sec('smtp_port', '587'));
  return {
    smtp: {
      host: sec('smtp_host', ''),
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 587,
      secure: mantiksal(sec('smtp_secure', '0'), false),
      user: sec('smtp_user', ''),
      pass: sec('smtp_pass', ''),
      fromEmail: sec('smtp_from_email', ''),
      fromName: sec('smtp_from_name', 'Toplantı Takip'),
    },
    raporAlici: sec('rapor_alici', ''),
    hatirlatmaSaati: sec('hatirlatma_saati', '09:00'),
    saatDilimi: sec('saat_dilimi', 'Europe/Istanbul'),
    testModu: mantiksal(sec('test_modu', '0'), false),
    kaynaklar: {
      smtpHost: kaynak(dbMap, config, 'smtp_host'),
      smtpPort: kaynak(dbMap, config, 'smtp_port'),
      smtpSecure: kaynak(dbMap, config, 'smtp_secure'),
      smtpUser: kaynak(dbMap, config, 'smtp_user'),
      smtpPass: kaynak(dbMap, config, 'smtp_pass'),
      smtpFromEmail: kaynak(dbMap, config, 'smtp_from_email'),
      smtpFromName: kaynak(dbMap, config, 'smtp_from_name'),
      raporAlici: kaynak(dbMap, config, 'rapor_alici'),
      hatirlatmaSaati: kaynak(dbMap, config, 'hatirlatma_saati'),
      saatDilimi: kaynak(dbMap, config, 'saat_dilimi'),
      testModu: kaynak(dbMap, config, 'test_modu'),
    },
  };
}

/** Şablonlarda kullanılacak, şifre içermeyen güvenli kopya. */
function guvenliAyarlar(ayarlar) {
  return {
    smtp: {
      host: ayarlar.smtp.host,
      port: ayarlar.smtp.port,
      secure: ayarlar.smtp.secure,
      user: ayarlar.smtp.user,
      fromEmail: ayarlar.smtp.fromEmail,
      fromName: ayarlar.smtp.fromName,
      sifreVar: Boolean(ayarlar.smtp.pass),
    },
    raporAlici: ayarlar.raporAlici,
    hatirlatmaSaati: ayarlar.hatirlatmaSaati,
    saatDilimi: ayarlar.saatDilimi,
    testModu: ayarlar.testModu,
  };
}

function testModuEtkin(ayarlar) {
  return Boolean(ayarlar.testModu) || !ayarlar.smtp.host;
}

function mailModu(ayarlar) {
  return testModuEtkin(ayarlar) ? 'test' : 'smtp';
}

/** Ayarlar formunun ihtiyaç duyduğu, şifresiz değerler. */
function ayarlarFormu(db, config) {
  const a = etkinAyarlar(db, config);
  return {
    smtpHost: a.smtp.host,
    smtpPort: a.smtp.port,
    smtpSecure: a.smtp.secure,
    smtpUser: a.smtp.user,
    smtpFromEmail: a.smtp.fromEmail,
    smtpFromName: a.smtp.fromName,
    raporAlici: a.raporAlici,
    hatirlatmaSaati: a.hatirlatmaSaati,
    saatDilimi: a.saatDilimi,
    testModu: a.testModu,
    smtpPassVar: Boolean(a.smtp.pass),
    smtpPassKaynak: a.kaynaklar.smtpPass,
    kaynaklar: a.kaynaklar,
    saatDilimleri: SAAT_DILIMLERI,
    mod: mailModu(a),
  };
}

function ayarYaz(db, anahtar, deger) {
  if (deger === undefined || deger === null || String(deger).trim() === '') {
    db.prepare('DELETE FROM ayarlar WHERE anahtar = ?').run(anahtar);
    return;
  }
  db.prepare(
    `INSERT INTO ayarlar (anahtar, deger) VALUES (?, ?)
     ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger`
  ).run(anahtar, String(deger).trim());
}

/**
 * Ayarları doğrular ve veritabanına yazar.
 * Boş metin alanları ortam değişkenine geri düşecek şekilde silinir.
 * Boş SMTP şifresi mevcut şifreyi korur; temizlemek için smtp_pass_sil gönderilir.
 */
function ayarlariKaydet(db, girdi, config) {
  const al = (ad) => metin(girdi[ad]);
  const raporAlici = al('rapor_alici');
  const smtpFromEmail = al('smtp_from_email');
  const smtpHost = al('smtp_host');
  const hatirlatmaSaati = al('hatirlatma_saati');
  const saatDilimi = al('saat_dilimi');
  const portMetni = al('smtp_port');

  if (raporAlici && !epostaGecerli(raporAlici)) {
    throw new Error('Rapor alıcı e-posta adresi geçerli değil.');
  }
  if (smtpFromEmail && !epostaGecerli(smtpFromEmail)) {
    throw new Error('Gönderen e-posta adresi geçerli değil.');
  }

  let port = null;
  if (portMetni) {
    port = Number(portMetni);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP portu 1 ile 65535 arasında bir tam sayı olmalıdır.');
    }
  }
  if (hatirlatmaSaati && !gecerliSaat(hatirlatmaSaati)) {
    throw new Error('Hatırlatma saati SS:DD biçiminde olmalıdır (örn. 09:00).');
  }
  if (saatDilimi && !gecerliSaatDilimi(saatDilimi)) {
    throw new Error('Saat dilimi geçerli bir IANA saat dilimi olmalıdır (örn. Europe/Istanbul).');
  }
  if (smtpHost && !port) {
    // Port boş bırakıldıysa SMTP sunucusu için varsayılan 587 kullanılır.
    port = 587;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    ayarYaz(db, 'smtp_host', smtpHost);
    ayarYaz(db, 'smtp_port', port);
    ayarYaz(db, 'smtp_secure', girdi.smtp_secure ? '1' : '0');
    ayarYaz(db, 'smtp_user', al('smtp_user'));
    ayarYaz(db, 'smtp_from_email', smtpFromEmail);
    ayarYaz(db, 'smtp_from_name', al('smtp_from_name'));
    ayarYaz(db, 'rapor_alici', raporAlici);
    ayarYaz(db, 'hatirlatma_saati', hatirlatmaSaati);
    ayarYaz(db, 'saat_dilimi', saatDilimi);
    ayarYaz(db, 'test_modu', girdi.test_modu ? '1' : '0');

    if (girdi.smtp_pass_sil) {
      ayarYaz(db, 'smtp_pass', '');
    } else {
      const yeniSifre = al('smtp_pass');
      if (yeniSifre) ayarYaz(db, 'smtp_pass', yeniSifre);
    }

    db.exec('COMMIT');
  } catch (hata) {
    db.exec('ROLLBACK');
    throw hata;
  }

  return etkinAyarlar(db, config);
}

module.exports = {
  SAAT_DILIMLERI,
  etkinAyarlar,
  guvenliAyarlar,
  ayarlarFormu,
  ayarlariKaydet,
  dbAyarlari,
  testModuEtkin,
  mailModu,
};
