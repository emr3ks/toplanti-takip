'use strict';

/**
 * Faz 3 eğitim hatırlatma zamanlayıcısı.
 *
 * Yalnızca üretim girişinde (`server.js`) başlatılır; `createApp` içinde
 * başlatılmaz, böylece testler deterministik kalır. Zamanlayıcı aralığı
 * `unref()` edildiği için süreç ve testler açık kalma nedeniyle bloklanmaz.
 */

const { egitimHatirlatmalariGonder } = require('./bildirimler');

const VARSAYILAN_ARALIK_MS = 6 * 60 * 60 * 1000;
const VARSAYILAN_GUN = 7;

// Aynı süreçte birden fazla zamanlayıcı başlatılırsa önceki durdurulur;
// böylece çift başlatma çökmez ve gereksiz aralıklar birikmez.
let oncekiDurdurucu = null;

function hatirlatmaZamanlayicisiBaslat({
  db,
  mail,
  config,
  aralikMs = VARSAYILAN_ARALIK_MS,
  gun = VARSAYILAN_GUN,
} = {}) {
  if (typeof oncekiDurdurucu === 'function') {
    try {
      oncekiDurdurucu();
    } catch (hata) {
      console.error('[egitim hatırlatma zamanlayıcısı] önceki zamanlayıcı durdurulamadı:', hata);
    }
  }

  const aralik = Number(aralikMs);
  const periyot = Number.isFinite(aralik) && aralik > 0 ? aralik : VARSAYILAN_ARALIK_MS;

  let devamEden = null;
  let durduruldu = false;

  /**
   * Tek bir hatırlatma turu çalıştırır. Zaten bir tur sürüyorsa aynı
   * promise döndürülür; böylece zamanlayıcı üst üste binmez. Hata fırlatmaz.
   */
  function calistir() {
    if (devamEden) return devamEden;
    devamEden = Promise.resolve()
      .then(() => egitimHatirlatmalariGonder({ db, mail, config, gun }))
      .catch((hata) => {
        console.error('[egitim hatırlatma zamanlayıcısı]', hata);
        return {
          gonderilen: 0,
          atlanan: 0,
          hatalar: [hata instanceof Error ? hata.message : String(hata)],
        };
      })
      .finally(() => {
        devamEden = null;
      });
    return devamEden;
  }

  // İlk tur hemen, isteği bekletmeden (fire-and-forget) çalışır.
  void calistir();

  const zamanlayici = setInterval(() => {
    if (durduruldu) return;
    void calistir();
  }, periyot);

  if (zamanlayici && typeof zamanlayici.unref === 'function') {
    zamanlayici.unref();
  }

  function durdur() {
    durduruldu = true;
    clearInterval(zamanlayici);
    if (oncekiDurdurucu === durdur) oncekiDurdurucu = null;
  }

  oncekiDurdurucu = durdur;

  return {
    /** Zamanlayıcıyı durdurur. Birden fazla çağrılması güvenlidir. */
    durdur,
    /** Elle bir tur çalıştırır ve sonucu döndürür. */
    calistir,
  };
}

module.exports = {
  hatirlatmaZamanlayicisiBaslat,
  VARSAYILAN_ARALIK_MS,
  VARSAYILAN_GUN,
};
