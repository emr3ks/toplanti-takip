'use strict';

const DURUMLAR = Object.freeze({
  aktif: 'Aktif',
  beklemede: 'Beklemede',
  tamamlandi: 'Tamamlandı',
});

const DURUM_ANAHTARLARI = Object.freeze(['aktif', 'beklemede', 'tamamlandi']);

const TOPLANTI_DURUMLARI = Object.freeze({
  acik: 'Açık',
  tamamlandi: 'Tamamlandı',
});

const EPOSTA_DURUMLARI = Object.freeze({
  gonderildi: 'Gönderildi',
  test_modu: 'Test modu',
  hata: 'Hata',
});

const EPOSTA_TURLERI = Object.freeze({
  rapor: 'Toplantı Raporu',
  hatirlatma: 'Hatırlatma',
  test: 'Test E-postası',
});

function durumEtiketi(durum) {
  return DURUMLAR[durum] || durum || '—';
}

function durumSinifi(durum) {
  return DURUMLAR[durum] ? `rozet-${durum}` : 'rozet-tamamlandi';
}

module.exports = {
  DURUMLAR,
  DURUM_ANAHTARLARI,
  TOPLANTI_DURUMLARI,
  EPOSTA_DURUMLARI,
  EPOSTA_TURLERI,
  durumEtiketi,
  durumSinifi,
};
