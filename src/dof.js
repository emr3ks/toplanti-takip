'use strict';

/**
 * Düzeltici ve Önleyici Faaliyet (DÖF) modülünün sabitleri ve ortak
 * yardımcıları. Bu dosya veritabanı bağlantısı tutmaz; yalnızca etiket,
 * görünürlük ve kod üretme gibi küçük yardımcıları içerir.
 */

const DOF_TURLERI = Object.freeze({
  duzeltici: 'Düzeltici Faaliyet',
  onleyici: 'Önleyici Faaliyet',
});

const DOF_KAYNAKLARI = Object.freeze({
  ic_tetkik: 'İç Tetkik',
  musteri_sikayeti: 'Müşteri Şikayeti',
  surec_uretim_hatasi: 'Süreç/Üretim Hatası',
  ygg: 'YGG',
  diger: 'Diğer',
});

const DOF_DURUMLARI = Object.freeze({
  acik: 'Açık',
  kok_neden: 'Kök Neden & Aksiyon Aşamasında',
  etkinlik_bekliyor: 'Etkinlik Kontrolü Bekliyor',
  kapandi: 'Kapandı',
});

const DOF_AKSIYON_DURUMLARI = Object.freeze({
  acik: 'Açık',
  devam_ediyor: 'Devam Ediyor',
  tamamlandi: 'Tamamlandı',
  gecikti: 'Gecikti',
});

const DOF_DURUM_ANAHTARLARI = Object.freeze(Object.keys(DOF_DURUMLARI));
const DOF_TUR_ANAHTARLARI = Object.freeze(Object.keys(DOF_TURLERI));
const DOF_KAYNAK_ANAHTARLARI = Object.freeze(Object.keys(DOF_KAYNAKLARI));
const DOF_AKSIYON_DURUM_ANAHTARLARI = Object.freeze(Object.keys(DOF_AKSIYON_DURUMLARI));

const DOF_TAMAMLANAN = 'tamamlandi';
const DOF_KAPALI = 'kapandi';

const DOF_DURUM_SINIFLARI = Object.freeze({
  acik: 'dof-durum-acik',
  kok_neden: 'dof-durum-kok-neden',
  etkinlik_bekliyor: 'dof-durum-etkinlik',
  kapandi: 'dof-durum-kapandi',
});

const DOF_AKSIYON_SINIFLARI = Object.freeze({
  acik: 'dof-aksiyon-acik',
  devam_ediyor: 'dof-aksiyon-devam',
  tamamlandi: 'dof-aksiyon-tamam',
  gecikti: 'dof-aksiyon-gecikti',
});

function turEtiketi(tur) {
  return DOF_TURLERI[tur] || tur || '—';
}

function kaynakEtiketi(kaynak) {
  return DOF_KAYNAKLARI[kaynak] || kaynak || '—';
}

function durumEtiketi(durum) {
  return DOF_DURUMLARI[durum] || durum || '—';
}

function aksiyonDurumEtiketi(durum) {
  return DOF_AKSIYON_DURUMLARI[durum] || durum || '—';
}

function dofDurumSinifi(durum) {
  return DOF_DURUM_SINIFLARI[durum] || 'dof-durum-acik';
}

function aksiyonDurumSinifi(durum) {
  return DOF_AKSIYON_SINIFLARI[durum] || 'dof-aksiyon-acik';
}

/**
 * Aksiyonun kullanıcıya gösterilecek durumunu belirler. Hedef tarihi geçmiş
 * ve henüz tamamlanmamış aksiyonlar, kayıtlı durum ne olursa olsun gecikmiş
 * sayılır; böylece gecikmeler elle güncellenmeyi beklemez.
 */
function aksiyonEtkinDurum(aksiyon, bugun) {
  const durum = String(aksiyon?.durum || 'acik');
  if (durum === DOF_TAMAMLANAN) return DOF_TAMAMLANAN;
  if (durum === 'gecikti') return 'gecikti';
  const hedef = String(aksiyon?.hedef_tarih || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(hedef) && bugun && hedef < bugun) return 'gecikti';
  return durum;
}

function aksiyonGeciktiMi(aksiyon, bugun) {
  return aksiyonEtkinDurum(aksiyon, bugun) === 'gecikti';
}

function aksiyonlariCoz(aksiyonlar, bugun) {
  return (Array.isArray(aksiyonlar) ? aksiyonlar : []).map((aksiyon) => {
    const etkin = aksiyonEtkinDurum(aksiyon, bugun);
    return {
      ...aksiyon,
      etkin_durum: etkin,
      etkin_durum_etiketi: aksiyonDurumEtiketi(etkin),
      etkin_durum_sinifi: aksiyonDurumSinifi(etkin),
      gecikti: etkin === 'gecikti',
    };
  });
}

function tamamlananAksiyonSayisi(aksiyonlar) {
  return (Array.isArray(aksiyonlar) ? aksiyonlar : []).filter(
    (aksiyon) => String(aksiyon.durum) === DOF_TAMAMLANAN
  ).length;
}

function tumAksiyonlarTamamlandi(aksiyonlar) {
  const liste = Array.isArray(aksiyonlar) ? aksiyonlar : [];
  return liste.length > 0 && liste.every((aksiyon) => String(aksiyon.durum) === DOF_TAMAMLANAN);
}

/** DÖF kodunun yılını tespit tarihinden, yoksa bugünden üretir. */
function dofYili(tespitTarihi, varsayilanYil) {
  const eslesme = String(tespitTarihi || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  if (eslesme) return Number(eslesme[1]);
  const yil = Number(varsayilanYil);
  return Number.isInteger(yil) && yil > 0 ? yil : new Date().getFullYear();
}

/** Bir sonraki DÖF kodunu `DOF-YYYY-NNN` biçiminde üretir. */
function dofKoduUret(db, yil) {
  const onEk = `DOF-${yil}-`;
  const satirlar = db.prepare('SELECT kod FROM dof_kayitlari WHERE kod LIKE ?').all(`${onEk}%`);
  let enBuyuk = 0;
  for (const satir of satirlar) {
    const eslesme = String(satir.kod || '').match(/^DOF-(\d{4})-(\d+)$/);
    if (eslesme && Number(eslesme[1]) === Number(yil)) {
      enBuyuk = Math.max(enBuyuk, Number(eslesme[2]));
    }
  }
  return `${onEk}${String(enBuyuk + 1).padStart(3, '0')}`;
}

/**
 * Kullanıcının görebileceği DÖF kayıtları için SQL koşulu.
 * Kalite yönetimi tüm kayıtları, diğer kullanıcılar yalnızca kendi
 * departmanının, açtığı veya sorumlusu olduğu kayıtları görür.
 */
function dofGorunurlukSql(kullanici, tamErisim = false) {
  if (!kullanici) return { sql: '1 = 0', parametreler: [] };
  if (tamErisim) return { sql: '1 = 1', parametreler: [] };
  return {
    sql: `(d.departman_id = ? OR d.olusturan_id = ? OR EXISTS (
      SELECT 1 FROM dof_aksiyonlari a WHERE a.dof_id = d.id AND a.sorumlu_id = ?
    ))`,
    parametreler: [kullanici.departman_id || null, kullanici.id, kullanici.id],
  };
}

/** Gövde/başlık metnini tek satırda kısaltır. */
function kisaMetin(deger, uzunluk = 120) {
  const metin = String(deger || '').replace(/\s+/g, ' ').trim();
  return metin.length > uzunluk ? `${metin.slice(0, uzunluk - 1)}…` : metin;
}

module.exports = {
  DOF_TURLERI,
  DOF_KAYNAKLARI,
  DOF_DURUMLARI,
  DOF_AKSIYON_DURUMLARI,
  DOF_DURUM_ANAHTARLARI,
  DOF_TUR_ANAHTARLARI,
  DOF_KAYNAK_ANAHTARLARI,
  DOF_AKSIYON_DURUM_ANAHTARLARI,
  DOF_TAMAMLANAN,
  DOF_KAPALI,
  DOF_DURUM_SINIFLARI,
  DOF_AKSIYON_SINIFLARI,
  turEtiketi,
  kaynakEtiketi,
  durumEtiketi,
  aksiyonDurumEtiketi,
  dofDurumSinifi,
  aksiyonDurumSinifi,
  aksiyonEtkinDurum,
  aksiyonGeciktiMi,
  aksiyonlariCoz,
  tamamlananAksiyonSayisi,
  tumAksiyonlarTamamlandi,
  dofYili,
  dofKoduUret,
  dofGorunurlukSql,
  kisaMetin,
};
