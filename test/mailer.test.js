'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { testOrtami } = require('./helpers');
const { fakeSmtpBaslat } = require('./fake-smtp');
const { ayarlariKaydet } = require('../src/settings');

function smtpAyarla(db, config, port, ek = {}) {
  ayarlariKaydet(
    db,
    {
      smtp_host: '127.0.0.1',
      smtp_port: String(port),
      smtp_secure: '',
      smtp_user: '',
      smtp_pass: '',
      smtp_from_email: 'toplanti@ornek.com',
      smtp_from_name: 'Toplantı Takip Test',
      saat_dilimi: 'Europe/Istanbul',
      ...ek,
    },
    config
  );
}

test('gerçek SMTP yolunda e-posta gönderilir ve kaydedilir', async (t) => {
  const fake = await fakeSmtpBaslat();
  const ortam = testOrtami();
  t.after(async () => {
    await fake.kapat();
    await ortam.kapat();
  });

  smtpAyarla(ortam.db, ortam.config, fake.port);
  const sonuc = await ortam.mailService.gonder({
    tur: 'test',
    alici: 'hedef@ornek.com',
    konu: 'Merhaba Test',
    html: '<p>Merhaba <strong>dünya</strong></p>',
  });

  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.durum, 'gonderildi');
  assert.equal(fake.mesajlar.length, 1);
  assert.match(fake.mesajlar[0].alicilar.join(','), /hedef@ornek\.com/);
  assert.match(fake.mesajlar[0].veri, /Subject: Merhaba Test/i);

  const log = ortam.db.prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 1').get();
  assert.equal(log.tur, 'test');
  assert.equal(log.durum, 'gonderildi');
  assert.match(log.icerik, /Merhaba/);

  const baglanti = await ortam.mailService.baglantiTest();
  assert.equal(baglanti.ok, true);
  assert.equal(baglanti.testModu, false);
  assert.match(baglanti.mesaj, /SMTP bağlantısı başarılı/);
});

test('test modu e-postayı göndermeden outbox dosyasına yazar', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  const sonuc = await ortam.mailService.gonder({
    tur: 'test',
    alici: 'hedef@ornek.com',
    konu: 'Test Modu',
    html: '<p>Test modu içeriği</p>',
  });

  assert.equal(sonuc.ok, true);
  assert.equal(sonuc.durum, 'test_modu');
  assert.ok(sonuc.dosya);
  assert.ok(fs.existsSync(path.join(ortam.config.outboxDir, sonuc.dosya)));

  const log = ortam.db.prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 1').get();
  assert.equal(log.durum, 'test_modu');
  assert.equal(log.dosya, sonuc.dosya);
  assert.match(log.icerik, /Test modu içeriği/);

  const baglanti = await ortam.mailService.baglantiTest();
  assert.equal(baglanti.ok, true);
  assert.equal(baglanti.testModu, true);
});

test('geçersiz alıcıya e-posta gönderilmez', async (t) => {
  const fake = await fakeSmtpBaslat();
  const ortam = testOrtami();
  t.after(async () => {
    await fake.kapat();
    await ortam.kapat();
  });

  smtpAyarla(ortam.db, ortam.config, fake.port);
  const sonuc = await ortam.mailService.gonder({
    tur: 'test',
    alici: 'gecersiz-adres',
    konu: 'Olmamalı',
    html: '<p>x</p>',
  });

  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.durum, 'hata');
  assert.match(sonuc.hata, /Geçerli bir alıcı/);
  assert.equal(fake.mesajlar.length, 0);

  const log = ortam.db.prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 1').get();
  assert.equal(log.durum, 'hata');
});

test('gönderen adresi yoksa gerçek gönderim hata verir', async (t) => {
  const fake = await fakeSmtpBaslat();
  const ortam = testOrtami();
  t.after(async () => {
    await fake.kapat();
    await ortam.kapat();
  });

  ayarlariKaydet(
    ortam.db,
    {
      smtp_host: '127.0.0.1',
      smtp_port: String(fake.port),
      smtp_user: '',
      smtp_from_email: '',
      saat_dilimi: 'Europe/Istanbul',
    },
    ortam.config
  );

  const sonuc = await ortam.mailService.gonder({
    tur: 'test',
    alici: 'hedef@ornek.com',
    konu: 'Gönderen yok',
    html: '<p>x</p>',
  });

  assert.equal(sonuc.ok, false);
  assert.match(sonuc.hata, /Gönderen e-posta adresi tanımlı değil/);
  assert.equal(fake.mesajlar.length, 0);
});
