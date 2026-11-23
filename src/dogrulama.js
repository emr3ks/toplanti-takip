'use strict';

const EPOSTA_DESENI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function metin(deger, varsayilan = '') {
  if (deger === undefined || deger === null) return varsayilan;
  return String(deger).trim();
}

function epostaGecerli(deger) {
  const adres = metin(deger);
  return adres.length > 0 && adres.length <= 254 && EPOSTA_DESENI.test(adres);
}

/**
 * Formlardan gelen dönüş adresini yalnızca uygulama içi yollara izin vererek temizler.
 * Açık yönlendirmeyi (open redirect) engeller.
 */
function guvenliDonus(deger, varsayilan = '/') {
  const adres = metin(deger);
  if (
    adres.startsWith('/') &&
    !adres.startsWith('//') &&
    !adres.includes('\\') &&
    !adres.includes('\n') &&
    adres.length <= 400
  ) {
    return adres;
  }
  return varsayilan;
}

function mesajliYol(yol, anahtar, mesaj) {
  const temel = 'http://yerel';
  const url = new URL(yol, temel);
  url.searchParams.set(anahtar, String(mesaj).slice(0, 800));
  return `${url.pathname}${url.search}`;
}

module.exports = { metin, epostaGecerli, guvenliDonus, mesajliYol };
