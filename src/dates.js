'use strict';

const TARIH_DESENI = /^\d{4}-\d{2}-\d{2}$/;
const SAAT_DESENI = /^([01]\d|2[0-3]):([0-5]\d)$/;

function gecerliTarih(deger) {
  if (typeof deger !== 'string' || !TARIH_DESENI.test(deger)) return false;
  const [yil, ay, gun] = deger.split('-').map(Number);
  const tarih = new Date(Date.UTC(yil, ay - 1, gun));
  return (
    tarih.getUTCFullYear() === yil &&
    tarih.getUTCMonth() === ay - 1 &&
    tarih.getUTCDate() === gun
  );
}

function gecerliSaat(deger) {
  return typeof deger === 'string' && SAAT_DESENI.test(deger);
}

function gecerliSaatDilimi(deger) {
  if (typeof deger !== 'string' || deger.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: deger }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Verilen zaman dilimindeki bugünün tarihini YYYY-MM-DD olarak döndürür. */
function bugunTz(saatDilimi = 'Europe/Istanbul', simdi = new Date()) {
  const dilim = saatDilimi && String(saatDilimi).trim() ? String(saatDilimi).trim() : 'Europe/Istanbul';
  try {
    const parcalar = new Intl.DateTimeFormat('en-CA', {
      timeZone: dilim,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(simdi);
    const al = (tur) => parcalar.find((p) => p.type === tur)?.value;
    return `${al('year')}-${al('month')}-${al('day')}`;
  } catch {
    if (dilim !== 'UTC') return bugunTz('UTC', simdi);
    return simdi.toISOString().slice(0, 10);
  }
}

/** YYYY-MM-DD tarihine gün ekler. */
function gunEkle(tarih, gun) {
  if (!gecerliTarih(tarih)) return tarih;
  const [yil, ay, gunDegeri] = tarih.split('-').map(Number);
  const tarihNesnesi = new Date(Date.UTC(yil, ay - 1, gunDegeri + gun));
  return tarihNesnesi.toISOString().slice(0, 10);
}

/** hedef - baslangic arasındaki gün farkı (hedef ilerideyse pozitif). */
function gunFarki(hedef, baslangic) {
  if (!gecerliTarih(hedef) || !gecerliTarih(baslangic)) return null;
  const [hy, ha, hg] = hedef.split('-').map(Number);
  const [by, ba, bg] = baslangic.split('-').map(Number);
  return Math.round(
    (Date.UTC(hy, ha - 1, hg) - Date.UTC(by, ba - 1, bg)) / 86_400_000
  );
}

function tarihTr(tarih) {
  if (!gecerliTarih(tarih)) return '—';
  const [yil, ay, gun] = tarih.split('-');
  return `${gun}.${ay}.${yil}`;
}

function zamanTr(zaman, saatDilimi = 'Europe/Istanbul') {
  if (!zaman) return '—';
  const tarih = new Date(zaman);
  if (Number.isNaN(tarih.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: saatDilimi || 'Europe/Istanbul',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(tarih);
  } catch {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(tarih);
  }
}

module.exports = {
  gecerliTarih,
  gecerliSaat,
  gecerliSaatDilimi,
  bugunTz,
  gunEkle,
  gunFarki,
  tarihTr,
  zamanTr,
};
