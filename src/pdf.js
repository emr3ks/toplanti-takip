'use strict';

const fs = require('node:fs');
const PDFDocument = require('pdfkit');
const { tarihTr } = require('./dates');

const A4 = { genislik: 595.28, yukseklik: 841.89 };
const KENAR = { sol: 48, sag: 48, ust: 165, alt: 118 };
const ICERIK_GENISLIK = A4.genislik - KENAR.sol - KENAR.sag;

const TURKCE_HARITA = Object.freeze({
  ı: 'i',
  İ: 'I',
  ş: 's',
  Ş: 'S',
  ğ: 'g',
  Ğ: 'G',
  ç: 'c',
  Ç: 'C',
  ö: 'o',
  Ö: 'O',
  ü: 'u',
  Ü: 'U',
  â: 'a',
  Â: 'A',
  î: 'i',
  Î: 'I',
  û: 'u',
  Û: 'U',
});

function fontAdaylari() {
  const ruzgar = process.env.WINDIR || 'C:\\Windows';
  return {
    normal: [
      process.env.PDF_FONT_YOLU,
      `${ruzgar}\\Fonts\\segoeui.ttf`,
      `${ruzgar}\\Fonts\\arial.ttf`,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/Library/Fonts/Arial.ttf',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
    ].filter(Boolean),
    kalin: [
      process.env.PDF_FONT_KALIN_YOLU,
      `${ruzgar}\\Fonts\\segoeuib.ttf`,
      `${ruzgar}\\Fonts\\arialbd.ttf`,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/Library/Fonts/Arial Bold.ttf',
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    ].filter(Boolean),
  };
}

function ilkVarOlan(yollar) {
  for (const yol of yollar) {
    try {
      if (yol && fs.existsSync(yol)) return yol;
    } catch {
      /* yoksay */
    }
  }
  return null;
}

const FONT_YOLLARI = fontAdaylari();
const NORMAL_YOL = ilkVarOlan(FONT_YOLLARI.normal);
const KALIN_YOL = ilkVarOlan(FONT_YOLLARI.kalin);

function turkceAscii(deger) {
  return String(deger ?? '').replace(/[ıİşŞğĞçÇöÖüÜâÂîÎûÛ]/g, (harf) => TURKCE_HARITA[harf] || harf);
}

function yazi(deger) {
  return NORMAL_YOL ? String(deger ?? '') : turkceAscii(deger);
}

function renkGecerliMi(renk) {
  return typeof renk === 'string' && /^#[0-9a-fA-F]{6}$/.test(renk);
}

function kontrastMetin(renk) {
  if (!renkGecerliMi(renk)) return '#ffffff';
  const kirmizi = parseInt(renk.slice(1, 3), 16);
  const yesil = parseInt(renk.slice(3, 5), 16);
  const mavi = parseInt(renk.slice(5, 7), 16);
  const parlaklik = (0.299 * kirmizi + 0.587 * yesil + 0.114 * mavi) / 255;
  return parlaklik > 0.62 ? '#111827' : '#ffffff';
}

function tarihMetni(deger) {
  if (!deger) return '—';
  const metin = String(deger);
  const gun = metin.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(gun)) return tarihTr(gun);
  return metin;
}

function stilCiz(doc, x, y, genislik, yukseklik, stil) {
  doc.save();
  doc.lineWidth(1).strokeColor('#334155');
  if (stil === 'kesikli') {
    doc.dash(4, { space: 2 });
    doc.rect(x, y, genislik, yukseklik).stroke();
    doc.undash();
  } else if (stil === 'cift') {
    doc.rect(x, y, genislik, yukseklik).stroke();
    doc.rect(x + 2.5, y + 2.5, genislik - 5, yukseklik - 5).stroke();
  } else {
    doc.rect(x, y, genislik, yukseklik).stroke();
  }
  doc.restore();
}

function pdfUret({
  dokuman,
  sablon,
  sirket,
  tur,
  logoYolu = null,
  hazirlayanAd = '',
  onaylayanAd = '',
}) {
  return new Promise((resolve, reject) => {
    let doc;
    try {
      doc = new PDFDocument({
        size: 'A4',
        margins: { top: KENAR.ust, bottom: KENAR.alt, left: KENAR.sol, right: KENAR.sag },
        bufferPages: true,
        info: {
          Title: `${dokuman.kod || ''} ${dokuman.baslik || ''}`.trim(),
          Author: sirket?.ad || 'Kalite Yönetim Sistemi',
          Subject: tur?.ad || 'Kalite Dokümanı',
        },
      });
    } catch (hata) {
      reject(hata);
      return;
    }

    if (NORMAL_YOL) doc.registerFont('govde', NORMAL_YOL);
    if (KALIN_YOL) doc.registerFont('kalin', KALIN_YOL);
    const govde = NORMAL_YOL ? 'govde' : 'Helvetica';
    const kalin = KALIN_YOL ? 'kalin' : 'Helvetica-Bold';

    const parcalar = [];
    doc.on('data', (parca) => parcalar.push(parca));
    doc.on('end', () => resolve(Buffer.concat(parcalar)));
    doc.on('error', reject);

    const antetRenk = renkGecerliMi(sablon?.antet_renk) ? sablon.antet_renk : '#1e3a8a';
    const metinRenk = kontrastMetin(antetRenk);
    const kenarlik = ['duz', 'kesikli', 'cift'].includes(sablon?.kenarlik_stili)
      ? sablon.kenarlik_stili
      : 'duz';
    const durum = String(dokuman.durum || 'taslak');
    const revizyon = `Rev.${String(Number(dokuman.revizyon) || 0).padStart(2, '0')}`;
    const yayinTarihi =
      durum === 'yayinda' || durum === 'iptal'
        ? tarihMetni(dokuman.yayin_tarihi || dokuman.onay_tarihi)
        : '—';
    const sirketAdi = sirket?.ad || 'Kurumsal Kalite Yönetim Sistemi';
    const logo = logoYolu && fs.existsSync(logoYolu) ? logoYolu : null;

    function antetCiz() {
      const x = KENAR.sol;
      const ust = 34;
      doc.rect(x, ust, ICERIK_GENISLIK, 5).fillColor(antetRenk).fill();

      if (logo) {
        try {
          doc.image(logo, x, ust + 14, { fit: [116, 48] });
        } catch {
          /* bozuk logo dosyası PDF üretimini engellemesin */
        }
      }

      doc
        .fillColor('#0f172a')
        .font(kalin)
        .fontSize(13.5)
        .text(yazi(sirketAdi), x, ust + 14, { width: ICERIK_GENISLIK, align: 'right' });
      doc
        .font(govde)
        .fontSize(8)
        .fillColor('#64748b')
        .text(yazi('Kalite Yönetim Sistemi Dokümanı'), x, ust + 33, {
          width: ICERIK_GENISLIK,
          align: 'right',
        });

      const tabloY = ust + 70;
      const hucreGenislik = ICERIK_GENISLIK / 4;
      const etiketler = ['Doküman Kodu', 'Doküman Türü', 'Revizyon', 'Yayın Tarihi'];
      const degerler = [
        dokuman.kod || '—',
        tur?.ad || '—',
        revizyon,
        yayinTarihi,
      ];
      doc.rect(x, tabloY, ICERIK_GENISLIK, 34).fillColor(antetRenk).fill();
      etiketler.forEach((etiket, indeks) => {
        const hucreX = x + indeks * hucreGenislik;
        doc
          .fillColor(metinRenk)
          .font(govde)
          .fontSize(6.5)
          .text(yazi(etiket.toLocaleUpperCase('tr-TR')), hucreX + 7, tabloY + 6, {
            width: hucreGenislik - 12,
            lineBreak: false,
          });
        doc
          .font(kalin)
          .fontSize(9.5)
          .text(yazi(degerler[indeks]), hucreX + 7, tabloY + 16, {
            width: hucreGenislik - 12,
            lineBreak: false,
          });
      });
      doc.strokeColor(antetRenk).lineWidth(0.8).rect(x, tabloY, ICERIK_GENISLIK, 34).stroke();

      // Onay bilgisi antet bölgesinde ayrıca gösterilir.
      let onaySatiri = '';
      if (durum === 'yayinda') {
        onaySatiri = `Onaylayan: ${onaylayanAd || '—'} · Onay Tarihi: ${tarihMetni(dokuman.onay_tarihi)}`;
      } else if (durum === 'kontrol') {
        onaySatiri = 'Onay bekliyor';
      } else if (durum === 'iptal') {
        onaySatiri = `İptal / Arşiv${onaylayanAd ? ` · Onaylayan: ${onaylayanAd}` : ''}${
          dokuman.onay_tarihi ? ` · Onay Tarihi: ${tarihMetni(dokuman.onay_tarihi)}` : ''
        }`;
      }
      if (onaySatiri) {
        doc
          .font(govde)
          .fontSize(7.5)
          .fillColor('#475569')
          .text(yazi(onaySatiri), x, tabloY + 38, {
            width: ICERIK_GENISLIK,
            align: 'right',
            lineBreak: false,
          });
      }
    }

    antetCiz();
    doc.on('pageAdded', () => {
      antetCiz();
      doc.y = KENAR.ust;
      doc.x = KENAR.sol;
    });

    // -----------------------------------------------------------------------
    // Başlık
    // -----------------------------------------------------------------------
    doc
      .fillColor('#0f172a')
      .font(kalin)
      .fontSize(17)
      .text(yazi(dokuman.baslik || 'Doküman'), KENAR.sol, KENAR.ust + 8, {
        width: ICERIK_GENISLIK,
        align: 'center',
      });
    doc.moveDown(0.35);
    doc
      .font(govde)
      .fontSize(9)
      .fillColor('#475569')
      .text(
        yazi(
          `${dokuman.kod || ''} · ${revizyon} · ${durum === 'yayinda' ? 'Yayında' : durum === 'kontrol' ? 'Onay Bekliyor' : durum === 'iptal' ? 'İptal / Arşiv' : 'Taslak'}`
        ),
        { width: ICERIK_GENISLIK, align: 'center' }
      );
    if (dokuman.aciklama) {
      doc.moveDown(0.5);
      doc
        .font(govde)
        .fontSize(9)
        .fillColor('#64748b')
        .text(yazi(dokuman.aciklama), { width: ICERIK_GENISLIK, align: 'center' });
    }
    doc.moveDown(0.8);
    doc
      .strokeColor('#cbd5e1')
      .lineWidth(0.8)
      .moveTo(KENAR.sol, doc.y)
      .lineTo(KENAR.sol + ICERIK_GENISLIK, doc.y)
      .stroke();
    doc.moveDown(0.8);

    // -----------------------------------------------------------------------
    // Bölümler
    // -----------------------------------------------------------------------
    const bolumler = Array.isArray(dokuman.icerik) ? dokuman.icerik : [];
    if (!bolumler.length) {
      doc
        .font(govde)
        .fontSize(10.5)
        .fillColor('#64748b')
        .text(yazi('Bu doküman için bölüm içeriği tanımlanmamış.'), KENAR.sol, doc.y, {
          width: ICERIK_GENISLIK,
        });
    }

    for (const bolum of bolumler) {
      if (doc.y > A4.yukseklik - KENAR.alt - 90) {
        doc.addPage();
      }
      const baslikY = doc.y;
      doc.rect(KENAR.sol, baslikY + 1, 3.5, 14).fillColor(antetRenk).fill();
      doc
        .fillColor('#0f172a')
        .font(kalin)
        .fontSize(11.5)
        .text(yazi(bolum.baslik || ''), KENAR.sol + 11, baslikY, {
          width: ICERIK_GENISLIK - 11,
        });
      doc.moveDown(0.45);
      const metin = String(bolum.metin || '').trim();
      if (metin) {
        const satirlar = metin.split(/\r?\n/);
        for (const satir of satirlar) {
          if (doc.y > A4.yukseklik - KENAR.alt - 26) {
            doc.addPage();
          }
          if (!satir.trim()) {
            doc.moveDown(0.35);
            continue;
          }
          doc
            .font(govde)
            .fontSize(10.2)
            .fillColor('#1f2937')
            .text(yazi(satir), KENAR.sol, doc.y, {
              width: ICERIK_GENISLIK,
              lineGap: 2.4,
              align: 'left',
            });
          doc.moveDown(0.2);
        }
      } else {
        doc
          .font(govde)
          .fontSize(10)
          .fillColor('#94a3b8')
          .text(yazi('—'), KENAR.sol, doc.y, { width: ICERIK_GENISLIK });
      }
      doc.moveDown(0.85);
    }

    // -----------------------------------------------------------------------
    // Alt bilgi kutuları, sayfa numarası ve filigran
    // -----------------------------------------------------------------------
    const aralik = doc.bufferedPageRange();
    const toplam = aralik.count;
    for (let i = 0; i < toplam; i += 1) {
      doc.switchToPage(i);
      const sayfa = doc.page;
      // Alt bilgi içerik alanının dışına çizildiği için PDFKit'in otomatik
      // sayfa eklemesini geçici olarak devre dışı bırakıyoruz.
      const eskiAltKenar = sayfa.margins.bottom;
      sayfa.margins.bottom = 0;
      const kutuY = sayfa.height - 96;
      const kutuGenislik = (ICERIK_GENISLIK - 14) / 2;

      const hazirlayanEtiket = sablon?.altbilgi_hazirlayan || 'Hazırlayan';
      const onaylayanEtiket = sablon?.altbilgi_onaylayan || 'Onaylayan';
      const hazirlayanTarih = tarihMetni(dokuman.olusturma_tarihi);
      const onayTarihi =
        durum === 'yayinda' || durum === 'iptal' ? tarihMetni(dokuman.onay_tarihi) : 'Onay bekliyor';

      for (const [indeks, etiket, ad, tarih] of [
        [0, hazirlayanEtiket, hazirlayanAd || '—', hazirlayanTarih],
        [1, onaylayanEtiket, onaylayanAd || '—', onayTarihi],
      ]) {
        const x = KENAR.sol + indeks * (kutuGenislik + 14);
        stilCiz(doc, x, kutuY, kutuGenislik, 40, kenarlik);
        doc
          .font(kalin)
          .fontSize(7.5)
          .fillColor('#334155')
          .text(yazi(etiket.toLocaleUpperCase('tr-TR')), x + 8, kutuY + 6, {
            width: kutuGenislik - 16,
          });
        doc
          .font(govde)
          .fontSize(9)
          .fillColor('#0f172a')
          .text(yazi(ad), x + 8, kutuY + 17, { width: kutuGenislik - 16, lineBreak: false });
        doc
          .font(govde)
          .fontSize(7.5)
          .fillColor('#64748b')
          .text(yazi(tarih), x + 8, kutuY + 28, { width: kutuGenislik - 16, lineBreak: false });
      }

      doc
        .font(govde)
        .fontSize(8)
        .fillColor('#64748b')
        .text(yazi(`Sayfa ${i + 1}/${toplam}`), KENAR.sol, sayfa.height - 40, {
          width: ICERIK_GENISLIK,
          align: 'center',
        });
      doc
        .font(govde)
        .fontSize(6.8)
        .fillColor('#94a3b8')
        .text(yazi(`${sirketAdi} · ${dokuman.kod || ''} · ${revizyon}`), KENAR.sol, sayfa.height - 27, {
          width: ICERIK_GENISLIK,
          align: 'center',
        });

      if (durum === 'taslak') {
        doc.save();
        doc.rotate(-30, { origin: [sayfa.width / 2, sayfa.height / 2] });
        doc
          .opacity(0.13)
          .fillColor('#64748b')
          .font(kalin)
          .fontSize(78)
          .text('TASLAK', 0, sayfa.height / 2 - 42, { width: sayfa.width, align: 'center' });
        doc.restore();
      }

      sayfa.margins.bottom = eskiAltKenar;
    }

    doc.end();
  });
}

module.exports = { pdfUret, turkceAscii, renkGecerliMi };
