'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pdfUret, logoVerisiCoz } = require('../src/pdf');
const qdms = require('../src/qdms');

// 1x1 saydam PNG (test/qdms.test.js içindeki sabitle aynı).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// 8x8 düz renkli JPEG; PDFKit'in JPEG kod çözücüsünü gerçekten çalıştırır.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5Hooor94Phz//2Q==',
  'base64'
);

// Gerçek bir WEBP yerine yalnızca imza baytları yeterli: logoVerisiCoz
// PDFKit'e hiç ulaşmadan biçimi reddetmeli.
function webpBaytlari() {
  const veri = Buffer.alloc(24);
  veri.write('RIFF', 0, 'ascii');
  veri.writeUInt32LE(16, 4);
  veri.write('WEBP', 8, 'ascii');
  veri.write('VP8 ', 12, 'ascii');
  veri.writeUInt32LE(8, 16);
  return veri;
}

const WEBP = webpBaytlari();

let geciciDizin = null;

test.before(() => {
  geciciDizin = fs.mkdtempSync(path.join(os.tmpdir(), 'qdms-logo-test-'));
  fs.writeFileSync(path.join(geciciDizin, 'logo.png'), PNG);
  fs.writeFileSync(path.join(geciciDizin, 'logo.jpg'), JPEG);
  fs.writeFileSync(path.join(geciciDizin, 'logo.webp'), WEBP);
  // Uzantı bilerek yanıltıcı: gerçek biçim imza baytlarından okunmalı.
  fs.writeFileSync(path.join(geciciDizin, 'aslinda-png.jpg'), PNG);
});

test.after(() => {
  if (geciciDizin) {
    fs.rmSync(geciciDizin, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function uyarilariYakala(fn) {
  const asil = console.warn;
  const mesajlar = [];
  console.warn = (...parcalar) => {
    mesajlar.push(parcalar.map((parca) => String(parca)).join(' '));
  };
  try {
    return { sonuc: fn(), mesajlar };
  } finally {
    console.warn = asil;
  }
}

async function uyarilariYakalaAsync(fn) {
  const asil = console.warn;
  const mesajlar = [];
  console.warn = (...parcalar) => {
    mesajlar.push(parcalar.map((parca) => String(parca)).join(' '));
  };
  try {
    return { sonuc: await fn(), mesajlar };
  } finally {
    console.warn = asil;
  }
}

function temelArgumanlar(ek = {}) {
  return {
    dokuman: {
      kod: 'PR-010',
      baslik: 'Logo Antet Testi',
      revizyon: 1,
      durum: 'taslak',
      icerik: [{ baslik: '1. Amaç', metin: 'Logo görünürlüğü için örnek Türkçe içerik.' }],
      olusturma_tarihi: new Date().toISOString(),
    },
    sablon: {
      antet_renk: '#1e3a8a',
      kenarlik_stili: 'duz',
      altbilgi_hazirlayan: 'Hazırlayan',
      altbilgi_onaylayan: 'Onaylayan',
    },
    sirket: { ad: 'Örnek Sanayi A.Ş.' },
    tur: qdms.turGetir('PR'),
    hazirlayanAd: 'Test Hazırlayan',
    onaylayanAd: 'Test Onaylayan',
    ...ek,
  };
}

function pdfDogrula(pdf) {
  assert.ok(Buffer.isBuffer(pdf), 'pdfUret Buffer döndürmeli');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1_000, 'PDF anlamlı büyüklükte olmalı');
}

function gorselVarMi(pdf) {
  return pdf.includes('/Subtype /Image');
}

function sayfaSayisi(pdf) {
  // /Type /Pages sözlüğü değil, yalnızca /Type /Page sayfa nesneleri sayılır.
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
}

test('logoVerisiCoz PNG/JPEG Buffer, data URI, ham base64 ve dosya yolunu çözer', () => {
  const png = logoVerisiCoz(PNG);
  assert.ok(png);
  assert.equal(png.tur, 'png');
  assert.deepEqual(png.veri, PNG);

  const jpeg = logoVerisiCoz(JPEG);
  assert.ok(jpeg);
  assert.equal(jpeg.tur, 'jpeg');
  assert.deepEqual(jpeg.veri, JPEG);

  const pngDataUri = logoVerisiCoz(`data:image/png;base64,${PNG.toString('base64')}`);
  assert.ok(pngDataUri);
  assert.equal(pngDataUri.tur, 'png');
  assert.deepEqual(pngDataUri.veri, PNG);

  const jpegDataUri = logoVerisiCoz(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
  assert.ok(jpegDataUri);
  assert.equal(jpegDataUri.tur, 'jpeg');
  assert.deepEqual(jpegDataUri.veri, JPEG);

  const pngYolu = logoVerisiCoz(path.join(geciciDizin, 'logo.png'));
  assert.ok(pngYolu);
  assert.equal(pngYolu.tur, 'png');
  assert.deepEqual(pngYolu.veri, PNG);

  const jpegYolu = logoVerisiCoz(path.join(geciciDizin, 'logo.jpg'));
  assert.ok(jpegYolu);
  assert.equal(jpegYolu.tur, 'jpeg');

  // Uzantı .jpg olsa da içerik PNG ise gerçek biçim PNG olarak dönmeli.
  const yanilticiUzanti = logoVerisiCoz(path.join(geciciDizin, 'aslinda-png.jpg'));
  assert.ok(yanilticiUzanti);
  assert.equal(yanilticiUzanti.tur, 'png');

  const hamBase64 = logoVerisiCoz(PNG.toString('base64'));
  assert.ok(hamBase64);
  assert.equal(hamBase64.tur, 'png');
  assert.deepEqual(hamBase64.veri, PNG);

  const uint8 = logoVerisiCoz(new Uint8Array(JPEG));
  assert.ok(uint8);
  assert.equal(uint8.tur, 'jpeg');
});

test('logoVerisiCoz WEBP ve geçersiz kaynaklarda null döner ve tek uyarı yazar', () => {
  const webp = uyarilariYakala(() => logoVerisiCoz(WEBP));
  assert.equal(webp.sonuc, null);
  assert.equal(webp.mesajlar.length, 1);
  assert.match(webp.mesajlar[0], /WEBP/i);
  assert.match(webp.mesajlar[0], /desteklenmiyor/i);

  const webpDataUri = uyarilariYakala(() =>
    logoVerisiCoz(`data:image/webp;base64,${WEBP.toString('base64')}`)
  );
  assert.equal(webpDataUri.sonuc, null);
  assert.equal(webpDataUri.mesajlar.length, 1);
  assert.match(webpDataUri.mesajlar[0], /WEBP/i);

  const webpYolu = uyarilariYakala(() => logoVerisiCoz(path.join(geciciDizin, 'logo.webp')));
  assert.equal(webpYolu.sonuc, null);
  assert.equal(webpYolu.mesajlar.length, 1);
  assert.match(webpYolu.mesajlar[0], /WEBP/i);

  const bilinmeyen = uyarilariYakala(() => logoVerisiCoz(Buffer.from('bu bir görsel değil')));
  assert.equal(bilinmeyen.sonuc, null);
  assert.equal(bilinmeyen.mesajlar.length, 1);

  const olmayanYol = uyarilariYakala(() =>
    logoVerisiCoz(path.join(geciciDizin, 'bulunmayan-logo.png'))
  );
  assert.equal(olmayanYol.sonuc, null);
  assert.equal(olmayanYol.mesajlar.length, 1);

  const bos = uyarilariYakala(() => logoVerisiCoz(''));
  assert.equal(bos.sonuc, null);
  assert.equal(bos.mesajlar.length, 0);
  assert.equal(logoVerisiCoz(null), null);
  assert.equal(logoVerisiCoz(undefined), null);
});

test('pdfUret PNG Buffer logoyu antet kutusuna gömer', async () => {
  const pdf = await pdfUret(temelArgumanlar({ logoVerisi: PNG }));
  pdfDogrula(pdf);
  assert.ok(gorselVarMi(pdf), 'PNG Buffer için /Subtype /Image XObject üretilmeli');
});

test('pdfUret PNG data URI logoyu gömer', async () => {
  const pdf = await pdfUret(
    temelArgumanlar({ logoVerisi: `data:image/png;base64,${PNG.toString('base64')}` })
  );
  pdfDogrula(pdf);
  assert.ok(gorselVarMi(pdf), 'data URI için /Subtype /Image XObject üretilmeli');
});

test('pdfUret logoYolu ile dosya yolundan PNG ve JPEG logoyu gömer', async () => {
  const pngPdf = await pdfUret(
    temelArgumanlar({ logoYolu: path.join(geciciDizin, 'logo.png') })
  );
  pdfDogrula(pngPdf);
  assert.ok(gorselVarMi(pngPdf), 'logoYolu PNG için görsel XObject üretilmeli');

  const jpegPdf = await pdfUret(
    temelArgumanlar({ logoYolu: path.join(geciciDizin, 'logo.jpg') })
  );
  pdfDogrula(jpegPdf);
  assert.ok(gorselVarMi(jpegPdf), 'logoYolu JPEG için görsel XObject üretilmeli');
});

test('pdfUret JPEG Buffer logoyu gömer', async () => {
  const pdf = await pdfUret(temelArgumanlar({ logoVerisi: JPEG }));
  pdfDogrula(pdf);
  assert.ok(gorselVarMi(pdf), 'JPEG Buffer için /Subtype /Image XObject üretilmeli');
});

test('logoVerisi geçerliyse logoYolu okunmadan o kullanılır', async () => {
  const { sonuc: pdf, mesajlar } = await uyarilariYakalaAsync(() =>
    pdfUret(
      temelArgumanlar({
        logoYolu: path.join(geciciDizin, 'logo.webp'),
        logoVerisi: PNG,
      })
    )
  );
  pdfDogrula(pdf);
  assert.ok(gorselVarMi(pdf));
  assert.deepEqual(mesajlar, []);
});

test('WEBP logo PDF üretimini bozmaz; uyarı verir ve logosuz PDF üretir', async () => {
  const tampon = await uyarilariYakalaAsync(() =>
    pdfUret(temelArgumanlar({ logoVerisi: WEBP }))
  );
  pdfDogrula(tampon.sonuc);
  assert.equal(gorselVarMi(tampon.sonuc), false, 'WEBP gömülmemeli');
  assert.ok(
    tampon.mesajlar.some((mesaj) => /WEBP/i.test(mesaj)),
    'WEBP için Türkçe uyarı yazılmalı'
  );

  const veriUri = await uyarilariYakalaAsync(() =>
    pdfUret(
      temelArgumanlar({ logoVerisi: `data:image/webp;base64,${WEBP.toString('base64')}` })
    )
  );
  pdfDogrula(veriUri.sonuc);
  assert.equal(gorselVarMi(veriUri.sonuc), false);

  const yol = await uyarilariYakalaAsync(() =>
    pdfUret(temelArgumanlar({ logoYolu: path.join(geciciDizin, 'logo.webp') }))
  );
  pdfDogrula(yol.sonuc);
  assert.equal(gorselVarMi(yol.sonuc), false);
});

test('logo verilmediğinde PDF eskisi gibi logosuz üretilir', async () => {
  const pdf = await pdfUret(temelArgumanlar());
  pdfDogrula(pdf);
  assert.equal(gorselVarMi(pdf), false);
});

test('bozuk PNG baytları PDF üretimini engellemez; uyarı verip logosuz devam eder', async () => {
  const bozuk = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const { sonuc: pdf, mesajlar } = await uyarilariYakalaAsync(() =>
    pdfUret(temelArgumanlar({ logoVerisi: bozuk }))
  );
  pdfDogrula(pdf);
  assert.equal(gorselVarMi(pdf), false);
  assert.ok(mesajlar.some((mesaj) => /görsel çizilemedi/i.test(mesaj)));
});

test('çok sayfalı PDF üretimi başarılı olur ve logo ikinci sayfada da kullanılır', async () => {
  const icerik = Array.from({ length: 8 }, (_, bolumIndeks) => ({
    baslik: `${bolumIndeks + 1}. Bölüm`,
    metin: Array.from(
      { length: 14 },
      (_, satirIndeks) =>
        `Satır ${satirIndeks + 1}: Türkçe karakterler İş Güvenliği, ÇĞİÖŞÜ ve logo denemesi.`
    ).join('\n'),
  }));
  const argumanlar = temelArgumanlar({ logoVerisi: PNG });
  argumanlar.dokuman = { ...argumanlar.dokuman, icerik };
  const pdf = await pdfUret(argumanlar);
  pdfDogrula(pdf);
  assert.ok(sayfaSayisi(pdf) >= 2, `en az 2 sayfa bekleniyordu, bulunan: ${sayfaSayisi(pdf)}`);
  assert.ok(gorselVarMi(pdf), 'çok sayfalı PDF logo XObject içermeli');
});

test('uzun şirket adı logo kutusuyla çakışmadan üretilir', async () => {
  const pdf = await pdfUret(
    temelArgumanlar({
      logoVerisi: PNG,
      sirket: {
        ad: 'Çok Uzun Şirket Adı Örneği Uluslararası Üretim ve Pazarlama Anonim Şirketi',
      },
    })
  );
  pdfDogrula(pdf);
  assert.ok(gorselVarMi(pdf));
});
