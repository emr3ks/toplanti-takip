'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { testOrtami, sunucuBaslat, girisYap, sayfaAl, formPost, konumMesaji } = require('./helpers');

let ortam;
let sunucu;
let adminCerez;

async function adminOl() {
  const sonuc = await girisYap(sunucu.base);
  adminCerez = sonuc.cerez;
  return sonuc;
}

function kullaniciEkle(email) {
  return ortam.db
    .prepare('SELECT * FROM kullanicilar WHERE email = ? COLLATE NOCASE')
    .get(email);
}

test.before(async () => {
  ortam = testOrtami();
  sunucu = await sunucuBaslat(ortam.app, { giris: false });
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

test('oturum yokken korumalı sayfalar girişe yönlendirir', async () => {
  const ana = await fetch(`${sunucu.base}/`, { redirect: 'manual' });
  assert.equal(ana.status, 303);
  assert.match(String(ana.headers.get('location')), /^\/giris\?donus=/);

  const dokumanlar = await fetch(`${sunucu.base}/dokumanlar`, { redirect: 'manual' });
  assert.equal(dokumanlar.status, 303);

  const saglik = await fetch(`${sunucu.base}/saglik`);
  assert.equal(saglik.status, 200);
});

test('varsayılan yönetici hesabı ilk kurulumda oluşturulur ve giriş çalışır', async () => {
  const admin = kullaniciEkle('admin@qdms.local');
  assert.ok(admin);
  assert.equal(admin.rol, 'admin');

  const hatali = await fetch(`${sunucu.base}/giris`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@qdms.local', sifre: 'yanlis-sifre' }),
    redirect: 'manual',
  });
  assert.equal(hatali.status, 401);

  const giris = await adminOl();
  assert.equal(giris.durum, 303);
  assert.ok(adminCerez);

  const ana = await sayfaAl(sunucu.base, '/');
  assert.equal(ana.durum, 200);
  assert.match(ana.metin, /Genel Bakış/);

  const organizasyon = await sayfaAl(sunucu.base, '/organizasyon');
  assert.match(organizasyon.metin, /Sistem Yöneticisi/);
});

test('oturum kapatıldıktan sonra sayfalar tekrar giriş ister', async () => {
  await adminOl();
  const cikis = await formPost(sunucu.base, '/cikis');
  assert.equal(cikis.durum, 303);
  const ana = await sayfaAl(sunucu.base, '/');
  assert.equal(ana.durum, 303);
  await adminOl();
});

test('rol bazlı yetkilendirme doküman ve yönetim ekranlarını korur', async () => {
  await adminOl();
  const olustur = await formPost(sunucu.base, '/organizasyon/kullanicilar', {
    ad: 'Saha Personeli',
    email: 'saha.auth@ornek.com',
    sifre: 'Saha12345',
    rol: 'kullanici',
    departman_id: '1',
    aktif: '1',
  });
  assert.equal(olustur.durum, 303);
  assert.ok(kullaniciEkle('saha.auth@ornek.com'));

  const giris = await girisYap(sunucu.base, 'saha.auth@ornek.com', 'Saha12345');
  assert.equal(giris.durum, 303);

  const dokumanYeni = await sayfaAl(sunucu.base, '/dokumanlar/yeni');
  assert.equal(dokumanYeni.durum, 403);
  assert.match(dokumanYeni.metin, /yetkiniz yok/);

  const sablonlar = await sayfaAl(sunucu.base, '/sablonlar');
  assert.equal(sablonlar.durum, 403);

  const ayarlar = await sayfaAl(sunucu.base, '/ayarlar');
  assert.equal(ayarlar.durum, 403);

  const departman = await formPost(sunucu.base, '/organizasyon/departmanlar', {
    ad: 'Yetkisiz Departman',
  });
  assert.equal(departman.durum, 403);

  const dashboard = await sayfaAl(sunucu.base, '/');
  assert.equal(dashboard.durum, 200);
  assert.match(dashboard.metin, /Okunmamış Dokümanlarım/);

  await adminOl();
});

test('kalite yöneticisi şablon ve onay ekranlarına erişebilir', async () => {
  await adminOl();
  await formPost(sunucu.base, '/organizasyon/kullanicilar', {
    ad: 'Kalite Yöneticisi Kullanıcı',
    email: 'kalite.auth@ornek.com',
    sifre: 'Kalite12345',
    rol: 'kalite',
    departman_id: '2',
    aktif: '1',
  });
  const giris = await girisYap(sunucu.base, 'kalite.auth@ornek.com', 'Kalite12345');
  assert.equal(giris.durum, 303);

  const sablonlar = await sayfaAl(sunucu.base, '/sablonlar');
  assert.equal(sablonlar.durum, 200);
  assert.match(sablonlar.metin, /Şablon Tasarımcısı/);

  const sablon = await sayfaAl(sunucu.base, '/sablonlar/PR');
  assert.equal(sablon.durum, 200);

  const ayarlar = await sayfaAl(sunucu.base, '/ayarlar');
  assert.equal(ayarlar.durum, 403);

  await adminOl();
});

test('profil şifresi değiştirilir ve yeni şifreyle giriş yapılır', async () => {
  const yanit = await formPost(sunucu.base, '/organizasyon/sifre', {
    mevcut_sifre: 'Admin123!',
    yeni_sifre: 'YeniAdmin123!',
    yeni_sifre_tekrar: 'YeniAdmin123!',
  });
  assert.equal(yanit.durum, 303);
  assert.match(konumMesaji(yanit.konum), /Şifreniz güncellendi/);

  const eskiSifre = await girisYap(sunucu.base, 'admin@qdms.local', 'Admin123!');
  assert.equal(eskiSifre.durum, 401);
  assert.equal(eskiSifre.cerez, null);

  const yeniSifre = await girisYap(sunucu.base, 'admin@qdms.local', 'YeniAdmin123!');
  assert.equal(yeniSifre.durum, 303);
  await girisYap(sunucu.base, 'admin@qdms.local', 'YeniAdmin123!');
});
