'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  testOrtami,
  sunucuBaslat,
  formPost,
  sayfaAl,
  girisYap,
  cerezliBasliklar,
  yolKimlik,
  konumMesaji,
} = require('./helpers');
const { kullaniciOlustur } = require('../src/auth');
const { bugunTz, gunEkle } = require('../src/dates');

let ortam;
let sunucu;
let uretimId;
let bakimId;
let kaliteDepartmanId;
let adminId;
let sahaId;
let bakimciId;
let olusturulanEgitimId;

const BUGUN = bugunTz('Europe/Istanbul');
const GELECEK = gunEkle(BUGUN, 10);

function db() {
  return ortam.db;
}

function kullaniciGetir(email) {
  return db().prepare('SELECT * FROM kullanicilar WHERE email = ? COLLATE NOCASE').get(email);
}

function egitimSayisi() {
  return db().prepare('SELECT COUNT(*) AS sayi FROM egitimler').get().sayi;
}

async function adminGiris() {
  const sonuc = await girisYap(sunucu.base);
  assert.equal(sonuc.durum, 303, 'admin girişi başarılı olmalı');
}

async function sahaGiris() {
  const sonuc = await girisYap(sunucu.base, 'saha@ornek.com', 'Standart123!');
  assert.equal(sonuc.durum, 303, 'standart kullanıcı girişi başarılı olmalı');
}

/** Aynı adı birden çok kez gönderebilmek için (ör. katilimci_id[]). */
async function cokluFormPost(yol, ciftler) {
  const govde = new URLSearchParams();
  for (const [ad, deger] of ciftler) {
    if (Array.isArray(deger)) {
      for (const parca of deger) govde.append(ad, parca);
    } else {
      govde.append(ad, deger);
    }
  }
  const yanit = await fetch(`${sunucu.base}${yol}`, {
    method: 'POST',
    headers: cerezliBasliklar(sunucu.base, {
      'content-type': 'application/x-www-form-urlencoded',
    }),
    body: govde,
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    konum: yanit.headers.get('location'),
    metin: await yanit.text(),
  };
}

test.before(async () => {
  ortam = testOrtami();
  const uretim = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Üretim');
  const bakim = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Bakım');
  const kalite = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Kalite Güvence');
  uretimId = uretim.id;
  bakimId = bakim.id;
  kaliteDepartmanId = kalite.id;

  adminId = kullaniciGetir('admin@qdms.local').id;
  sahaId = kullaniciOlustur(db(), {
    ad: 'Saha Personeli',
    email: 'saha@ornek.com',
    sifre: 'Standart123!',
    rol: 'kullanici',
    departmanId: uretimId,
  });
  bakimciId = kullaniciOlustur(db(), {
    ad: 'Bakım Personeli',
    email: 'bakim@ornek.com',
    sifre: 'Standart123!',
    rol: 'kullanici',
    departmanId: bakimId,
  });
  kullaniciOlustur(db(), {
    ad: 'Kalite Yöneticisi Kullanıcı',
    email: 'kalite@ornek.com',
    sifre: 'Kalite123!',
    rol: 'kalite',
    departmanId: kaliteDepartmanId,
  });

  sunucu = await sunucuBaslat(ortam.app);
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

test('eğitim tabloları ve katılımcı sütunları migration ile hazırdır', () => {
  const tablolar = db()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('egitimler', 'egitim_katilimcilari')"
    )
    .all()
    .map((satir) => satir.name)
    .sort();
  assert.deepEqual(tablolar, ['egitim_katilimcilari', 'egitimler']);

  const kolonlar = db()
    .prepare('PRAGMA table_info(egitim_katilimcilari)')
    .all()
    .map((satir) => satir.name);
  for (const kolon of [
    'katilim_durumu',
    'degerlendirme_puani',
    'etkinlik_durumu',
    'sertifika_no',
    'not_metni',
    'hatirlatma_tarihi',
  ]) {
    assert.ok(kolonlar.includes(kolon), `${kolon} sütunu bulunmalı`);
  }
});

test('GET /egitim yıllık planı 200 ile gösterir ve yer tutucu metni içermez', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/egitim');
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Yıllık Eğitim Planı/);
  assert.match(sayfa.metin, /Yaklaşan Eğitimler/);
  assert.doesNotMatch(sayfa.metin, /Yakında/);
  assert.match(sayfa.metin, /\+ Yeni Eğitim/);
  assert.match(sayfa.metin, /Katılım oranı/);
});

test('GET /egitim/yeni yönetici formunu katılımcı seçimiyle açar', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/egitim/yeni');
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Eğitim Bilgileri/);
  assert.match(sayfa.metin, /Katılımcılar/);
  assert.match(sayfa.metin, /name="departmanlar"/);
  assert.match(sayfa.metin, /name="kullanicilar"/);
  assert.match(sayfa.metin, /Saha Personeli/);
});

test('yönetici departman seçerek eğitim oluşturur; katılımcılar ve bildirimler yazılır', async () => {
  await adminGiris();
  const once = egitimSayisi();
  const yanit = await formPost(sunucu.base, '/egitim/yeni', {
    ad: 'Kalite Farkındalık Eğitimi',
    tur: 'ic',
    egitmen: 'Ayşe Yıldız',
    planlanan_tarih: GELECEK,
    sure_saat: '2',
    dokuman_id: '',
    aciklama: 'Test amaçlı oluşturulan eğitim.',
    departmanlar: String(uretimId),
  });
  assert.equal(yanit.durum, 303);
  assert.equal(egitimSayisi(), once + 1);

  olusturulanEgitimId = yolKimlik(yanit.konum, /^\/egitim\/(\d+)/);
  assert.ok(olusturulanEgitimId, 'yönlendirme eğitim kimliği içermeli');

  const egitim = db().prepare('SELECT * FROM egitimler WHERE id = ?').get(olusturulanEgitimId);
  assert.equal(egitim.ad, 'Kalite Farkındalık Eğitimi');
  assert.equal(egitim.tur, 'ic');
  assert.equal(egitim.durum, 'planlandi');
  assert.equal(egitim.planlanan_tarih, GELECEK);
  assert.equal(Number(egitim.sure_saat), 2);
  assert.equal(egitim.olusturan_id, adminId);

  const beklenen = db()
    .prepare('SELECT id, ad FROM kullanicilar WHERE aktif = 1 AND departman_id = ?')
    .all(uretimId);
  const katilimcilar = db()
    .prepare(
      `SELECT kk.kullanici_id, k.ad FROM egitim_katilimcilari kk
       JOIN kullanicilar k ON k.id = kk.kullanici_id
       WHERE kk.egitim_id = ? ORDER BY k.ad`
    )
    .all(olusturulanEgitimId);
  assert.equal(katilimcilar.length, beklenen.length);
  assert.ok(katilimcilar.some((kisi) => kisi.kullanici_id === sahaId));

  const bildirimler = db()
    .prepare("SELECT * FROM bildirimler WHERE tur = 'egitim' AND baglanti = ?")
    .all(`/egitim/${olusturulanEgitimId}`);
  assert.equal(bildirimler.length, beklenen.length);
  assert.match(bildirimler[0].baslik, /Yeni eğitim: Kalite Farkındalık Eğitimi/);

  const detay = await sayfaAl(sunucu.base, `/egitim/${olusturulanEgitimId}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /Kalite Farkındalık Eğitimi/);
  assert.match(detay.metin, /Saha Personeli/);
  assert.match(detay.metin, /Ayşe Yıldız/);
});

test('geçersiz tarih, ad, süre, doküman ve katılımcısız istekler 303 ile reddedilir', async () => {
  await adminGiris();
  const once = egitimSayisi();
  const gecersizler = [
    {
      ad: 'Geçersiz Tarih Eğitimi',
      tur: 'ic',
      planlanan_tarih: '2026-02-31',
      sure_saat: '2',
      kullanicilar: String(sahaId),
    },
    {
      ad: 'ab',
      tur: 'ic',
      planlanan_tarih: GELECEK,
      sure_saat: '2',
      kullanicilar: String(sahaId),
    },
    {
      ad: 'Geçersiz Süre Eğitimi',
      tur: 'ic',
      planlanan_tarih: GELECEK,
      sure_saat: '0',
      kullanicilar: String(sahaId),
    },
    {
      ad: 'Geçersiz Doküman Eğitimi',
      tur: 'ic',
      planlanan_tarih: GELECEK,
      sure_saat: '2',
      dokuman_id: '999999',
      kullanicilar: String(sahaId),
    },
    {
      ad: 'Katılımcısız Eğitim',
      tur: 'ic',
      planlanan_tarih: GELECEK,
      sure_saat: '1',
    },
  ];

  for (const veri of gecersizler) {
    const yanit = await formPost(sunucu.base, '/egitim/yeni', veri);
    assert.equal(yanit.durum, 303, `${veri.ad} 303 ile reddedilmeli`);
    const konum = konumMesaji(yanit.konum);
    assert.match(konum, /^\/egitim\/yeni\?/);
    assert.match(konum, /hata=/, `${veri.ad} için hata mesajı olmalı`);
  }
  assert.equal(egitimSayisi(), once, 'geçersiz istekler kayıt oluşturmamalı');
});

test('katılımcı eklenir ve sonuç formu iki kişi için kaydedilir', async () => {
  await adminGiris();
  assert.ok(olusturulanEgitimId);

  const ekle = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}/katilimcilar`, {
    kullanicilar: String(bakimciId),
  });
  assert.equal(ekle.durum, 303);
  assert.match(konumMesaji(ekle.konum), /1 yeni katılımcı eklendi/);
  assert.ok(
    db()
      .prepare('SELECT 1 FROM egitim_katilimcilari WHERE egitim_id = ? AND kullanici_id = ?')
      .get(olusturulanEgitimId, bakimciId)
  );

  const katilimcilar = db()
    .prepare('SELECT * FROM egitim_katilimcilari WHERE egitim_id = ? ORDER BY id')
    .all(olusturulanEgitimId);
  assert.equal(katilimcilar.length, 2);
  const [birinci, ikinci] = katilimcilar;

  const sonuc = await cokluFormPost(`/egitim/${olusturulanEgitimId}/sonuclar`, [
    ['katilimci_id', String(birinci.id)],
    [`katilim_${birinci.id}`, 'katildi'],
    [`puan_${birinci.id}`, '90'],
    [`etkinlik_${birinci.id}`, 'etkin'],
    [`sertifika_${birinci.id}`, 'EGT-2026-001'],
    [`not_${birinci.id}`, 'Başarılı katılım.'],
    ['katilimci_id', String(ikinci.id)],
    [`katilim_${ikinci.id}`, 'katilmadi'],
    [`puan_${ikinci.id}`, ''],
    [`etkinlik_${ikinci.id}`, 'etkin_degil'],
    [`sertifika_${ikinci.id}`, ''],
    [`not_${ikinci.id}`, 'Mazeret bildirdi.'],
  ]);
  assert.equal(sonuc.durum, 303);
  assert.match(konumMesaji(sonuc.konum), /2 katılımcı/);

  const guncel = db()
    .prepare('SELECT * FROM egitim_katilimcilari WHERE egitim_id = ? ORDER BY id')
    .all(olusturulanEgitimId);
  assert.equal(guncel[0].katilim_durumu, 'katildi');
  assert.equal(Number(guncel[0].degerlendirme_puani), 90);
  assert.equal(guncel[0].etkinlik_durumu, 'etkin');
  assert.equal(guncel[0].sertifika_no, 'EGT-2026-001');
  assert.equal(guncel[1].katilim_durumu, 'katilmadi');
  assert.equal(guncel[1].degerlendirme_puani, null);
  assert.equal(guncel[1].etkinlik_durumu, 'etkin_degil');

  const detay = await sayfaAl(sunucu.base, `/egitim/${olusturulanEgitimId}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /90/);
  assert.match(detay.metin, /50%/); // katıldı 1 / (katıldı 1 + katılmadı 1)

  // Test yardımcısı formPost bir dizi değeri virgülle birleştirir; bu biçim de
  // katılımcı kimlikleri listesi olarak kabul edilmelidir.
  const virgullu = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}/sonuclar`, {
    katilimci_id: [String(birinci.id), String(ikinci.id)],
    [`katilim_${birinci.id}`]: 'katildi',
    [`puan_${birinci.id}`]: '90',
    [`etkinlik_${birinci.id}`]: 'etkin',
    [`katilim_${ikinci.id}`]: 'katilmadi',
    [`puan_${ikinci.id}`]: '',
    [`etkinlik_${ikinci.id}`]: 'etkin_degil',
  });
  assert.equal(virgullu.durum, 303);

  const kotuPuan = await cokluFormPost(`/egitim/${olusturulanEgitimId}/sonuclar`, [
    ['katilimci_id', String(birinci.id)],
    [`katilim_${birinci.id}`, 'katildi'],
    [`puan_${birinci.id}`, '150'],
    [`etkinlik_${birinci.id}`, 'etkin'],
  ]);
  assert.equal(kotuPuan.durum, 303);
  assert.match(konumMesaji(kotuPuan.konum), /hata=/);
  const korunan = db()
    .prepare('SELECT degerlendirme_puani FROM egitim_katilimcilari WHERE id = ?')
    .get(birinci.id);
  assert.equal(Number(korunan.degerlendirme_puani), 90);
});

test('eğitim bilgileri ve durumu POST ile güncellenir', async () => {
  await adminGiris();
  const guncelle = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}`, {
    ad: 'Kalite Farkındalık Eğitimi (Güncel)',
    tur: 'dis',
    egitmen: 'Dış Eğitim Kurumu',
    planlanan_tarih: GELECEK,
    sure_saat: '3',
    dokuman_id: '',
    aciklama: 'Güncellenmiş açıklama.',
  });
  assert.equal(guncelle.durum, 303);
  const guncel = db()
    .prepare('SELECT * FROM egitimler WHERE id = ?')
    .get(olusturulanEgitimId);
  assert.equal(guncel.ad, 'Kalite Farkındalık Eğitimi (Güncel)');
  assert.equal(guncel.tur, 'dis');
  assert.equal(Number(guncel.sure_saat), 3);

  const durum = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}/durum`, {
    durum: 'tamamlandi',
  });
  assert.equal(durum.durum, 303);
  assert.equal(
    db().prepare('SELECT durum FROM egitimler WHERE id = ?').get(olusturulanEgitimId).durum,
    'tamamlandi'
  );
});

test('standart kullanıcı planı ve kendi sicilini görür; yönetim işlemleri 403 döner', async () => {
  await sahaGiris();

  const plan = await sayfaAl(sunucu.base, '/egitim');
  assert.equal(plan.durum, 200);
  assert.doesNotMatch(plan.metin, /href="\/egitim\/yeni"/);

  const yeni = await sayfaAl(sunucu.base, '/egitim/yeni');
  assert.equal(yeni.durum, 403);
  assert.match(yeni.metin, /yetkiniz yok/);

  const egitimPost = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}`, {
    ad: 'Yetkisiz Güncelleme Denemesi',
    tur: 'ic',
    planlanan_tarih: GELECEK,
    sure_saat: '1',
  });
  assert.equal(egitimPost.durum, 403);

  const sonucPost = await cokluFormPost(`/egitim/${olusturulanEgitimId}/sonuclar`, [
    ['katilimci_id', '1'],
    ['katilim_1', 'katildi'],
    ['puan_1', '100'],
    ['etkinlik_1', 'etkin'],
  ]);
  assert.equal(sonucPost.durum, 403);

  const liste = await sayfaAl(sunucu.base, '/egitim/personel');
  assert.equal(liste.durum, 303);
  assert.match(String(liste.konum), new RegExp(`/egitim/personel/${sahaId}$`));

  const kendi = await sayfaAl(sunucu.base, `/egitim/personel/${sahaId}`);
  assert.equal(kendi.durum, 200);
  assert.match(kendi.metin, /Saha Personeli/);
  assert.match(kendi.metin, /Eğitim Geçmişi/);
  assert.match(kendi.metin, /Kalite Farkındalık Eğitimi/);

  const baska = await sayfaAl(sunucu.base, `/egitim/personel/${adminId}`);
  assert.equal(baska.durum, 403);
  assert.match(baska.metin, /yetkiniz yok/);

  const detay = await sayfaAl(sunucu.base, `/egitim/${olusturulanEgitimId}`);
  assert.equal(detay.durum, 200);
  assert.doesNotMatch(detay.metin, /Sonuçları Kaydet/);
  assert.match(detay.metin, /salt okunur görünümdedir/);

  const okundu = db()
    .prepare('SELECT okundu FROM bildirimler WHERE kullanici_id = ? AND baglanti = ?')
    .get(sahaId, `/egitim/${olusturulanEgitimId}`);
  assert.equal(okundu.okundu, 1, 'detay açıldığında bildirim okundu olmalı');

  await adminGiris();
  const yoneticiGorunumu = await sayfaAl(sunucu.base, `/egitim/personel/${sahaId}`);
  assert.equal(yoneticiGorunumu.durum, 200);
  assert.match(yoneticiGorunumu.metin, /Saha Personeli/);
  assert.match(yoneticiGorunumu.metin, /Yazdır/);

  const personelListesi = await sayfaAl(sunucu.base, '/egitim/personel?q=retim');
  assert.equal(personelListesi.durum, 200);
  assert.match(personelListesi.metin, /Saha Personeli/);

  const bosListe = await sayfaAl(sunucu.base, '/egitim/personel?q=zzzz');
  assert.equal(bosListe.durum, 200);
  assert.match(bosListe.metin, /Personel bulunamadı/);
});

test('hatırlatma uç noktası e-posta modülü yokken bile 303 döner', async () => {
  await adminGiris();
  const yanit = await formPost(sunucu.base, `/egitim/${olusturulanEgitimId}/hatirlat`, {});
  assert.equal(yanit.durum, 303);
  assert.match(konumMesaji(yanit.konum), new RegExp(`^/egitim/${olusturulanEgitimId}`));
});

test('bilinmeyen eğitim kimliği 404 görünümü döndürür', async () => {
  await adminGiris();
  const yanit = await sayfaAl(sunucu.base, '/egitim/999999');
  assert.equal(yanit.durum, 404);
  assert.match(yanit.metin, /bulunamadı/i);
});
