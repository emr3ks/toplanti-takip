'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { testOrtami } = require('./helpers');
const { fakeSmtpBaslat } = require('./fake-smtp');
const { ayarlariKaydet } = require('../src/settings');
const { runReminderJob } = require('../src/reminder');

function sorumluEkle(db, ad, email) {
  const bilgi = db.prepare('INSERT INTO sorumlular (ad, email) VALUES (?, ?)').run(ad, email);
  return Number(bilgi.lastInsertRowid);
}

function toplantiEkle(db, ad, tarih) {
  const bilgi = db.prepare('INSERT INTO toplantilar (ad, tarih) VALUES (?, ?)').run(ad, tarih);
  return Number(bilgi.lastInsertRowid);
}

function isEkle(db, { toplantiId, baslik, sorumluId = null, hedefTarih = null, durum = 'aktif' }) {
  const bilgi = db
    .prepare(
      `INSERT INTO isler (toplanti_id, baslik, not_metni, sorumlu_id, hedef_tarih, durum)
       VALUES (?, ?, '', ?, ?, ?)`
    )
    .run(toplantiId, baslik, sorumluId, hedefTarih, durum);
  return Number(bilgi.lastInsertRowid);
}

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
      rapor_alici: 'rapor@ornek.com',
      hatirlatma_saati: '09:00',
      saat_dilimi: 'Europe/Istanbul',
      ...ek,
    },
    config
  );
}

test('hatırlatma yalnızca uygun işlere gider ve mükerrer gönderim yapmaz', async (t) => {
  const fake = await fakeSmtpBaslat();
  const ortam = testOrtami();
  t.after(async () => {
    await fake.kapat();
    await ortam.kapat();
  });

  smtpAyarla(ortam.db, ortam.config, fake.port);
  const sorumlu = sorumluEkle(ortam.db, 'Elif Kaya', 'elif@ornek.com');
  const sorumlu2 = sorumluEkle(ortam.db, 'Mert Demir', 'mert@ornek.com');
  const toplanti = toplantiEkle(ortam.db, 'Haftalık Sprint', '2026-11-20');

  const yarin = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Yarın bitecek', sorumluId: sorumlu, hedefTarih: '2026-11-24' });
  const bugun = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Bugün bitecek', sorumluId: sorumlu2, hedefTarih: '2026-11-23' });
  const geciken = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Geciken iş', sorumluId: sorumlu, hedefTarih: '2026-11-20' });
  const ikiGunSonra = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'İki gün sonra', sorumluId: sorumlu, hedefTarih: '2026-11-25' });
  const beklemede = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Bekleyen iş', sorumluId: sorumlu, hedefTarih: '2026-11-23', durum: 'beklemede' });
  const tamamlandi = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Biten iş', sorumluId: sorumlu, hedefTarih: '2026-11-23', durum: 'tamamlandi' });
  const tarihsiz = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Tarihsiz iş', sorumluId: sorumlu });
  const sorumlusuz = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Sorumlusuz iş', hedefTarih: '2026-11-23' });

  const simdi = new Date('2026-11-23T20:00:00.000Z'); // İstanbul: 23 Kasım 23:00
  const sonuc = await runReminderJob({ db: ortam.db, config: ortam.config, mailService: ortam.mailService, now: simdi });

  assert.equal(sonuc.baslangic, '2026-11-23');
  assert.equal(sonuc.sinir, '2026-11-24');
  assert.equal(sonuc.taranan, 4);
  assert.equal(sonuc.gonderilen, 3);
  assert.equal(sonuc.atlanan, 1);
  assert.equal(sonuc.hataSayisi, 0);
  assert.equal(fake.mesajlar.length, 3);

  const alicilar = fake.mesajlar.map((m) => m.alicilar.join(',')).join(' | ');
  assert.match(alicilar, /elif@ornek\.com/);
  assert.match(alicilar, /mert@ornek\.com/);

  const bayraklar = Object.fromEntries(
    ortam.db.prepare('SELECT id, hatirlatma_gonderildi FROM isler').all().map((s) => [s.id, s.hatirlatma_gonderildi])
  );
  assert.equal(bayraklar[yarin], 1);
  assert.equal(bayraklar[bugun], 1);
  assert.equal(bayraklar[geciken], 1);
  assert.equal(bayraklar[ikiGunSonra], 0);
  assert.equal(bayraklar[beklemede], 0);
  assert.equal(bayraklar[tamamlandi], 0);
  assert.equal(bayraklar[tarihsiz], 0);
  assert.equal(bayraklar[sorumlusuz], 0);

  const loglar = ortam.db.prepare("SELECT * FROM email_kayitlari WHERE tur = 'hatirlatma'").all();
  assert.equal(loglar.length, 3);
  assert.ok(loglar.every((l) => l.durum === 'gonderildi'));

  const ikinci = await runReminderJob({ db: ortam.db, config: ortam.config, mailService: ortam.mailService, now: simdi });
  assert.equal(ikinci.taranan, 1);
  assert.equal(ikinci.gonderilen, 0);
  assert.equal(ikinci.atlanan, 1);
  assert.equal(fake.mesajlar.length, 3);
});

test('test modunda hatırlatma dosyaya kaydedilir ve bayrak yine işaretlenir', async (t) => {
  const fake = await fakeSmtpBaslat();
  const ortam = testOrtami();
  t.after(async () => {
    await fake.kapat();
    await ortam.kapat();
  });

  smtpAyarla(ortam.db, ortam.config, fake.port, { test_modu: '1' });
  const sorumlu = sorumluEkle(ortam.db, 'Zeynep Şahin', 'zeynep@ornek.com');
  const toplanti = toplantiEkle(ortam.db, 'Test Toplantısı', '2026-11-20');
  const is = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Test hatırlatma', sorumluId: sorumlu, hedefTarih: '2026-11-23' });

  const sonuc = await runReminderJob({
    db: ortam.db,
    config: ortam.config,
    mailService: ortam.mailService,
    now: new Date('2026-11-23T10:00:00.000Z'),
  });

  assert.equal(sonuc.mod, 'test');
  assert.equal(sonuc.gonderilen, 1);
  assert.equal(fake.mesajlar.length, 0);

  const satir = ortam.db.prepare('SELECT hatirlatma_gonderildi FROM isler WHERE id = ?').get(is);
  assert.equal(satir.hatirlatma_gonderildi, 1);

  const log = ortam.db.prepare("SELECT * FROM email_kayitlari WHERE is_id = ? ORDER BY id DESC LIMIT 1").get(is);
  assert.equal(log.durum, 'test_modu');
  assert.ok(log.icerik.includes('Test hatırlatma'));
  assert.ok(fs.existsSync(path.join(ortam.config.outboxDir, log.dosya)));
});

test('SMTP hatası bayrağı işaretlemez ve hata kaydeder', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  smtpAyarla(ortam.db, ortam.config, 1);
  const sorumlu = sorumluEkle(ortam.db, 'Burak Yılmaz', 'burak@ornek.com');
  const toplanti = toplantiEkle(ortam.db, 'Hata Testi', '2026-11-20');
  const is = isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Gönderilemeyen iş', sorumluId: sorumlu, hedefTarih: '2026-11-23' });

  const sonuc = await runReminderJob({
    db: ortam.db,
    config: ortam.config,
    mailService: ortam.mailService,
    now: new Date('2026-11-23T10:00:00.000Z'),
  });

  assert.equal(sonuc.taranan, 1);
  assert.equal(sonuc.gonderilen, 0);
  assert.equal(sonuc.hataSayisi, 1);
  assert.match(sonuc.hatalar[0].hata, /gönderilemedi/i);

  const satir = ortam.db.prepare('SELECT hatirlatma_gonderildi FROM isler WHERE id = ?').get(is);
  assert.equal(satir.hatirlatma_gonderildi, 0);

  const log = ortam.db.prepare("SELECT * FROM email_kayitlari WHERE is_id = ? ORDER BY id DESC LIMIT 1").get(is);
  assert.equal(log.durum, 'hata');
});

test('hatırlatma için hedef tarihi geçmiş ama durumu aktif olmayan işler taranmaz', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  const sorumlu = sorumluEkle(ortam.db, 'Test Kişi', 'test@ornek.com');
  const toplanti = toplantiEkle(ortam.db, 'Kapsam Testi', '2026-11-20');
  isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Tamamlanmış', sorumluId: sorumlu, hedefTarih: '2026-11-23', durum: 'tamamlandi' });
  isEkle(ortam.db, { toplantiId: toplanti, baslik: 'Beklemede', sorumluId: sorumlu, hedefTarih: '2026-11-23', durum: 'beklemede' });

  const sonuc = await runReminderJob({ db: ortam.db, config: ortam.config, mailService: ortam.mailService });
  assert.equal(sonuc.taranan, 0);
});
