'use strict';

/**
 * Kalite Yönetim Sistemi (QDMS) sabitleri ve doküman/taslak yardımcıları.
 */

const DOKUMAN_TURLERI = Object.freeze({
  PR: {
    kod: 'PR',
    ad: 'Prosedür',
    cogul: 'Prosedürler',
    aciklama: 'Bir sürecin nasıl yürütüleceğini tanımlayan dokümandır.',
    renk: '#4f46e5',
    varsayilanRenk: '#1e3a8a',
  },
  TL: {
    kod: 'TL',
    ad: 'Talimat',
    cogul: 'Talimatlar',
    aciklama: 'Belirli bir işin adım adım nasıl yapılacağını anlatan dokümandır.',
    renk: '#0d9488',
    varsayilanRenk: '#0f766e',
  },
  EK: {
    kod: 'EK',
    ad: 'El Kitabı',
    cogul: 'El Kitabı',
    aciklama: 'Kalite politikası, hedefleri ve sistemi bütünüyle açıklayan dokümandır.',
    renk: '#b45309',
    varsayilanRenk: '#7c2d12',
  },
  LS: {
    kod: 'LS',
    ad: 'Liste',
    cogul: 'Listeler',
    aciklama: 'Kontrol edilmesi gereken kayıt ve kalemlerin listesidir.',
    renk: '#7c3aed',
    varsayilanRenk: '#4338ca',
  },
  FR: {
    kod: 'FR',
    ad: 'Form',
    cogul: 'Formlar',
    aciklama: 'Süreç içinde doldurulan standart kayıt formudur.',
    renk: '#dc2626',
    varsayilanRenk: '#b91c1c',
  },
});

const TUR_KODLARI = Object.freeze(Object.keys(DOKUMAN_TURLERI));

const DOKUMAN_DURUMLARI = Object.freeze({
  taslak: 'Taslak',
  kontrol: 'Kontrol / Onay Bekliyor',
  yayinda: 'Yayında',
  iptal: 'İptal / Arşiv',
});

const DOKUMAN_DURUM_ANAHTARLARI = Object.freeze(Object.keys(DOKUMAN_DURUMLARI));

const DOKUMAN_DURUM_ACIKLAMALARI = Object.freeze({
  taslak: 'Hazırlanıyor; yalnızca hazırlayan ve kalite ekibi görür. PDF üzerinde TASLAK filigranı vardır.',
  kontrol: 'Onaya gönderildi; onaylayanların incelemesini bekliyor.',
  yayinda: 'Onaylandı ve dağıtıma açıldı; filigran kaldırılır.',
  iptal: 'Yürürlükten kaldırıldı; geçmiş revizyon olarak arşivde saklanır.',
});

const DURUM_SINIFLARI = Object.freeze({
  taslak: 'taslak',
  kontrol: 'kontrol',
  yayinda: 'yayinda',
  iptal: 'iptal',
});

const VARSAYILAN_BOLUMLER = Object.freeze({
  PR: [
    { baslik: '1. Amaç', ipucu: 'Bu prosedürün hangi amaca hizmet ettiğini kısaca yazın.', zorunlu: true },
    { baslik: '2. Kapsam', ipucu: 'Prosedürün hangi birim, süreç ve durumları kapsadığını belirtin.', zorunlu: true },
    { baslik: '3. Tanımlar ve Kısaltmalar', ipucu: 'Prosedürde geçen özel terimleri ve kısaltmaları açıklayın.', zorunlu: false },
    { baslik: '4. Sorumluluklar', ipucu: 'Hangi rolün hangi adımdan sorumlu olduğunu yazın.', zorunlu: true },
    { baslik: '5. Uygulama', ipucu: 'Sürecin adımlarını, karar noktalarını ve kayıtları anlatın.', zorunlu: true },
    { baslik: '6. İlgili Dokümanlar', ipucu: 'Bağlantılı prosedür, talimat, form ve mevzuatları listeleyin.', zorunlu: false },
  ],
  TL: [
    { baslik: '1. Amaç', ipucu: 'Talimatın hangi işi güvenli ve doğru biçimde yapmayı sağladığını yazın.', zorunlu: true },
    { baslik: '2. Kapsam', ipucu: 'Talimatın uygulandığı ekipman, birim ve koşulları belirtin.', zorunlu: true },
    { baslik: '3. İş Güvenliği Önlemleri', ipucu: 'Kullanılacak kişisel koruyucu donanım ve güvenlik kurallarını yazın.', zorunlu: true },
    { baslik: '4. Uygulama Adımları', ipucu: 'İşi adım adım, numaralandırarak anlatın.', zorunlu: true },
    { baslik: '5. İlgili Dokümanlar', ipucu: 'İlgili prosedür, form ve bakım kayıtlarını listeleyin.', zorunlu: false },
  ],
  EK: [
    { baslik: '1. Amaç', ipucu: 'El kitabının amacını ve kapsamını özetleyin.', zorunlu: true },
    { baslik: '2. Kapsam', ipucu: 'Sistemin geçerli olduğu tüm birim ve süreçleri belirtin.', zorunlu: true },
    { baslik: '3. Politika ve Taahhütler', ipucu: 'Kalite politikası, hedefler ve yönetim taahhütlerini yazın.', zorunlu: true },
    { baslik: '4. Organizasyon ve Sorumluluklar', ipucu: 'Kalite organizasyonunu ve sorumlulukları açıklayın.', zorunlu: false },
    { baslik: '5. Süreçler', ipucu: 'Ana süreçler ve aralarındaki etkileşimleri özetleyin.', zorunlu: false },
    { baslik: '6. Ekler', ipucu: 'El kitabına eklenen şema, liste ve kayıtları belirtin.', zorunlu: false },
  ],
  LS: [
    { baslik: '1. Amaç', ipucu: 'Listenin hangi kontrolü sağladığını yazın.', zorunlu: true },
    { baslik: '2. Kapsam', ipucu: 'Listenin kapsadığı kayıtları ve dönemi belirtin.', zorunlu: true },
    { baslik: '3. Liste Alanları', ipucu: 'Listede yer alan sütunları ve değerlendirme ölçütlerini açıklayın.', zorunlu: true },
    { baslik: '4. Kayıt ve Güncelleme Sorumluluğu', ipucu: 'Listenin kim tarafından, hangi sıklıkla güncelleneceğini yazın.', zorunlu: true },
  ],
  FR: [
    { baslik: '1. Form Amacı', ipucu: 'Formun hangi kaydı oluşturduğunu yazın.', zorunlu: true },
    { baslik: '2. Doldurma Talimatı', ipucu: 'Formun kim tarafından ve nasıl doldurulacağını açıklayın.', zorunlu: true },
    { baslik: '3. Form Alanları', ipucu: 'Formda istenen bilgileri ve zorunlu alanları listeleyin.', zorunlu: true },
    { baslik: '4. Onay', ipucu: 'Formun onay ve kayıt akışını belirtin.', zorunlu: false },
  ],
});

function turGetir(kod) {
  const anahtar = String(kod || '').trim().toUpperCase();
  return DOKUMAN_TURLERI[anahtar] || null;
}

function turKoduGecerliMi(kod) {
  return Boolean(turGetir(kod));
}

function durumEtiketi(durum) {
  return DOKUMAN_DURUMLARI[durum] || durum || '—';
}

function durumSinifi(durum) {
  return DURUM_SINIFLARI[durum] || 'taslak';
}

function revizyonEtiketi(revizyon) {
  const sayi = Number.isInteger(Number(revizyon)) && Number(revizyon) >= 0 ? Number(revizyon) : 0;
  return `Rev.${String(sayi).padStart(2, '0')}`;
}

function varsayilanSablonlar() {
  return TUR_KODLARI.map((kod) => {
    const tur = DOKUMAN_TURLERI[kod];
    return {
      turKod: kod,
      baslik: `${tur.ad} Şablonu`,
      bolumler: VARSAYILAN_BOLUMLER[kod],
      antetRenk: tur.varsayilanRenk,
      kenarlikStili: 'duz',
      altbilgiHazirlayan: 'Hazırlayan',
      altbilgiOnaylayan: 'Onaylayan',
    };
  });
}

function bolumleriCoz(deger) {
  if (Array.isArray(deger)) return deger;
  try {
    const cozulen = JSON.parse(deger || '[]');
    if (!Array.isArray(cozulen)) return [];
    return cozulen
      .filter((bolum) => bolum && typeof bolum.baslik === 'string')
      .map((bolum) => ({
        baslik: bolum.baslik,
        metin: typeof bolum.metin === 'string' ? bolum.metin : '',
      }));
  } catch {
    return [];
  }
}

function sablonBolumleriCoz(deger) {
  if (Array.isArray(deger)) return deger;
  try {
    const cozulen = JSON.parse(deger || '[]');
    if (!Array.isArray(cozulen)) return [];
    return cozulen
      .filter((bolum) => bolum && typeof bolum.baslik === 'string' && bolum.baslik.trim())
      .map((bolum) => ({
        baslik: bolum.baslik.trim().slice(0, 160),
        ipucu: String(bolum.ipucu || '').trim().slice(0, 400),
        zorunlu: Boolean(bolum.zorunlu),
      }));
  } catch {
    return [];
  }
}

function sablonGetir(db, turKod) {
  const kod = String(turKod || '').toUpperCase();
  let satir = db.prepare('SELECT * FROM sablonlar WHERE tur_kod = ?').get(kod);
  if (!satir) {
    const varsayilan = varsayilanSablonlar().find((s) => s.turKod === kod);
    if (!varsayilan) return null;
    db.prepare(
      `INSERT INTO sablonlar
        (tur_kod, baslik, bolumler, antet_renk, kenarlik_stili, altbilgi_hazirlayan, altbilgi_onaylayan, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      kod,
      varsayilan.baslik,
      JSON.stringify(varsayilan.bolumler),
      varsayilan.antetRenk,
      varsayilan.kenarlikStili,
      varsayilan.altbilgiHazirlayan,
      varsayilan.altbilgiOnaylayan,
      new Date().toISOString()
    );
    satir = db.prepare('SELECT * FROM sablonlar WHERE tur_kod = ?').get(kod);
  }
  return {
    ...satir,
    bolumler: sablonBolumleriCoz(satir.bolumler),
  };
}

function tumSablonlar(db) {
  return TUR_KODLARI.map((kod) => {
    const sablon = sablonGetir(db, kod);
    return {
      ...sablon,
      tur: DOKUMAN_TURLERI[kod],
      bolumSayisi: sablon.bolumler.length,
    };
  });
}

function sonrakiKod(db, turKod) {
  const kod = String(turKod || '').toUpperCase();
  if (!DOKUMAN_TURLERI[kod]) return '';
  const satirlar = db.prepare('SELECT kod FROM dokumanlar WHERE tur_kod = ?').all(kod);
  let enBuyuk = 0;
  for (const satir of satirlar) {
    const eslesme = String(satir.kod || '').match(/^([A-Z]+)-(\d+)$/);
    if (eslesme && eslesme[1] === kod) {
      enBuyuk = Math.max(enBuyuk, Number(eslesme[2]));
    }
  }
  return `${kod}-${String(enBuyuk + 1).padStart(3, '0')}`;
}

module.exports = {
  DOKUMAN_TURLERI,
  TUR_KODLARI,
  DOKUMAN_DURUMLARI,
  DOKUMAN_DURUM_ANAHTARLARI,
  DOKUMAN_DURUM_ACIKLAMALARI,
  VARSAYILAN_BOLUMLER,
  varsayilanSablonlar,
  turGetir,
  turKoduGecerliMi,
  durumEtiketi,
  durumSinifi,
  revizyonEtiketi,
  bolumleriCoz,
  sablonBolumleriCoz,
  sablonGetir,
  tumSablonlar,
  sonrakiKod,
};
