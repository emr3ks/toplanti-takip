'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateRawSync, crc32: zlibCrc32 } = require('node:zlib');

const {
  csvOlustur,
  xlsxOlustur,
  hucreMetni,
  sayfaAdiTemizle,
  kolonAdi,
  xmlKacisla,
} = require('../src/disa-aktarma');

// ---------------------------------------------------------------------------
// Test yardımcıları
// ---------------------------------------------------------------------------

/** ZIP arşivini merkezi dizinden okuyup { ad -> Buffer } döndürür. */
function zipOku(tampon) {
  const enErken = Math.max(0, tampon.length - 65_557);
  let sonu = -1;
  for (let i = tampon.length - 22; i >= enErken; i -= 1) {
    if (tampon.readUInt32LE(i) === 0x06054b50) {
      sonu = i;
      break;
    }
  }
  assert.notEqual(sonu, -1, 'ZIP merkezi dizin sonu (EOCD) bulunamadı');

  const adet = tampon.readUInt16LE(sonu + 10);
  const merkezBoyut = tampon.readUInt32LE(sonu + 12);
  let imlec = tampon.readUInt32LE(sonu + 16);
  assert.equal(imlec + merkezBoyut, sonu, 'merkezi dizin boyutu EOCD ile uyuşmuyor');

  const dosyalar = new Map();
  for (let i = 0; i < adet; i += 1) {
    assert.equal(tampon.readUInt32LE(imlec), 0x02014b50, 'merkezi dizin imzası geçersiz');
    const yontem = tampon.readUInt16LE(imlec + 10);
    const crc = tampon.readUInt32LE(imlec + 16);
    const sikistirilmisBoyut = tampon.readUInt32LE(imlec + 20);
    const hamBoyut = tampon.readUInt32LE(imlec + 24);
    const adUzunluk = tampon.readUInt16LE(imlec + 28);
    const ekstraUzunluk = tampon.readUInt16LE(imlec + 30);
    const yorumUzunluk = tampon.readUInt16LE(imlec + 32);
    const yerelKonum = tampon.readUInt32LE(imlec + 42);
    const ad = tampon.toString('utf8', imlec + 46, imlec + 46 + adUzunluk);

    assert.equal(tampon.readUInt32LE(yerelKonum), 0x04034b50, `${ad}: yerel başlık imzası geçersiz`);
    const yerelAdUzunluk = tampon.readUInt16LE(yerelKonum + 26);
    const yerelEkstra = tampon.readUInt16LE(yerelKonum + 28);
    const veriBaslangic = yerelKonum + 30 + yerelAdUzunluk + yerelEkstra;
    const hamVeri = tampon.subarray(veriBaslangic, veriBaslangic + sikistirilmisBoyut);
    const icerik = yontem === 0 ? Buffer.from(hamVeri) : inflateRawSync(hamVeri);

    assert.equal(icerik.length, hamBoyut, `${ad}: açılmış boyut uyuşmuyor`);
    assert.equal(zlibCrc32(icerik), crc, `${ad}: CRC-32 uyuşmuyor`);

    dosyalar.set(ad, icerik);
    imlec += 46 + adUzunluk + ekstraUzunluk + yorumUzunluk;
  }
  return dosyalar;
}

/** Bir hücrenin XML parçasını döndürür. */
function hucreXml(sayfa, ref) {
  const eslesme = sayfa.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`));
  assert.ok(eslesme, `${ref} hücresi sayfada bulunamadı`);
  return eslesme[0];
}

/** XML parçalarında ham '&' ve geçersiz kontrol karakteri olmadığını doğrular. */
function xmlGecerliMi(dosyalar) {
  const hamAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  const gecersizKontrol = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
  for (const [ad, icerik] of dosyalar) {
    if (!ad.endsWith('.xml')) continue;
    const xml = icerik.toString('utf8');
    assert.ok(xml.startsWith('<?xml '), `${ad}: XML bildirimi yok`);
    assert.doesNotMatch(xml, hamAmpersand, `${ad}: kaçışlanmamış '&' var`);
    assert.doesNotMatch(xml, gecersizKontrol, `${ad}: geçersiz XML kontrol karakteri var`);
  }
}

function ornekVeri() {
  return {
    sayfaAdi: 'Eğitim Raporu',
    basliklar: ['Ad Soyad', 'İş Güvenliği ÇĞİÖŞÜ', 'Puan', 'Aktif', 'Tarih', 'Not'],
    satirlar: [
      ['Ayşe Yılmaz; "Usta"', 'İş Güvenliği ÇĞİÖŞÜ', 87.5, true, new Date('2024-03-05T00:00:00Z'), 'Satır\nİki'],
      [null, undefined, 0, false, null, ''],
      ['<Ali & Veli>', 'Metin', 100, true, new Date('2024-12-31T00:00:00Z'), '  boşluklu  '],
    ],
    genislikler: [30, 12],
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test('CSV: UTF-8 BOM, başlık ilk satır, ; ayraç ve CRLF', () => {
  const tampon = csvOlustur({ basliklar: ['Ad', 'Tutar'], satirlar: [['Ayşe', 1234.5]] });

  assert.deepEqual([...tampon.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM baytları yok');
  assert.equal(tampon.toString('utf8'), '\uFEFFAd;Tutar\r\nAyşe;1234.5\r\n');
});

test('CSV: ; " ve satır sonu içeren hücreler tırnaklanır, iç tırnak ikilenir', () => {
  const tampon = csvOlustur({
    basliklar: ['Başlık;1'],
    satirlar: [['a;b', 'a"b', 'a\nb', 'a\r\nb']],
  });

  assert.equal(
    tampon.toString('utf8'),
    '\uFEFF"Başlık;1"\r\n"a;b";"a""b";"a\nb";"a\r\nb"\r\n'
  );
});

test('CSV: Türkçe karakterler korunur, null/undefined/boş hücreler boş kalır', () => {
  const tampon = csvOlustur({
    basliklar: ['Ad', 'Not', 'Tarih', 'Puan'],
    satirlar: [
      ['İş Güvenliği ÇĞİÖŞÜ', null, new Date('2024-03-05T00:00:00Z'), 0],
      [undefined, '', new Date('2024-12-31T00:00:00Z'), 42],
    ],
  });

  assert.equal(
    tampon.toString('utf8'),
    '\uFEFFAd;Not;Tarih;Puan\r\n' +
      'İş Güvenliği ÇĞİÖŞÜ;;2024-03-05;0\r\n' +
      ';;2024-12-31;42\r\n'
  );
});

test('CSV: boş veri yalnızca BOM üretir ve hata vermez', () => {
  assert.equal(csvOlustur({}).toString('utf8'), '\uFEFF');
  assert.equal(csvOlustur({ basliklar: [], satirlar: [] }).toString('utf8'), '\uFEFF');
  assert.equal(csvOlustur().toString('utf8'), '\uFEFF');
});

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

test('hucreMetni değerleri CSV/XLSX kurallarına göre metne çevirir', () => {
  assert.equal(hucreMetni(null), '');
  assert.equal(hucreMetni(undefined), '');
  assert.equal(hucreMetni(12.5), '12.5');
  assert.equal(hucreMetni(0), '0');
  assert.equal(hucreMetni(true), 'true');
  assert.equal(hucreMetni(new Date('2024-02-29T23:30:00Z')), '2024-02-29');
  assert.equal(hucreMetni(new Date('geçersiz')), '');
  assert.equal(hucreMetni('İş Güvenliği'), 'İş Güvenliği');
});

test('xmlKacisla özel karakterleri kaçışlar ve kontrol karakterlerini temizler', () => {
  assert.equal(
    xmlKacisla('& < > " \' İş'),
    '&amp; &lt; &gt; &quot; &apos; İş'
  );
  assert.equal(xmlKacisla('a\u0000b\u0007c\u001Fd'), 'abcd');
});

test('sayfaAdiTemizle geçersiz karakterleri atar ve 31 karaktere sınırlar', () => {
  const ad = sayfaAdiTemizle(`Rapor[2024]:*?/\\${'X'.repeat(40)}`);
  assert.ok(ad.length <= 31, `sayfa adı çok uzun: ${ad.length}`);
  assert.doesNotMatch(ad, /[[\]:*?/\\]/);
  assert.ok(ad.startsWith('Rapor'));
  assert.equal(sayfaAdiTemizle(''), 'Rapor');
  assert.equal(sayfaAdiTemizle(null), 'Rapor');
  assert.equal(sayfaAdiTemizle('  Eğitim  '), 'Eğitim');
  assert.equal(sayfaAdiTemizle('A\tB\nC'), 'A B C');
  assert.ok(sayfaAdiTemizle('X'.repeat(31)).length === 31);
});

test('kolonAdi sütun sırasını Excel harflerine çevirir', () => {
  assert.equal(kolonAdi(1), 'A');
  assert.equal(kolonAdi(26), 'Z');
  assert.equal(kolonAdi(27), 'AA');
  assert.equal(kolonAdi(52), 'AZ');
  assert.equal(kolonAdi(702), 'ZZ');
  assert.equal(kolonAdi(703), 'AAA');
});

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

test('XLSX: PK imzası ve zorunlu OOXML parçaları üretilir', () => {
  const tampon = xlsxOlustur(ornekVeri());

  assert.equal(tampon.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'ZIP imzası yok');

  const dosyalar = zipOku(tampon);
  for (const ad of [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'docProps/app.xml',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(dosyalar.has(ad), `eksik parça: ${ad}`);
  }

  const icerikTuru = dosyalar.get('[Content_Types].xml').toString('utf8');
  assert.match(icerikTuru, /spreadsheetml\.sheet\.main\+xml/);
  assert.match(icerikTuru, /spreadsheetml\.worksheet\+xml/);
  assert.match(icerikTuru, /spreadsheetml\.styles\+xml/);
  assert.match(icerikTuru, /worksheets\/sheet1\.xml/);

  const iliskiler = dosyalar.get('xl/_rels/workbook.xml.rels').toString('utf8');
  assert.match(iliskiler, /worksheets\/sheet1\.xml/);
  assert.match(iliskiler, /styles\.xml/);

  const kitap = dosyalar.get('xl/workbook.xml').toString('utf8');
  assert.ok(kitap.includes('<sheet name="Eğitim Raporu" sheetId="1" r:id="rId1"/>'));
  assert.equal((kitap.match(/<sheet /g) || []).length, 1, 'tam olarak bir sayfa olmalı');

  xmlGecerliMi(dosyalar);
});

test('XLSX: hücreler doğru tür ve değerlerle yazılır', () => {
  const dosyalar = zipOku(xlsxOlustur(ornekVeri()));
  const sayfa = dosyalar.get('xl/worksheets/sheet1.xml').toString('utf8');

  // Türkçe metin ve XML kaçışı
  assert.ok(sayfa.includes('İş Güvenliği ÇĞİÖŞÜ'), 'Türkçe metin korunmadı');
  assert.ok(sayfa.includes('Ayşe Yılmaz; &quot;Usta&quot;'), 'tırnak kaçışı yok');
  assert.ok(sayfa.includes('&lt;Ali &amp; Veli&gt;'), 'XML kaçışı yok');
  assert.ok(sayfa.includes('Satır\nİki'), 'satır sonu korunmadı');

  // Başlık hücreleri: inlineStr + başlık stili (s="1")
  for (const ref of ['A1', 'B1', 'C1', 'D1', 'E1', 'F1']) {
    const hucre = hucreXml(sayfa, ref);
    assert.match(hucre, /t="inlineStr"/, `${ref}: başlık inlineStr değil`);
    assert.match(hucre, /s="1"/, `${ref}: başlık stili yok`);
  }

  // Sayısal hücre: inlineStr DEĞİL, <v> ile sayısal değer
  const puan = hucreXml(sayfa, 'C2');
  assert.doesNotMatch(puan, /t="/, 'sayısal hücre türü yanlış');
  assert.match(puan, /<v>87\.5<\/v>/);
  assert.doesNotMatch(hucreXml(sayfa, 'C3'), /t="/);
  assert.match(hucreXml(sayfa, 'C3'), /<v>0<\/v>/);
  assert.match(hucreXml(sayfa, 'C4'), /<v>100<\/v>/);

  // Mantıksal hücreler
  assert.match(hucreXml(sayfa, 'D2'), /^<c r="D2" t="b"><v>1<\/v><\/c>$/);
  assert.match(hucreXml(sayfa, 'D3'), /^<c r="D3" t="b"><v>0<\/v><\/c>$/);

  // Tarih, YYYY-MM-DD metni olarak
  assert.match(hucreXml(sayfa, 'E2'), /t="inlineStr"/);
  assert.ok(hucreXml(sayfa, 'E2').includes('2024-03-05'));
  assert.ok(hucreXml(sayfa, 'E4').includes('2024-12-31'));

  // null/undefined/boş dize hücresi yazılmaz
  for (const ref of ['A3', 'B3', 'E3', 'F3']) {
    assert.throws(() => hucreXml(sayfa, ref), /bulunamadı/, `${ref} boş olmalıydı`);
  }

  // Boşluklar korunur
  assert.ok(sayfa.includes('<t xml:space="preserve">  boşluklu  </t>'));
});

test('XLSX: dondurulmuş başlık, otomatik filtre, sütun genişlikleri ve stil', () => {
  const dosyalar = zipOku(xlsxOlustur(ornekVeri()));
  const sayfa = dosyalar.get('xl/worksheets/sheet1.xml').toString('utf8');

  assert.ok(
    sayfa.includes(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    ),
    'dondurulmuş bölme yok'
  );
  assert.ok(sayfa.includes('<autoFilter ref="A1:F4"/>'), 'otomatik filtre aralığı yanlış');
  assert.ok(sayfa.includes('<dimension ref="A1:F4"/>'), 'boyut aralığı yanlış');

  assert.ok(sayfa.includes('<col min="1" max="1" width="30" customWidth="1"/>'));
  assert.ok(sayfa.includes('<col min="2" max="2" width="12" customWidth="1"/>'));
  assert.ok(sayfa.includes('<col min="3" max="3" width="18" customWidth="1"/>'));

  const stiller = dosyalar.get('xl/styles.xml').toString('utf8');
  assert.match(stiller, /<b\/>/, 'kalın yazı stili yok');
  assert.match(stiller, /<fgColor rgb="FF1E3A8A"\/>/, 'dolgusu rengi yok');
  assert.match(stiller, /<color rgb="FFFFFFFF"\/>/, 'beyaz yazı rengi yok');
  assert.match(stiller, /patternType="solid"/);
  assert.match(stiller, /<cellXfs count="2">/);
});

test('XLSX: sayfa adı güvenli biçimde kullanılır, genişlik verilmemişse 18 olur', () => {
  const uzunAd = `Rapor[2024]:*?/\\${'X'.repeat(40)}`;
  const temizAd = sayfaAdiTemizle(uzunAd);
  const dosyalar = zipOku(
    xlsxOlustur({ sayfaAdi: uzunAd, basliklar: ['A', 'B'], satirlar: [[1, 'x']] })
  );

  const kitap = dosyalar.get('xl/workbook.xml').toString('utf8');
  assert.ok(kitap.includes(`<sheet name="${temizAd}"`), 'temizlenmiş sayfa adı kullanılmadı');
  assert.doesNotMatch(temizAd, /[[\]:*?/\\]/);

  const sayfa = dosyalar.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(sayfa.includes('<col min="1" max="1" width="18" customWidth="1"/>'));
  assert.ok(sayfa.includes('<col min="2" max="2" width="18" customWidth="1"/>'));
});

test('XLSX: boş veri geçerli ve açılabilir bir dosya üretir', () => {
  const tampon = xlsxOlustur({});
  assert.equal(tampon.subarray(0, 4).toString('latin1'), 'PK\x03\x04');

  const dosyalar = zipOku(tampon);
  xmlGecerliMi(dosyalar);

  const sayfa = dosyalar.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(sayfa.includes('<dimension ref="A1"/>'));
  assert.doesNotMatch(sayfa, /autoFilter/);
  assert.doesNotMatch(sayfa, /<pane /);
  assert.match(sayfa, /<sheetData><\/sheetData>/);

  // Yalnızca başlık satırı olan dosya da geçerli olmalı.
  const baslikli = zipOku(xlsxOlustur({ basliklar: ['A', 'B'] }));
  const baslikliSayfa = baslikli.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(baslikliSayfa.includes('<autoFilter ref="A1:B1"/>'));
  assert.ok(baslikliSayfa.includes('<pane ySplit="1"'));
});

test('XLSX: sayısal olmayan sayılar ve tarih olmayan nesneler güvenli yazılır', () => {
  const dosyalar = zipOku(
    xlsxOlustur({
      basliklar: ['Değer'],
      satirlar: [[Number.NaN], [Number.POSITIVE_INFINITY], [new Date('geçersiz')], ['00123']],
      genislikler: ['geçersiz', -5, 0],
    })
  );
  const sayfa = dosyalar.get('xl/worksheets/sheet1.xml').toString('utf8');

  assert.ok(sayfa.includes('<t xml:space="preserve">NaN</t>'));
  assert.ok(sayfa.includes('<t xml:space="preserve">Infinity</t>'));
  assert.ok(sayfa.includes('<t xml:space="preserve">00123</t>'), 'sayı görünümlü metin metin kalmalı');
  assert.ok(sayfa.includes('<col min="1" max="1" width="18" customWidth="1"/>'));
  xmlGecerliMi(dosyalar);
});
