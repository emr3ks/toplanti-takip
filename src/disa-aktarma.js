'use strict';

/**
 * Bağımlılıksız CSV ve gerçek XLSX (.xlsx) dışa aktarma yardımcıları.
 *
 * - CSV: UTF-8 BOM'lu, ';' ayraçlı, CRLF satır sonlu (Türkçe Excel ile uyumlu).
 * - XLSX: Office Open XML paketi (ZIP) doğrudan Buffer olarak üretilir; harici
 *   paket gerekmez. Başlık satırı kalın + koyu mavi zemin + beyaz yazı, ilk
 *   satır dondurulmuş, otomatik filtre açık, sütun genişlikleri ayarlanabilir.
 *
 * Modül dosya veya ortam okumaz; yalnızca node:zlib kullanır.
 */

const { deflateRawSync } = require('node:zlib');

// XML 1.0'da izin verilmeyen kontrol karakterleri (sekme, LF ve CR hariç).
const XML_GECERSIZ = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
// CSV'de tırnak içine alınması gereken karakterler.
const CSV_OZEL = /[;"\r\n]/;
// Excel sayfa adında kullanılamayan karakterler.
const SAYFA_GECERSIZ = /[[\]:*?/\\]/g;

/** Tüm dışa aktarılan hücreler için tek tip metin üretir. */
function hucreMetni(deger) {
  if (deger === null || deger === undefined) return '';
  if (deger instanceof Date) {
    return Number.isNaN(deger.getTime()) ? '' : deger.toISOString().slice(0, 10);
  }
  if (typeof deger === 'symbol') return deger.toString();
  return String(deger);
}

/** XML metin/öznitelik değerlerini kaçışlar ve geçersiz karakterleri temizler. */
function xmlKacisla(deger) {
  return hucreMetni(deger)
    .replace(XML_GECERSIZ, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Tek bir CSV hücresini kaçışlar. */
function csvHucre(deger) {
  const metin = hucreMetni(deger);
  return CSV_OZEL.test(metin) ? `"${metin.replace(/"/g, '""')}"` : metin;
}

/**
 * CSV üretir: UTF-8 BOM + ';' ayraç + CRLF.
 * @param {{basliklar?: any[], satirlar?: any[][]}} veri
 * @returns {Buffer}
 */
function csvOlustur({ basliklar = [], satirlar = [] } = {}) {
  const basliklarDizisi = Array.isArray(basliklar) ? basliklar : [];
  const satirlarDizisi = Array.isArray(satirlar) ? satirlar : [];
  const satirlarMetni = [];

  if (basliklarDizisi.length > 0) {
    satirlarMetni.push(basliklarDizisi.map(csvHucre).join(';'));
  }
  for (const satir of satirlarDizisi) {
    const hucreler = Array.isArray(satir) ? satir : [satir];
    satirlarMetni.push(hucreler.map(csvHucre).join(';'));
  }

  // Her satır (son satır dahil) CRLF ile biter; Excel bunu sorunsuz okur.
  const govde = satirlarMetni.map((satir) => `${satir}\r\n`).join('');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, Buffer.from(govde, 'utf8')]);
}

// ---------------------------------------------------------------------------
// XLSX yardımcıları
// ---------------------------------------------------------------------------

/** Excel sayfa adını 31 karaktere sınırlar ve geçersiz karakterleri temizler. */
function sayfaAdiTemizle(ad) {
  const metin = hucreMetni(ad)
    .replace(XML_GECERSIZ, '')
    .replace(/[\t\n\r]/g, ' ')
    .replace(SAYFA_GECERSIZ, ' ')
    .replace(/^'+|'+$/g, '')
    .trim();
  // Excel boş sayfa adına izin vermez; ayrıca ad 31 karakteri aşamaz.
  const kirpilmis = Array.from(metin || 'Rapor').slice(0, 31).join('').trim();
  return kirpilmis || 'Rapor';
}

/** 1 tabanlı sütun sırasını Excel sütun harfine çevirir (1 -> A, 27 -> AA). */
function kolonAdi(sira) {
  let kalan = Math.trunc(Number(sira)) || 1;
  let ad = '';
  while (kalan > 0) {
    const harf = (kalan - 1) % 26;
    ad = String.fromCharCode(65 + harf) + ad;
    kalan = Math.floor((kalan - 1) / 26);
  }
  return ad || 'A';
}

/** Sütun genişliğini Excel birimi olarak doğrular; geçersizse 18 kullanır. */
function genislikDegeri(deger) {
  const sayi = Number(deger);
  return Number.isFinite(sayi) && sayi > 0 ? Math.min(Math.round(sayi * 100) / 100, 255) : 18;
}

/** Hücre türünü belirler: bos | sayi | mantik | metin. */
function hucreTuru(deger) {
  if (deger === null || deger === undefined) return 'bos';
  if (deger instanceof Date) return Number.isNaN(deger.getTime()) ? 'bos' : 'metin';
  if (typeof deger === 'boolean') return 'mantik';
  if (typeof deger === 'number') return Number.isFinite(deger) ? 'sayi' : 'metin';
  if (typeof deger === 'string' && deger === '') return 'bos';
  return 'metin';
}

/** Inline string hücresi üretir (xml:space="preserve" boşlukları korur). */
function inlineStrHucre(ref, stil, deger) {
  const stilEki = stil ? ` s="${stil}"` : '';
  return (
    `<c r="${ref}"${stilEki} t="inlineStr"><is>` +
    `<t xml:space="preserve">${xmlKacisla(deger)}</t></is></c>`
  );
}

/** Çalışma sayfası XML'ini üretir. */
function sayfaXml({ basliklar, satirlar, genislikler }) {
  const basliklarDizisi = Array.isArray(basliklar) ? basliklar : [];
  const satirlarDizisi = Array.isArray(satirlar) ? satirlar : [];
  const genisliklerDizisi = Array.isArray(genislikler) ? genislikler : [];
  const baslikVar = basliklarDizisi.length > 0;

  const enGenisSatir = satirlarDizisi.reduce(
    (en, satir) => Math.max(en, Array.isArray(satir) ? satir.length : 1),
    0
  );
  const kolonSayisi = Math.max(basliklarDizisi.length, enGenisSatir, 1);
  const sonKolon = kolonAdi(kolonSayisi);
  const veriBaslangic = baslikVar ? 2 : 1;
  const sonSatir = (baslikVar ? 1 : 0) + satirlarDizisi.length;
  const boyut = sonSatir > 0 ? `A1:${sonKolon}${sonSatir}` : 'A1';

  const parcalar = [`${XML_BASLIK}` +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  parcalar.push(`<dimension ref="${boyut}"/>`);

  // Görünüm: başlık satırı varsa ilk satırı dondur.
  if (baslikVar) {
    parcalar.push(
      '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>'
    );
  } else {
    parcalar.push('<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>');
  }

  parcalar.push('<sheetFormatPr defaultRowHeight="15"/>');

  const kolonlar = [];
  for (let sira = 1; sira <= kolonSayisi; sira += 1) {
    const genislik = genislikDegeri(genisliklerDizisi[sira - 1]);
    kolonlar.push(`<col min="${sira}" max="${sira}" width="${genislik}" customWidth="1"/>`);
  }
  parcalar.push(`<cols>${kolonlar.join('')}</cols>`);
  parcalar.push('<sheetData>');

  // Başlık satırı: kalın + beyaz yazı + koyu mavi zemin (stil 1).
  if (baslikVar) {
    const hucreler = basliklarDizisi.map((baslik, indeks) =>
      inlineStrHucre(`${kolonAdi(indeks + 1)}1`, 1, baslik)
    );
    parcalar.push(`<row r="1" spans="1:${basliklarDizisi.length}">${hucreler.join('')}</row>`);
  }

  satirlarDizisi.forEach((satir, satirIndeksi) => {
    const satirNo = veriBaslangic + satirIndeksi;
    const hucreler = Array.isArray(satir) ? satir : [satir];
    const xmlHucreler = [];
    hucreler.forEach((deger, kolonIndeksi) => {
      const tur = hucreTuru(deger);
      if (tur === 'bos') return; // null/undefined/boş dize: hücre yazılmaz
      const ref = `${kolonAdi(kolonIndeksi + 1)}${satirNo}`;
      if (tur === 'sayi') {
        xmlHucreler.push(`<c r="${ref}"><v>${deger}</v></c>`);
      } else if (tur === 'mantik') {
        xmlHucreler.push(`<c r="${ref}" t="b"><v>${deger ? 1 : 0}</v></c>`);
      } else {
        xmlHucreler.push(inlineStrHucre(ref, 0, deger));
      }
    });
    // Boş satırlar da yazılır; böylece boyut ve filtre aralığı tutarlı kalır.
    parcalar.push(
      `<row r="${satirNo}" spans="1:${Math.max(hucreler.length, 1)}">${xmlHucreler.join('')}</row>`
    );
  });

  parcalar.push('</sheetData>');
  if (baslikVar) {
    // Otomatik filtre başlık satırını ve tüm veriyi kapsar.
    parcalar.push(`<autoFilter ref="A1:${sonKolon}${sonSatir}"/>`);
  }
  parcalar.push('</worksheet>');
  return parcalar.join('');
}

// ---------------------------------------------------------------------------
// ZIP (Office Open XML paketi)
// ---------------------------------------------------------------------------

let crcTablo = null;

/** CRC-32 (IEEE 802.3) hesaplar. */
function crc32(veri) {
  if (!crcTablo) {
    crcTablo = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let deger = i;
      for (let bit = 0; bit < 8; bit += 1) {
        deger = deger & 1 ? 0xedb88320 ^ (deger >>> 1) : deger >>> 1;
      }
      crcTablo[i] = deger;
    }
  }
  let crc = -1;
  for (let i = 0; i < veri.length; i += 1) {
    crc = (crc >>> 8) ^ crcTablo[(crc ^ veri[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// Sabit DOS zaman damgası (2020-01-01 00:00) — çıktıyı tekrarlanabilir kılar.
const DOS_SAAT = 0;
const DOS_TARIH = ((2020 - 1980) << 9) | (1 << 5) | 1;

/** Dosya listesinden sıkıştırılmış (deflate) bir ZIP arşivi üretir. */
function zipOlustur(dosyalar) {
  const parcalar = [];
  const merkeziDizinler = [];
  let konum = 0;

  for (const dosya of dosyalar) {
    const adTamponu = Buffer.from(dosya.ad, 'utf8');
    const ham = Buffer.isBuffer(dosya.icerik) ? dosya.icerik : Buffer.from(dosya.icerik, 'utf8');
    const sikistirilmis = deflateRawSync(ham);
    const dosyaCrc = crc32(ham);

    const yerelBaslik = Buffer.alloc(30);
    yerelBaslik.writeUInt32LE(0x04034b50, 0); // yerel dosya başlığı imzası
    yerelBaslik.writeUInt16LE(20, 4); // gereken sürüm (2.0)
    yerelBaslik.writeUInt16LE(0x0800, 6); // dosya adı UTF-8
    yerelBaslik.writeUInt16LE(8, 8); // yöntem: deflate
    yerelBaslik.writeUInt16LE(DOS_SAAT, 10);
    yerelBaslik.writeUInt16LE(DOS_TARIH, 12);
    yerelBaslik.writeUInt32LE(dosyaCrc, 14);
    yerelBaslik.writeUInt32LE(sikistirilmis.length, 18);
    yerelBaslik.writeUInt32LE(ham.length, 22);
    yerelBaslik.writeUInt16LE(adTamponu.length, 26);
    yerelBaslik.writeUInt16LE(0, 28);

    parcalar.push(yerelBaslik, adTamponu, sikistirilmis);

    const merkeziDizin = Buffer.alloc(46);
    merkeziDizin.writeUInt32LE(0x02014b50, 0); // merkezi dizin imzası
    merkeziDizin.writeUInt16LE(20, 4); // oluşturan sürüm
    merkeziDizin.writeUInt16LE(20, 6);
    merkeziDizin.writeUInt16LE(0x0800, 8);
    merkeziDizin.writeUInt16LE(8, 10);
    merkeziDizin.writeUInt16LE(DOS_SAAT, 12);
    merkeziDizin.writeUInt16LE(DOS_TARIH, 14);
    merkeziDizin.writeUInt32LE(dosyaCrc, 16);
    merkeziDizin.writeUInt32LE(sikistirilmis.length, 20);
    merkeziDizin.writeUInt32LE(ham.length, 24);
    merkeziDizin.writeUInt16LE(adTamponu.length, 28);
    merkeziDizin.writeUInt16LE(0, 30); // ekstra alan
    merkeziDizin.writeUInt16LE(0, 32); // yorum
    merkeziDizin.writeUInt16LE(0, 34); // disk numarası
    merkeziDizin.writeUInt16LE(0, 36); // iç öznitelikler
    merkeziDizin.writeUInt32LE(0, 38); // dış öznitelikler
    merkeziDizin.writeUInt32LE(konum, 42); // yerel başlık ofseti

    merkeziDizinler.push(Buffer.concat([merkeziDizin, adTamponu]));
    konum += yerelBaslik.length + adTamponu.length + sikistirilmis.length;
  }

  const merkeziDizin = Buffer.concat(merkeziDizinler);
  const sonu = Buffer.alloc(22);
  sonu.writeUInt32LE(0x06054b50, 0); // merkezi dizin sonu imzası
  sonu.writeUInt16LE(0, 4); // disk numarası
  sonu.writeUInt16LE(0, 6); // merkezi dizin diski
  sonu.writeUInt16LE(dosyalar.length, 8);
  sonu.writeUInt16LE(dosyalar.length, 10);
  sonu.writeUInt32LE(merkeziDizin.length, 12);
  sonu.writeUInt32LE(konum, 16);
  sonu.writeUInt16LE(0, 20); // yorum uzunluğu

  return Buffer.concat([...parcalar, merkeziDizin, sonu]);
}

// ---------------------------------------------------------------------------
// XLSX paketi
// ---------------------------------------------------------------------------

const XML_BASLIK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const ICERIK_TURLERI =
  `${XML_BASLIK}` +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ' +
  'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>';

const KOK_ILISKILER =
  `${XML_BASLIK}` +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="xl/workbook.xml"/>' +
  '<Relationship Id="rId2" ' +
  'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ' +
  'Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" ' +
  'Target="docProps/app.xml"/>' +
  '</Relationships>';

const CALISMA_KITABI_ILISKILERI =
  `${XML_BASLIK}` +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
  'Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
  'Target="styles.xml"/>' +
  '</Relationships>';

const STILLER =
  `${XML_BASLIK}` +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid">' +
  '<fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" ' +
  'applyAlignment="1"><alignment vertical="center"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
  '</styleSheet>';

/**
 * Gerçek bir Office Open XML çalışma kitabı üretir (tek sayfa).
 * @param {{sayfaAdi?: string, basliklar?: any[], satirlar?: any[][], genislikler?: number[]}} veri
 * @returns {Buffer}
 */
function xlsxOlustur({
  sayfaAdi = 'Rapor',
  basliklar = [],
  satirlar = [],
  genislikler = [],
} = {}) {
  const ad = sayfaAdiTemizle(sayfaAdi);
  const sayfa = sayfaXml({ basliklar, satirlar, genislikler });
  const zaman = new Date().toISOString();

  const calismaKitabi =
    `${XML_BASLIK}` +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<workbookPr/>' +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    '<sheets>' +
    `<sheet name="${xmlKacisla(ad)}" sheetId="1" r:id="rId1"/>` +
    '</sheets>' +
    '</workbook>';

  const cekirdek =
    `${XML_BASLIK}` +
    '<cp:coreProperties ' +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlKacisla(ad)}</dc:title>` +
    '<dc:creator>QDMS</dc:creator>' +
    '<cp:lastModifiedBy>QDMS</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${zaman}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${zaman}</dcterms:modified>` +
    '</cp:coreProperties>';

  const uygulama =
    `${XML_BASLIK}` +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>QDMS</Application>' +
    '<DocSecurity>0</DocSecurity>' +
    '<ScaleCrop>false</ScaleCrop>' +
    '<Company></Company>' +
    '<LinksUpToDate>false</LinksUpToDate>' +
    '<SharedDoc>false</SharedDoc>' +
    '<HyperlinksChanged>false</HyperlinksChanged>' +
    '<AppVersion>1.0</AppVersion>' +
    '</Properties>';

  return zipOlustur([
    { ad: '[Content_Types].xml', icerik: ICERIK_TURLERI },
    { ad: '_rels/.rels', icerik: KOK_ILISKILER },
    { ad: 'docProps/core.xml', icerik: cekirdek },
    { ad: 'docProps/app.xml', icerik: uygulama },
    { ad: 'xl/workbook.xml', icerik: calismaKitabi },
    { ad: 'xl/_rels/workbook.xml.rels', icerik: CALISMA_KITABI_ILISKILERI },
    { ad: 'xl/styles.xml', icerik: STILLER },
    { ad: 'xl/worksheets/sheet1.xml', icerik: sayfa },
  ]);
}

module.exports = {
  csvOlustur,
  xlsxOlustur,
  hucreMetni,
  sayfaAdiTemizle,
  kolonAdi,
  xmlKacisla,
  crc32,
};
