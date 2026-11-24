'use strict';

const EPOSTA_DURUMLARI = Object.freeze({
  gonderildi: 'Gönderildi',
  test_modu: 'Test modu',
  hata: 'Hata',
});

const EPOSTA_TURLERI = Object.freeze({
  test: 'Test E-postası',
  dokuman_onay: 'Doküman onay bildirimi',
  dokuman_yayin: 'Doküman yayın bildirimi',
  egitim_hatirlatma: 'Eğitim hatırlatması',
  dof_acildi: 'DÖF açılış bildirimi',
  dof_aksiyon: 'DÖF aksiyon atama bildirimi',
});

module.exports = {
  EPOSTA_DURUMLARI,
  EPOSTA_TURLERI,
};
