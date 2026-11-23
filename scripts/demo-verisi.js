'use strict';

/**
 * Ekran görüntüleri ve hızlı deneme için örnek veri oluşturur.
 *   npm run demo
 *   npm run demo -- --sifirla
 */

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { bugunTz, gunEkle } = require('../src/dates');
const { ayarlariKaydet, etkinAyarlar } = require('../src/settings');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const sifirla = process.argv.includes('--sifirla');
const mevcut = db.prepare('SELECT COUNT(*) AS sayi FROM toplantilar').get().sayi;

if (mevcut > 0 && !sifirla) {
  console.log('');
  console.log('Veritabanında zaten toplantı kayıtları var.');
  console.log('Örnek verileri yeniden oluşturmak için: npm run demo -- --sifirla');
  console.log(`Veritabanı: ${config.dbPath}`);
  console.log('');
  process.exit(0);
}

if (sifirla) {
  db.exec('DELETE FROM email_kayitlari; DELETE FROM isler; DELETE FROM toplantilar; DELETE FROM sorumlular;');
  console.log('Mevcut toplantı, iş, sorumlu ve e-posta kayıtları temizlendi.');
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
      smtp_from_name: 'Toplantı Takip Demo',
      rapor_alici: 'raporlar@ornek.com',
      hatirlatma_saati: '09:00',
      saat_dilimi: ayarlar.saatDilimi,
      test_modu: '1',
    },
    config
  );
}

const bugun = bugunTz(ayarlar.saatDilimi);
const simdi = new Date().toISOString();

function sorumluEkle(ad, email) {
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

function isEkle({ toplantiId, baslik, sorumluId, hedefTarih, durum = 'aktif', notMetni = '', hatirlatmaGonderildi = 0, hatirlatmaTarihi = null, tamamlanmaTarihi = null }) {
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

const yolHaritasi = toplantiEkle('Ürün Yol Haritası', gunEkle(bugun, -14), 'tamamlandi');
isEkle({
  toplantiId: yolHaritasi,
  baslik: 'Yol haritası sunumunu tamamla',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, -12),
  durum: 'tamamlandi',
  notMetni: 'Yönetim sunumu 12 slayt olarak hazırlandı ve paylaşıldı.',
  hatirlatmaGonderildi: 1,
  hatirlatmaTarihi: `${gunEkle(bugun, -13)}T09:00:00.000Z`,
  tamamlanmaTarihi: `${gunEkle(bugun, -12)}T16:30:00.000Z`,
});
isEkle({
  toplantiId: yolHaritasi,
  baslik: 'Rakip analizini güncelle',
  sorumluId: mert,
  hedefTarih: gunEkle(bugun, -13),
  durum: 'tamamlandi',
  notMetni: 'Üç rakip için fiyat ve konumlandırma karşılaştırması eklendi.',
  tamamlanmaTarihi: `${gunEkle(bugun, -13)}T11:15:00.000Z`,
});
isEkle({
  toplantiId: yolHaritasi,
  baslik: 'Q1 hedeflerini netleştir',
  sorumluId: zeynep,
  hedefTarih: gunEkle(bugun, -11),
  durum: 'tamamlandi',
  notMetni: 'Ürün ve pazarlama hedefleri tek tabloda birleştirildi.',
  tamamlanmaTarihi: `${gunEkle(bugun, -11)}T14:00:00.000Z`,
});

const pazarlama = toplantiEkle('Haftalık Pazarlama Sprinti', gunEkle(bugun, -2));
isEkle({
  toplantiId: pazarlama,
  baslik: 'Landing page metinlerini güncelle',
  sorumluId: mert,
  hedefTarih: gunEkle(bugun, 1),
  notMetni: 'Başlık ve alt başlık metinleri yenilenecek; ürün ekibinden onay alınacak.',
});
isEkle({
  toplantiId: pazarlama,
  baslik: 'Sosyal medya takvimini hazırla',
  sorumluId: zeynep,
  hedefTarih: gunEkle(bugun, 4),
  notMetni: 'Aralık ayı için haftalık içerik planı ve görsel ihtiyaç listesi.',
});
isEkle({
  toplantiId: pazarlama,
  baslik: 'Kasım bülteni görsellerini seç',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, -1),
  durum: 'beklemede',
  notMetni: 'Görsel alternatifleri paylaşıldı, marka ekibinden onay bekleniyor.',
});
isEkle({
  toplantiId: pazarlama,
  baslik: 'Reklam bütçesi raporunu hazırla',
  sorumluId: burak,
  hedefTarih: gunEkle(bugun, 2),
  durum: 'tamamlandi',
  notMetni: 'Kanal bazlı harcama ve dönüşüm oranları rapora eklendi.',
  tamamlanmaTarihi: `${gunEkle(bugun, -1)}T10:00:00.000Z`,
});
isEkle({
  toplantiId: pazarlama,
  baslik: 'Instagram içerik planını güncelle',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, 6),
  notMetni: 'Reels ve carousel formatları için yeni yayın takvimi.',
  hatirlatmaGonderildi: 1,
  hatirlatmaTarihi: `${gunEkle(bugun, -1)}T09:00:00.000Z`,
});

const geriBildirim = toplantiEkle('Müşteri Geri Bildirimleri', gunEkle(bugun, -1));
isEkle({
  toplantiId: geriBildirim,
  baslik: 'Müşteri memnuniyet anketini gönder',
  sorumluId: zeynep,
  hedefTarih: bugun,
  notMetni: 'Aktif müşterilere kısa anket e-postası gönderilecek.',
});
isEkle({
  toplantiId: geriBildirim,
  baslik: 'Destek taleplerini kategorize et',
  sorumluId: mert,
  hedefTarih: gunEkle(bugun, -2),
  notMetni: 'Son 30 günün destek talepleri ürün, faturalama ve teknik olarak ayrılacak.',
});
isEkle({
  toplantiId: geriBildirim,
  baslik: 'Görüşme notlarını arşivle',
  sorumluId: burak,
  hedefTarih: gunEkle(bugun, -3),
  durum: 'beklemede',
  notMetni: 'Müşteri görüşmelerinin ham notları ortak klasöre taşınacak.',
});
isEkle({
  toplantiId: geriBildirim,
  baslik: 'Aylık geri bildirim raporunu paylaş',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, -5),
  durum: 'tamamlandi',
  notMetni: 'Öne çıkan üç tema ve önerilen aksiyonlar rapora eklendi.',
  tamamlanmaTarihi: `${gunEkle(bugun, -5)}T15:20:00.000Z`,
});

const tasarim = toplantiEkle('Tasarım Değerlendirmesi', gunEkle(bugun, -5));
isEkle({
  toplantiId: tasarim,
  baslik: 'Yeni tasarım taslağını incele',
  sorumluId: elif,
  hedefTarih: gunEkle(bugun, 3),
  notMetni: 'Ana sayfa ve toplantı detay ekranlarının yeni taslakları.',
});
isEkle({
  toplantiId: tasarim,
  baslik: 'Marka rehberi güncellemesini planla',
  sorumluId: burak,
  hedefTarih: gunEkle(bugun, 8),
  durum: 'beklemede',
  notMetni: 'Renk ve tipografi kararları onaylandıktan sonra rehber güncellenecek.',
});

console.log('');
console.log('Örnek veriler oluşturuldu.');
console.log(`  Sorumlu : 4`);
console.log(`  Toplantı: 4 (1 tamamlandı)`);
console.log(`  İş      : 14`);
console.log(`  Bugün   : ${bugun}`);
console.log(`  Veritabanı: ${config.dbPath}`);
console.log('');
console.log('Başlatmak için: npm start');
console.log('');
