'use strict';

/**
 * QDMS ekran görüntüleri ve hızlı deneme için örnek veri oluşturur.
 *   npm run demo
 *   npm run demo -- --sifirla
 */

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { bugunTz, gunEkle } = require('../src/dates');
const { ayarlariKaydet, etkinAyarlar, sirketAyarlariKaydet } = require('../src/settings');
const { kullaniciOlustur, VARSAYILAN_ADMIN } = require('../src/auth');
const qdms = require('../src/qdms');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const sifirla = process.argv.includes('--sifirla');
const mevcut = db.prepare('SELECT COUNT(*) AS sayi FROM dokumanlar').get().sayi;

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
    DELETE FROM bildirimler;
    DELETE FROM dokuman_okumalari;
    DELETE FROM dokuman_onaylari;
    DELETE FROM dokuman_hedef_departmanlar;
    DELETE FROM dokumanlar;
    DELETE FROM oturumlar;
    DELETE FROM email_kayitlari;
    DELETE FROM isler;
    DELETE FROM toplantilar;
    DELETE FROM sorumlular;
    DELETE FROM kullanicilar;
  `);
  console.log('Mevcut doküman, toplantı, kullanıcı ve e-posta kayıtları temizlendi.');
}

const ayarlar = etkinAyarlar(db, config);
if (!ayarlar.raporAlici) {
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
      rapor_alici: 'raporlar@ornek.com',
      hatirlatma_saati: '09:00',
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
// Toplantı ve aksiyon takibi demo verisi
// ---------------------------------------------------------------------------
function sorumluEkle(ad, email) {
  const mevcutKisi = db.prepare('SELECT * FROM sorumlular WHERE email = ? COLLATE NOCASE').get(email);
  if (mevcutKisi) return mevcutKisi.id;
  const bilgi = db.prepare('INSERT INTO sorumlular (ad, email) VALUES (?, ?)').run(ad, email);
  return Number(bilgi.lastInsertRowid);
}

function toplantiEkle(ad, tarih, durum = 'acik') {
  const bilgi = db
    .prepare(
      `INSERT INTO toplantilar (ad, tarih, durum, tamamlanma_tarihi)
       VALUES (?, ?, ?, ?)`
    )
    .run(ad, tarih, durum, durum === 'tamamlandi' ? simdi : null);
  return Number(bilgi.lastInsertRowid);
}

function isEkle({
  toplantiId,
  baslik,
  sorumluId,
  hedefTarih,
  durum = 'aktif',
  notMetni = '',
  hatirlatmaGonderildi = 0,
  hatirlatmaTarihi = null,
  tamamlanmaTarihi = null,
}) {
  db.prepare(
    `INSERT INTO isler
      (toplanti_id, baslik, not_metni, sorumlu_id, hedef_tarih, durum,
       hatirlatma_gonderildi, hatirlatma_tarihi, olusturma_tarihi, guncelleme_tarihi, tamamlanma_tarihi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    toplantiId,
    baslik,
    notMetni,
    sorumluId,
    hedefTarih,
    durum,
    hatirlatmaGonderildi,
    hatirlatmaTarihi,
    simdi,
    simdi,
    tamamlanmaTarihi
  );
}

const elif = sorumluEkle('Elif Kaya', 'elif.kaya@ornek.com');
const mert = sorumluEkle('Mert Demir', 'mert.demir@ornek.com');
const zeynep = sorumluEkle('Zeynep Şahin', 'zeynep.sahin@ornek.com');
const burak = sorumluEkle('Burak Yılmaz', 'burak.yilmaz@ornek.com');

const kaliteToplantisi = toplantiEkle('Kalite Yönetim Gözden Geçirme', gunEkle(bugun, -14));
isEkle({
  toplantiId: kaliteToplantisi,
  baslik: 'Yıllık kalite hedeflerini güncelle',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, 6),
  notMetni: 'Birim hedefleri yönetim gözden geçirme toplantısında sunulacak.',
});
isEkle({
  toplantiId: kaliteToplantisi,
  baslik: 'Tedarikçi değerlendirme listesini yayınla',
  sorumluId: zeynep,
  hedefTarih: gunEkle(bugun, -2),
  durum: 'tamamlandi',
  notMetni: 'LS-001 listesi güncellendi ve onaya sunuldu.',
  tamamlanmaTarihi: gunOnce(2),
});
isEkle({
  toplantiId: kaliteToplantisi,
  baslik: 'Düzeltici faaliyet formunu revize et',
  sorumluId: mert,
  hedefTarih: gunEkle(bugun, 3),
  durum: 'beklemede',
  notMetni: 'Formun kök neden alanı genişletilecek; onay bekleniyor.',
});

const uretimToplantisi = toplantiEkle('Haftalık Üretim Planlama', gunEkle(bugun, -2));
isEkle({
  toplantiId: uretimToplantisi,
  baslik: 'CNC talimatının okunmasını takip et',
  sorumluId: burak,
  hedefTarih: gunEkle(bugun, 2),
  notMetni: 'Üretim ekibinin TL-001 dokümanını okuması ve onaylaması sağlanacak.',
});
isEkle({
  toplantiId: uretimToplantisi,
  baslik: 'Aylık bakım planını yayınla',
  sorumluId: zeynep,
  hedefTarih: gunEkle(bugun, 5),
  notMetni: 'Bakım planı bakım panosuna ve QDMS’e yüklenecek.',
});
isEkle({
  toplantiId: uretimToplantisi,
  baslik: 'Son üç aylık uygunsuzlukları analiz et',
  sorumluId: mert,
  hedefTarih: gunEkle(bugun, 1),
  notMetni: 'Tekrarlayan uygunsuzluklar için Pareto analizi hazırlanacak.',
});

const tasarim = toplantiEkle('Doküman Şablonu Değerlendirmesi', gunEkle(bugun, -5));
isEkle({
  toplantiId: tasarim,
  baslik: 'Prosedür şablonunun antet rengini güncelle',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, 4),
  notMetni: 'Kurumsal kimlik rehberine uygun yeni renk paleti uygulanacak.',
});

const sayilar = {
  kullanici: db.prepare('SELECT COUNT(*) AS sayi FROM kullanicilar').get().sayi,
  dokuman: db.prepare('SELECT COUNT(*) AS sayi FROM dokumanlar').get().sayi,
  yayinda: db.prepare("SELECT COUNT(*) AS sayi FROM dokumanlar WHERE durum = 'yayinda'").get().sayi,
  toplanti: db.prepare('SELECT COUNT(*) AS sayi FROM toplantilar').get().sayi,
  is: db.prepare('SELECT COUNT(*) AS sayi FROM isler').get().sayi,
};

console.log('');
console.log('Örnek QDMS verileri oluşturuldu.');
console.log(`  Kullanıcı : ${sayilar.kullanici}`);
console.log(`  Doküman   : ${sayilar.dokuman} (${sayilar.yayinda} yayında)`);
console.log(`  Toplantı  : ${sayilar.toplanti} · İş: ${sayilar.is}`);
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
