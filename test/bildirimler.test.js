'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { testOrtami } = require('./helpers');
const { bugunTz, gunEkle, tarihTr } = require('../src/dates');
const {
  onayBekleyenleriBilgilendir,
  yayinBilgileriniGonder,
  egitimHatirlatmalariGonder,
} = require('../src/bildirimler');
const { hatirlatmaZamanlayicisiBaslat } = require('../src/hatirlatmalar');
const { EPOSTA_TURLERI } = require('../src/sabitler');
const {
  onayBekliyorEpostasi,
  dokumanYayinlandiEpostasi,
  egitimHatirlatmaEpostasi,
} = require('../src/emails');

const TZ = 'Europe/Istanbul';

function kullaniciEkle(db, { ad, email, rol = 'kullanici', departmanId = null, aktif = 1 }) {
  const bilgi = db
    .prepare(
      `INSERT INTO kullanicilar (ad, email, sifre_hash, rol, departman_id, aktif)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(ad, email, 'test-hash', rol, departmanId, aktif);
  return Number(bilgi.lastInsertRowid);
}

function departmanId(db, ad) {
  const satir = db.prepare('SELECT id FROM departmanlar WHERE ad = ? COLLATE NOCASE').get(ad);
  assert.ok(satir, `${ad} departmanı bulunamadı`);
  return Number(satir.id);
}

function dokumanEkle(
  db,
  { kod, baslik, turKod = 'PR', revizyon = 1, durum = 'yayinda', departmanlar = [] }
) {
  const bilgi = db
    .prepare(
      `INSERT INTO dokumanlar (kod, tur_kod, baslik, aciklama, revizyon, durum, icerik)
       VALUES (?, ?, ?, '', ?, ?, '[]')`
    )
    .run(kod, turKod, baslik, revizyon, durum);
  const id = Number(bilgi.lastInsertRowid);
  for (const departman of departmanlar) {
    db.prepare(
      'INSERT OR IGNORE INTO dokuman_hedef_departmanlar (dokuman_id, departman_id) VALUES (?, ?)'
    ).run(id, departman);
  }
  return db
    .prepare(
      `SELECT d.*, t.ad AS tur_ad FROM dokumanlar d
       LEFT JOIN dokuman_turleri t ON t.kod = d.tur_kod WHERE d.id = ?`
    )
    .get(id);
}

function egitimEkle(
  db,
  { ad, tur = 'ic', egitmen = '', tarih, sureSaat = 2, dokumanId = null, durum = 'planlandi' }
) {
  const bilgi = db
    .prepare(
      `INSERT INTO egitimler (ad, tur, egitmen, planlanan_tarih, sure_saat, dokuman_id, aciklama, durum)
       VALUES (?, ?, ?, ?, ?, ?, '', ?)`
    )
    .run(ad, tur, egitmen, tarih, sureSaat, dokumanId, durum);
  return Number(bilgi.lastInsertRowid);
}

function katilimciEkle(db, egitimId, kullaniciId, katilimDurumu = 'bekliyor') {
  db.prepare(
    `INSERT INTO egitim_katilimcilari (egitim_id, kullanici_id, katilim_durumu)
     VALUES (?, ?, ?)`
  ).run(egitimId, kullaniciId, katilimDurumu);
}

function epostaKayitlari(db, tur) {
  return db
    .prepare('SELECT * FROM email_kayitlari WHERE tur = ? ORDER BY id ASC')
    .all(tur);
}

async function sessionKayitliCalistir(fn) {
  const eski = console.error;
  const kayitlar = [];
  console.error = (...parcalar) => {
    kayitlar.push(parcalar.map((parca) => String(parca)).join(' '));
  };
  try {
    const sonuc = await fn();
    return { sonuc, kayitlar };
  } finally {
    console.error = eski;
  }
}

test('onay bekleyen doküman onaylayan ve kalite rollerine bildirilir', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());
  const { db, mailService, config } = ortam;
  const uretim = departmanId(db, 'Üretim');

  const gonderen = kullaniciEkle(db, {
    ad: 'Gönderen Kalite',
    email: 'gonderen@ornek.com',
    rol: 'onaylayan',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Onaylayan Kullanıcı',
    email: 'onaylayan@ornek.com',
    rol: 'onaylayan',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Kalite Kullanıcı',
    email: 'kalite@ornek.com',
    rol: 'kalite',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Pasif Onaylayan',
    email: 'pasif@ornek.com',
    rol: 'onaylayan',
    departmanId: uretim,
    aktif: 0,
  });
  kullaniciEkle(db, {
    ad: 'Geçersiz E-posta',
    email: 'gecersiz-adres',
    rol: 'kalite',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Normal Kullanıcı',
    email: 'normal@ornek.com',
    rol: 'kullanici',
    departmanId: uretim,
  });

  const dokuman = dokumanEkle(db, {
    kod: 'PR-120',
    baslik: 'Onay Bekleyen Prosedür',
    turKod: 'PR',
    revizyon: 3,
    durum: 'kontrol',
    departmanlar: [uretim],
  });

  const sonuc = await onayBekleyenleriBilgilendir({
    db,
    mail: mailService,
    config,
    dokuman,
    gonderenId: gonderen,
  });

  assert.equal(sonuc.gonderilen, 2);
  assert.equal(sonuc.atlanan, 1);
  assert.deepEqual(sonuc.hatalar, []);

  const kayitlar = epostaKayitlari(db, 'dokuman_onay');
  assert.equal(kayitlar.length, 2);
  assert.deepEqual(
    kayitlar.map((kayit) => kayit.alici).sort(),
    ['kalite@ornek.com', 'onaylayan@ornek.com']
  );
  const beklenenBaglanti = `http://${config.host}:${config.port}/dokumanlar/${dokuman.id}`;
  for (const kayit of kayitlar) {
    assert.equal(kayit.durum, 'test_modu');
    assert.equal(kayit.konu, 'Onay bekleyen doküman: PR-120');
    assert.ok(kayit.icerik.includes(dokuman.kod));
    assert.ok(kayit.icerik.includes(beklenenBaglanti));
    assert.ok(kayit.icerik.includes('Onay Bekleyen Doküman'));
  }

  const normalKayit = db
    .prepare("SELECT COUNT(*) AS sayi FROM email_kayitlari WHERE alici = 'normal@ornek.com'")
    .get();
  assert.equal(normalKayit.sayi, 0);
  const gonderenKayit = db
    .prepare("SELECT COUNT(*) AS sayi FROM email_kayitlari WHERE alici = 'gonderen@ornek.com'")
    .get();
  assert.equal(gonderenKayit.sayi, 0);
});

test('yayın bilgisi yalnızca hedef departman kullanıcılarına gönderilir', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());
  const { db, mailService, config } = ortam;
  const uretim = departmanId(db, 'Üretim');
  const bakim = departmanId(db, 'Bakım');

  kullaniciEkle(db, {
    ad: 'Üretim Bir',
    email: 'uretim1@ornek.com',
    rol: 'kullanici',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Üretim İki',
    email: 'uretim2@ornek.com',
    rol: 'kullanici',
    departmanId: uretim,
  });
  kullaniciEkle(db, {
    ad: 'Pasif Üretim',
    email: 'pasif-uretim@ornek.com',
    rol: 'kullanici',
    departmanId: uretim,
    aktif: 0,
  });
  kullaniciEkle(db, {
    ad: 'Bakım Kullanıcı',
    email: 'bakim@ornek.com',
    rol: 'kullanici',
    departmanId: bakim,
  });

  const dokuman = dokumanEkle(db, {
    kod: 'TL-045',
    baslik: 'Yayınlanan Talimat',
    turKod: 'TL',
    revizyon: 2,
    durum: 'yayinda',
    departmanlar: [uretim],
  });

  const sonuc = await yayinBilgileriniGonder({
    db,
    mail: mailService,
    config,
    dokuman,
  });

  assert.equal(sonuc.gonderilen, 2);
  assert.equal(sonuc.atlanan, 0);
  assert.deepEqual(sonuc.hatalar, []);

  const kayitlar = epostaKayitlari(db, 'dokuman_yayin');
  assert.equal(kayitlar.length, 2);
  assert.deepEqual(
    kayitlar.map((kayit) => kayit.alici).sort(),
    ['uretim1@ornek.com', 'uretim2@ornek.com']
  );
  const beklenenBaglanti = `http://${config.host}:${config.port}/dokumanlar/${dokuman.id}`;
  for (const kayit of kayitlar) {
    assert.equal(kayit.durum, 'test_modu');
    assert.equal(kayit.konu, 'Doküman yayınlandı: TL-045');
    assert.ok(kayit.icerik.includes('TL-045'));
    assert.ok(kayit.icerik.includes('Okudum, Anladım'));
    assert.ok(kayit.icerik.includes(beklenenBaglanti));
  }

  const bakimKayit = db
    .prepare("SELECT COUNT(*) AS sayi FROM email_kayitlari WHERE alici = 'bakim@ornek.com'")
    .get();
  assert.equal(bakimKayit.sayi, 0);
});

test('eğitim hatırlatmaları gönderilir ve aynı katılımcıya tekrar gönderilmez', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());
  const { db, mailService, config } = ortam;
  const bugun = bugunTz(TZ);
  const yaklasanTarih = gunEkle(bugun, 2);

  const dokuman = dokumanEkle(db, {
    kod: 'PR-330',
    baslik: 'Eğitim Dayanak Prosedürü',
    durum: 'yayinda',
  });
  const egitimId = egitimEkle(db, {
    ad: 'ISO 9001 İç Denetçi Eğitimi',
    tur: 'ic',
    egitmen: 'Ahmet Eğitmen',
    tarih: yaklasanTarih,
    sureSaat: 2.5,
    dokumanId: dokuman.id,
  });

  const p1 = kullaniciEkle(db, { ad: 'Katılımcı Bir', email: 'p1@ornek.com', rol: 'kullanici' });
  const p2 = kullaniciEkle(db, { ad: 'Katılımcı İki', email: 'p2@ornek.com', rol: 'kullanici' });
  const katildi = kullaniciEkle(db, {
    ad: 'Katılmış Kişi',
    email: 'katildi@ornek.com',
    rol: 'kullanici',
  });
  const pasif = kullaniciEkle(db, {
    ad: 'Pasif Katılımcı',
    email: 'pasif-p@ornek.com',
    rol: 'kullanici',
    aktif: 0,
  });
  const gecersiz = kullaniciEkle(db, {
    ad: 'Geçersiz E-posta Katılımcı',
    email: 'gecersiz-p',
    rol: 'kullanici',
  });
  katilimciEkle(db, egitimId, p1);
  katilimciEkle(db, egitimId, p2);
  katilimciEkle(db, egitimId, katildi, 'katildi');
  katilimciEkle(db, egitimId, pasif);
  katilimciEkle(db, egitimId, gecersiz);

  // Pencere dışı ve tamamlanmış eğitimler hatırlatmaya dahil edilmemeli.
  const uzakId = egitimEkle(db, {
    ad: 'Çok İlerideki Eğitim',
    tarih: gunEkle(bugun, 10),
  });
  const uzakKisi = kullaniciEkle(db, { ad: 'Uzak Katılımcı', email: 'uzak@ornek.com' });
  katilimciEkle(db, uzakId, uzakKisi);
  const tamamlanmisId = egitimEkle(db, {
    ad: 'Tamamlanmış Eğitim',
    tarih: gunEkle(bugun, 1),
    durum: 'tamamlandi',
  });
  const tamamKisi = kullaniciEkle(db, { ad: 'Tamam Katılımcı', email: 'tamam@ornek.com' });
  katilimciEkle(db, tamamlanmisId, tamamKisi);

  const sonuc = await egitimHatirlatmalariGonder({
    db,
    mail: mailService,
    config,
    gun: 7,
  });

  assert.equal(sonuc.gonderilen, 2);
  assert.equal(sonuc.atlanan, 1);
  assert.deepEqual(sonuc.hatalar, []);

  const kayitlar = epostaKayitlari(db, 'egitim_hatirlatma');
  assert.equal(kayitlar.length, 2);
  assert.deepEqual(
    kayitlar.map((kayit) => kayit.alici).sort(),
    ['p1@ornek.com', 'p2@ornek.com']
  );
  const beklenenBaglanti = `http://${config.host}:${config.port}/egitim/${egitimId}`;
  for (const kayit of kayitlar) {
    assert.equal(kayit.durum, 'test_modu');
    assert.equal(kayit.konu, 'Eğitim hatırlatması: ISO 9001 İç Denetçi Eğitimi');
    assert.ok(kayit.icerik.includes('ISO 9001 İç Denetçi Eğitimi'));
    assert.ok(kayit.icerik.includes(tarihTr(yaklasanTarih)));
    assert.ok(kayit.icerik.includes('2,5 saat'));
    assert.ok(kayit.icerik.includes('Ahmet Eğitmen'));
    assert.ok(kayit.icerik.includes(dokuman.kod));
    assert.ok(kayit.icerik.includes(beklenenBaglanti));
  }

  const katilimcilar = db
    .prepare(
      'SELECT kullanici_id, hatirlatma_tarihi FROM egitim_katilimcilari WHERE egitim_id = ? ORDER BY kullanici_id'
    )
    .all(egitimId);
  const hatirlatmaMap = new Map(katilimcilar.map((satir) => [satir.kullanici_id, satir.hatirlatma_tarihi]));
  assert.ok(hatirlatmaMap.get(p1));
  assert.ok(hatirlatmaMap.get(p2));
  assert.equal(hatirlatmaMap.get(katildi), null);
  assert.equal(hatirlatmaMap.get(pasif), null);
  assert.equal(hatirlatmaMap.get(gecersiz), null);

  const tekrar = await egitimHatirlatmalariGonder({
    db,
    mail: mailService,
    config,
    gun: 7,
  });
  assert.equal(tekrar.gonderilen, 0);
  assert.equal(epostaKayitlari(db, 'egitim_hatirlatma').length, 2);

  // egitimId verildiğinde yalnızca o eğitim işlenir.
  const ikinciId = egitimEkle(db, {
    ad: 'Yeni Planlanan Eğitim',
    tarih: gunEkle(bugun, 3),
  });
  const p6 = kullaniciEkle(db, { ad: 'Altıncı Katılımcı', email: 'p6@ornek.com' });
  katilimciEkle(db, ikinciId, p6);
  const sinirli = await egitimHatirlatmalariGonder({
    db,
    mail: mailService,
    config,
    egitimId: ikinciId,
    gun: 7,
  });
  assert.equal(sinirli.gonderilen, 1);
  const sinirliKayitlar = epostaKayitlari(db, 'egitim_hatirlatma');
  assert.equal(sinirliKayitlar.length, 3);
  assert.equal(sinirliKayitlar[2].alici, 'p6@ornek.com');
});

test('e-posta gönderimi başarısız olursa hatırlatma tarihi boş kalır ve hata fırlatılmaz', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());
  const { db, config } = ortam;
  const bugun = bugunTz(TZ);

  const egitimId = egitimEkle(db, {
    ad: 'Hatalı Gönderim Eğitimi',
    tarih: gunEkle(bugun, 2),
  });
  const kisi = kullaniciEkle(db, { ad: 'Hatalı Alıcı', email: 'hata@ornek.com' });
  katilimciEkle(db, egitimId, kisi);

  const bozukMail = {
    async gonder() {
      throw new Error('SMTP bağlantısı kurulamadı');
    },
  };

  const { sonuc, kayitlar } = await sessionKayitliCalistir(() =>
    egitimHatirlatmalariGonder({ db, mail: bozukMail, config, gun: 7 })
  );

  assert.equal(sonuc.gonderilen, 0);
  assert.equal(sonuc.hatalar.length, 1);
  assert.match(sonuc.hatalar[0], /SMTP bağlantısı kurulamadı/);
  assert.equal(kayitlar.length, 1);
  assert.match(kayitlar[0], /egitim hatırlatması/);

  const katilim = db
    .prepare('SELECT hatirlatma_tarihi FROM egitim_katilimcilari WHERE egitim_id = ?')
    .get(egitimId);
  assert.equal(katilim.hatirlatma_tarihi, null);

  // Sonraki turda yeniden denenebilmelidir.
  const duzgun = await egitimHatirlatmalariGonder({
    db,
    mail: ortam.mailService,
    config,
    gun: 7,
  });
  assert.equal(duzgun.gonderilen, 1);
});

test('zamanlayıcı başlatma/durdurma güvenlidir ve hemen bir tur çalıştırır', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());
  const { db, mailService, config } = ortam;
  const bugun = bugunTz(TZ);

  const egitimId = egitimEkle(db, {
    ad: 'Zamanlayıcı Eğitimi',
    tarih: gunEkle(bugun, 2),
  });
  const kisi = kullaniciEkle(db, { ad: 'Zamanlayıcı Katılımcı', email: 'zaman@ornek.com' });
  katilimciEkle(db, egitimId, kisi);

  const zamanlayici = hatirlatmaZamanlayicisiBaslat({
    db,
    mail: mailService,
    config,
    aralikMs: 60_000,
    gun: 7,
  });
  assert.equal(typeof zamanlayici.calistir, 'function');
  assert.equal(typeof zamanlayici.durdur, 'function');

  const ilk = await zamanlayici.calistir();
  assert.equal(ilk.gonderilen, 1);
  assert.equal(epostaKayitlari(db, 'egitim_hatirlatma').length, 1);

  zamanlayici.durdur();
  assert.doesNotThrow(() => zamanlayici.durdur());

  // İkinci kez başlatmak çökmemeli; tekrar gönderim de olmamalı.
  const ikinci = hatirlatmaZamanlayicisiBaslat({
    db,
    mail: mailService,
    config,
    aralikMs: 60_000,
    gun: 7,
  });
  const ikinciSonuc = await ikinci.calistir();
  assert.equal(ikinciSonuc.gonderilen, 0);
  assert.equal(epostaKayitlari(db, 'egitim_hatirlatma').length, 1);
  ikinci.durdur();
});

test('şablonlar kullanıcı verilerini kaçırır ve yeni e-posta türleri tanımlıdır', () => {
  assert.equal(EPOSTA_TURLERI.dokuman_onay, 'Doküman onay bildirimi');
  assert.equal(EPOSTA_TURLERI.dokuman_yayin, 'Doküman yayın bildirimi');
  assert.equal(EPOSTA_TURLERI.egitim_hatirlatma, 'Eğitim hatırlatması');

  const onayHtml = onayBekliyorEpostasi({
    dokuman: { kod: '<script>alert(1)</script>', baslik: '<b>Başlık</b>', revizyon: 1 },
    aliciAd: '<i>Ali</i>',
    turAd: '<u>Tür</u>',
    revizyonEtiketi: 'Rev.01',
    sirketAdi: '<em>Şirket</em>',
    baglanti: 'http://ornek.local/dokumanlar/1?a=1&b=2',
    saatDilimi: TZ,
  });
  assert.ok(!onayHtml.includes('<script>'));
  assert.ok(!onayHtml.includes('<b>Başlık</b>'));
  assert.ok(onayHtml.includes('&lt;script&gt;'));
  assert.ok(onayHtml.includes('http://ornek.local/dokumanlar/1?a=1&amp;b=2'));
  assert.ok(onayHtml.includes('otomatik olarak gönderilmiştir'));
  assert.ok(onayHtml.includes('Onay Bekleyen Doküman'));

  const yayinHtml = dokumanYayinlandiEpostasi({
    dokuman: { kod: 'PR-1', baslik: 'Başlık', yayin_tarihi: new Date().toISOString() },
    aliciAd: 'Ayşe',
    turAd: 'Prosedür',
    revizyonEtiketi: 'Rev.00',
    sirketAdi: 'Şirket',
    baglanti: '/dokumanlar/1',
    saatDilimi: TZ,
  });
  assert.ok(yayinHtml.includes('Okudum, Anladım'));
  assert.ok(yayinHtml.includes('/dokumanlar/1'));

  const egitimHtml = egitimHatirlatmaEpostasi({
    egitim: { ad: 'Eğitim Adı' },
    kisiAd: 'Mehmet',
    turEtiketi: 'İç Eğitim',
    tarih: '01.02.2026',
    sureSaat: '2',
    egitmen: 'Eğitmen',
    dokumanKodu: 'PR-9',
    baglanti: '/egitim/5',
    sirketAdi: 'Şirket',
    saatDilimi: TZ,
  });
  assert.ok(egitimHtml.includes('Eğitim Adı'));
  assert.ok(egitimHtml.includes('2 saat'));
  assert.ok(egitimHtml.includes('PR-9'));
  assert.ok(egitimHtml.includes('/egitim/5'));
  assert.ok(egitimHtml.includes('otomatik olarak gönderilmiştir'));
});
