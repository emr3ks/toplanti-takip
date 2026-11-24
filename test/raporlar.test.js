'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateRawSync } = require('node:zlib');

const {
  testOrtami,
  sunucuBaslat,
  sayfaAl,
  girisYap,
  cerezliBasliklar,
} = require('./helpers');
const { kullaniciOlustur } = require('../src/auth');
const { bugunTz } = require('../src/dates');

let ortam;
let sunucu;

let uretimId;
let bakimId;
let kaliteDepartmanId;

let adminId;
let sahaId;
let ayseId;
let mehmetId;
let kaliteId;
let pasifId;

let prId;
let tlId;
let ekId;

let isoEgitimId;
let isGuvenligiEgitimId;
let yeniSistemEgitimId;
let gecenYilEgitimId;

const BUGUN = bugunTz('Europe/Istanbul');
const BU_YIL = Number(BUGUN.slice(0, 4));
const GECEN_YIL = BU_YIL - 1;

function db() {
  return ortam.db;
}

function departmanId(ad) {
  return db().prepare('SELECT id FROM departmanlar WHERE ad = ? COLLATE NOCASE').get(ad).id;
}

function dokumanEkle({ kod, turKod, baslik, revizyon = 0, durum = 'yayinda', yayinTarihi = null, hedefler = [] }) {
  const bilgi = db()
    .prepare(
      `INSERT INTO dokumanlar
         (kod, tur_kod, baslik, revizyon, durum, yayin_tarihi, hazirlayan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kod, turKod, baslik, revizyon, durum, yayinTarihi, adminId);
  const id = Number(bilgi.lastInsertRowid);
  const hedefEkle = db().prepare(
    'INSERT INTO dokuman_hedef_departmanlar (dokuman_id, departman_id) VALUES (?, ?)'
  );
  for (const departman of hedefler) hedefEkle.run(id, departman);
  return id;
}

function okumaEkle(dokumanId, kullaniciId, okundu, okunmaTarihi = null) {
  db()
    .prepare(
      `INSERT INTO dokuman_okumalari (dokuman_id, kullanici_id, okundu, okunma_tarihi)
       VALUES (?, ?, ?, ?)`
    )
    .run(dokumanId, kullaniciId, okundu ? 1 : 0, okunmaTarihi);
}

function egitimEkle({ ad, tur = 'ic', egitmen = '', tarih, sure = 1, dokumanId = null, durum = 'planlandi' }) {
  const bilgi = db()
    .prepare(
      `INSERT INTO egitimler (ad, tur, egitmen, planlanan_tarih, sure_saat, dokuman_id, aciklama, durum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ad, tur, egitmen, tarih, sure, dokumanId, 'Rapor testi eğitimi.', durum);
  return Number(bilgi.lastInsertRowid);
}

function katilimciEkle(egitimId, kullaniciId, katilimDurumu, puan = null, etkinlikDurumu = 'bekliyor') {
  db()
    .prepare(
      `INSERT INTO egitim_katilimcilari
         (egitim_id, kullanici_id, katilim_durumu, degerlendirme_puani, etkinlik_durumu)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(egitimId, kullaniciId, katilimDurumu, puan, etkinlikDurumu);
}

async function adminGiris() {
  const sonuc = await girisYap(sunucu.base);
  assert.equal(sonuc.durum, 303, 'admin girişi başarılı olmalı');
}

async function kisiGiris(email, sifre) {
  const sonuc = await girisYap(sunucu.base, email, sifre);
  assert.equal(sonuc.durum, 303, `${email} girişi başarılı olmalı`);
}

/** İkili yanıtları (CSV/XLSX) çerezle indirir. */
async function ikiliAl(yol) {
  const yanit = await fetch(`${sunucu.base}${yol}`, {
    headers: cerezliBasliklar(sunucu.base),
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    icerikTuru: yanit.headers.get('content-type'),
    duzen: yanit.headers.get('content-disposition'),
    onbellek: yanit.headers.get('cache-control'),
    tampon: Buffer.from(await yanit.arrayBuffer()),
  };
}

/** UTF-8 BOM'unu doğrular ve BOM sonrası metni döndürür. */
function csvMetni(tampon) {
  assert.deepEqual([...tampon.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV UTF-8 BOM ile başlamalı');
  return tampon.subarray(3).toString('utf8');
}

function satirlar(metin) {
  return metin.trimEnd().split('\r\n');
}

/** Gerçek XLSX paketinden sheet1.xml içeriğini çıkarır (sıkıştırmayı açar). */
function xlsxSayfaXml(tampon) {
  const enErken = Math.max(0, tampon.length - 65_557);
  let sonu = -1;
  for (let i = tampon.length - 22; i >= enErken; i -= 1) {
    if (tampon.readUInt32LE(i) === 0x06054b50) {
      sonu = i;
      break;
    }
  }
  assert.notEqual(sonu, -1, 'ZIP merkezi dizin sonu bulunamadı');

  const adet = tampon.readUInt16LE(sonu + 10);
  let imlec = tampon.readUInt32LE(sonu + 16);
  for (let i = 0; i < adet; i += 1) {
    const yontem = tampon.readUInt16LE(imlec + 10);
    const sikistirilmisBoyut = tampon.readUInt32LE(imlec + 20);
    const adUzunluk = tampon.readUInt16LE(imlec + 28);
    const ekstraUzunluk = tampon.readUInt16LE(imlec + 30);
    const yorumUzunluk = tampon.readUInt16LE(imlec + 32);
    const yerelKonum = tampon.readUInt32LE(imlec + 42);
    const ad = tampon.toString('utf8', imlec + 46, imlec + 46 + adUzunluk);

    if (ad === 'xl/worksheets/sheet1.xml') {
      assert.equal(tampon.readUInt32LE(yerelKonum), 0x04034b50, 'yerel başlık imzası geçersiz');
      const yerelAdUzunluk = tampon.readUInt16LE(yerelKonum + 26);
      const yerelEkstra = tampon.readUInt16LE(yerelKonum + 28);
      const baslangic = yerelKonum + 30 + yerelAdUzunluk + yerelEkstra;
      const ham = tampon.subarray(baslangic, baslangic + sikistirilmisBoyut);
      const icerik = yontem === 0 ? Buffer.from(ham) : inflateRawSync(ham);
      return icerik.toString('utf8');
    }

    imlec += 46 + adUzunluk + ekstraUzunluk + yorumUzunluk;
  }
  assert.fail('xl/worksheets/sheet1.xml bulunamadı');
}

test.before(async () => {
  ortam = testOrtami();

  uretimId = departmanId('Üretim');
  bakimId = departmanId('Bakım');
  kaliteDepartmanId = departmanId('Kalite Güvence');

  adminId = db().prepare("SELECT id FROM kullanicilar WHERE email = 'admin@qdms.local'").get().id;

  sahaId = kullaniciOlustur(db(), {
    ad: 'Saha Personeli',
    email: 'saha@ornek.com',
    sifre: 'Standart123!',
    rol: 'kullanici',
    departmanId: uretimId,
  });
  ayseId = kullaniciOlustur(db(), {
    ad: 'Ayşe Yıldız',
    email: 'ayse@ornek.com',
    sifre: 'Ayse12345!',
    rol: 'kullanici',
    departmanId: uretimId,
  });
  mehmetId = kullaniciOlustur(db(), {
    ad: 'Mehmet Demir',
    email: 'mehmet@ornek.com',
    sifre: 'Mehmet12345!',
    rol: 'kullanici',
    departmanId: bakimId,
  });
  kaliteId = kullaniciOlustur(db(), {
    ad: 'Kalite Yöneticisi Kullanıcı',
    email: 'kalite@ornek.com',
    sifre: 'Kalite123!',
    rol: 'kalite',
    departmanId: kaliteDepartmanId,
  });
  pasifId = kullaniciOlustur(db(), {
    ad: 'Pasif Personel',
    email: 'pasif@ornek.com',
    sifre: 'Pasif12345!',
    rol: 'kullanici',
    departmanId: uretimId,
    aktif: 0,
  });

  prId = dokumanEkle({
    kod: 'PR-101',
    turKod: 'PR',
    baslik: 'Kalite Kayıtlarının Kontrolü Prosedürü',
    revizyon: 2,
    yayinTarihi: `${BU_YIL}-01-15T08:00:00.000Z`,
    hedefler: [uretimId, kaliteDepartmanId],
  });
  tlId = dokumanEkle({
    kod: 'TL-201',
    turKod: 'TL',
    baslik: 'Üretim Hattı İş Talimatı',
    revizyon: 0,
    yayinTarihi: `${BU_YIL}-02-01T08:00:00.000Z`,
    hedefler: [uretimId],
  });
  ekId = dokumanEkle({
    kod: 'EK-301',
    turKod: 'EK',
    baslik: 'Kalite El Kitabı',
    revizyon: 1,
    yayinTarihi: `${BU_YIL}-03-10T08:00:00.000Z`,
    hedefler: [bakimId],
  });
  // Yayında olmayan doküman raporda görünmemelidir.
  dokumanEkle({
    kod: 'FR-401',
    turKod: 'FR',
    baslik: 'Taslak Form',
    durum: 'taslak',
    hedefler: [uretimId],
  });

  okumaEkle(prId, ayseId, true, `${BU_YIL}-01-20T09:30:00.000Z`);
  okumaEkle(tlId, ayseId, false);
  okumaEkle(prId, mehmetId, false);
  okumaEkle(tlId, mehmetId, true, `${BU_YIL}-02-05T10:00:00.000Z`);
  okumaEkle(prId, kaliteId, true, `${BU_YIL}-01-22T11:15:00.000Z`);
  // Pasif kullanıcının okuması matris/liste raporuna girmemelidir.
  okumaEkle(prId, pasifId, true, `${BU_YIL}-01-23T11:15:00.000Z`);

  isoEgitimId = egitimEkle({
    ad: 'ISO 9001 Farkındalık Eğitimi',
    tur: 'ic',
    egitmen: 'Ayşe Yıldız',
    tarih: `${BU_YIL}-02-10`,
    sure: 2,
    dokumanId: prId,
    durum: 'tamamlandi',
  });
  isGuvenligiEgitimId = egitimEkle({
    ad: 'İş Güvenliği Eğitimi',
    tur: 'dis',
    egitmen: 'Dış Eğitim Kurumu',
    tarih: `${BU_YIL}-03-05`,
    sure: 4,
    dokumanId: tlId,
    durum: 'tamamlandi',
  });
  yeniSistemEgitimId = egitimEkle({
    ad: 'Yeni Sistem Tanıtımı',
    tur: 'ic',
    egitmen: 'Mehmet Demir',
    tarih: `${BU_YIL}-04-01`,
    sure: 1.5,
    durum: 'planlandi',
  });
  gecenYilEgitimId = egitimEkle({
    ad: 'Geçen Yıl Eğitimi',
    tur: 'ic',
    egitmen: 'Eski Eğitmen',
    tarih: `${GECEN_YIL}-05-01`,
    sure: 8,
    durum: 'tamamlandi',
  });

  katilimciEkle(isoEgitimId, ayseId, 'katildi', 90, 'etkin');
  katilimciEkle(isoEgitimId, mehmetId, 'katilmadi', null, 'etkin_degil');
  katilimciEkle(isoEgitimId, kaliteId, 'katildi', 80, 'etkin');
  katilimciEkle(isGuvenligiEgitimId, ayseId, 'katildi', 75, 'etkin');
  katilimciEkle(isGuvenligiEgitimId, mehmetId, 'katildi', 85, 'etkin');
  katilimciEkle(yeniSistemEgitimId, ayseId, 'bekliyor');
  katilimciEkle(yeniSistemEgitimId, mehmetId, 'bekliyor');
  katilimciEkle(gecenYilEgitimId, ayseId, 'katildi', 100, 'etkin');

  sunucu = await sunucuBaslat(ortam.app);
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

// ---------------------------------------------------------------------------
// Rapor merkezi
// ---------------------------------------------------------------------------

test('rapor merkezi özet kartlarını ve üç rapor bağlantısını gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/raporlar');

  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Kurumsal Raporlar/);
  assert.match(sayfa.metin, /Güncel Doküman Ana Listesi/);
  assert.match(sayfa.metin, /Okundu Onayı Matrisi/);
  assert.match(sayfa.metin, /Eğitim Matrisi/);
  assert.match(sayfa.metin, /Raporu Aç/);

  assert.match(sayfa.metin, /Yayındaki doküman/);
  assert.match(sayfa.metin, /Toplam okuma kaydı/);
  assert.match(sayfa.metin, /Okunma oranı/);
  assert.match(sayfa.metin, /yılı eğitimi/);
  assert.match(sayfa.metin, /Katılım oranı/);

  assert.match(sayfa.metin, /href="\/raporlar\/dokumanlar"/);
  assert.match(sayfa.metin, /href="\/raporlar\/okundu-onayi"/);
  assert.match(sayfa.metin, /href="\/raporlar\/egitim"/);
});

// ---------------------------------------------------------------------------
// Doküman ana listesi
// ---------------------------------------------------------------------------

test('doküman ana listesi yalnızca yayındaki dokümanları Türkçe alanlarla gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/raporlar/dokumanlar');

  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Güncel Doküman Ana Listesi/);
  assert.match(sayfa.metin, /PR-101/);
  assert.match(sayfa.metin, /TL-201/);
  assert.match(sayfa.metin, /EK-301/);
  assert.match(sayfa.metin, /Kalite Kayıtlarının Kontrolü Prosedürü/);
  assert.match(sayfa.metin, /Üretim Hattı İş Talimatı/);
  assert.match(sayfa.metin, /Rev\.02/);
  assert.match(sayfa.metin, /15\.01\.2026/);
  assert.match(sayfa.metin, /Üretim/);
  assert.match(sayfa.metin, /Kalite Güvence/);
  assert.match(sayfa.metin, /Hazırlayan/);
  assert.doesNotMatch(sayfa.metin, /FR-401/);
  assert.doesNotMatch(sayfa.metin, /Taslak Form/);
});

test('doküman raporu tür, departman ve arama filtreleriyle daraltılır', async () => {
  await adminGiris();

  const prosedur = await sayfaAl(sunucu.base, '/raporlar/dokumanlar?tur=PR');
  assert.equal(prosedur.durum, 200);
  assert.match(prosedur.metin, /PR-101/);
  assert.doesNotMatch(prosedur.metin, /TL-201/);
  assert.doesNotMatch(prosedur.metin, /EK-301/);

  const bakim = await sayfaAl(sunucu.base, `/raporlar/dokumanlar?departman=${bakimId}`);
  assert.equal(bakim.durum, 200);
  assert.match(bakim.metin, /EK-301/);
  assert.doesNotMatch(bakim.metin, /PR-101/);

  const arama = await sayfaAl(
    sunucu.base,
    `/raporlar/dokumanlar?q=${encodeURIComponent('Kalite El')}`
  );
  assert.equal(arama.durum, 200);
  assert.match(arama.metin, /EK-301/);
  assert.doesNotMatch(arama.metin, /PR-101/);

  const bos = await sayfaAl(sunucu.base, '/raporlar/dokumanlar?tur=FR');
  assert.equal(bos.durum, 200);
  assert.match(bos.metin, /Bu filtrelerde yayında doküman yok/);
});

// ---------------------------------------------------------------------------
// Okundu onayı
// ---------------------------------------------------------------------------

test('okundu onayı matrisi kişi, doküman ve okuma işaretlerini gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/raporlar/okundu-onayi');

  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Okundu Onayı Matrisi/);
  assert.match(sayfa.metin, /Ayşe Yıldız/);
  assert.match(sayfa.metin, /Mehmet Demir/);
  assert.match(sayfa.metin, /Kalite Yöneticisi Kullanıcı/);
  assert.match(sayfa.metin, /PR-101/);
  assert.match(sayfa.metin, /TL-201/);
  assert.match(sayfa.metin, /EK-301/);
  assert.match(sayfa.metin, /✓/);
  assert.match(sayfa.metin, /•/);
  assert.match(sayfa.metin, /Okunan \/ Toplam/);
  assert.doesNotMatch(sayfa.metin, /Pasif Personel/);

  assert.match(sayfa.metin, /Toplam kayıt/);
  assert.match(sayfa.metin, /Okunma yüzdesi/);
});

test('okundu onayı liste görünümü okuma kayıtlarını ayrıntılı gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/raporlar/okundu-onayi?gorunum=liste');

  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Okuma kayıtları/);
  assert.match(sayfa.metin, /Personel/);
  assert.match(sayfa.metin, /Okunma Tarihi/);
  assert.match(sayfa.metin, /Ayşe Yıldız/);
  assert.match(sayfa.metin, /Mehmet Demir/);
  assert.match(sayfa.metin, /PR-101/);
  assert.match(sayfa.metin, /TL-201/);
  assert.match(sayfa.metin, /Okudu/);
  assert.match(sayfa.metin, /Bekliyor/);
  assert.doesNotMatch(sayfa.metin, /Pasif Personel/);

  const okunan = await sayfaAl(
    sunucu.base,
    '/raporlar/okundu-onayi?durum=okundu&gorunum=liste'
  );
  assert.equal(okunan.durum, 200);
  assert.match(okunan.metin, /Ayşe Yıldız/);
  assert.match(okunan.metin, /Mehmet Demir/);
  assert.doesNotMatch(okunan.metin, /rozet-beklemede">Bekliyor/);
});

// ---------------------------------------------------------------------------
// Eğitim raporu
// ---------------------------------------------------------------------------

test('eğitim matrisi cari yılın eğitimlerini, katılımcıları ve puanları gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/raporlar/egitim');

  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Yıllık Eğitim Matrisi/);
  assert.match(sayfa.metin, /ISO 9001 Farkındalık Eğitimi/);
  assert.match(sayfa.metin, /İş Güvenliği Eğitimi/);
  assert.match(sayfa.metin, /Yeni Sistem Tanıtımı/);
  assert.doesNotMatch(sayfa.metin, /Geçen Yıl Eğitimi/);
  assert.match(sayfa.metin, /Ayşe Yıldız/);
  assert.match(sayfa.metin, /Mehmet Demir/);
  assert.match(sayfa.metin, /Katıldı \(90\)/);
  assert.match(sayfa.metin, /Katılmadı/);
  assert.match(sayfa.metin, /Bekliyor/);
  assert.match(sayfa.metin, /Katıldığı \/ Toplam/);

  assert.match(sayfa.metin, /Toplam eğitim/);
  assert.match(sayfa.metin, /Planlanan/);
  assert.match(sayfa.metin, /Tamamlanan/);
  assert.match(sayfa.metin, /Toplam katılımcı/);
  assert.match(sayfa.metin, /Katılım oranı/);
  assert.match(sayfa.metin, /Ortalama puan/);
  assert.match(sayfa.metin, /Etkinlik oranı/);
});

test('eğitim raporu yıl ve durum filtreleriyle daraltılır; liste görünümü özet sütunları verir', async () => {
  await adminGiris();

  const gecenYil = await sayfaAl(sunucu.base, `/raporlar/egitim?yil=${GECEN_YIL}`);
  assert.equal(gecenYil.durum, 200);
  assert.match(gecenYil.metin, /Geçen Yıl Eğitimi/);
  assert.doesNotMatch(gecenYil.metin, /ISO 9001 Farkındalık Eğitimi/);

  const tamamlanan = await sayfaAl(sunucu.base, '/raporlar/egitim?durum=tamamlandi');
  assert.equal(tamamlanan.durum, 200);
  assert.match(tamamlanan.metin, /ISO 9001 Farkındalık Eğitimi/);
  assert.doesNotMatch(tamamlanan.metin, /Yeni Sistem Tanıtımı/);

  const liste = await sayfaAl(sunucu.base, '/raporlar/egitim?gorunum=liste');
  assert.equal(liste.durum, 200);
  assert.match(liste.metin, /Eğitim bazında gerçekleşme/);
  assert.match(liste.metin, /Katılım %/);
  assert.match(liste.metin, /Ort\. Puan/);
  assert.match(liste.metin, /Etkinlik %/);
  assert.match(liste.metin, /%80/);
  assert.match(liste.metin, new RegExp(`href="/dokumanlar/${prId}"`));
});

// ---------------------------------------------------------------------------
// CSV / XLSX dışa aktarma
// ---------------------------------------------------------------------------

test('doküman CSV çıktısı BOM, noktalı virgül, Türkçe karakter ve doğru dosya adını içerir', async () => {
  await adminGiris();
  const yanit = await ikiliAl('/raporlar/dokumanlar.csv');

  assert.equal(yanit.durum, 200);
  assert.match(String(yanit.icerikTuru), /^text\/csv; charset=utf-8/);
  assert.equal(yanit.duzen, `attachment; filename="dokuman-ana-listesi-${BUGUN}.csv"`);
  assert.equal(yanit.onbellek, 'no-store');

  const metin = csvMetni(yanit.tampon);
  assert.match(metin, /Doküman Kodu;Başlık;Tür;Revizyon;Yayın Tarihi;Hedef Departmanlar;Hazırlayan/);
  assert.match(metin, /PR-101/);
  assert.match(metin, /Kalite Kayıtlarının Kontrolü Prosedürü/);
  assert.match(metin, /Prosedür/);
  assert.match(metin, /15\.01\.2026/);
  assert.match(metin, /Rev\.02/);
  assert.doesNotMatch(metin, /FR-401/);

  const prosedur = await ikiliAl('/raporlar/dokumanlar.csv?tur=PR');
  const prosedurMetni = csvMetni(prosedur.tampon);
  assert.match(prosedurMetni, /PR-101/);
  assert.doesNotMatch(prosedurMetni, /TL-201/);

  const bos = await ikiliAl('/raporlar/dokumanlar.csv?tur=FR');
  assert.equal(bos.durum, 200);
  const bosSatirlar = satirlar(csvMetni(bos.tampon));
  assert.equal(bosSatirlar.length, 1, 'boş veride yalnızca başlık satırı olmalı');
});

test('doküman XLSX çıktısı gerçek bir Office Open XML paketidir', async () => {
  await adminGiris();
  const yanit = await ikiliAl('/raporlar/dokumanlar.xlsx');

  assert.equal(yanit.durum, 200);
  assert.equal(
    yanit.icerikTuru,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.equal(yanit.duzen, `attachment; filename="dokuman-ana-listesi-${BUGUN}.xlsx"`);
  assert.equal(yanit.onbellek, 'no-store');
  assert.deepEqual([...yanit.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const xml = xlsxSayfaXml(yanit.tampon);
  assert.match(xml, /PR-101/);
  assert.match(xml, /Kalite Kayıtlarının Kontrolü Prosedürü/);
  assert.match(xml, /autoFilter/);
  assert.match(xml, /pane ySplit="1"/);
});

test('okundu onayı CSV varsayılan olarak ayrıntılı listeyi, matris seçeneğinde matrisi üretir', async () => {
  await adminGiris();

  const liste = await ikiliAl('/raporlar/okundu-onayi.csv');
  assert.equal(liste.durum, 200);
  assert.equal(liste.duzen, `attachment; filename="okundu-onayi-${BUGUN}.csv"`);
  const listeMetni = csvMetni(liste.tampon);
  assert.match(
    listeMetni,
    /Personel;Departman;Doküman Kodu;Doküman;Revizyon;Durum;Okunma Tarihi/
  );
  assert.match(listeMetni, /Ayşe Yıldız/);
  assert.match(listeMetni, /Mehmet Demir/);
  assert.match(listeMetni, /PR-101/);
  assert.match(listeMetni, /TL-201/);
  assert.match(listeMetni, /Okudu/);
  assert.match(listeMetni, /Bekliyor/);
  assert.doesNotMatch(listeMetni, /Pasif Personel/);

  const matris = await ikiliAl('/raporlar/okundu-onayi.csv?gorunum=matris');
  assert.equal(matris.durum, 200);
  assert.equal(matris.duzen, `attachment; filename="okundu-onayi-matrisi-${BUGUN}.csv"`);
  const matrisMetni = csvMetni(matris.tampon);
  const matrisSatirlari = satirlar(matrisMetni);
  assert.match(matrisSatirlari[0], /^Personel;Departman;/);
  assert.match(matrisSatirlari[0], /PR-101/);
  assert.match(matrisSatirlari[0], /TL-201/);
  assert.match(matrisMetni, /Ayşe Yıldız/);
  assert.match(matrisMetni, /Mehmet Demir/);
  assert.match(matrisMetni, /Okundu/);
  assert.match(matrisMetni, /Bekliyor/);

  const okunan = await ikiliAl('/raporlar/okundu-onayi.csv?durum=okundu');
  const okunanMetni = csvMetni(okunan.tampon);
  assert.match(okunanMetni, /Okudu/);
  assert.doesNotMatch(okunanMetni, /Bekliyor/);

  const tekDokuman = await ikiliAl(`/raporlar/okundu-onayi.csv?dokuman=${tlId}`);
  const tekDokumanMetni = csvMetni(tekDokuman.tampon);
  assert.match(tekDokumanMetni, /TL-201/);
  assert.doesNotMatch(tekDokumanMetni, /PR-101/);

  const tekDepartman = await ikiliAl(`/raporlar/okundu-onayi.csv?departman=${bakimId}`);
  const tekDepartmanMetni = csvMetni(tekDepartman.tampon);
  assert.match(tekDepartmanMetni, /Mehmet Demir/);
  assert.doesNotMatch(tekDepartmanMetni, /Ayşe Yıldız/);

  const tekKisi = await ikiliAl(
    `/raporlar/okundu-onayi.csv?q=${encodeURIComponent('Ayşe')}`
  );
  const tekKisiMetni = csvMetni(tekKisi.tampon);
  assert.match(tekKisiMetni, /Ayşe Yıldız/);
  assert.doesNotMatch(tekKisiMetni, /Mehmet Demir/);
});

test('okundu onayı XLSX liste ve matris çıktıları geçerli paket üretir', async () => {
  await adminGiris();

  const liste = await ikiliAl('/raporlar/okundu-onayi.xlsx');
  assert.equal(liste.durum, 200);
  assert.equal(
    liste.icerikTuru,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.deepEqual([...liste.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const listeXml = xlsxSayfaXml(liste.tampon);
  assert.match(listeXml, /Ayşe Yıldız/);
  assert.match(listeXml, /PR-101/);

  const matris = await ikiliAl('/raporlar/okundu-onayi.xlsx?gorunum=matris');
  assert.equal(matris.durum, 200);
  assert.deepEqual([...matris.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const matrisXml = xlsxSayfaXml(matris.tampon);
  assert.match(matrisXml, /Ayşe Yıldız/);
  assert.match(matrisXml, /PR-101/);
  assert.match(matrisXml, /Okundu/);
});

test('eğitim CSV listesi ve matrisi eğitim adlarını, kişileri ve katılım durumlarını içerir', async () => {
  await adminGiris();

  const liste = await ikiliAl('/raporlar/egitim.csv');
  assert.equal(liste.durum, 200);
  assert.equal(liste.duzen, `attachment; filename="egitim-listesi-${BUGUN}.csv"`);
  const listeMetni = csvMetni(liste.tampon);
  assert.match(
    listeMetni,
    /Eğitim;Tür;Tarih;Eğitmen;Süre \(saat\);İlgili Doküman;Planlanan;Katılan;Katılmayan;Bekleyen;Katılım %;Ort\. Puan;Etkinlik %/
  );
  assert.match(listeMetni, /ISO 9001 Farkındalık Eğitimi/);
  assert.match(listeMetni, /İş Güvenliği Eğitimi/);
  assert.match(listeMetni, /Dış Eğitim/);
  assert.match(listeMetni, /Ayşe Yıldız/);
  assert.doesNotMatch(listeMetni, /Geçen Yıl Eğitimi/);

  const matris = await ikiliAl('/raporlar/egitim.csv?gorunum=matris');
  assert.equal(matris.durum, 200);
  assert.equal(matris.duzen, `attachment; filename="egitim-matrisi-${BUGUN}.csv"`);
  const matrisMetni = csvMetni(matris.tampon);
  const matrisSatirlari = satirlar(matrisMetni);
  assert.match(matrisSatirlari[0], /^Personel;Departman;/);
  assert.match(matrisSatirlari[0], /ISO 9001 Farkındalık Eğitimi/);
  assert.match(matrisSatirlari[0], /İş Güvenliği Eğitimi/);
  assert.match(matrisSatirlari[0], /Yeni Sistem Tanıtımı/);
  assert.match(matrisMetni, /Ayşe Yıldız/);
  assert.match(matrisMetni, /Mehmet Demir/);
  assert.match(matrisMetni, /Katıldı \(90\)/);
  assert.match(matrisMetni, /Katılmadı/);
  assert.match(matrisMetni, /Bekliyor/);

  const gecenYil = await ikiliAl(`/raporlar/egitim.csv?yil=${GECEN_YIL}`);
  const gecenYilMetni = csvMetni(gecenYil.tampon);
  assert.match(gecenYilMetni, /Geçen Yıl Eğitimi/);
  assert.doesNotMatch(gecenYilMetni, /ISO 9001 Farkındalık Eğitimi/);
});

test('eğitim XLSX listesi ve matrisi geçerli paket üretir', async () => {
  await adminGiris();

  const liste = await ikiliAl('/raporlar/egitim.xlsx');
  assert.equal(liste.durum, 200);
  assert.equal(liste.duzen, `attachment; filename="egitim-listesi-${BUGUN}.xlsx"`);
  assert.deepEqual([...liste.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const listeXml = xlsxSayfaXml(liste.tampon);
  assert.match(listeXml, /ISO 9001 Farkındalık Eğitimi/);
  assert.match(listeXml, /Ayşe Yıldız/);

  const matris = await ikiliAl('/raporlar/egitim.xlsx?gorunum=matris');
  assert.equal(matris.durum, 200);
  assert.equal(matris.duzen, `attachment; filename="egitim-matrisi-${BUGUN}.xlsx"`);
  assert.deepEqual([...matris.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const matrisXml = xlsxSayfaXml(matris.tampon);
  assert.match(matrisXml, /ISO 9001 Farkındalık Eğitimi/);
  assert.match(matrisXml, /Ayşe Yıldız/);
  assert.match(matrisXml, /Katıldı \(90\)/);
});

// ---------------------------------------------------------------------------
// Boş veri, geçersiz filtreler ve yetki
// ---------------------------------------------------------------------------

test('eğitim raporu boş yılda dahi geçerli başlık-only CSV/XLSX üretir', async () => {
  await adminGiris();

  const bosYil = 2099;
  const csv = await ikiliAl(`/raporlar/egitim.csv?yil=${bosYil}`);
  assert.equal(csv.durum, 200);
  const csvSatirlari = satirlar(csvMetni(csv.tampon));
  assert.equal(csvSatirlari.length, 1, 'eğitim olmayan yılda yalnızca başlık satırı olmalı');
  assert.match(csvSatirlari[0], /^Eğitim;Tür;Tarih;/);

  const xlsx = await ikiliAl(`/raporlar/egitim.xlsx?yil=${bosYil}`);
  assert.equal(xlsx.durum, 200);
  assert.deepEqual([...xlsx.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const xml = xlsxSayfaXml(xlsx.tampon);
  assert.match(xml, /Eğitim/);
  assert.doesNotMatch(xml, /ISO 9001 Farkındalık Eğitimi/);

  const matris = await ikiliAl(`/raporlar/egitim.csv?yil=${bosYil}&gorunum=matris`);
  assert.equal(matris.durum, 200);
  assert.equal(satirlar(csvMetni(matris.tampon)).length, 1);
});

test('geçersiz filtre değerleri 400/500 yerine tüm veriye döner', async () => {
  await adminGiris();

  const dokuman = await sayfaAl(
    sunucu.base,
    '/raporlar/dokumanlar?tur=ZZ&departman=999999&q='
  );
  assert.equal(dokuman.durum, 200);
  assert.match(dokuman.metin, /PR-101/);

  const okundu = await sayfaAl(
    sunucu.base,
    '/raporlar/okundu-onayi?dokuman=999999&departman=abc&durum=gecersiz&gorunum=xyz'
  );
  assert.equal(okundu.durum, 200);
  assert.match(okundu.metin, /Okundu Onayı Matrisi/);
  assert.match(okundu.metin, /PR-101/);

  const egitim = await sayfaAl(sunucu.base, '/raporlar/egitim?yil=abc&durum=gecersiz');
  assert.equal(egitim.durum, 200);
  assert.match(egitim.metin, /Yıllık Eğitim Matrisi/);
  assert.match(egitim.metin, /ISO 9001 Farkındalık Eğitimi/);
});

test('standart kullanıcı raporlarda ve dışa aktarmalarda 403 alır; kalite kullanıcısı 200 alır', async () => {
  await kisiGiris('saha@ornek.com', 'Standart123!');

  for (const yol of [
    '/raporlar',
    '/raporlar/dokumanlar',
    '/raporlar/dokumanlar.csv',
    '/raporlar/okundu-onayi',
    '/raporlar/okundu-onayi.xlsx',
    '/raporlar/egitim',
    '/raporlar/egitim.xlsx',
  ]) {
    const yanit = await sayfaAl(sunucu.base, yol);
    assert.equal(yanit.durum, 403, `${yol} standart kullanıcıya 403 dönmeli`);
    assert.match(yanit.metin, /yetkiniz yok/);
  }

  await kisiGiris('kalite@ornek.com', 'Kalite123!');

  for (const yol of ['/raporlar', '/raporlar/dokumanlar', '/raporlar/okundu-onayi', '/raporlar/egitim']) {
    const yanit = await sayfaAl(sunucu.base, yol);
    assert.equal(yanit.durum, 200, `${yol} kalite kullanıcısına açık olmalı`);
  }

  const csv = await ikiliAl('/raporlar/dokumanlar.csv');
  assert.equal(csv.durum, 200);
  assert.match(String(csv.icerikTuru), /^text\/csv/);

  const xlsx = await ikiliAl('/raporlar/egitim.xlsx');
  assert.equal(xlsx.durum, 200);
  assert.deepEqual([...xlsx.tampon.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});
