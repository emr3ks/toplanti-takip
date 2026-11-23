'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { testOrtami, sunucuBaslat, formPost, sayfaAl, yolKimlik, konumMesaji } = require('./helpers');

let ortam;
let sunucu;

test.before(async () => {
  ortam = testOrtami();
  sunucu = await sunucuBaslat(ortam.app);
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

function veritabani() {
  return ortam.db;
}

async function sorumluOlustur(ad, email) {
  const yanit = await formPost(sunucu.base, '/sorumlular', { ad, email });
  assert.equal(yanit.durum, 303);
  return veritabani().prepare('SELECT * FROM sorumlular WHERE email = ?').get(email);
}

async function toplantiOlustur(ad, tarih) {
  const yanit = await formPost(sunucu.base, '/toplantilar', { ad, tarih });
  assert.equal(yanit.durum, 303);
  const id = yolKimlik(yanit.konum, /\/toplantilar\/(\d+)/);
  assert.ok(id);
  return id;
}

async function isOlustur(toplantiId, veri = {}) {
  const yanit = await formPost(sunucu.base, '/isler', {
    toplanti_id: String(toplantiId),
    baslik: 'Örnek iş',
    sorumlu_id: '',
    hedef_tarih: '',
    not_metni: '',
    durum: 'aktif',
    donus: `/toplantilar/${toplantiId}`,
    ...veri,
  });
  assert.equal(yanit.durum, 303);
  return yanit;
}

test('ana sayfa ve sağlık uç noktası çalışır', async () => {
  const ana = await sayfaAl(sunucu.base, '/');
  assert.equal(ana.durum, 200);
  assert.match(ana.metin, /Genel Bakış/);
  assert.match(ana.metin, /Yaklaşan Hedefler/);

  const saglik = await sayfaAl(sunucu.base, '/saglik');
  assert.equal(saglik.durum, 200);
  assert.match(saglik.metin, /"ok":true/);
});

test('sorumlu eklenir, doğrulanır ve benzersiz e-posta korunur', async () => {
  const sorumlu = await sorumluOlustur('Elif Kaya', 'elif@ornek.com');
  assert.equal(sorumlu.ad, 'Elif Kaya');
  assert.equal(sorumlu.email, 'elif@ornek.com');

  const ayni = await formPost(sunucu.base, '/sorumlular', { ad: 'Başka Kişi', email: 'ELIF@ornek.com' });
  assert.equal(ayni.durum, 303);
  assert.match(konumMesaji(ayni.konum), /zaten var/);

  const gecersiz = await formPost(sunucu.base, '/sorumlular', { ad: 'Test', email: 'gecersiz-adres' });
  assert.equal(gecersiz.durum, 303);
  assert.match(konumMesaji(gecersiz.konum), /Geçerli bir e-posta/);

  const sayfa = await sayfaAl(sunucu.base, '/sorumlular');
  assert.match(sayfa.metin, /Elif Kaya/);
  assert.match(sayfa.metin, /elif@ornek\.com/);
});

test('toplantı ve iş oluşturulur, durumlar tek tıkla değişir', async () => {
  const sorumlu = await sorumluOlustur('Mert Demir', 'mert@ornek.com');
  const toplantiId = await toplantiOlustur('Ürün Yol Haritası', '2026-11-24');

  const detay = await sayfaAl(sunucu.base, `/toplantilar/${toplantiId}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /Ürün Yol Haritası/);
  assert.match(detay.metin, /Toplantıyı Tamamla ve Rapor Gönder/);

  const ekle = await formPost(sunucu.base, '/isler', {
    toplanti_id: String(toplantiId),
    baslik: 'Landing page metinlerini güncelle',
    sorumlu_id: String(sorumlu.id),
    hedef_tarih: '2026-11-26',
    not_metni: 'Başlık ve alt başlık metinleri yenilenecek.',
    durum: 'aktif',
    donus: '/isler',
  });
  assert.equal(ekle.durum, 303);
  assert.match(ekle.konum, /^\/isler\?ok=/);

  const is = veritabani().prepare('SELECT * FROM isler WHERE toplanti_id = ?').get(toplantiId);
  assert.equal(is.baslik, 'Landing page metinlerini güncelle');
  assert.equal(is.sorumlu_id, sorumlu.id);
  assert.equal(is.durum, 'aktif');
  assert.equal(is.hatirlatma_gonderildi, 0);

  const islerSayfasi = await sayfaAl(sunucu.base, '/isler');
  assert.match(islerSayfasi.metin, /Landing page metinlerini güncelle/);
  assert.match(islerSayfasi.metin, /Mert Demir/);
  assert.match(islerSayfasi.metin, /Başlık ve alt başlık metinleri yenilenecek/);

  const bekle = await formPost(sunucu.base, `/isler/${is.id}/durum`, { durum: 'beklemede', donus: '/isler' });
  assert.equal(bekle.durum, 303);
  assert.equal(veritabani().prepare('SELECT durum FROM isler WHERE id = ?').get(is.id).durum, 'beklemede');

  const beklemedeSayfasi = await sayfaAl(sunucu.base, '/isler?durum=beklemede');
  assert.match(beklemedeSayfasi.metin, /Aktif Yap/);

  const aktifYap = await formPost(sunucu.base, `/isler/${is.id}/durum`, { durum: 'aktif', donus: '/isler?durum=beklemede' });
  assert.equal(aktifYap.durum, 303);
  assert.match(konumMesaji(aktifYap.konum), /durum=beklemede/);
  assert.equal(veritabani().prepare('SELECT durum FROM isler WHERE id = ?').get(is.id).durum, 'aktif');

  const tamamla = await formPost(sunucu.base, `/isler/${is.id}/durum`, { durum: 'tamamlandi', donus: `/toplantilar/${toplantiId}` });
  assert.equal(tamamla.durum, 303);
  const biten = veritabani().prepare('SELECT * FROM isler WHERE id = ?').get(is.id);
  assert.equal(biten.durum, 'tamamlandi');
  assert.ok(biten.tamamlanma_tarihi);

  const yenidenAc = await formPost(sunucu.base, `/isler/${is.id}/durum`, { durum: 'aktif', donus: `/toplantilar/${toplantiId}` });
  assert.equal(yenidenAc.durum, 303);
  assert.equal(veritabani().prepare('SELECT tamamlanma_tarihi FROM isler WHERE id = ?').get(is.id).tamamlanma_tarihi, null);
});

test('iş düzenlenir ve hedef tarih değişince hatırlatma sıfırlanır', async () => {
  const sorumlu = await sorumluOlustur('Zeynep Şahin', 'zeynep@ornek.com');
  const toplantiId = await toplantiOlustur('Haftalık Pazarlama Sprinti', '2026-11-22');
  await isOlustur(toplantiId, {
    baslik: 'Sosyal medya takvimini hazırla',
    sorumlu_id: String(sorumlu.id),
    hedef_tarih: '2026-11-25',
    not_metni: 'İlk taslak.',
  });

  const is = veritabani().prepare('SELECT * FROM isler WHERE toplanti_id = ?').get(toplantiId);
  veritabani()
    .prepare('UPDATE isler SET hatirlatma_gonderildi = 1, hatirlatma_tarihi = ? WHERE id = ?')
    .run('2026-11-23T09:00:00.000Z', is.id);

  const duzenle = await formPost(sunucu.base, `/isler/${is.id}`, {
    baslik: 'Sosyal medya takvimini güncelle',
    sorumlu_id: String(sorumlu.id),
    hedef_tarih: '2026-11-27',
    not_metni: 'Güncellenmiş not.',
    durum: 'aktif',
    donus: `/toplantilar/${toplantiId}`,
  });
  assert.equal(duzenle.durum, 303);
  assert.match(duzenle.konum, new RegExp(`/toplantilar/${toplantiId}`));

  const guncel = veritabani().prepare('SELECT * FROM isler WHERE id = ?').get(is.id);
  assert.equal(guncel.baslik, 'Sosyal medya takvimini güncelle');
  assert.equal(guncel.hedef_tarih, '2026-11-27');
  assert.equal(guncel.hatirlatma_gonderildi, 0);
  assert.equal(guncel.hatirlatma_tarihi, null);

  const duzenleSayfasi = await sayfaAl(sunucu.base, `/isler/${is.id}/duzenle`);
  assert.match(duzenleSayfasi.metin, /Sosyal medya takvimini güncelle/);
  assert.match(duzenleSayfasi.metin, /Güncellenmiş not/);
});

test('toplantı tamamlanınca rapor test modunda kaydedilir', async () => {
  const sorumlu = await sorumluOlustur('Burak Yılmaz', 'burak@ornek.com');
  const toplantiId = await toplantiOlustur('Müşteri Geri Bildirimleri', '2026-11-21');
  await isOlustur(toplantiId, {
    baslik: 'Geri bildirimleri kategorize et',
    sorumlu_id: String(sorumlu.id),
    hedef_tarih: '2026-11-28',
    not_metni: 'Destek ve satış başlıkları ayrılacak.',
  });
  await isOlustur(toplantiId, {
    baslik: 'Özet sunumunu hazırla',
    sorumlu_id: String(sorumlu.id),
    hedef_tarih: '2026-11-29',
    durum: 'beklemede',
  });

  const ayarlar = await formPost(sunucu.base, '/ayarlar', {
    smtp_host: '',
    smtp_port: '',
    smtp_secure: '',
    smtp_user: '',
    smtp_pass: '',
    smtp_from_email: '',
    smtp_from_name: '',
    rapor_alici: 'rapor@ornek.com',
    hatirlatma_saati: '09:00',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });
  assert.equal(ayarlar.durum, 303);
  assert.match(konumMesaji(ayarlar.konum), /Ayarlar kaydedildi/);

  const tamamla = await formPost(sunucu.base, `/toplantilar/${toplantiId}/tamamla`);
  assert.equal(tamamla.durum, 303);
  assert.match(konumMesaji(tamamla.konum), /Toplantı tamamlandı/);
  assert.match(konumMesaji(tamamla.konum), /test modunda/);

  const toplanti = veritabani().prepare('SELECT * FROM toplantilar WHERE id = ?').get(toplantiId);
  assert.equal(toplanti.durum, 'tamamlandi');
  assert.ok(toplanti.tamamlanma_tarihi);

  const log = veritabani().prepare("SELECT * FROM email_kayitlari WHERE tur = 'rapor' ORDER BY id DESC LIMIT 1").get();
  assert.ok(log);
  assert.equal(log.durum, 'test_modu');
  assert.equal(log.alici, 'rapor@ornek.com');
  assert.match(log.icerik, /Toplantı Sonu Raporu/);
  assert.match(log.icerik, /Geri bildirimleri kategorize et/);
  assert.match(log.icerik, /Destek ve satış başlıkları ayrılacak/);
  assert.match(log.icerik, /Beklemede/);
  assert.ok(fs.existsSync(path.join(ortam.config.outboxDir, log.dosya)));

  const eposta = await sayfaAl(sunucu.base, `/emailler/${log.id}`);
  assert.equal(eposta.durum, 200);
  assert.match(eposta.metin, /Toplantı Sonu Raporu/);
  assert.match(eposta.metin, /Geri bildirimleri kategorize et/);

  const detay = await sayfaAl(sunucu.base, `/toplantilar/${toplantiId}`);
  assert.match(detay.metin, /Raporu Tekrar Gönder/);
});

test('rapor alıcısı yoksa toplantı tamamlanmaz', async () => {
  const toplantiId = await toplantiOlustur('Alıcısız Toplantı', '2026-11-23');
  await isOlustur(toplantiId, { baslik: 'Rapora girecek iş' });

  const ayarlar = await formPost(sunucu.base, '/ayarlar', {
    rapor_alici: '',
    hatirlatma_saati: '09:00',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });
  assert.equal(ayarlar.durum, 303);

  const tamamla = await formPost(sunucu.base, `/toplantilar/${toplantiId}/tamamla`);
  assert.equal(tamamla.durum, 303);
  assert.match(konumMesaji(tamamla.konum), /Rapor alıcı e-postası tanımlı değil/);
  const toplanti = veritabani().prepare('SELECT durum FROM toplantilar WHERE id = ?').get(toplantiId);
  assert.equal(toplanti.durum, 'acik');
});

test('kullanıcı metinleri HTML olarak kaçırılır', async () => {
  const toplantiId = await toplantiOlustur('<b>Tehlikeli</b> Toplantı', '2026-11-25');
  await isOlustur(toplantiId, {
    baslik: '<img src=x onerror=alert(1)>',
    not_metni: '<script>alert("xss")</script>',
  });

  const sayfa = await sayfaAl(sunucu.base, `/toplantilar/${toplantiId}`);
  assert.equal(sayfa.durum, 200);
  assert.doesNotMatch(sayfa.metin, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(sayfa.metin, /<script>alert\("xss"\)<\/script>/);
  assert.match(sayfa.metin, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const rapor = await (async () => {
    await formPost(sunucu.base, '/ayarlar', { rapor_alici: 'rapor@ornek.com', test_modu: '1', hatirlatma_saati: '09:00', saat_dilimi: 'Europe/Istanbul' });
    return formPost(sunucu.base, `/toplantilar/${toplantiId}/rapor`);
  })();
  assert.equal(rapor.durum, 303);

  const log = veritabani().prepare("SELECT * FROM email_kayitlari WHERE tur = 'rapor' ORDER BY id DESC LIMIT 1").get();
  assert.doesNotMatch(log.icerik, /<img src=x onerror=alert\(1\)>/);
  assert.match(log.icerik, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('sorumluya atanmış iş varsa sorumlu silinemez', async () => {
  const sorumlu = await sorumluOlustur('Silinemez Kişi', 'silinemez@ornek.com');
  const toplantiId = await toplantiOlustur('Silme Testi', '2026-11-23');
  await isOlustur(toplantiId, { baslik: 'Atanmış iş', sorumlu_id: String(sorumlu.id) });

  const sil = await formPost(sunucu.base, `/sorumlular/${sorumlu.id}/sil`);
  assert.equal(sil.durum, 303);
  assert.match(konumMesaji(sil.konum), /atanmış 1 iş var/);
  assert.ok(veritabani().prepare('SELECT id FROM sorumlular WHERE id = ?').get(sorumlu.id));

  const bos = await sorumluOlustur('Boş Kişi', 'bos@ornek.com');
  const sil2 = await formPost(sunucu.base, `/sorumlular/${bos.id}/sil`);
  assert.equal(sil2.durum, 303);
  assert.equal(veritabani().prepare('SELECT id FROM sorumlular WHERE id = ?').get(bos.id), undefined);
});

test('toplantı silinince bağlı işler de silinir', async () => {
  const toplantiId = await toplantiOlustur('Silinecek Toplantı', '2026-11-23');
  await isOlustur(toplantiId, { baslik: 'Silinecek iş' });
  assert.equal(veritabani().prepare('SELECT COUNT(*) AS c FROM isler WHERE toplanti_id = ?').get(toplantiId).c, 1);

  const sil = await formPost(sunucu.base, `/toplantilar/${toplantiId}/sil`);
  assert.equal(sil.durum, 303);
  assert.equal(veritabani().prepare('SELECT COUNT(*) AS c FROM isler WHERE toplanti_id = ?').get(toplantiId).c, 0);
  assert.equal(veritabani().prepare('SELECT COUNT(*) AS c FROM toplantilar WHERE id = ?').get(toplantiId).c, 0);
});

test('olmayan kayıtlar 404 döndürür', async () => {
  const toplanti = await sayfaAl(sunucu.base, '/toplantilar/999999');
  assert.equal(toplanti.durum, 404);
  assert.match(toplanti.metin, /bulunamadı/);

  const is = await sayfaAl(sunucu.base, '/isler/999999/duzenle');
  assert.equal(is.durum, 404);

  const eposta = await sayfaAl(sunucu.base, '/emailler/999999');
  assert.equal(eposta.durum, 404);

  const bilinmeyen = await sayfaAl(sunucu.base, '/boyle-bir-sayfa-yok');
  assert.equal(bilinmeyen.durum, 404);
});

test('ayarlar formunda şifre alanı boş bırakıldığında korunur', async () => {
  await formPost(sunucu.base, '/ayarlar', {
    smtp_host: 'smtp.ornek.com',
    smtp_port: '587',
    smtp_secure: '',
    smtp_user: 'kullanici@ornek.com',
    smtp_pass: 'ilk-sifre',
    smtp_from_email: 'gonderen@ornek.com',
    smtp_from_name: 'Toplantı Takip',
    rapor_alici: 'rapor@ornek.com',
    hatirlatma_saati: '09:00',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });

  await formPost(sunucu.base, '/ayarlar', {
    smtp_host: 'smtp.ornek.com',
    smtp_port: '587',
    smtp_user: 'kullanici@ornek.com',
    smtp_pass: '',
    smtp_from_email: 'gonderen@ornek.com',
    smtp_from_name: 'Toplantı Takip',
    rapor_alici: 'rapor@ornek.com',
    hatirlatma_saati: '09:00',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });

  const sifre = veritabani().prepare("SELECT deger FROM ayarlar WHERE anahtar = 'smtp_pass'").get();
  assert.equal(sifre.deger, 'ilk-sifre');

  const sayfa = await sayfaAl(sunucu.base, '/ayarlar');
  assert.doesNotMatch(sayfa.metin, /ilk-sifre/);
  assert.match(sayfa.metin, /Kayıtlı şifre korunuyor/);
});
