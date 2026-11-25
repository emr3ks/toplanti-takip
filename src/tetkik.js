'use strict';

/**
 * Faz 5 — İç Tetkik (Denetim) Yönetimi modülünün ortak sabitleri ve
 * yardımcıları. Bu dosya veritabanı bağlantısını doğrudan saklamaz; rota
 * katmanı tarafından açılan bağlantı üzerinde sorgu ve seed işlemleri yapar.
 */

const TETKIK_DURUMLARI = Object.freeze({
  planlandi: 'Planlandı',
  devam_ediyor: 'Devam Ediyor',
  tamamlandi: 'Tamamlandı',
});

const TETKIK_SONUCLARI = Object.freeze({
  uygun: 'Uygun',
  minor: 'Minör Uygunsuzluk',
  major: 'Majör Uygunsuzluk',
  gozlem: 'Gözlem',
});

const TETKIK_STANDARTLARI = Object.freeze({
  iso_9001: 'ISO 9001',
  kurum_ici: 'Kurum İçi',
});

const TETKIK_DENETCI_GOREVLERI = Object.freeze({
  bas_denetci: 'Baş Denetçi',
  denetci: 'Denetçi',
  gozlemci: 'Gözlemci',
});

const TETKIK_DENETCI_DURUMLARI = Object.freeze({
  atanmis: 'Atandı',
  kabul_edildi: 'Kabul Edildi',
  tamamlandi: 'Tamamlandı',
});

const TETKIK_BULGU_DURUMLARI = Object.freeze({
  acik: 'Açık',
  dof_acildi: 'DÖF Açıldı',
  kapandi: 'Kapatıldı',
});

const TETKIK_DURUM_ANAHTARLARI = Object.freeze(Object.keys(TETKIK_DURUMLARI));
const TETKIK_SONUC_ANAHTARLARI = Object.freeze(Object.keys(TETKIK_SONUCLARI));
const TETKIK_STANDART_ANAHTARLARI = Object.freeze(Object.keys(TETKIK_STANDARTLARI));
const TETKIK_DENETCI_GOREV_ANAHTARLARI = Object.freeze(Object.keys(TETKIK_DENETCI_GOREVLERI));
const TETKIK_DENETCI_DURUM_ANAHTARLARI = Object.freeze(Object.keys(TETKIK_DENETCI_DURUMLARI));

/** Sonuç sınıfının uyumluluk puanına katkısı. Gözlem uyumluluğu düşürmez. */
const TETKIK_SONUC_PUANLARI = Object.freeze({
  uygun: 100,
  minor: 50,
  major: 0,
  gozlem: 100,
});

const TETKIK_DURUM_SINIFLARI = Object.freeze({
  planlandi: 'tetkik-durum-planlandi',
  devam_ediyor: 'tetkik-durum-devam',
  tamamlandi: 'tetkik-durum-tamamlandi',
});

const TETKIK_SONUC_SINIFLARI = Object.freeze({
  uygun: 'tetkik-sonuc-uygun',
  minor: 'tetkik-sonuc-minor',
  major: 'tetkik-sonuc-major',
  gozlem: 'tetkik-sonuc-gozlem',
});

function durumEtiketi(durum) {
  return TETKIK_DURUMLARI[durum] || durum || '—';
}

function sonucEtiketi(sonuc) {
  return TETKIK_SONUCLARI[sonuc] || sonuc || '—';
}

function standartEtiketi(standart) {
  return TETKIK_STANDARTLARI[standart] || standart || '—';
}

function denetciGorevEtiketi(gorev) {
  return TETKIK_DENETCI_GOREVLERI[gorev] || gorev || '—';
}

function denetciDurumEtiketi(durum) {
  return TETKIK_DENETCI_DURUMLARI[durum] || durum || '—';
}

function bulguDurumEtiketi(durum) {
  return TETKIK_BULGU_DURUMLARI[durum] || durum || '—';
}

function durumSinifi(durum) {
  return TETKIK_DURUM_SINIFLARI[durum] || 'tetkik-durum-planlandi';
}

function sonucSinifi(sonuc) {
  return TETKIK_SONUC_SINIFLARI[sonuc] || 'tetkik-sonuc-gozlem';
}

function yilGecerliMi(yil) {
  const sayi = Number(yil);
  return Number.isInteger(sayi) && sayi >= 2000 && sayi <= 2200;
}

function tarihYili(tarih, varsayilanYil = new Date().getFullYear()) {
  const eslesme = String(tarih || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  if (eslesme) return Number(eslesme[1]);
  return yilGecerliMi(varsayilanYil) ? Number(varsayilanYil) : new Date().getFullYear();
}

/** Bir sonraki iç tetkik kodunu `IT-YYYY-NNN` biçiminde üretir. */
function tetkikKoduUret(db, yil) {
  const onEk = `IT-${yil}-`;
  const satirlar = db.prepare('SELECT kod FROM ic_tetkikler WHERE kod LIKE ?').all(`${onEk}%`);
  let enBuyuk = 0;
  for (const satir of satirlar) {
    const eslesme = String(satir.kod || '').match(/^IT-(\d{4})-(\d+)$/);
    if (eslesme && Number(eslesme[1]) === Number(yil)) {
      enBuyuk = Math.max(enBuyuk, Number(eslesme[2]));
    }
  }
  return `${onEk}${String(enBuyuk + 1).padStart(3, '0')}`;
}

/** Bir sonraki bulgu kodunu `BUL-YYYY-NNN` biçiminde üretir. */
function bulguKoduUret(db, yil) {
  const onEk = `BUL-${yil}-`;
  const satirlar = db.prepare('SELECT kod FROM ic_tetkik_bulgulari WHERE kod LIKE ?').all(`${onEk}%`);
  let enBuyuk = 0;
  for (const satir of satirlar) {
    const eslesme = String(satir.kod || '').match(/^BUL-(\d{4})-(\d+)$/);
    if (eslesme && Number(eslesme[1]) === Number(yil)) {
      enBuyuk = Math.max(enBuyuk, Number(eslesme[2]));
    }
  }
  return `${onEk}${String(enBuyuk + 1).padStart(3, '0')}`;
}

/**
 * Kullanıcının görebileceği iç tetkikler için SQL koşulu.
 * Kalite yönetimi tüm kayıtları; diğer kullanıcılar kendi departmanına,
 * kendisine atanmış denetimlere veya kendi oluşturduğu kayıtlara erişir.
 */
function tetkikGorunurlukSql(kullanici, tamErisim = false) {
  if (!kullanici) return { sql: '1 = 0', parametreler: [] };
  if (tamErisim) return { sql: '1 = 1', parametreler: [] };
  return {
    sql: `(t.departman_id = ? OR t.olusturan_id = ? OR EXISTS (
      SELECT 1 FROM ic_tetkik_denetcileri td
      WHERE td.tetkik_id = t.id AND td.kullanici_id = ?
    ))`,
    parametreler: [kullanici.departman_id || null, kullanici.id, kullanici.id],
  };
}

/** Kayıt bazında iç tetkik görünürlüğü. */
function tetkikErisimiVar(db, kullanici, tetkik, tamErisim = false) {
  if (!kullanici || !tetkik) return false;
  if (tamErisim) return true;
  if (Number(tetkik.olusturan_id) === Number(kullanici.id)) return true;
  if (tetkik.departman_id && Number(tetkik.departman_id) === Number(kullanici.departman_id)) return true;
  return Boolean(
    db
      .prepare('SELECT 1 FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND kullanici_id = ?')
      .get(tetkik.id, kullanici.id)
  );
}

/** Kullanıcının tetkik üzerinde madde/finding değerlendirme yetkisi var mı? */
function tetkikDuzenlemeErisimiVar(db, kullanici, tetkik, tamErisim = false) {
  if (!kullanici || !tetkik) return false;
  if (tamErisim) return true;
  return Boolean(
    db
      .prepare('SELECT 1 FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND kullanici_id = ?')
      .get(tetkik.id, kullanici.id)
  );
}

/** Ağırlıklı uyumluluk puanı. Değerlendirilmemiş maddeler hesaba katılmaz. */
function puanHesapla(maddeler) {
  const liste = Array.isArray(maddeler) ? maddeler : [];
  let agirlikToplami = 0;
  let puanToplami = 0;
  let degerlendirilen = 0;
  for (const madde of liste) {
    if (!madde || !madde.sonuc) continue;
    const agirlik = Math.max(1, Number(madde.agirlik) || 1);
    const puan = Number.isFinite(Number(madde.puan))
      ? Math.max(0, Math.min(100, Number(madde.puan)))
      : TETKIK_SONUC_PUANLARI[madde.sonuc] ?? 0;
    agirlikToplami += agirlik;
    puanToplami += puan * agirlik;
    degerlendirilen += 1;
  }
  return {
    puan: agirlikToplami > 0 ? Math.round((puanToplami / agirlikToplami) * 10) / 10 : 0,
    degerlendirilen,
    toplam: liste.length,
    yuzde: agirlikToplami > 0 ? Math.round((puanToplami / agirlikToplami) * 100) : 0,
  };
}

/** Sonuç sınıflarının adet dağılımı. */
function sonucDagilimi(maddeler) {
  const dagilim = { uygun: 0, minor: 0, major: 0, gozlem: 0, degerlendirilmeyen: 0 };
  for (const madde of Array.isArray(maddeler) ? maddeler : []) {
    if (madde?.sonuc && Object.prototype.hasOwnProperty.call(dagilim, madde.sonuc)) {
      dagilim[madde.sonuc] += 1;
    } else {
      dagilim.degerlendirilmeyen += 1;
    }
  }
  return dagilim;
}

function bulguDofAktarilabilirMi(bulgu) {
  if (!bulgu) return false;
  if (bulgu.dof_id) return false;
  return ['minor', 'major'].includes(String(bulgu.sonuc || ''));
}

/** İlk kurulumda ISO 9001 ve kurum içi örnek kontrol listelerini oluşturur. */
function varsayilanTetkikVerileriniYukle(db) {
  const simdi = new Date().toISOString();
  const sablonEkle = db.prepare(
    `INSERT INTO ic_tetkik_checklistleri
      (kod, ad, standart, aciklama, versiyon, aktif, olusturma_tarihi, guncelleme_tarihi)
     VALUES (?, ?, ?, ?, '1.0', 1, ?, ?)
     ON CONFLICT (kod) DO NOTHING`
  );
  const maddeEkle = db.prepare(
    `INSERT INTO ic_tetkik_checklist_maddeleri
      (checklist_id, sira, baslik, kriter, referans, agirlik, zorunlu)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const listeler = varsayilanChecklistler();
  for (const checklist of listeler) {
    sablonEkle.run(
      checklist.kod,
      checklist.ad,
      checklist.standart,
      checklist.aciklama,
      simdi,
      simdi
    );
    const kayit = db
      .prepare('SELECT id FROM ic_tetkik_checklistleri WHERE kod = ?')
      .get(checklist.kod);
    if (!kayit) continue;
    const maddeSayisi = db
      .prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_checklist_maddeleri WHERE checklist_id = ?')
      .get(kayit.id).sayi;
    if (Number(maddeSayisi) > 0) continue;
    checklist.maddeler.forEach((madde, indeks) => {
      maddeEkle.run(
        kayit.id,
        indeks + 1,
        madde.baslik,
        madde.kriter,
        madde.referans || '',
        madde.agirlik || 1
      );
    });
  }
}

function varsayilanChecklistler() {
  return [
    {
      kod: 'CL-ISO-001',
      ad: 'ISO 9001 Kalite Yönetim Sistemi İç Tetkik Listesi',
      standart: 'iso_9001',
      aciklama:
        'ISO 9001:2015 kalite yönetim sistemi kapsamındaki temel süreç, kaynak, izleme ve iyileştirme gerekliliklerini denetler.',
      maddeler: [
        {
          baslik: 'QMS kapsamı ve süreç etkileşimleri',
          kriter: 'QMS kapsamı, süreç sahipleri, süreç girdileri/çıktıları ve süreçler arası etkileşimler tanımlanmış ve günceldir.',
          referans: 'ISO 9001 — 4.4',
          agirlik: 3,
        },
        {
          baslik: 'Kalite politikası ve hedefler',
          kriter: 'Kalite politikası uygulanabilir, ölçülebilir kalite hedefleriyle uyumludur ve personel tarafından anlaşılmaktadır.',
          referans: 'ISO 9001 — 5.2, 6.2',
          agirlik: 2,
        },
        {
          baslik: 'Yetkinlik ve eğitim',
          kriter: 'Yapılan iş için gereken yetkinlik belirlenmiş, eğitim planlanmış, uygulanmış ve etkinliği değerlendirilmiştir.',
          referans: 'ISO 9001 — 7.1, 7.2',
          agirlik: 3,
        },
        {
          baslik: 'İzleme ve ölçüm kaynakları',
          kriter: 'İzleme, ölçüm, analiz ve değerlendirme için uygun kaynaklar belirlenmiş; kalibrasyon/kalibrasyon doğrulama durumu günceldir.',
          referans: 'ISO 9001 — 7.1.5, 7.1.6',
          agirlik: 3,
        },
        {
          baslik: 'Operasyonel planlama ve değişiklik kontrolü',
          kriter: 'Ürün/hizmet gereklilikleri karşılanmakta, riskler değerlendirilmekte ve değişiklikler yetkili kişilerce onaylanmaktadır.',
          referans: 'ISO 9001 — 8.1, 8.5.6',
          agirlik: 3,
        },
        {
          baslik: 'Dış kaynaklı süreç kontrolü',
          kriter: 'Dış kaynaklı süreçler için kriter, seçim, performans izleme ve yeniden değerlendirme kontrolleri tanımlıdır.',
          referans: 'ISO 9001 — 8.4',
          agirlik: 2,
        },
        {
          baslik: 'Üretim ve hizmet sunum kontrolü',
          kriter: 'Üretim/hizmet koşulları, izlenebilirlik, müşteri/müşteri mülkiyeti ve serbest bırakma kontrolleri uygulanmaktadır.',
          referans: 'ISO 9001 — 8.5, 8.6',
          agirlik: 4,
        },
        {
          baslik: 'Uyumsuzluk ve düzeltici faaliyet',
          kriter: 'Uyumsuzluklar kayıt altına alınmış, kök neden analizi yapılmış, düzeltici faaliyet etkinliği izlenmektedir.',
          referans: 'ISO 9001 — 10.2',
          agirlik: 4,
        },
        {
          baslik: 'İç tetkik programı',
          kriter: 'İç tetkikler risk ve önceliklendirmeye dayalı yıllık programla yürütülür, bulgular takip edilir ve denetçi bağımsızlığı korunur.',
          referans: 'ISO 9001 — 9.2',
          agirlik: 4,
        },
        {
          baslik: 'Yönetim gözden geçirme',
          kriter: 'Yönetim gözden geçirme girdileri eksiksiz toplanmış, çıktılar kararlaştırılmış ve kaynaklar belirlenmiştir.',
          referans: 'ISO 9001 — 9.3',
          agirlik: 2,
        },
      ],
    },
    {
      kod: 'CL-KI-001',
      ad: 'Kurum İçi Operasyon ve Uyum Kontrol Listesi',
      standart: 'kurum_ici',
      aciklama:
        'Doküman, kayıt, bakım, kalibrasyon, tedarikçi, eğitim ve değişiklik süreçlerindeki kurum içi zorunlu kontrolleri denetler.',
      maddeler: [
        {
          baslik: 'Doküman yönetimi',
          kriter: 'Yayındaki kalite dokümanları güncel, revizyon kontrollü ve dağıtım kapsamındaki personel erişebilir durumdadır.',
          referans: 'Kurum İçi — Doküman Yönetimi',
          agirlik: 3,
        },
        {
          baslik: 'Kayıt yönetimi',
          kriter: 'Kalite kayıtları okunabilir, izlenebilir, saklama sürelerine uygun ve elektronik ortamda güvenli biçimde saklanmaktadır.',
          referans: 'Kurum İçi — Kayıt Saklama',
          agirlik: 3,
        },
        {
          baslik: 'Bakım planı',
          kriter: 'Kritik ekipmanların periyodik bakım planı, yedek parça planı ve arıza geçmişi güncel olarak izlenmektedir.',
          referans: 'Kurum İçi — Bakım Yönetimi',
          agirlik: 4,
        },
        {
          baslik: 'Ölçüm ve kalibrasyon',
          kriter: 'Ölçüm cihazları için envanter, kalibrasyon tarihi, kalibrasyon sonucu ve etiket kontrolü bulunmaktadır.',
          referans: 'Kurum İçi — Kalibrasyon',
          agirlik: 4,
        },
        {
          baslik: 'Tedarikçi kontrolü',
          kriter: 'Kritik tedarikçiler onaylı listeye alınmış, performansları izlenmiş ve yetersizlerse düzeltici faaliyet başlatılmıştır.',
          referans: 'Kurum İçi — Tedarikçi Değerlendirme',
          agirlik: 3,
        },
        {
          baslik: 'Eğitim ve personel yetkinliği',
          kriter: 'Departman eğitim planı yürürlüktedir; kritik görevler için yetkinlik matrisi güncel ve uygulanmaktadır.',
          referans: 'Kurum İçi — Eğitim Yönetimi',
          agirlik: 3,
        },
        {
          baslik: 'Değişiklik yönetimi',
          kriter: 'Ürün, süreç, ekipman veya doküman değişiklikleri önceden risk değerlendirmesinden geçmiş, yetkili onayı ve etki analizi içermektedir.',
          referans: 'Kurum İçi — Değişiklik Yönetimi',
          agirlik: 3,
        },
        {
          baslik: 'Acil durum ve iş sürekliliği',
          kriter: 'Acil durum planları güncel, tahliye planları görünür, ekipmanlar periyodik olarak denenmiş ve yedekleme yapılmıştır.',
          referans: 'Kurum İçi — İş Sürekliliği',
          agirlik: 3,
        },
      ],
    },
  ];
}

module.exports = {
  TETKIK_DURUMLARI,
  TETKIK_SONUCLARI,
  TETKIK_STANDARTLARI,
  TETKIK_DENETCI_GOREVLERI,
  TETKIK_DENETCI_DURUMLARI,
  TETKIK_BULGU_DURUMLARI,
  TETKIK_DURUM_ANAHTARLARI,
  TETKIK_SONUC_ANAHTARLARI,
  TETKIK_STANDART_ANAHTARLARI,
  TETKIK_DENETCI_GOREV_ANAHTARLARI,
  TETKIK_DENETCI_DURUM_ANAHTARLARI,
  TETKIK_SONUC_PUANLARI,
  durumEtiketi,
  sonucEtiketi,
  standartEtiketi,
  denetciGorevEtiketi,
  denetciDurumEtiketi,
  bulguDurumEtiketi,
  durumSinifi,
  sonucSinifi,
  yilGecerliMi,
  tarihYili,
  tetkikKoduUret,
  bulguKoduUret,
  tetkikGorunurlukSql,
  tetkikErisimiVar,
  tetkikDuzenlemeErisimiVar,
  puanHesapla,
  sonucDagilimi,
  bulguDofAktarilabilirMi,
  varsayilanTetkikVerileriniYukle,
  varsayilanChecklistler,
};
