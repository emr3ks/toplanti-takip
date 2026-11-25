'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
let kaliteId;
let gozlemciId;

let prId;
let tlId;

let dofAId;
let dofBId;
let aksiyon1Id;
let aksiyon2Id;

const BUGUN = bugunTz('Europe/Istanbul');
const BU_YIL = Number(BUGUN.slice(0, 4));
const GECMIS = gunEkle(BUGUN, -5);
const GELECEK = gunEkle(BUGUN, 10);

function db() {
  return ortam.db;
}

function dofSayisi() {
  return db().prepare('SELECT COUNT(*) AS sayi FROM dof_kayitlari').get().sayi;
}

function dofGetir(kodVeyaId) {
  if (typeof kodVeyaId === 'string') {
    return db().prepare('SELECT * FROM dof_kayitlari WHERE kod = ?').get(kodVeyaId);
  }
  return db().prepare('SELECT * FROM dof_kayitlari WHERE id = ?').get(kodVeyaId);
}

function aksiyonGetir(id) {
  return db().prepare('SELECT * FROM dof_aksiyonlari WHERE id = ?').get(id);
}

function dokumanEkle({ kod, turKod, baslik, durum = 'yayinda' }) {
  const bilgi = db()
    .prepare(
      `INSERT INTO dokumanlar (kod, tur_kod, baslik, revizyon, durum, icerik)
       VALUES (?, ?, ?, 0, ?, '[]')`
    )
    .run(kod, turKod, baslik, durum);
  return Number(bilgi.lastInsertRowid);
}

async function adminGiris() {
  const sonuc = await girisYap(sunucu.base);
  assert.equal(sonuc.durum, 303, 'admin girişi başarılı olmalı');
}

async function kisiGiris(email, sifre) {
  const sonuc = await girisYap(sunucu.base, email, sifre);
  assert.equal(sonuc.durum, 303, `${email} girişi başarılı olmalı`);
}

/** İkili yanıtları (PDF/CSV/XLSX/kanıt) çerezle indirir. */
async function ikiliAl(yol) {
  const yanit = await fetch(`${sunucu.base}${yol}`, {
    headers: cerezliBasliklar(sunucu.base),
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    icerikTuru: yanit.headers.get('content-type'),
    duzen: yanit.headers.get('content-disposition'),
    tampon: Buffer.from(await yanit.arrayBuffer()),
  };
}

/** Kanıt dosyası gibi çok parçalı (multipart/form-data) form gönderir. */
async function dosyaliPost(yol, alanlar, dosya = null) {
  const govde = new FormData();
  for (const [ad, deger] of Object.entries(alanlar)) {
    if (deger === undefined || deger === null) continue;
    govde.append(ad, String(deger));
  }
  if (dosya) {
    govde.append('kanit', new Blob([dosya.icerik], { type: dosya.tur }), dosya.ad);
  }
  const yanit = await fetch(`${sunucu.base}${yol}`, {
    method: 'POST',
    headers: cerezliBasliklar(sunucu.base),
    body: govde,
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    konum: yanit.headers.get('location'),
    metin: await yanit.text(),
  };
}

function doluDofFormu(ek = {}) {
  return {
    tur: 'duzeltici',
    kaynak: 'musteri_sikayeti',
    departman_id: String(uretimId),
    talep_eden: 'Müşteri Kalite Ekibi',
    tespit_tarihi: GECMIS,
    dokuman_id: String(tlId),
    uygunsuzluk_tanimi:
      'Müşteri sevkiyatında ürünlerin yüzeyinde çizik tespit edildi. Etkilenen parti sevkiyat öncesi kontrol edilmemiş.',
    ...ek,
  };
}

test.before(async () => {
  ortam = testOrtami();
  uretimId = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Üretim').id;
  bakimId = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Bakım').id;
  kaliteDepartmanId = db()
    .prepare('SELECT id FROM departmanlar WHERE ad = ?')
    .get('Kalite Güvence').id;

  adminId = db().prepare('SELECT id FROM kullanicilar WHERE email = ?').get('admin@qdms.local').id;
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
  kaliteId = kullaniciOlustur(db(), {
    ad: 'Kalite Yöneticisi',
    email: 'kalite@ornek.com',
    sifre: 'Kalite123!',
    rol: 'kalite',
    departmanId: kaliteDepartmanId,
  });
  gozlemciId = kullaniciOlustur(db(), {
    ad: 'Gözlemci Personel',
    email: 'gozlemci@ornek.com',
    sifre: 'Standart123!',
    rol: 'kullanici',
    departmanId: bakimId,
  });

  prId = dokumanEkle({
    kod: 'PR-001',
    turKod: 'PR',
    baslik: 'Kalite Kayıtlarının Kontrolü Prosedürü',
  });
  tlId = dokumanEkle({
    kod: 'TL-001',
    turKod: 'TL',
    baslik: 'Paketleme ve Sevkiyat Talimatı',
  });

  sunucu = await sunucuBaslat(ortam.app);
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

test('DÖF tabloları, sütunları ve şema sürümü hazırdır', () => {
  const tablolar = db()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('dof_kayitlari', 'dof_aksiyonlari')"
    )
    .all()
    .map((satir) => satir.name)
    .sort();
  assert.deepEqual(tablolar, ['dof_aksiyonlari', 'dof_kayitlari']);

  const dofKolonlari = db()
    .prepare('PRAGMA table_info(dof_kayitlari)')
    .all()
    .map((satir) => satir.name);
  for (const kolon of [
    'kod',
    'tur',
    'kaynak',
    'departman_id',
    'talep_eden',
    'tespit_tarihi',
    'uygunsuzluk_tanimi',
    'dokuman_id',
    'kok_neden',
    'acil_onlem',
    'durum',
    'etkinlik_degerlendirmesi',
    'kapatan_id',
    'kapanis_tarihi',
  ]) {
    assert.ok(dofKolonlari.includes(kolon), `${kolon} sütunu bulunmalı`);
  }

  const aksiyonKolonlari = db()
    .prepare('PRAGMA table_info(dof_aksiyonlari)')
    .all()
    .map((satir) => satir.name);
  for (const kolon of [
    'dof_id',
    'sira',
    'aciklama',
    'sorumlu_id',
    'hedef_tarih',
    'durum',
    'kanit_aciklama',
    'kanit_dosya',
    'kanit_dosya_adi',
    'tamamlanma_tarihi',
  ]) {
    assert.ok(aksiyonKolonlari.includes(kolon), `${kolon} sütunu bulunmalı`);
  }

  assert.equal(db().prepare('PRAGMA user_version').get().user_version, 6);
});

test('GET /dof DÖF ana listesini ve özet sayaçları gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/dof');
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /DÖF Yönetimi/);
  assert.match(sayfa.metin, /DÖF Ana Listesi/);
  assert.match(sayfa.metin, /\+ Yeni DÖF/);
  assert.match(sayfa.metin, /Açık DÖF/);
  assert.match(sayfa.metin, /Geciken DÖF/);
  assert.match(sayfa.metin, /CSV İndir/);
  assert.match(sayfa.metin, /Excel İndir/);
});

test('GET /dof/yeni otomatik kod önizlemesini ve zorunlu alanları gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, '/dof/yeni');
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, new RegExp(`DOF-${BU_YIL}-001`));
  assert.match(sayfa.metin, /name="uygunsuzluk_tanimi"/);
  assert.match(sayfa.metin, /name="kaynak"/);
  assert.match(sayfa.metin, /name="departman_id"/);
  assert.match(sayfa.metin, /Düzeltici Faaliyet/);
  assert.match(sayfa.metin, /Önleyici Faaliyet/);
});

test('standart kullanıcı DÖF oluşturamaz ve dışa aktarma alamaz', async () => {
  await kisiGiris('saha@ornek.com', 'Standart123!');
  const yeni = await sayfaAl(sunucu.base, '/dof/yeni');
  assert.equal(yeni.durum, 403);

  const once = dofSayisi();
  const kayit = await formPost(sunucu.base, '/dof/yeni', doluDofFormu());
  assert.equal(kayit.durum, 403);
  assert.equal(dofSayisi(), once, 'yetkisiz kullanıcı DÖF oluşturmamalı');

  const csv = await ikiliAl('/dof/disa-aktarma.csv');
  assert.equal(csv.durum, 403);
});

test('geçersiz DÖF kaydı reddedilir ve kayıt oluşmaz', async () => {
  await adminGiris();
  const once = dofSayisi();
  const yanit = await formPost(
    sunucu.base,
    '/dof/yeni',
    doluDofFormu({ uygunsuzluk_tanimi: 'kısa' })
  );
  assert.equal(yanit.durum, 303);
  assert.match(String(yanit.konum), /hata=/);
  assert.equal(dofSayisi(), once);
});

test('DÖF otomatik kodla oluşturulur; departmana bildirim ve e-posta gider', async () => {
  await adminGiris();
  const yanit = await formPost(sunucu.base, '/dof/yeni', doluDofFormu());
  assert.equal(yanit.durum, 303);
  dofAId = yolKimlik(yanit.konum, /\/dof\/(\d+)/);
  assert.ok(dofAId, 'yönlendirme DÖF kimliği içermeli');

  const kayit = dofGetir(dofAId);
  assert.equal(kayit.kod, `DOF-${BU_YIL}-001`);
  assert.equal(kayit.tur, 'duzeltici');
  assert.equal(kayit.kaynak, 'musteri_sikayeti');
  assert.equal(kayit.durum, 'acik');
  assert.equal(kayit.departman_id, uretimId);
  assert.equal(kayit.dokuman_id, tlId);
  assert.equal(kayit.olusturan_id, adminId);

  const bildirim = db()
    .prepare("SELECT COUNT(*) AS sayi FROM bildirimler WHERE kullanici_id = ? AND tur = 'dof'")
    .get(sahaId);
  assert.ok(bildirim.sayi >= 1, 'ilgili departman personeline uygulama bildirimi gitmeli');

  const eposta = db()
    .prepare(
      "SELECT COUNT(*) AS sayi FROM email_kayitlari WHERE tur = 'dof_acildi' AND alici = 'saha@ornek.com'"
    )
    .get();
  assert.equal(eposta.sayi, 1, 'DÖF açılışında test modunda e-posta kaydı oluşmalı');
});

test('DÖF kodları yıl içinde sırayla artar', async () => {
  await adminGiris();
  const yanit = await formPost(
    sunucu.base,
    '/dof/yeni',
    doluDofFormu({
      tur: 'onleyici',
      kaynak: 'ic_tetkik',
      uygunsuzluk_tanimi:
        'İç tetkikte bakım planındaki yağlama periyotlarının tanımlı olmadığı tespit edildi. Tekrar oluşma riski bulunuyor.',
    })
  );
  assert.equal(yanit.durum, 303);
  dofBId = yolKimlik(yanit.konum, /\/dof\/(\d+)/);
  const kayit = dofGetir(dofBId);
  assert.equal(kayit.kod, `DOF-${BU_YIL}-002`);
  assert.equal(kayit.durum, 'acik');
});

test('DÖF detayı künyeyi, akışı, aksiyon planını ve PDF bağlantısını gösterir', async () => {
  await adminGiris();
  const sayfa = await sayfaAl(sunucu.base, `/dof/${dofAId}`);
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /DOF-\d{4}-001/);
  assert.match(sayfa.metin, /Uygunsuzluk Tanımı/);
  assert.match(sayfa.metin, /Kök Neden Analizi ve Acil Önlem/);
  assert.match(sayfa.metin, /Aksiyon Planı/);
  assert.match(sayfa.metin, /Etkinlik Kontrolü ve Kapanış/);
  assert.match(sayfa.metin, new RegExp(`/dof/${dofAId}/pdf`));
  assert.match(sayfa.metin, /Durum Akışı/);
});

test('kök neden ve acil önlem kaydedilir; durum kök neden aşamasına geçer', async () => {
  await adminGiris();
  const yanit = await formPost(sunucu.base, `/dof/${dofAId}/kok-neden`, {
    kok_neden:
      '5 Neden: Paketleme sırasında parçalar birbirine temas ediyor; ara katman koruma yok; talimatta adım tanımlı değil. Kök neden: paketleme sürecinin risk analizine dahil edilmemesi.',
    acil_onlem: 'Etkilenen parti yeniden paketlendi ve %100 yüzey kontrolü başlatıldı.',
  });
  assert.equal(yanit.durum, 303);
  const kayit = dofGetir(dofAId);
  assert.equal(kayit.durum, 'kok_neden');
  assert.match(kayit.kok_neden, /Kök neden/);
  assert.match(kayit.acil_onlem, /yüzey kontrolü/);
});

test('aksiyonlar eklenir; sorumluya bildirim/e-posta gider ve geciken hesaplanır', async () => {
  await adminGiris();
  const ilk = await formPost(sunucu.base, `/dof/${dofAId}/aksiyonlar`, {
    aciklama: 'Paketleme talimatına ara katman koruma adımı eklenecek.',
    sorumlu_id: String(sahaId),
    hedef_tarih: GECMIS,
    durum: 'acik',
    kanit_aciklama: 'Talimat taslağı hazır.',
  });
  assert.equal(ilk.durum, 303);
  aksiyon1Id = db()
    .prepare('SELECT id FROM dof_aksiyonlari WHERE dof_id = ? ORDER BY id ASC LIMIT 1')
    .get(dofAId).id;

  const aksiyon1 = aksiyonGetir(aksiyon1Id);
  assert.equal(aksiyon1.sorumlu_id, sahaId);
  assert.equal(aksiyon1.durum, 'acik');
  assert.equal(aksiyon1.hedef_tarih, GECMIS);

  const bildirim = db()
    .prepare(
      "SELECT COUNT(*) AS sayi FROM bildirimler WHERE kullanici_id = ? AND tur = 'dof' AND baslik LIKE '%aksiyon%'"
    )
    .get(sahaId);
  assert.ok(bildirim.sayi >= 1, 'aksiyon sorumlusuna uygulama bildirimi gitmeli');

  const eposta = db()
    .prepare(
      "SELECT COUNT(*) AS sayi FROM email_kayitlari WHERE tur = 'dof_aksiyon' AND alici = 'saha@ornek.com'"
    )
    .get();
  assert.equal(eposta.sayi, 1, 'aksiyon atamasında test modunda e-posta kaydı oluşmalı');

  const ikinci = await formPost(sunucu.base, `/dof/${dofAId}/aksiyonlar`, {
    aciklama: 'Sevkiyat öncesi yüzey kontrol listesi oluşturulacak.',
    sorumlu_id: String(bakimciId),
    hedef_tarih: GELECEK,
    durum: 'devam_ediyor',
    kanit_aciklama: '',
  });
  assert.equal(ikinci.durum, 303);
  aksiyon2Id = db()
    .prepare('SELECT id FROM dof_aksiyonlari WHERE dof_id = ? ORDER BY id DESC LIMIT 1')
    .get(dofAId).id;
  assert.equal(
    db().prepare('SELECT COUNT(*) AS sayi FROM dof_aksiyonlari WHERE dof_id = ?').get(dofAId).sayi,
    2
  );

  const geciken = await sayfaAl(sunucu.base, '/dof?geciken=1');
  assert.equal(geciken.durum, 200);
  assert.match(geciken.metin, new RegExp(`DOF-${BU_YIL}-001`));
});

test('kanıt dosyası yüklenir ve yetkili kullanıcı indirir', async () => {
  await adminGiris();
  const mevcut = aksiyonGetir(aksiyon1Id);
  const yanit = await dosyaliPost(
    `/dof/${dofAId}/aksiyonlar/${aksiyon1Id}`,
    {
      aciklama: mevcut.aciklama,
      sorumlu_id: String(sahaId),
      hedef_tarih: GECMIS,
      durum: 'acik',
      kanit_aciklama: 'Talimat taslağı eklendi.',
    },
    { ad: 'kanit.txt', tur: 'text/plain', icerik: 'kanit icerigi: paketleme talimati' }
  );
  assert.equal(yanit.durum, 303);

  const guncel = aksiyonGetir(aksiyon1Id);
  assert.ok(guncel.kanit_dosya, 'kanıt dosyası kaydedilmeli');
  assert.equal(guncel.kanit_dosya_adi, 'kanit.txt');

  const indirme = await ikiliAl(`/dof/${dofAId}/aksiyonlar/${aksiyon1Id}/kanit`);
  assert.equal(indirme.durum, 200);
  assert.match(String(indirme.icerikTuru), /text\/plain/);
  assert.match(indirme.tampon.toString('utf8'), /kanit icerigi/);
});

test('sorumlu kendi aksiyonunu günceller; başkasının aksiyonunu güncelleyemez', async () => {
  await kisiGiris('saha@ornek.com', 'Standart123!');
  const kendi = await formPost(sunucu.base, `/dof/${dofAId}/aksiyonlar/${aksiyon1Id}`, {
    durum: 'tamamlandi',
    kanit_aciklama: 'Talimat yayınlandı, eğitim kaydı eklendi.',
  });
  assert.equal(kendi.durum, 303);
  const aksiyon1 = aksiyonGetir(aksiyon1Id);
  assert.equal(aksiyon1.durum, 'tamamlandi');
  assert.ok(aksiyon1.tamamlanma_tarihi, 'tamamlanma tarihi yazılmalı');
  assert.equal(dofGetir(dofAId).durum, 'kok_neden', 'diğer aksiyon açıkken DÖF kapanmamalı');

  const baskasi = await formPost(sunucu.base, `/dof/${dofAId}/aksiyonlar/${aksiyon2Id}`, {
    durum: 'tamamlandi',
    kanit_aciklama: 'Yetkisiz deneme.',
  });
  assert.equal(baskasi.durum, 403);
  assert.equal(aksiyonGetir(aksiyon2Id).durum, 'devam_ediyor');
});

test('tüm aksiyonlar tamamlanınca DÖF etkinlik kontrolüne geçer', async () => {
  await adminGiris();
  const aksiyon2 = aksiyonGetir(aksiyon2Id);
  const yanit = await formPost(sunucu.base, `/dof/${dofAId}/aksiyonlar/${aksiyon2Id}`, {
    aciklama: aksiyon2.aciklama,
    sorumlu_id: String(bakimciId),
    hedef_tarih: GELECEK,
    durum: 'tamamlandi',
    kanit_aciklama: 'Kontrol listesi yayınlandı.',
  });
  assert.equal(yanit.durum, 303);
  assert.equal(dofGetir(dofAId).durum, 'etkinlik_bekliyor');

  const sayfa = await sayfaAl(sunucu.base, `/dof/${dofAId}`);
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Etkinlik Değerlendirmesiyle DÖF'ü Kapat/);
});

test('DÖF yalnızca etkinlik notuyla ve yetkili kullanıcı tarafından kapatılır', async () => {
  await kisiGiris('saha@ornek.com', 'Standart123!');
  const yetkisiz = await formPost(sunucu.base, `/dof/${dofAId}/kapat`, {
    etkinlik_degerlendirmesi: 'Yetkisiz kullanıcı denemesi.',
  });
  assert.equal(yetkisiz.durum, 403);

  await kisiGiris('kalite@ornek.com', 'Kalite123!');
  const kisa = await formPost(sunucu.base, `/dof/${dofAId}/kapat`, {
    etkinlik_degerlendirmesi: 'kısa',
  });
  assert.equal(kisa.durum, 303);
  assert.match(String(kisa.konum), /hata=/);
  assert.equal(dofGetir(dofAId).durum, 'etkinlik_bekliyor');

  const yanit = await formPost(sunucu.base, `/dof/${dofAId}/kapat`, {
    etkinlik_degerlendirmesi:
      'Paketleme talimatı güncellendi, ara katman koruma adımı uygulanıyor. Son üç sevkiyatta yüzey çiziği tekrarlamadı; etkinlik doğrulandı.',
  });
  assert.equal(yanit.durum, 303);
  const kayit = dofGetir(dofAId);
  assert.equal(kayit.durum, 'kapandi');
  assert.equal(kayit.kapatan_id, kaliteId);
  assert.ok(kayit.kapanis_tarihi, 'kapanış tarihi yazılmalı');
  assert.match(kayit.etkinlik_degerlendirmesi, /etkinlik doğrulandı/);

  const detay = await sayfaAl(sunucu.base, `/dof/${dofAId}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, /Kapandı/);
  assert.match(detay.metin, /etkinlik doğrulandı/);
});

test('kapanmış DÖF yeniden kapatılamaz ve künyesi düzenlenemez', async () => {
  await adminGiris();
  const tekrar = await formPost(sunucu.base, `/dof/${dofAId}/kapat`, {
    etkinlik_degerlendirmesi: 'Tekrar kapatma denemesi yeterince uzun bir metin.',
  });
  assert.equal(tekrar.durum, 303);
  assert.match(String(tekrar.konum), /hata=/);

  const duzenle = await formPost(sunucu.base, `/dof/${dofAId}`, doluDofFormu());
  assert.equal(duzenle.durum, 303);
  assert.match(String(duzenle.konum), /hata=/);
  assert.equal(dofGetir(dofAId).kod, `DOF-${BU_YIL}-001`);
});

test('DÖF raporu PDF olarak üretilir', async () => {
  await adminGiris();
  const pdf = await ikiliAl(`/dof/${dofAId}/pdf`);
  assert.equal(pdf.durum, 200);
  assert.match(String(pdf.icerikTuru), /application\/pdf/);
  assert.equal(pdf.tampon.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.tampon.length > 2000, 'PDF anlamlı büyüklükte olmalı');

  const indir = await ikiliAl(`/dof/${dofAId}/pdf?indir=1`);
  assert.equal(indir.durum, 200);
  assert.match(String(indir.duzen), /attachment/);
});

test('DÖF raporu şirket logosunu PDF antetine gömer', async () => {
  await adminGiris();
  const logoKok = path.join(ortam.dir, 'yuklemeler', 'logo');
  fs.mkdirSync(logoKok, { recursive: true });
  fs.writeFileSync(
    path.join(logoKok, 'dof-test-logo.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
  );
  db()
    .prepare(
      `INSERT INTO ayarlar (anahtar, deger) VALUES ('sirket_logo', ?)
       ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger`
    )
    .run('dof-test-logo.png');
  try {
    const pdf = await ikiliAl(`/dof/${dofAId}/pdf`);
    assert.equal(pdf.durum, 200);
    assert.ok(
      pdf.tampon.includes(Buffer.from('/Subtype /Image')),
      'şirket logosu PDF içine görsel nesnesi olarak gömülmeli'
    );
  } finally {
    db().prepare("DELETE FROM ayarlar WHERE anahtar = 'sirket_logo'").run();
  }
});

test('DÖF listesi CSV ve XLSX olarak dışa aktarılır', async () => {
  await adminGiris();
  const csv = await ikiliAl('/dof/disa-aktarma.csv');
  assert.equal(csv.durum, 200);
  assert.match(String(csv.icerikTuru), /text\/csv/);
  assert.deepEqual([...csv.tampon.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvMetni = csv.tampon.toString('utf8');
  assert.match(csvMetni, /DÖF No/);
  assert.match(csvMetni, new RegExp(`DOF-${BU_YIL}-001`));
  assert.match(csvMetni, /Kapandı/);

  const xlsx = await ikiliAl('/dof/disa-aktarma.xlsx');
  assert.equal(xlsx.durum, 200);
  assert.match(
    String(xlsx.icerikTuru),
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
  );
  assert.equal(xlsx.tampon.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(xlsx.tampon.length > 1000);
});

test('dashboard açık ve geciken DÖF özet kartını gösterir', async () => {
  await adminGiris();
  // İkinci DÖF'e hedef tarihi geçmiş, tamamlanmamış bir aksiyon ekleyerek gecikme üret.
  const action = await formPost(sunucu.base, `/dof/${dofBId}/aksiyonlar`, {
    aciklama: 'Bakım planı yağlama periyotları güncellenecek.',
    sorumlu_id: String(bakimciId),
    hedef_tarih: GECMIS,
    durum: 'acik',
    kanit_aciklama: '',
  });
  assert.equal(action.durum, 303);
  assert.equal(dofGetir(dofBId).durum, 'kok_neden');

  const sayfa = await sayfaAl(sunucu.base, '/');
  assert.equal(sayfa.durum, 200);
  assert.match(sayfa.metin, /Açık ve Geciken DÖF'ler/);
  assert.match(sayfa.metin, /Geciken DÖF/);
});

test('standart kullanıcı yalnızca erişebildiği DÖF kayıtlarını görür', async () => {
  await kisiGiris('gozlemci@ornek.com', 'Standart123!');
  const baskaDepartman = await sayfaAl(sunucu.base, `/dof/${dofAId}`);
  assert.equal(baskaDepartman.durum, 404);
  const liste = await sayfaAl(sunucu.base, '/dof');
  assert.equal(liste.durum, 200);
  assert.doesNotMatch(liste.metin, new RegExp(`href="/dof/${dofAId}"`));

  await kisiGiris('saha@ornek.com', 'Standart123!');
  const kendiDepartmani = await sayfaAl(sunucu.base, `/dof/${dofBId}`);
  assert.equal(kendiDepartmani.durum, 200);
  assert.doesNotMatch(kendiDepartmani.metin, /Yeni aksiyon ekle/);
  assert.doesNotMatch(kendiDepartmani.metin, /DÖF künyesini düzenle/);
});

test('DÖF listesi durum ve tür filtreleriyle daraltılır', async () => {
  await adminGiris();
  const kapali = await sayfaAl(sunucu.base, '/dof?durum=kapandi');
  assert.equal(kapali.durum, 200);
  assert.match(kapali.metin, new RegExp(`href="/dof/${dofAId}"`));
  assert.doesNotMatch(kapali.metin, new RegExp(`href="/dof/${dofBId}"`));

  const onleyici = await sayfaAl(sunucu.base, '/dof?tur=onleyici');
  assert.equal(onleyici.durum, 200);
  assert.match(onleyici.metin, new RegExp(`href="/dof/${dofBId}"`));
  assert.doesNotMatch(onleyici.metin, new RegExp(`href="/dof/${dofAId}"`));
});

test('DÖF künyesi yetkili kullanıcı tarafından güncellenebilir', async () => {
  await adminGiris();
  const yanit = await formPost(sunucu.base, `/dof/${dofBId}`, {
    tur: 'onleyici',
    kaynak: 'ic_tetkik',
    departman_id: String(bakimId),
    talep_eden: 'İç Tetkik Ekibi (güncel)',
    tespit_tarihi: BUGUN,
    dokuman_id: String(prId),
    uygunsuzluk_tanimi:
      'İç tetkikte bakım planındaki yağlama periyotlarının tanımlı olmadığı görüldü; plan güncellendi.',
  });
  assert.equal(yanit.durum, 303);
  const kayit = dofGetir(dofBId);
  assert.equal(kayit.departman_id, bakimId);
  assert.equal(kayit.talep_eden, 'İç Tetkik Ekibi (güncel)');
  assert.equal(kayit.dokuman_id, prId);
  assert.equal(kayit.kod, `DOF-${BU_YIL}-002`, 'düzenleme kodu değiştirmemeli');
});

test('DÖF PDF erişimi kayıt görünürlüğüne göre korunur', async () => {
  await kisiGiris('gozlemci@ornek.com', 'Standart123!');
  const yasak = await ikiliAl(`/dof/${dofAId}/pdf`);
  assert.equal(yasak.durum, 404);
});
