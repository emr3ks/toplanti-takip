'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  testOrtami,
  sunucuBaslat,
  formPost,
  sayfaAl,
  girisYap,
  cerezAl,
  konumMesaji,
  yolKimlik,
} = require('./helpers');
const { pdfUret } = require('../src/pdf');
const qdms = require('../src/qdms');

let ortam;
let sunucu;
let uretim;
let kaliteDepartman;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function db() {
  return ortam.db;
}

function bolumDoldur(turKod) {
  const sablon = qdms.sablonGetir(db(), turKod);
  return sablon.bolumler.map((bolum, indeks) => ({
    baslik: bolum.baslik,
    metin: `${bolum.baslik} için örnek kurumsal içerik. Türkçe karakterler: İş Güvenliği, ÇĞİÖŞÜ. Satır ${indeks + 1}.`,
  }));
}

async function dokumanOlustur({ turKod = 'PR', baslik, departmanIdler = [uretim.id], icerik, dosya = null } = {}) {
  const veri = new FormData();
  veri.set('tur_kod', turKod);
  veri.set('baslik', baslik);
  veri.set('aciklama', 'Test dokümanı açıklaması.');
  for (const id of departmanIdler) veri.append('hedef_departmanlar', String(id));
  const bolumler = icerik || bolumDoldur(turKod);
  bolumler.forEach((bolum, indeks) => veri.set(`bolum_${indeks}`, bolum.metin));
  if (dosya) veri.set('dosya', new Blob([dosya.icerik], { type: dosya.tip || 'application/pdf' }), dosya.ad);
  const yanit = await fetch(`${sunucu.base}/dokumanlar/yeni`, {
    method: 'POST',
    headers: { cookie: cerezAl(sunucu.base) },
    body: veri,
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    konum: yanit.headers.get('location'),
    metin: await yanit.text(),
  };
}

function kisi(email) {
  return db().prepare('SELECT * FROM kullanicilar WHERE email = ? COLLATE NOCASE').get(email);
}

test.before(async () => {
  ortam = testOrtami();
  sunucu = await sunucuBaslat(ortam.app);
  uretim = db().prepare("SELECT * FROM departmanlar WHERE ad = 'Üretim'").get();
  kaliteDepartman = db().prepare("SELECT * FROM departmanlar WHERE ad = 'Kalite Güvence'").get();
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

test('ilk kurulumda departmanlar, doküman türleri, şablonlar ve admin hazırdır', async () => {
  assert.equal(db().prepare('SELECT COUNT(*) AS sayi FROM departmanlar').get().sayi, 5);
  assert.equal(db().prepare('SELECT COUNT(*) AS sayi FROM dokuman_turleri').get().sayi, 5);
  assert.equal(db().prepare('SELECT COUNT(*) AS sayi FROM sablonlar').get().sayi, 5);
  const admin = kisi('admin@qdms.local');
  assert.ok(admin);
  assert.equal(admin.rol, 'admin');

  const sablonlar = await sayfaAl(sunucu.base, '/sablonlar');
  assert.equal(sablonlar.durum, 200);
  assert.match(sablonlar.metin, /Prosedür Şablonu/);
  assert.match(sablonlar.metin, /Talimat Şablonu/);

  const yeni = await sayfaAl(sunucu.base, '/dokumanlar/yeni?tur=PR');
  assert.equal(yeni.durum, 200);
  assert.match(yeni.metin, /PR-001/);
  assert.match(yeni.metin, /1\. Amaç/);
});

test('standart kullanıcı ve doküman hazırlayan kullanıcı oluşturulur', async () => {
  const saha = await formPost(sunucu.base, '/organizasyon/kullanicilar', {
    ad: 'Saha Personeli',
    email: 'saha@ornek.com',
    sifre: 'Saha12345',
    rol: 'kullanici',
    departman_id: String(uretim.id),
    aktif: '1',
  });
  assert.equal(saha.durum, 303);
  assert.match(konumMesaji(saha.konum), /oluşturuldu/);

  const hazirlayan = await formPost(sunucu.base, '/organizasyon/kullanicilar', {
    ad: 'Doküman Hazırlayan',
    email: 'hazirlayan@ornek.com',
    sifre: 'Hazirlayan12345',
    rol: 'hazirlayan',
    departman_id: String(uretim.id),
    aktif: '1',
  });
  assert.equal(hazirlayan.durum, 303);

  const onaylayan = await formPost(sunucu.base, '/organizasyon/kullanicilar', {
    ad: 'Onaylayan Kullanıcı',
    email: 'onaylayan@ornek.com',
    sifre: 'Onaylayan12345',
    rol: 'onaylayan',
    departman_id: String(kaliteDepartman.id),
    aktif: '1',
  });
  assert.equal(onaylayan.durum, 303);

  const kullanicilar = await sayfaAl(sunucu.base, '/organizasyon');
  assert.match(kullanicilar.metin, /Saha Personeli/);
  assert.match(kullanicilar.metin, /Standart Kullanıcı/);
  assert.match(kullanicilar.metin, /Doküman Hazırlayan/);
});

test('doküman oluşturulur; kod otomatik atanır ve taslak PDF üretilir', async () => {
  const olustur = await dokumanOlustur({ baslik: 'Kalite Kayıtlarının Kontrolü Prosedürü' });
  assert.equal(olustur.durum, 303);
  const id = yolKimlik(olustur.konum, /\/dokumanlar\/(\d+)/);
  assert.ok(id);

  const dokuman = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(id);
  assert.equal(dokuman.kod, 'PR-001');
  assert.equal(dokuman.revizyon, 0);
  assert.equal(dokuman.durum, 'taslak');
  assert.equal(dokuman.tur_kod, 'PR');
  assert.match(dokuman.icerik, /Amaç için örnek/);

  const detay = await sayfaAl(sunucu.base, `/dokumanlar/${id}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /Taslak/);
  assert.match(detay.metin, /Onaya Gönder/);
  assert.match(detay.metin, /PDF Önizleme/);

  const pdfYanit = await fetch(`${sunucu.base}/dokumanlar/${id}/pdf`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  const pdf = Buffer.from(await pdfYanit.arrayBuffer());
  assert.equal(pdfYanit.status, 200);
  assert.equal(pdfYanit.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5_000);
});

test('standart kullanıcı dağıtılmayan taslağı göremez ve erişemez', async () => {
  const doc = db().prepare("SELECT * FROM dokumanlar WHERE kod = 'PR-001'").get();
  const giris = await girisYap(sunucu.base, 'saha@ornek.com', 'Saha12345');
  assert.equal(giris.durum, 303);

  const liste = await sayfaAl(sunucu.base, '/dokumanlar');
  assert.equal(liste.durum, 200);
  assert.doesNotMatch(liste.metin, /Kalite Kayıtlarının Kontrolü Prosedürü/);

  const detay = await sayfaAl(sunucu.base, `/dokumanlar/${doc.id}`);
  assert.equal(detay.durum, 404);

  await girisYap(sunucu.base);
});

test('doküman onaya gönderilir, onaylanır ve filigran kalkar', async () => {
  const doc = db().prepare("SELECT * FROM dokumanlar WHERE kod = 'PR-001'").get();
  const onaya = await formPost(sunucu.base, `/dokumanlar/${doc.id}/onaya-gonder`, {});
  assert.equal(onaya.durum, 303);
  assert.equal(db().prepare('SELECT durum FROM dokumanlar WHERE id = ?').get(doc.id).durum, 'kontrol');

  const bekleyen = db()
    .prepare("SELECT COUNT(*) AS sayi FROM bildirimler WHERE tur = 'onay' AND dokuman_id = ?")
    .get(doc.id).sayi;
  assert.ok(bekleyen >= 1);

  const onayla = await formPost(sunucu.base, `/dokumanlar/${doc.id}/onayla`, {});
  assert.equal(onayla.durum, 303);
  assert.match(konumMesaji(onayla.konum), /yayınlandı/);

  const guncel = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(doc.id);
  assert.equal(guncel.durum, 'yayinda');
  assert.ok(guncel.onay_tarihi);
  assert.ok(guncel.onaylayan_id);

  const okuyucular = db()
    .prepare(
      `SELECT k.email FROM dokuman_okumalari r JOIN kullanicilar k ON k.id = r.kullanici_id
       WHERE r.dokuman_id = ?`
    )
    .all(doc.id)
    .map((satir) => satir.email)
    .sort();
  assert.deepEqual(okuyucular, ['hazirlayan@ornek.com', 'saha@ornek.com']);

  const yayinPdf = await fetch(`${sunucu.base}/dokumanlar/${doc.id}/pdf`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  const pdf = Buffer.from(await yayinPdf.arrayBuffer());
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');

  const detay = await sayfaAl(sunucu.base, `/dokumanlar/${doc.id}`);
  assert.match(detay.metin, /Yayında/);
  assert.match(detay.metin, /Saha Personeli/);
});

test('standart kullanıcı dokümanı okur ve "Okudum, Anladım" onayı verir', async () => {
  const doc = db().prepare("SELECT * FROM dokumanlar WHERE kod = 'PR-001'").get();
  const giris = await girisYap(sunucu.base, 'saha@ornek.com', 'Saha12345');
  assert.equal(giris.durum, 303);

  const liste = await sayfaAl(sunucu.base, '/dokumanlar');
  assert.match(liste.metin, /Kalite Kayıtlarının Kontrolü Prosedürü/);

  const detay = await sayfaAl(sunucu.base, `/dokumanlar/${doc.id}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /Okudum, Anladım/);

  const oku = await formPost(sunucu.base, `/dokumanlar/${doc.id}/oku`, {});
  assert.equal(oku.durum, 303);
  assert.match(konumMesaji(oku.konum), /onayınız kaydedildi/);

  const okuma = db()
    .prepare('SELECT * FROM dokuman_okumalari WHERE dokuman_id = ? AND kullanici_id = ?')
    .get(doc.id, kisi('saha@ornek.com').id);
  assert.equal(okuma.okundu, 1);
  assert.ok(okuma.okunma_tarihi);

  const detayTekrar = await sayfaAl(sunucu.base, `/dokumanlar/${doc.id}`);
  assert.match(detayTekrar.metin, /onayınız kaydedildi/);

  await girisYap(sunucu.base, 'hazirlayan@ornek.com', 'Hazirlayan12345');
  const ikinciOkuma = await formPost(sunucu.base, `/dokumanlar/${doc.id}/oku`, {});
  assert.equal(ikinciOkuma.durum, 303);

  await girisYap(sunucu.base);
  const takip = await sayfaAl(sunucu.base, `/dokumanlar/${doc.id}`);
  assert.match(takip.metin, /100%/);
  assert.match(takip.metin, /Okudu/);
});

test('yeni revizyon eski revizyonu arşivler ve değişiklik notunu saklar', async () => {
  const doc = db().prepare("SELECT * FROM dokumanlar WHERE kod = 'PR-001'").get();
  const revizyon = await formPost(sunucu.base, `/dokumanlar/${doc.id}/revizyon`, {
    degisiklik_notu: 'Kayıt saklama süresi 5 yıla çıkarıldı.',
  });
  assert.equal(revizyon.durum, 303);
  const yeniId = yolKimlik(revizyon.konum, /\/dokumanlar\/(\d+)/);
  assert.ok(yeniId);

  const yeni = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(yeniId);
  assert.equal(yeni.kod, 'PR-001');
  assert.equal(yeni.revizyon, 1);
  assert.equal(yeni.durum, 'taslak');
  assert.equal(yeni.degisiklik_notu, 'Kayıt saklama süresi 5 yıla çıkarıldı.');

  const eski = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(doc.id);
  assert.equal(eski.durum, 'iptal');

  const detay = await sayfaAl(sunucu.base, `/dokumanlar/${yeniId}`);
  assert.match(detay.metin, /Rev\.01/);
  assert.match(detay.metin, /Kayıt saklama süresi 5 yıla çıkarıldı/);

  const hedefler = db()
    .prepare('SELECT departman_id FROM dokuman_hedef_departmanlar WHERE dokuman_id = ?')
    .all(yeniId)
    .map((satir) => satir.departman_id);
  assert.deepEqual(hedefler, [uretim.id]);

  await formPost(sunucu.base, `/dokumanlar/${yeniId}/onaya-gonder`, {});
  await formPost(sunucu.base, `/dokumanlar/${yeniId}/onayla`, {});

  const revizyonsuzNot = await formPost(sunucu.base, `/dokumanlar/${yeniId}/revizyon`, {
    degisiklik_notu: '',
  });
  assert.equal(revizyonsuzNot.durum, 303);
  assert.match(konumMesaji(revizyonsuzNot.konum), /değişiklik notu zorunludur/);
});

test('doküman hazırlayan taslak oluşturur ancak onaylayamaz', async () => {
  const giris = await girisYap(sunucu.base, 'hazirlayan@ornek.com', 'Hazirlayan12345');
  assert.equal(giris.durum, 303);

  const olustur = await dokumanOlustur({
    turKod: 'TL',
    baslik: 'CNC Tezgahı Kullanım Talimatı',
    departmanIdler: [uretim.id],
  });
  assert.equal(olustur.durum, 303);
  const id = yolKimlik(olustur.konum, /\/dokumanlar\/(\d+)/);

  const dokuman = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(id);
  assert.equal(dokuman.kod, 'TL-001');
  assert.equal(dokuman.hazirlayan_id, kisi('hazirlayan@ornek.com').id);

  const onaya = await formPost(sunucu.base, `/dokumanlar/${id}/onaya-gonder`, {});
  assert.equal(onaya.durum, 303);

  const onayla = await formPost(sunucu.base, `/dokumanlar/${id}/onayla`, {});
  assert.equal(onayla.durum, 403);

  await girisYap(sunucu.base);
});

test('onaylayan rolü onay bekleyen dokümanı yayınlar', async () => {
  const doc = db().prepare("SELECT * FROM dokumanlar WHERE kod = 'TL-001'").get();
  assert.equal(doc.durum, 'kontrol');

  const giris = await girisYap(sunucu.base, 'onaylayan@ornek.com', 'Onaylayan12345');
  assert.equal(giris.durum, 303);

  const liste = await sayfaAl(sunucu.base, '/dokumanlar?durum=kontrol');
  assert.equal(liste.durum, 200);
  assert.match(liste.metin, /CNC Tezgahı Kullanım Talimatı/);

  const onayla = await formPost(sunucu.base, `/dokumanlar/${doc.id}/onayla`, {});
  assert.equal(onayla.durum, 303);

  const guncel = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(doc.id);
  assert.equal(guncel.durum, 'yayinda');
  assert.equal(guncel.onaylayan_id, kisi('onaylayan@ornek.com').id);

  await girisYap(sunucu.base);
});

test('şablon tasarımı, logo ve PDF önizlemesi kaydedilir', async () => {
  const form = new FormData();
  form.set('baslik', 'Liste Şablonu Özel');
  form.set('antet_renk', '#0f766e');
  form.set('kenarlik_stili', 'kesikli');
  form.set('altbilgi_hazirlayan', 'Hazırlayan Kişi');
  form.set('altbilgi_onaylayan', 'Onaylayan Kişi');
  form.append('bolum_baslik', '1. Amaç');
  form.append('bolum_ipucu', 'Listenin amacı');
  form.append('bolum_zorunlu', '1');
  form.append('bolum_baslik', '2. Liste Alanları');
  form.append('bolum_ipucu', 'Sütunlar');
  form.append('bolum_zorunlu', '0');
  form.set('logo', new Blob([PNG], { type: 'image/png' }), 'logo.png');

  const kaydet = await fetch(`${sunucu.base}/sablonlar/LS`, {
    method: 'POST',
    headers: { cookie: cerezAl(sunucu.base) },
    body: form,
    redirect: 'manual',
  });
  assert.equal(kaydet.status, 303);

  const sablon = qdms.sablonGetir(db(), 'LS');
  assert.equal(sablon.baslik, 'Liste Şablonu Özel');
  assert.equal(sablon.antet_renk, '#0f766e');
  assert.equal(sablon.kenarlik_stili, 'kesikli');
  assert.equal(sablon.bolumler.length, 2);
  assert.equal(sablon.bolumler[0].zorunlu, true);
  assert.ok(sablon.bolumler[0].ipucu);

  const logo = await fetch(`${sunucu.base}/sablonlar/LS/logo`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const onizleme = await fetch(`${sunucu.base}/sablonlar/LS/onizleme`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  const pdf = Buffer.from(await onizleme.arrayBuffer());
  assert.equal(onizleme.status, 200);
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');

  const sayfa = await sayfaAl(sunucu.base, '/sablonlar');
  assert.match(sayfa.metin, /Liste Şablonu Özel/);
});

test('şirket adı ve logosu kaydedilir; PDF ve arayüzde kullanılır', async () => {
  const form = new FormData();
  form.set('sirket_adi', 'Örnek Sanayi A.Ş.');
  form.set('logo', new Blob([PNG], { type: 'image/png' }), 'sirket.png');
  const kaydet = await fetch(`${sunucu.base}/ayarlar/sirket`, {
    method: 'POST',
    headers: { cookie: cerezAl(sunucu.base) },
    body: form,
    redirect: 'manual',
  });
  assert.equal(kaydet.status, 303);

  const sayfa = await sayfaAl(sunucu.base, '/ayarlar');
  assert.match(sayfa.metin, /Örnek Sanayi A\.Ş\./);
  assert.match(sayfa.metin, /\/sirket-logo/);

  const logo = await fetch(`${sunucu.base}/sirket-logo`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  assert.equal(logo.status, 200);

  const ana = await sayfaAl(sunucu.base, '/');
  assert.match(ana.metin, /Örnek Sanayi A\.Ş\./);
});

test('hazır PDF yüklenebilir ve indirilebilir', async () => {
  const ornek = await pdfUret({
    dokuman: {
      kod: 'FR-999',
      baslik: 'Yüklenen Form',
      revizyon: 0,
      durum: 'yayinda',
      icerik: [],
      olusturma_tarihi: new Date().toISOString(),
    },
    sablon: { antet_renk: '#1e3a8a', kenarlik_stili: 'duz', altbilgi_hazirlayan: 'Hazırlayan', altbilgi_onaylayan: 'Onaylayan' },
    sirket: { ad: 'Örnek Sanayi A.Ş.' },
    tur: qdms.turGetir('FR'),
    hazirlayanAd: 'Test',
    onaylayanAd: 'Test',
  });

  const olustur = await dokumanOlustur({
    turKod: 'FR',
    baslik: 'Yüklenen Form Dokümanı',
    icerik: [{ metin: '' }],
    dosya: { icerik: ornek, ad: 'hazir-form.pdf', tip: 'application/pdf' },
  });
  assert.equal(olustur.durum, 303);
  const id = yolKimlik(olustur.konum, /\/dokumanlar\/(\d+)/);
  const dokuman = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(id);
  assert.equal(dokuman.dosya_turu, 'pdf');
  assert.ok(dokuman.dosya_yolu);

  const indir = await fetch(`${sunucu.base}/dokumanlar/${id}/dosya`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  const icerik = Buffer.from(await indir.arrayBuffer());
  assert.equal(indir.status, 200);
  assert.equal(icerik.slice(0, 5).toString(), '%PDF-');

  const onizleme = await fetch(`${sunucu.base}/dokumanlar/${id}/pdf`, {
    headers: { cookie: cerezAl(sunucu.base) },
  });
  assert.equal(onizleme.status, 200);
  assert.equal(onizleme.headers.get('content-type'), 'application/pdf');
});

test('eksik zorunlu bölüm ve hedef departman doğrulanır', async () => {
  const hedefsiz = await dokumanOlustur({
    baslik: 'Hedefsiz Prosedür',
    departmanIdler: [],
  });
  assert.equal(hedefsiz.durum, 303);
  assert.match(konumMesaji(hedefsiz.konum), /En az bir hedef departman/);

  const eksik = await dokumanOlustur({
    baslik: 'Eksik Bölümlü Prosedür',
    icerik: bolumDoldur('PR').map((bolum, indeks) => ({
      ...bolum,
      metin: indeks === 0 ? '' : bolum.metin,
    })),
  });
  assert.equal(eksik.durum, 303);
  assert.match(konumMesaji(eksik.konum), /zorunludur/);

  const sayi = db().prepare("SELECT COUNT(*) AS sayi FROM dokumanlar WHERE baslik = 'Eksik Bölümlü Prosedür'").get().sayi;
  assert.equal(sayi, 0);

  const ikinci = await dokumanOlustur({ baslik: 'İkinci Prosedür' });
  assert.equal(ikinci.durum, 303);
  const ikinciId = yolKimlik(ikinci.konum, /\/dokumanlar\/(\d+)/);
  const ikinciBelge = db().prepare('SELECT * FROM dokumanlar WHERE id = ?').get(ikinciId);
  assert.equal(ikinciBelge.kod, 'PR-002');
  assert.equal(ikinciBelge.revizyon, 0);
});

test('PDF üretici Türkçe karakterleri ve taslak/yayın formatını destekler', async () => {
  const icerik = [
    { baslik: '1. Amaç', metin: 'Türkçe karakterler: İş Güvenliği, ÇĞİÖŞÜ, şablon ve revizyon. '.repeat(20) },
    { baslik: '2. Kapsam', metin: 'İkinci bölüm metni.' },
  ];
  const ortak = {
    dokuman: {
      kod: 'PR-010',
      baslik: 'Türkçe Karakter Testi',
      aciklama: 'Açıklama',
      revizyon: 1,
      durum: 'taslak',
      icerik,
      olusturma_tarihi: new Date().toISOString(),
    },
    sablon: {
      antet_renk: '#1e3a8a',
      kenarlik_stili: 'cift',
      altbilgi_hazirlayan: 'Hazırlayan',
      altbilgi_onaylayan: 'Onaylayan',
    },
    sirket: { ad: 'Örnek Sanayi A.Ş.' },
    tur: qdms.turGetir('PR'),
    hazirlayanAd: 'Elif Kaya',
    onaylayanAd: '',
  };

  const taslak = await pdfUret(ortak);
  const yayinda = await pdfUret({
    ...ortak,
    dokuman: {
      ...ortak.dokuman,
      durum: 'yayinda',
      onaylayan_id: 1,
      onay_tarihi: new Date().toISOString(),
      yayin_tarihi: new Date().toISOString(),
    },
    onaylayanAd: 'Kalite Yöneticisi',
  });

  for (const pdf of [taslak, yayinda]) {
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 5_000);
  }
  assert.ok(!taslak.equals(yayinda));
});
