'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { testOrtami, sunucuBaslat, formPost, sayfaAl } = require('./helpers');

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

test('ana sayfa ve sağlık uç noktası QDMS arayüzü sunar', async () => {
  const ana = await sayfaAl(sunucu.base, '/');
  assert.equal(ana.durum, 200);
  assert.match(ana.metin, /Genel Bakış/);
  assert.match(ana.metin, /Doküman Yönetimi/);
  assert.match(ana.metin, /Doküman Türleri/);
  assert.doesNotMatch(ana.metin, /Yaklaşan Hedefler/);
  assert.doesNotMatch(ana.metin, /Toplantı Modülü/);
  assert.doesNotMatch(ana.metin, /href="\/toplantilar"/);
  assert.doesNotMatch(ana.metin, /href="\/isler"/);
  assert.doesNotMatch(ana.metin, /href="\/sorumlular"/);

  const saglik = await sayfaAl(sunucu.base, '/saglik');
  assert.equal(saglik.durum, 200);
  assert.match(saglik.metin, /"ok":true/);
});

test('toplantı ve aksiyon takibi sayfaları tamamen kaldırılmıştır', async () => {
  for (const yol of ['/toplantilar', '/toplantilar/1', '/isler', '/isler/1/duzenle', '/sorumlular']) {
    const yanit = await sayfaAl(sunucu.base, yol);
    assert.equal(yanit.durum, 404, `${yol} bulunmamalı`);
  }

  const menu = await sayfaAl(sunucu.base, '/dokumanlar');
  assert.equal(menu.durum, 200);
  assert.doesNotMatch(menu.metin, /Toplantı ve Aksiyon Takibi/);
});

test('ayarlar sayfasında toplantı raporu ve hatırlatma alanları yoktur', async () => {
  const sayfa = await sayfaAl(sunucu.base, '/ayarlar');
  assert.equal(sayfa.durum, 200);
  assert.doesNotMatch(sayfa.metin, /Toplantı sonu rapor alıcı/);
  assert.doesNotMatch(sayfa.metin, /Günlük hatırlatma saati/);
  assert.doesNotMatch(sayfa.metin, /Hatırlatmayı Elle Çalıştır/);
  assert.match(sayfa.metin, /Saat dilimi/);
  assert.match(sayfa.metin, /Test modu/);
});

test('ayarlar formunda şifre alanı boş bırakıldığında korunur', async () => {
  await formPost(sunucu.base, '/ayarlar', {
    smtp_host: 'smtp.ornek.com',
    smtp_port: '587',
    smtp_secure: '',
    smtp_user: 'kullanici@ornek.com',
    smtp_pass: 'ilk-sifre',
    smtp_from_email: 'gonderen@ornek.com',
    smtp_from_name: 'QDMS',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });

  await formPost(sunucu.base, '/ayarlar', {
    smtp_host: 'smtp.ornek.com',
    smtp_port: '587',
    smtp_user: 'kullanici@ornek.com',
    smtp_pass: '',
    smtp_from_email: 'gonderen@ornek.com',
    smtp_from_name: 'QDMS',
    saat_dilimi: 'Europe/Istanbul',
    test_modu: '1',
  });

  const sifre = veritabani().prepare("SELECT deger FROM ayarlar WHERE anahtar = 'smtp_pass'").get();
  assert.equal(sifre.deger, 'ilk-sifre');

  const sayfa = await sayfaAl(sunucu.base, '/ayarlar');
  assert.doesNotMatch(sayfa.metin, /ilk-sifre/);
  assert.match(sayfa.metin, /Kayıtlı şifre korunuyor/);
});

test('olmayan kayıtlar ve bilinmeyen sayfalar 404 döndürür', async () => {
  const eposta = await sayfaAl(sunucu.base, '/emailler/999999');
  assert.equal(eposta.durum, 404);

  const bilinmeyen = await sayfaAl(sunucu.base, '/boyle-bir-sayfa-yok');
  assert.equal(bilinmeyen.durum, 404);
  assert.match(bilinmeyen.metin, /bulunamadı/);
});
