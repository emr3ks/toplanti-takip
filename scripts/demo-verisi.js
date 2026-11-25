'use strict';

/**
 * QDMS ekran görüntüleri ve hızlı deneme için örnek veri oluşturur.
 *   npm run demo
 *   npm run demo -- --sifirla
 */

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { bugunTz, gunEkle, tarihTr } = require('../src/dates');
const { ayarlariKaydet, etkinAyarlar, sirketAyarlariKaydet } = require('../src/settings');
const { kullaniciOlustur, VARSAYILAN_ADMIN } = require('../src/auth');
const qdms = require('../src/qdms');
const tetkik = require('../src/tetkik');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const sifirla = process.argv.includes('--sifirla');
const mevcut =
  db.prepare('SELECT COUNT(*) AS sayi FROM dokumanlar').get().sayi +
  db.prepare('SELECT COUNT(*) AS sayi FROM ic_tetkikler').get().sayi;

if (mevcut > 0 && !sifirla) {
  console.log('');
  console.log('Veritabanında zaten doküman kayıtları var.');
  console.log('Örnek verileri yeniden oluşturmak için: npm run demo -- --sifirla');
  console.log(`Veritabanı: ${config.dbPath}`);
  console.log('');
  process.exit(0);
}

if (sifirla) {
  db.exec(`
    DELETE FROM ic_tetkik_bulgulari;
    DELETE FROM ic_tetkik_maddeleri;
    DELETE FROM ic_tetkik_denetcileri;
    DELETE FROM ic_tetkikler;
    DELETE FROM aktivite_loglari WHERE modul = 'tetkik';
    DELETE FROM ic_tetkik_checklist_maddeleri
      WHERE checklist_id IN (
        SELECT id FROM ic_tetkik_checklistleri
        WHERE kod NOT IN ('CL-ISO-001', 'CL-KI-001')
      );
    DELETE FROM ic_tetkik_checklistleri
      WHERE kod NOT IN ('CL-ISO-001', 'CL-KI-001');
    DELETE FROM dof_aksiyonlari;
    DELETE FROM dof_kayitlari;
    DELETE FROM egitim_katilimcilari;
    DELETE FROM egitimler;
    DELETE FROM bildirimler;
    DELETE FROM dokuman_okumalari;
    DELETE FROM dokuman_onaylari;
    DELETE FROM dokuman_hedef_departmanlar;
    DELETE FROM dokumanlar;
    DELETE FROM oturumlar;
    DELETE FROM email_kayitlari;
    DELETE FROM kullanicilar;
  `);
  console.log('Mevcut doküman, DÖF, eğitim, iç tetkik, kullanıcı ve e-posta kayıtları temizlendi.');
}

const ayarlar = etkinAyarlar(db, config);
if (!ayarlar.smtp.host) {
  ayarlariKaydet(
    db,
    {
      smtp_host: 'smtp.gmail.com',
      smtp_port: '587',
      smtp_secure: '',
      smtp_user: 'demo@ornek.com',
      smtp_pass: '',
      smtp_from_email: 'demo@ornek.com',
      smtp_from_name: 'Örnek Sanayi QDMS',
      saat_dilimi: ayarlar.saatDilimi,
      test_modu: '1',
    },
    config
  );
}
sirketAyarlariKaydet(db, { ad: 'Örnek Sanayi A.Ş.' });

const bugun = bugunTz(ayarlar.saatDilimi);
const simdi = new Date().toISOString();

function gunOnce(gun) {
  return `${gunEkle(bugun, -gun)}T09:00:00.000Z`;
}

function departmanId(ad) {
  const satir = db.prepare('SELECT id FROM departmanlar WHERE ad = ? COLLATE NOCASE').get(ad);
  return satir ? satir.id : null;
}

const kaliteDepartman = departmanId('Kalite Güvence');
const uretimDepartman = departmanId('Üretim');
const bakimDepartman = departmanId('Bakım');
const satinAlmaDepartman = departmanId('Satın Alma');

function kullaniciEkle(ad, email, sifre, rol, departman) {
  const mevcutKullanici = db
    .prepare('SELECT * FROM kullanicilar WHERE email = ? COLLATE NOCASE')
    .get(email);
  if (mevcutKullanici) return mevcutKullanici.id;
  return kullaniciOlustur(db, {
    ad,
    email,
    sifre,
    rol,
    departmanId: departman,
    aktif: 1,
  });
}

const admin = kullaniciEkle(VARSAYILAN_ADMIN.ad, VARSAYILAN_ADMIN.email, VARSAYILAN_ADMIN.sifre, 'admin', kaliteDepartman);
const kalite = kullaniciEkle('Ayşe Yıldız', 'kalite@ornek.com', 'Kalite123!', 'kalite', kaliteDepartman);
const hazirlayan = kullaniciEkle('Elif Kaya', 'hazirlayan@ornek.com', 'Hazirlayan123!', 'hazirlayan', uretimDepartman);
const onaylayan = kullaniciEkle('Mert Demir', 'onaylayan@ornek.com', 'Onaylayan123!', 'onaylayan', kaliteDepartman);
const saha = kullaniciEkle('Burak Yılmaz', 'saha@ornek.com', 'Standart123!', 'kullanici', uretimDepartman);
const bakimci = kullaniciEkle('Zeynep Şahin', 'bakim@ornek.com', 'Standart123!', 'kullanici', bakimDepartman);

const ORNEK_BOLUM_METINLERI = {
  PR: [
    'Bu prosedürün amacı, kalite yönetim sistemi kapsamındaki kayıtların tanımlanması, saklanması, korunması ve imha edilmesine ilişkin yöntemi belirlemektir. Kayıtların eksiksiz ve izlenebilir tutulması hedeflenir.',
    'Bu prosedür; üretim, kalite, bakım ve satın alma birimlerinde oluşturulan tüm kalite kayıtlarını ve bu kayıtların elektronik kopyalarını kapsar. Müşteri şikâyetleri ve tedarikçi değerlendirme kayıtları da kapsam içindedir.',
    'Kalite Kaydı: Ürün, süreç veya sistemin kalitesini kanıtlayan doküman ve veri. Elektronik Kayıt: QDMS üzerinde saklanan sayısal kayıt. Saklama Süresi: Kaydın yasal ve kurumsal olarak tutulması gereken süre.',
    'Kalite Yöneticisi kayıt saklama sürelerini belirler ve listeyi güncel tutar. Süreç sahipleri kayıtların doğru ve eksiksiz oluşturulmasından, doküman kontrol yetkilisi arşiv düzeninden sorumludur. Tüm çalışanlar kendi iş adımlarında oluşan kayıtları eksiksiz doldurmakla yükümlüdür.',
    '1) Kayıt, ilgili form veya sistem ekranı kullanılarak oluşturulur.\n2) Kayıt oluşturulduktan sonra en geç iki iş günü içinde doküman kontrolüne iletilir.\n3) Elektronik kayıtlar okunabilir formatta QDMS üzerinde saklanır.\n4) Fiziksel kayıtlar kilitli dolaplarda, nem ve ışıktan korunacak şekilde muhafaza edilir.\n5) Saklama süresi dolan kayıtlar imha tutanağı ile imha edilir.',
    'İlgili Dokümanlar: Kalite El Kitabı (EK-001), Düzeltici Faaliyet Prosedürü (PR-002), Kayıt Saklama Listesi (LS-001).',
  ],
  TL: [
    'Bu talimatın amacı, CNC işleme merkezinin güvenli ve standartlara uygun biçimde kullanılmasını sağlamaktır.',
    'Bu talimat, üretim atölyesinde CNC tezgâhlarında görev yapan tüm operatörler ve bakım personeli için geçerlidir.',
    'Koruyucu gözlük, çelik burunlu ayakkabı ve iş eldiveni kullanılmalıdır. Tezgâh çalışırken kapak açılmamalı, takım değişimi yalnızca tezgâh durdurulduktan sonra yapılmalıdır. Acil durdurma butonunun yeri her vardiyada kontrol edilir.',
    '1) Tezgâhı açmadan önce yağ ve soğutma sıvısı seviyesini kontrol edin.\n2) Günlük bakım formunu doldurun.\n3) İş emrindeki programı tezgâha yükleyin.\n4) İlk parçayı ölçü kontrolüne gönderin.\n5) Vardiya sonunda tezgâhı temizleyin ve çalışma alanını düzenleyin.',
    'İlgili Dokümanlar: CNC Günlük Bakım Formu (FR-002), Üretim Prosedürü (PR-003), İş Güvenliği Talimatı (TL-004).',
  ],
  EK: [
    'Bu el kitabının amacı, şirketin kalite politikasını, hedeflerini ve kalite yönetim sisteminin temel yapısını tüm paydaşlara açıklamaktır.',
    'El kitabı, Örnek Sanayi A.Ş. bünyesindeki tüm birimleri ve üretim süreçlerini kapsar.',
    'Yönetim, müşteri memnuniyetini ve sürekli iyileştirmeyi temel ilke olarak benimser. Kalite hedefleri her yıl yönetim gözden geçirme toplantısında güncellenir ve tüm birimlere duyurulur.',
    'Kalite Yöneticisi sistemi kurmak ve sürdürmekle, süreç sahipleri ise kendi süreçlerinin performansını izlemekle sorumludur.',
    'Ana süreçler: müşteri talebinin alınması, tasarım ve geliştirme, satın alma, üretim, kalite kontrol, sevkiyat ve satış sonrası hizmet.',
    'Ekler: organizasyon şeması, süreç etkileşim şeması, kalite hedefleri tablosu.',
  ],
  LS: [
    'Bu listenin amacı, kritik tedarikçilerin düzenli olarak değerlendirilmesini ve performanslarının izlenmesini sağlamaktır.',
    'Liste, üretim için kritik hammadde ve hizmet sağlayan tedarikçileri kapsar.',
    'Değerlendirme; kalite, teslimat, fiyat ve iş birliği başlıklarında 1-5 puan üzerinden yapılır. 3 puan altındaki tedarikçiler için düzeltici faaliyet açılır.',
    'Liste, satın alma birimi tarafından üç ayda bir güncellenir ve Kalite Yöneticisi tarafından onaylanır.',
  ],
  FR: [
    'Bu form, tespit edilen bir uygunsuzluğun tanımlanması, kök nedeninin analizi ve düzeltici faaliyetlerin izlenmesi için kullanılır.',
    'Formu uygunsuzluğu tespit eden birim doldurur. Kalite birimi formu değerlendirir ve faaliyet sorumlularını atar.',
    'Uygunsuzluk tanımı, tespit tarihi, ilgili ürün/süreç, kök neden analizi, düzeltici faaliyet, sorumlu ve termin alanları zorunludur.',
    'Form, kalite yöneticisi onayından sonra kapatılır ve kayıt olarak arşivlenir.',
  ],
};

function ornekIcerik(turKod) {
  const sablon = qdms.sablonGetir(db, turKod);
  const metinler = ORNEK_BOLUM_METINLERI[turKod] || [];
  return sablon.bolumler.map((bolum, indeks) => ({
    baslik: bolum.baslik,
    metin: metinler[indeks] || `${bolum.baslik} bölümü için örnek açıklama metni.`,
  }));
}

function dokumanEkle({
  kod,
  turKod,
  baslik,
  aciklama,
  revizyon = 0,
  durum,
  hazirlayanId,
  onaylayanId = null,
  onayTarihi = null,
  yayinTarihi = null,
  degisiklikNotu = '',
  hedefDepartmanlar = [],
  olusturmaTarihi = simdi,
}) {
  const bilgi = db
    .prepare(
      `INSERT INTO dokumanlar
        (kod, tur_kod, baslik, aciklama, revizyon, durum, icerik, degisiklik_notu,
         hazirlayan_id, onaylayan_id, onay_tarihi, yayin_tarihi, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      kod,
      turKod,
      baslik,
      aciklama,
      revizyon,
      durum,
      JSON.stringify(ornekIcerik(turKod)),
      degisiklikNotu,
      hazirlayanId,
      onaylayanId,
      onayTarihi,
      yayinTarihi,
      olusturmaTarihi,
      simdi
    );
  const dokumanId = Number(bilgi.lastInsertRowid);
  const hedefEkle = db.prepare(
    'INSERT OR IGNORE INTO dokuman_hedef_departmanlar (dokuman_id, departman_id) VALUES (?, ?)'
  );
  for (const departman of hedefDepartmanlar) {
    if (departman) hedefEkle.run(dokumanId, departman);
  }
  return dokumanId;
}

function bildirimYaz(kullaniciId, tur, baslik, mesaj, dokumanId) {
  db.prepare(
    `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, dokuman_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(kullaniciId, tur, baslik, mesaj, `/dokumanlar/${dokumanId}`, dokumanId);
}

function onayGecmisiEkle(dokumanId, kullaniciId, islem, notMetni = '', tarih = simdi) {
  db.prepare(
    `INSERT INTO dokuman_onaylari (dokuman_id, kullanici_id, islem, not_metni, tarih)
     VALUES (?, ?, ?, ?, ?)`
  ).run(dokumanId, kullaniciId, islem, notMetni, tarih);
}

function okumaListesiHazirla(dokumanId, okunmusEmailler = []) {  const kisiler = db
    .prepare(
      `SELECT DISTINCT k.id, k.ad, k.email
       FROM dokuman_hedef_departmanlar h
       JOIN kullanicilar k ON k.departman_id = h.departman_id
       WHERE h.dokuman_id = ? AND k.aktif = 1`
    )
    .all(dokumanId);
  const ekle = db.prepare(
    'INSERT OR IGNORE INTO dokuman_okumalari (dokuman_id, kullanici_id, okundu, okunma_tarihi) VALUES (?, ?, ?, ?)'
  );
  const dokuman = db.prepare('SELECT kod, baslik, revizyon FROM dokumanlar WHERE id = ?').get(dokumanId);
  for (const kisi of kisiler) {
    const okundu = okunmusEmailler.includes(kisi.email) ? 1 : 0;
    ekle.run(dokumanId, kisi.id, okundu, okundu ? gunOnce(2) : null);
    if (!okundu) {
      bildirimYaz(
        kisi.id,
        'dokuman',
        `Yeni doküman yayınlandı: ${dokuman.kod}`,
        `${dokuman.baslik} · ${qdms.revizyonEtiketi(dokuman.revizyon)}. Okuyup "Okudum, Anladım" onayı vermeniz bekleniyor.`,
        dokumanId
      );
    }
  }
  return kisiler.length;
}

// Prosedür — arşivdeki eski revizyon
const pr001Eski = dokumanEkle({
  kod: 'PR-001',
  turKod: 'PR',
  baslik: 'Kalite Kayıtlarının Kontrolü Prosedürü',
  aciklama: 'Kalite kayıtlarının oluşturulması, saklanması ve imhası.',
  revizyon: 0,
  durum: 'iptal',
  hazirlayanId: hazirlayan,
  onaylayanId: admin,
  onayTarihi: gunOnce(180),
  yayinTarihi: gunOnce(180),
  hedefDepartmanlar: [uretimDepartman],
  olusturmaTarihi: gunOnce(190),
});
onayGecmisiEkle(pr001Eski, hazirlayan, 'olustur', 'İlk sürüm oluşturuldu.', gunOnce(190));
onayGecmisiEkle(pr001Eski, admin, 'onayla', 'İlk yayın onaylandı.', gunOnce(180));

// Prosedür — güncel revizyon (örnek okuma takibi ile)
const pr001 = dokumanEkle({
  kod: 'PR-001',
  turKod: 'PR',
  baslik: 'Kalite Kayıtlarının Kontrolü Prosedürü',
  aciklama: 'Kalite kayıtlarının oluşturulması, saklanması ve imhası.',
  revizyon: 1,
  durum: 'yayinda',
  hazirlayanId: hazirlayan,
  onaylayanId: kalite,
  onayTarihi: gunOnce(14),
  yayinTarihi: gunOnce(14),
  degisiklikNotu: 'Elektronik kayıtların saklama süresi ve QDMS üzerinden erişim adımları eklendi.',
  hedefDepartmanlar: [uretimDepartman, kaliteDepartman],
  olusturmaTarihi: gunOnce(20),
});
onayGecmisiEkle(pr001, hazirlayan, 'olustur', 'Rev.01 taslağı oluşturuldu.', gunOnce(20));
onayGecmisiEkle(pr001, hazirlayan, 'onaya_gonder', 'Kayıt saklama süreleri güncellendi.', gunOnce(16));
onayGecmisiEkle(pr001, kalite, 'onayla', 'Revizyon onaylandı ve yayınlandı.', gunOnce(14));
okumaListesiHazirla(pr001, ['admin@qdms.local', 'kalite@ornek.com', 'hazirlayan@ornek.com']);

// Talimat — yayında, kısmi okuma
const tl001 = dokumanEkle({
  kod: 'TL-001',
  turKod: 'TL',
  baslik: 'CNC Tezgâhı Kullanım Talimatı',
  aciklama: 'CNC işleme merkezinin güvenli kullanımı ve günlük bakımı.',
  durum: 'yayinda',
  hazirlayanId: hazirlayan,
  onaylayanId: onaylayan,
  onayTarihi: gunOnce(7),
  yayinTarihi: gunOnce(7),
  hedefDepartmanlar: [uretimDepartman, kaliteDepartman],
  olusturmaTarihi: gunOnce(12),
});
onayGecmisiEkle(tl001, hazirlayan, 'olustur', 'Talimat taslağı oluşturuldu.', gunOnce(12));
onayGecmisiEkle(tl001, hazirlayan, 'onaya_gonder', '', gunOnce(9));
onayGecmisiEkle(tl001, onaylayan, 'onayla', 'Güvenlik önlemleri yeterli bulundu.', gunOnce(7));
okumaListesiHazirla(tl001, ['hazirlayan@ornek.com']);

// Form — onay bekliyor
const fr001 = dokumanEkle({
  kod: 'FR-001',
  turKod: 'FR',
  baslik: 'Düzeltici Faaliyet Formu',
  aciklama: 'Uygunsuzluk ve düzeltici faaliyet kaydı.',
  durum: 'kontrol',
  hazirlayanId: hazirlayan,
  hedefDepartmanlar: [kaliteDepartman, uretimDepartman],
  olusturmaTarihi: gunOnce(3),
});
onayGecmisiEkle(fr001, hazirlayan, 'olustur', 'Form taslağı oluşturuldu.', gunOnce(3));
onayGecmisiEkle(fr001, hazirlayan, 'onaya_gonder', 'Kök neden alanı güncellendi; onaya sunuldu.', gunOnce(1));
bildirimYaz(
  onaylayan,
  'onay',
  'Onay bekleyen doküman: FR-001',
  'Düzeltici Faaliyet Formu · Rev.00 onayınızı bekliyor.',
  fr001
);
bildirimYaz(
  kalite,
  'onay',
  'Onay bekleyen doküman: FR-001',
  'Düzeltici Faaliyet Formu · Rev.00 onayınızı bekliyor.',
  fr001
);

// Liste — yayında, bakım personeline dağıtıldı
const ls001 = dokumanEkle({
  kod: 'LS-001',
  turKod: 'LS',
  baslik: 'Kritik Tedarikçi Listesi',
  aciklama: 'Kritik hammadde ve hizmet tedarikçilerinin değerlendirme listesi.',
  durum: 'yayinda',
  hazirlayanId: kalite,
  onaylayanId: admin,
  onayTarihi: gunOnce(3),
  yayinTarihi: gunOnce(3),
  hedefDepartmanlar: [satinAlmaDepartman, bakimDepartman],
  olusturmaTarihi: gunOnce(9),
});
onayGecmisiEkle(ls001, kalite, 'olustur', 'Tedarikçi listesi güncellendi.', gunOnce(9));
onayGecmisiEkle(ls001, admin, 'onayla', 'Liste onaylandı ve satın alma birimine dağıtıldı.', gunOnce(3));
okumaListesiHazirla(ls001, []);

// El kitabı — taslak
const ek001 = dokumanEkle({
  kod: 'EK-001',
  turKod: 'EK',
  baslik: 'Kalite El Kitabı',
  aciklama: 'Kalite politikası, organizasyon ve temel süreçler.',
  durum: 'taslak',
  hazirlayanId: hazirlayan,
  hedefDepartmanlar: [uretimDepartman, kaliteDepartman],
  olusturmaTarihi: gunOnce(1),
});
onayGecmisiEkle(ek001, hazirlayan, 'olustur', 'El kitabı taslağı oluşturuldu.', gunOnce(1));

// ---------------------------------------------------------------------------
// Eğitim Yönetimi örnekleri
// ---------------------------------------------------------------------------
function egitimEkle({
  ad,
  tur,
  egitmen,
  planlananTarih,
  sureSaat,
  dokumanId = null,
  aciklama = '',
  durum = 'planlandi',
  katilimcilar = [],
}) {
  const bilgi = db
    .prepare(
      `INSERT INTO egitimler
        (ad, tur, egitmen, planlanan_tarih, sure_saat, dokuman_id, aciklama, durum,
         olusturan_id, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ad, tur, egitmen, planlananTarih, sureSaat, dokumanId, aciklama, durum, kalite, simdi, simdi);
  const egitimId = Number(bilgi.lastInsertRowid);
  const ekle = db.prepare(
    `INSERT OR IGNORE INTO egitim_katilimcilari
      (egitim_id, kullanici_id, katilim_durumu, degerlendirme_puani, etkinlik_durumu,
       sertifika_no, not_metni, olusturma_tarihi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const kisi of katilimcilar) {
    ekle.run(
      egitimId,
      kisi.id,
      kisi.katilimDurumu || 'bekliyor',
      kisi.puan ?? null,
      kisi.etkinlik || 'bekliyor',
      kisi.sertifika || '',
      kisi.not || '',
      simdi
    );
    if (durum === 'planlandi') {
      db.prepare(
        `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, olusturma_tarihi)
         VALUES (?, 'egitim', ?, ?, ?, ?)`
      ).run(
        kisi.id,
        `Yeni eğitim: ${ad}`,
        `${tarihTr(planlananTarih)} · ${egitmen || 'Eğitmen belirtilmedi'}. Eğitim detayını görüntüleyin.`,
        `/egitim/${egitimId}`,
        simdi
      );
    }
  }
  return egitimId;
}

const egitimGecmis = egitimEkle({
  ad: 'Kalite Kayıtları ve Doküman Kontrolü Eğitimi',
  tur: 'ic',
  egitmen: 'Ayşe Yıldız',
  planlananTarih: gunOnce(10),
  sureSaat: 2,
  dokumanId: pr001,
  aciklama: 'Kalite kayıtlarının saklanması, doküman kontrolü ve okuma onayı süreci.',
  durum: 'tamamlandi',
  katilimcilar: [
    { id: hazirlayan, katilimDurumu: 'katildi', puan: 92, etkinlik: 'etkin', sertifika: 'EGT-2026-001' },
    { id: saha, katilimDurumu: 'katildi', puan: 84, etkinlik: 'etkin', sertifika: 'EGT-2026-002' },
    { id: bakimci, katilimDurumu: 'katilmadi', etkinlik: 'etkin_degil', not: 'Mazeret bildirdi.' },
  ],
});

const egitimYaklasan = egitimEkle({
  ad: 'İş Güvenliği ve Kişisel Koruyucu Donanım',
  tur: 'ic',
  egitmen: 'Mert Demir',
  planlananTarih: gunEkle(bugun, 5),
  sureSaat: 1.5,
  dokumanId: tl001,
  aciklama: 'CNC tezgâhı kullanımı ve kişisel koruyucu donanım kuralları.',
  katilimcilar: [
    { id: saha },
    { id: bakimci },
    { id: hazirlayan },
  ],
});

egitimEkle({
  ad: 'ISO 9001 İç Denetçi Eğitimi',
  tur: 'dis',
  egitmen: 'Dış Eğitim Kurumu',
  planlananTarih: gunOnce(45),
  sureSaat: 16,
  dokumanId: ek001,
  aciklama: 'İç denetim planlaması, kanıt toplama ve uygunsuzluk yönetimi.',
  durum: 'tamamlandi',
  katilimcilar: [
    { id: kalite, katilimDurumu: 'katildi', puan: 96, etkinlik: 'etkin', sertifika: 'ISO-IA-2026-014' },
    { id: admin, katilimDurumu: 'katildi', puan: 88, etkinlik: 'etkin', sertifika: 'ISO-IA-2026-015' },
    { id: onaylayan, katilimDurumu: 'katildi', puan: 90, etkinlik: 'etkin', sertifika: 'ISO-IA-2026-016' },
  ],
});

egitimEkle({
  ad: 'Ölçüm Cihazları ve Kalibrasyon Farkındalığı',
  tur: 'ic',
  egitmen: 'Ayşe Yıldız',
  planlananTarih: gunEkle(bugun, 21),
  sureSaat: 3,
  aciklama: 'Ölçüm cihazlarının izlenebilirliği ve kalibrasyon takvimi.',
  katilimcilar: [{ id: saha }, { id: bakimci }],
});

// ---------------------------------------------------------------------------
// DÖF (Düzeltici ve Önleyici Faaliyet) örnekleri
// ---------------------------------------------------------------------------
const dofYili = bugun.slice(0, 4);
let dofSira = 0;

function dofEkle({
  tur,
  kaynak,
  departmanId,
  talepEden,
  tespitTarihi,
  tanim,
  dokumanId = null,
  kokNeden = '',
  acilOnlem = '',
  durum = 'acik',
  etkinlikNotu = '',
  kapatanId = null,
  kapanisTarihi = null,
  aksiyonlar = [],
}) {
  dofSira += 1;
  const kod = `DOF-${dofYili}-${String(dofSira).padStart(3, '0')}`;
  const bilgi = db
    .prepare(
      `INSERT INTO dof_kayitlari
        (kod, tur, kaynak, departman_id, talep_eden, tespit_tarihi, uygunsuzluk_tanimi,
         dokuman_id, kok_neden, acil_onlem, durum, etkinlik_degerlendirmesi,
         kapatan_id, kapanis_tarihi, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      kod,
      tur,
      kaynak,
      departmanId,
      talepEden,
      tespitTarihi,
      tanim,
      dokumanId,
      kokNeden,
      acilOnlem,
      durum,
      etkinlikNotu,
      kapatanId,
      kapanisTarihi,
      kalite,
      simdi,
      simdi
    );
  const dofId = Number(bilgi.lastInsertRowid);
  const ekle = db.prepare(
    `INSERT INTO dof_aksiyonlari
      (dof_id, sira, aciklama, sorumlu_id, hedef_tarih, durum, kanit_aciklama,
       tamamlanma_tarihi, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  aksiyonlar.forEach((aksiyon, indeks) => {
    ekle.run(
      dofId,
      indeks + 1,
      aksiyon.aciklama,
      aksiyon.sorumluId,
      aksiyon.hedefTarih,
      aksiyon.durum || 'acik',
      aksiyon.kanitAciklama || '',
      aksiyon.durum === 'tamamlandi' ? gunOnce(1) : null,
      kalite,
      simdi,
      simdi
    );
  });
  return dofId;
}

const dofMusteri = dofEkle({
  tur: 'duzeltici',
  kaynak: 'musteri_sikayeti',
  departmanId: uretimDepartman,
  talepEden: 'Müşteri Kalite Ekibi',
  tespitTarihi: gunEkle(bugun, -18),
  tanim:
    'Müşteri sevkiyatında 12 adet üründe yüzey çiziği bildirildi. Etkilenen parti 2026-08 üretim dönemine ait ve sevkiyat öncesi yüzey kontrolünde izlenmemiş.',
  dokumanId: tl001,
  kokNeden:
    '5 Neden: Çizik neden oluşuyor? (1) Paketleme sırasında parçalar birbirine temas ediyor. (2) Ara katman koruma kullanılmıyor. (3) Paketleme talimatında ara katman adımı tanımlı değil. (4) Talimat hazırlanırken sevkiyat riskleri değerlendirilmemiş. (5) Paketleme süreci risk analizine dahil edilmemiş. Kök neden: Paketleme sürecinin risk analizinde yer almaması ve talimatta koruma adımının bulunmaması.',
  acilOnlem:
    'Etkilenen parti müşteriden geri çağrıldı, yeniden paketleme yapıldı ve sevkiyat öncesi %100 yüzey kontrolü başlatıldı.',
  durum: 'kok_neden',
  aksiyonlar: [
    {
      aciklama: 'Paketleme talimatına ara katman koruma adımı eklendi ve Rev.01 olarak yayınlandı.',
      sorumluId: hazirlayan,
      hedefTarih: gunEkle(bugun, -10),
      durum: 'tamamlandi',
      kanitAciklama: 'Güncellenen paketleme talimatı ve eğitim kaydı.',
    },
    {
      aciklama: 'Sevkiyat öncesi yüzey kontrolü için kontrol listesi oluşturulacak.',
      sorumluId: saha,
      hedefTarih: gunEkle(bugun, -3),
      durum: 'devam_ediyor',
      kanitAciklama: 'Kontrol listesi taslağı hazır.',
    },
  ],
});

const dofBakim = dofEkle({
  tur: 'onleyici',
  kaynak: 'ic_tetkik',
  departmanId: bakimDepartman,
  talepEden: 'İç Tetkik Ekibi',
  tespitTarihi: gunEkle(bugun, -30),
  tanim:
    'İç tetkikte kritik ekipmanların yağlama periyotlarının bakım planında tanımlı olmadığı görüldü. Bu durum plansız duruş riski oluşturuyor.',
  dokumanId: pr001,
  kokNeden:
    'Kök neden: Bakım planı ekipman bazında hazırlanmış ancak yağlama periyotları üretici önerileriyle eşleştirilmemiş. Periyodik gözden geçirme sorumluluğu tanımlı değil.',
  acilOnlem: 'Kritik ekipmanlar için geçici yağlama takvimi devreye alındı.',
  durum: 'etkinlik_bekliyor',
  etkinlikNotu: '',
  aksiyonlar: [
    {
      aciklama: 'Kritik ekipman yağlama periyotları üretici önerileriyle bakım planına işlendi.',
      sorumluId: bakimci,
      hedefTarih: gunEkle(bugun, -12),
      durum: 'tamamlandi',
      kanitAciklama: 'Güncel bakım planı ve üretici öneri dokümanları.',
    },
    {
      aciklama: 'Bakım planı gözden geçirme sorumluluğu talimata eklendi ve ekip bilgilendirildi.',
      sorumluId: kalite,
      hedefTarih: gunEkle(bugun, -5),
      durum: 'tamamlandi',
      kanitAciklama: 'Talimat Rev.00 ve toplantı tutanağı.',
    },
  ],
});

const dofYgg = dofEkle({
  tur: 'duzeltici',
  kaynak: 'ygg',
  departmanId: kaliteDepartman,
  talepEden: 'Yönetim Gözden Geçirme Toplantısı',
  tespitTarihi: gunEkle(bugun, -60),
  tanim:
    'YGG toplantısında kalite hedeflerinin üç ayda bir yerine yılda bir izlendiği tespit edildi. Hedeflerden sapmalar zamanında görülemiyor.',
  dokumanId: pr001,
  kokNeden:
    'Kök neden: Kalite hedefleri izleme takvimi tanımlı değil; mevcut prosedürde izleme sıklığı belirtilmemiş.',
  acilOnlem: 'Üç aylık izleme takvimi hazırlanarak sorumlulara duyuruldu.',
  durum: 'kapandi',
  etkinlikNotu:
    'Üç aylık izleme takvimi uygulanmaya başlandı. Son iki dönemde hedef sapmaları zamanında tespit edildi ve düzeltici faaliyetler açıldı. Etkinlik doğrulandı.',
  kapatanId: kalite,
  kapanisTarihi: gunOnce(20),
  aksiyonlar: [
    {
      aciklama: 'Kalite hedefleri izleme takvimi hazırlandı ve prosedüre işlendi.',
      sorumluId: kalite,
      hedefTarih: gunEkle(bugun, -30),
      durum: 'tamamlandi',
      kanitAciklama: 'Güncellenen prosedür ve üç aylık izleme takvimi.',
    },
  ],
});

const dofTedarikci = dofEkle({
  tur: 'onleyici',
  kaynak: 'surec_uretim_hatasi',
  departmanId: satinAlmaDepartman,
  talepEden: 'Satın Alma Sorumlusu',
  tespitTarihi: gunEkle(bugun, -5),
  tanim:
    'Tedarikçi değerlendirme puanlarının yalnızca yıllık olarak hesaplandığı, düşük performanslı tedarikçilerin zamanında izlenmediği tespit edildi.',
  dokumanId: ls001,
  durum: 'acik',
  aksiyonlar: [],
});

// ---------------------------------------------------------------------------
// Faz 5: İç Tetkik (Denetim) örnekleri
// ---------------------------------------------------------------------------
const isoChecklist = db
  .prepare("SELECT id FROM ic_tetkik_checklistleri WHERE kod = 'CL-ISO-001'")
  .get();
const kurumChecklist = db
  .prepare("SELECT id FROM ic_tetkik_checklistleri WHERE kod = 'CL-KI-001'")
  .get();

function icTetkikEkle({
  yil,
  checklistId,
  baslik,
  amac,
  kapsam,
  yontem,
  departmanId,
  planlananTarih,
  baslangicTarihi = null,
  bitisTarihi = null,
  durum = 'planlandi',
  tamamlayanId = null,
  denetciler = [],
}) {
  const kod = tetkik.tetkikKoduUret(db, yil);
  const bilgi = db
    .prepare(
      `INSERT INTO ic_tetkikler
        (kod, yil, checklist_id, baslik, amac, kapsam, yontem, departman_id,
         planlanan_tarih, baslangic_tarihi, bitis_tarihi, durum, olusturan_id,
         tamamlayan_id, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      kod,
      yil,
      checklistId,
      baslik,
      amac,
      kapsam,
      yontem,
      departmanId,
      planlananTarih,
      baslangicTarihi,
      bitisTarihi,
      durum,
      kalite,
      tamamlayanId,
      simdi,
      simdi
    );
  const tetkikId = Number(bilgi.lastInsertRowid);
  const maddeEkle = db.prepare(
    `INSERT INTO ic_tetkik_maddeleri
      (tetkik_id, checklist_madde_id, sira, baslik, kriter, referans, agirlik)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const kaynakMaddeler = db
    .prepare('SELECT * FROM ic_tetkik_checklist_maddeleri WHERE checklist_id = ? ORDER BY sira')
    .all(checklistId);
  for (const madde of kaynakMaddeler) {
    maddeEkle.run(
      tetkikId,
      madde.id,
      madde.sira,
      madde.baslik,
      madde.kriter,
      madde.referans,
      madde.agirlik
    );
  }
  const atamaEkle = db.prepare(
    `INSERT INTO ic_tetkik_denetcileri
      (tetkik_id, kullanici_id, gorev, durum, atayan_id, atama_tarihi, yanit_tarihi, tamamlanma_tarihi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const denetci of denetciler) {
    atamaEkle.run(
      tetkikId,
      denetci.kullaniciId,
      denetci.gorev || 'denetci',
      denetci.durum || 'atanmis',
      kalite,
      simdi,
      denetci.durum && denetci.durum !== 'atanmis' ? simdi : null,
      denetci.durum === 'tamamlandi' ? simdi : null
    );
  }
  db.prepare(
    `INSERT INTO aktivite_loglari
      (modul, islem, kayit_tipi, kayit_id, referans_no, kullanici_id, aciklama, yeni_deger, tarih)
     VALUES ('tetkik', 'plan_olustur', 'ic_tetkik', ?, ?, ?, ?, ?, ?)`
  ).run(
    tetkikId,
    kod,
    kalite,
    `${baslik} iç tetkik planı demo verisi olarak oluşturuldu.`,
    durum,
    simdi
  );
  return { id: tetkikId, kod };
}

function tetkikMaddesiDegerlendir(tetkikId, sira, sonuc, puan, aciklama = '', kanit = '') {
  db.prepare(
    `UPDATE ic_tetkik_maddeleri
     SET sonuc = ?, puan = ?, bulgu_aciklama = ?, kanit = ?,
         degerlendiren_id = ?, degerlendirme_tarihi = ?
     WHERE tetkik_id = ? AND sira = ?`
  ).run(sonuc, puan, aciklama, kanit, kalite, simdi, tetkikId, sira);
}

function tetkikBulguEkle({
  tetkikId,
  tetkikKod,
  maddeId,
  baslik,
  tanim,
  sonuc,
  departmanId,
  sorumluId,
  tespitTarihi,
  dofId = null,
}) {
  const kod = tetkik.bulguKoduUret(db, dofYili);
  const bilgi = db
    .prepare(
      `INSERT INTO ic_tetkik_bulgulari
        (kod, tetkik_id, madde_id, baslik, tanim, sonuc, departman_id, sorumlu_id,
         tespit_tarihi, durum, dof_id, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      kod,
      tetkikId,
      maddeId,
      baslik,
      tanim,
      sonuc,
      departmanId,
      sorumluId,
      tespitTarihi,
      dofId ? 'dof_acildi' : 'acik',
      dofId,
      kalite,
      simdi,
      simdi
    );
  const bulguId = Number(bilgi.lastInsertRowid);
  db.prepare(
    `INSERT INTO aktivite_loglari
      (modul, islem, kayit_tipi, kayit_id, referans_no, kullanici_id, aciklama, yeni_deger, tarih)
     VALUES ('tetkik', ?, 'ic_tetkik', ?, ?, ?, ?, ?, ?)`
  ).run(
    dofId ? 'dof_aktar' : 'bulgu_olustur',
    tetkikId,
    `${tetkikKod} / ${kod}`,
    kalite,
    dofId ? 'Bulgu demo olarak mevcut DÖF kaydına bağlandı.' : `${baslik} bulgusu kaydedildi.`,
    dofId ? 'dof_acildi' : 'acik',
    simdi
  );
  return { id: bulguId, kod };
}

const tamamlananTetkik = icTetkikEkle({
  yil: dofYili,
  checklistId: isoChecklist.id,
  baslik: `${dofYili} Yılı Bakım Süreçleri İç Tetkiki`,
  amac: 'Bakım planının uygulanabilirliğini ve kritik ekipman kontrollerinin etkinliğini doğrulamak.',
  kapsam: 'Bakım talimatları, periyodik bakım planı, arıza geçmişi, ekipman kontrol kayıtları ve ilgili çalışan talimatları.',
  yontem: 'Doküman ve kayıt incelemesi, saha gözlemi, bakım ekibiyle görüşme ve geçmiş arıza verilerinin karşılaştırılması.',
  departmanId: bakimDepartman,
  planlananTarih: `${dofYili}-03-15`,
  baslangicTarihi: `${dofYili}-03-20`,
  bitisTarihi: `${dofYili}-04-05`,
  durum: 'tamamlandi',
  tamamlayanId: kalite,
  denetciler: [
    { kullaniciId: kalite, gorev: 'bas_denetci', durum: 'tamamlandi' },
    { kullaniciId: bakimci, gorev: 'denetci', durum: 'tamamlandi' },
  ],
});

for (let sira = 1; sira <= 10; sira += 1) {
  const major = sira === 8;
  tetkikMaddesiDegerlendir(
    tamamlananTetkik.id,
    sira,
    major ? 'major' : 'uygun',
    major ? 0 : 100,
    major
      ? 'Kritik ekipmanların yağlama periyotları bakım planında tanımlı değildi.'
      : 'İncelenen kontrol ve kayıtlar kurum içi beklentiyle uyumludur.',
    major ? 'Bakım planı ve ekipman kontrol listesi incelemesi.' : 'İlgili güncel kayıtlar.'
  );
}
const tamamlananMadde8 = db
  .prepare('SELECT id FROM ic_tetkik_maddeleri WHERE tetkik_id = ? AND sira = 8')
  .get(tamamlananTetkik.id);
tetkikBulguEkle({
  tetkikId: tamamlananTetkik.id,
  tetkikKod: tamamlananTetkik.kod,
  maddeId: tamamlananMadde8.id,
  baslik: 'Kritik ekipman yağlama periyotları planlanmamış',
  tanim:
    'Kritik ekipmanların yağlama periyotları bakım planında üretici önerileriyle eşleştirilmemiş ve plansız duruş riski taşımaktadır.',
  sonuc: 'major',
  departmanId: bakimDepartman,
  sorumluId: bakimci,
  tespitTarihi: `${dofYili}-04-02`,
  dofId: dofBakim,
});
db.prepare(
  `UPDATE dof_kayitlari
   SET uygunsuzluk_tanimi = ?
   WHERE id = ?`
).run(
  `[${tamamlananTetkik.kod} / BUL-${dofYili}-001] İç tetkikte kritik ekipmanların yağlama periyotlarının bakım planında tanımlı olmadığı görüldü. Bu durum plansız duruş riski oluşturuyor.`,
  dofBakim
);

const devamEdenTetkik = icTetkikEkle({
  yil: dofYili,
  checklistId: isoChecklist.id,
  baslik: `${dofYili} Yılı Üretim Süreçleri İç Tetkiki`,
  amac: 'Üretim operasyonlarının tanımlı kalite dokümanlarına uyumunu ve izlenebilirliğini değerlendirmek.',
  kapsam: 'Üretim planlama, operasyon talimatları, ilk ürün kontrolü, sevkiyat öncesi kontroller ve ilgili kayıtlar.',
  yontem: 'Saha gözlemi, üretim kayıtları örneklemesi, ilgili doküman incelemesi ve operatör görüşmeleri.',
  departmanId: uretimDepartman,
  planlananTarih: `${dofYili}-10-05`,
  baslangicTarihi: `${dofYili}-10-12`,
  durum: 'devam_ediyor',
  denetciler: [
    { kullaniciId: kalite, gorev: 'bas_denetci', durum: 'kabul_edildi' },
    { kullaniciId: hazirlayan, gorev: 'denetci', durum: 'kabul_edildi' },
  ],
});
const devamSonuclar = [
  [1, 'uygun', 100],
  [2, 'minor', 50],
  [3, 'uygun', 100],
  [4, 'uygun', 100],
];
for (const [sira, sonuc, puan] of devamSonuclar) {
  tetkikMaddesiDegerlendir(
    devamEdenTetkik.id,
    sira,
    sonuc,
    puan,
    sonuc === 'minor'
      ? 'Üretim vardiya değişim kayıtlarında kontrol sorumlulukları her vardiyada açıkça belirtilmemiş.'
      : '',
    sonuc === 'minor' ? 'Vardiya formu ve operasyon talimatı incelemesi.' : 'Güncel operasyon kayıtları.'
  );
}
const devamMadde2 = db
  .prepare('SELECT id FROM ic_tetkik_maddeleri WHERE tetkik_id = ? AND sira = 2')
  .get(devamEdenTetkik.id);
tetkikBulguEkle({
  tetkikId: devamEdenTetkik.id,
  tetkikKod: devamEdenTetkik.kod,
  maddeId: devamMadde2.id,
  baslik: 'Vardiya değişim kontrol sorumluluğu belirsiz',
  tanim:
    'Üretim vardiya değişim formunda kalite kontrol sorumluluğu açıkça tanımlanmamış ve iki vardiya arasında örneklemelerde boş alan bulunmuştur.',
  sonuc: 'minor',
  departmanId: uretimDepartman,
  sorumluId: hazirlayan,
  tespitTarihi: `${dofYili}-10-18`,
});

const planlananTetkik = icTetkikEkle({
  yil: dofYili,
  checklistId: kurumChecklist.id,
  baslik: `${dofYili} Yılı İnsan Kaynakları İç Tetkiki`,
  amac: 'Personel eğitim, yetkinlik ve çalışan kayıtlarının kurum içi kontrollerle uyumunu doğrulamak.',
  kapsam: 'Eğitim planı, personel yetkinlik kayıtları, işe alım ve oryantasyon kayıtları ile ilgili kalite dokümanları.',
  yontem: 'Kayıt incelemesi, personel görüşmesi ve yıllık eğitim planının yeterlilik analizi.',
  departmanId: db.prepare("SELECT id FROM departmanlar WHERE ad = 'İnsan Kaynakları'").get().id,
  planlananTarih: `${dofYili}-12-08`,
  durum: 'planlandi',
  denetciler: [
    { kullaniciId: kalite, gorev: 'bas_denetci', durum: 'atanmis' },
    { kullaniciId: admin, gorev: 'gozlemci', durum: 'atanmis' },
  ],
});

const sayilar = {
  kullanici: db.prepare('SELECT COUNT(*) AS sayi FROM kullanicilar').get().sayi,
  dokuman: db.prepare('SELECT COUNT(*) AS sayi FROM dokumanlar').get().sayi,
  yayinda: db.prepare("SELECT COUNT(*) AS sayi FROM dokumanlar WHERE durum = 'yayinda'").get().sayi,
  dof: db.prepare('SELECT COUNT(*) AS sayi FROM dof_kayitlari').get().sayi,
  dofAksiyon: db.prepare('SELECT COUNT(*) AS sayi FROM dof_aksiyonlari').get().sayi,
  tetkik: db.prepare('SELECT COUNT(*) AS sayi FROM ic_tetkikler').get().sayi,
  tetkikBulgu: db.prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_bulgulari').get().sayi,
};

console.log('');
console.log('Örnek QDMS verileri oluşturuldu.');
console.log(`  Kullanıcı : ${sayilar.kullanici}`);
console.log(`  Doküman   : ${sayilar.dokuman} (${sayilar.yayinda} yayında)`);
console.log(`  DÖF       : ${sayilar.dof} kayıt, ${sayilar.dofAksiyon} aksiyon`);
console.log(`  İç Tetkik : ${sayilar.tetkik} plan, ${sayilar.tetkikBulgu} bulgu`);
console.log(`  Bugün     : ${bugun}`);
console.log(`  Veritabanı: ${config.dbPath}`);
console.log('');
console.log('Demo giriş bilgileri:');
console.log(`  Sistem Yöneticisi   : ${VARSAYILAN_ADMIN.email} / ${VARSAYILAN_ADMIN.sifre}`);
console.log('  Kalite Yöneticisi   : kalite@ornek.com / Kalite123!');
console.log('  Doküman Hazırlayan  : hazirlayan@ornek.com / Hazirlayan123!');
console.log('  Onaylayan           : onaylayan@ornek.com / Onaylayan123!');
console.log('  Standart Kullanıcı  : saha@ornek.com / Standart123!');
console.log('  Standart Kullanıcı  : bakim@ornek.com / Standart123!');
console.log('');
console.log('Başlatmak için: npm start');
console.log('Adres: http://127.0.0.1:3005');
console.log('');
