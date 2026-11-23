'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { testOrtami } = require('./helpers');
const {
  ayarlariKaydet,
  etkinAyarlar,
  guvenliAyarlar,
  testModuEtkin,
} = require('../src/settings');

test('varsayılan ayarlar ve ortam değişkeni yedeği', async (t) => {
  const ortam = testOrtami({
    SMTP_HOST: 'env.ornek.com',
    SMTP_PORT: '2525',
    SMTP_FROM_EMAIL: 'env@ornek.com',
    RAPOR_ALICI: 'rapor@ornek.com',
    HATIRLATMA_SAATI: '08:15',
    SAAT_DILIMI: 'Europe/Berlin',
    MAIL_TEST_MODE: '',
  });
  t.after(() => ortam.kapat());

  const ayarlar = etkinAyarlar(ortam.db, ortam.config);
  assert.equal(ayarlar.smtp.host, 'env.ornek.com');
  assert.equal(ayarlar.smtp.port, 2525);
  assert.equal(ayarlar.raporAlici, 'rapor@ornek.com');
  assert.equal(ayarlar.hatirlatmaSaati, '08:15');
  assert.equal(ayarlar.saatDilimi, 'Europe/Berlin');
  assert.equal(testModuEtkin(ayarlar), false);
  assert.equal(ayarlar.kaynaklar.smtpHost, 'ortam');
});

test('SMTP tanımlı değilse test modu otomatik etkindir', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  const ayarlar = etkinAyarlar(ortam.db, ortam.config);
  assert.equal(ayarlar.smtp.host, '');
  assert.equal(ayarlar.smtp.port, 587);
  assert.equal(ayarlar.hatirlatmaSaati, '09:00');
  assert.equal(ayarlar.saatDilimi, 'Europe/Istanbul');
  assert.equal(testModuEtkin(ayarlar), true);
  assert.equal(ayarlar.kaynaklar.smtpHost, 'varsayilan');
});

test('ayarlar kaydedilir ve şifre boş bırakıldığında korunur', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  ayarlariKaydet(
    ortam.db,
    {
      smtp_host: 'smtp.ornek.com',
      smtp_port: '2525',
      smtp_secure: '1',
      smtp_user: 'kullanici@ornek.com',
      smtp_pass: 'gizli-sifre',
      smtp_from_email: 'gonderen@ornek.com',
      smtp_from_name: 'Ekip',
      rapor_alici: 'rapor@ornek.com',
      hatirlatma_saati: '14:30',
      saat_dilimi: 'Europe/Berlin',
      test_modu: '1',
    },
    ortam.config
  );

  let ayarlar = etkinAyarlar(ortam.db, ortam.config);
  assert.equal(ayarlar.smtp.host, 'smtp.ornek.com');
  assert.equal(ayarlar.smtp.port, 2525);
  assert.equal(ayarlar.smtp.secure, true);
  assert.equal(ayarlar.smtp.pass, 'gizli-sifre');
  assert.equal(ayarlar.raporAlici, 'rapor@ornek.com');
  assert.equal(ayarlar.hatirlatmaSaati, '14:30');
  assert.equal(ayarlar.saatDilimi, 'Europe/Berlin');
  assert.equal(ayarlar.testModu, true);
  assert.equal(ayarlar.kaynaklar.smtpPass, 'veritabani');
  assert.equal(Object.hasOwn(guvenliAyarlar(ayarlar).smtp, 'pass'), false);

  ayarlariKaydet(
    ortam.db,
    {
      smtp_host: 'smtp.ornek.com',
      smtp_port: '2525',
      smtp_user: 'kullanici@ornek.com',
      smtp_from_email: 'gonderen@ornek.com',
      rapor_alici: 'rapor@ornek.com',
      hatirlatma_saati: '14:30',
      saat_dilimi: 'Europe/Berlin',
      smtp_pass: '',
    },
    ortam.config
  );

  ayarlar = etkinAyarlar(ortam.db, ortam.config);
  assert.equal(ayarlar.smtp.pass, 'gizli-sifre');
  assert.equal(ayarlar.testModu, false, 'işaretsiz test_modu alanı false olarak kaydedilir');

  ayarlariKaydet(ortam.db, { smtp_pass_sil: '1' }, ortam.config);
  ayarlar = etkinAyarlar(ortam.db, ortam.config);
  assert.equal(ayarlar.smtp.pass, '');
});

test('geçersiz ayarlar reddedilir ve önceki değer korunur', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  ayarlariKaydet(ortam.db, { rapor_alici: 'gecerli@ornek.com' }, ortam.config);

  assert.throws(
    () => ayarlariKaydet(ortam.db, { rapor_alici: 'gecersiz-adres' }, ortam.config),
    /Rapor alıcı e-posta adresi geçerli değil/
  );
  assert.throws(
    () => ayarlariKaydet(ortam.db, { smtp_port: '70000' }, ortam.config),
    /SMTP portu/
  );
  assert.throws(
    () => ayarlariKaydet(ortam.db, { hatirlatma_saati: '25:00' }, ortam.config),
    /Hatırlatma saati/
  );
  assert.throws(
    () => ayarlariKaydet(ortam.db, { saat_dilimi: 'Mars/Olympus' }, ortam.config),
    /Saat dilimi/
  );

  assert.equal(etkinAyarlar(ortam.db, ortam.config).raporAlici, 'gecerli@ornek.com');
});

test('boş veritabanı değeri ortam değişkenine geri düşer', async (t) => {
  const ortam = testOrtami({ SMTP_HOST: 'env.ornek.com', RAPOR_ALICI: 'env-rapor@ornek.com' });
  t.after(() => ortam.kapat());

  ayarlariKaydet(
    ortam.db,
    {
      smtp_host: 'db.ornek.com',
      rapor_alici: 'db-rapor@ornek.com',
      hatirlatma_saati: '10:00',
      saat_dilimi: 'Europe/Istanbul',
    },
    ortam.config
  );
  assert.equal(etkinAyarlar(ortam.db, ortam.config).smtp.host, 'db.ornek.com');

  // Boş alan veritabanı satırını siler; ortam değişkeni yeniden geçerli olur.
  ortam.db.prepare("DELETE FROM ayarlar WHERE anahtar = 'smtp_host'").run();
  assert.equal(etkinAyarlar(ortam.db, ortam.config).smtp.host, 'env.ornek.com');
});
