'use strict';

const fs = require('node:fs');
const PDFDocument = require('pdfkit');
const { tarihTr } = require('./dates');
const dofSabitleri = require('./dof');

const A4 = { genislik: 595.28, yukseklik: 841.89 };
const KENAR = { sol: 48, sag: 48, ust: 165, alt: 118 };
const ICERIK_GENISLIK = A4.genislik - KENAR.sol - KENAR.sag;
const LOGO_KUTU = Object.freeze({ genislik: 140, yukseklik: 52, icBosluk: 5 });

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

const PNG_IMZASI = Object.freeze([0x89, 0x50, 0x4e, 0x47]);
const JPEG_IMZASI = Object.freeze([0xff, 0xd8, 0xff]);

function logoUyar(mesaj) {
  console.warn(`[pdf] Logo: ${mesaj}`);
}

/** Görselin gerçek biçimini dosya uzantısına değil, imza baytlarına göre belirler. */
function logoBicimi(veri) {
  if (!Buffer.isBuffer(veri) || veri.length < 3) return null;
  if (veri.length >= 4 && PNG_IMZASI.every((bayt, indeks) => veri[indeks] === bayt)) {
    return 'png';
  }
  if (JPEG_IMZASI.every((bayt, indeks) => veri[indeks] === bayt)) {
    return 'jpeg';
  }
  if (
    veri.length >= 12 &&
    veri.toString('ascii', 0, 4) === 'RIFF' &&
    veri.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** base64 kodlamalı data URI'yi çözer; biçim doğrulaması çağıran tarafta yapılır. */
function dataUriCoz(metin) {
  const virgul = metin.indexOf(',');
  if (virgul < 0) {
    logoUyar('data URI biçimi geçersiz.');
    return null;
  }
  const ustBilgi = metin.slice(5, virgul);
  if (!/(?:^|;)base64(?:;|$)/i.test(ustBilgi)) {
    logoUyar('data URI base64 kodlamalı değil.');
    return null;
  }
  const govde = metin.slice(virgul + 1).replace(/\s+/g, '');
  if (!govde || !/^[A-Za-z0-9+/]+={0,2}$/.test(govde)) {
    logoUyar('data URI içindeki base64 verisi geçersiz.');
    return null;
  }
  return Buffer.from(govde, 'base64');
}

/**
 * Logoyu PDFKit'in gömebileceği bir Buffer'a çözer.
 *
 * Kabul edilen kaynaklar: PNG/JPEG dosya yolu, PNG/JPEG baytları içeren
 * Buffer/Uint8Array, base64 data URI ve imza baytları geçerli ham base64.
 * Desteklenmeyen biçimlerde (ör. WEBP) null döner ve tek bir uyarı yazar;
 * böylece logo sorunu PDF üretimini engellemez ama sessizce de kaybolmaz.
 */
function logoVerisiCoz(kaynak) {
  if (kaynak === null || kaynak === undefined) return null;

  let veri = null;
  if (Buffer.isBuffer(kaynak)) {
    veri = kaynak;
  } else if (kaynak instanceof Uint8Array) {
    veri = Buffer.from(kaynak);
  } else if (typeof kaynak === 'string') {
    const metin = kaynak.trim();
    if (!metin) return null;

    if (/^data:/i.test(metin)) {
      veri = dataUriCoz(metin);
      if (!veri) return null;
    } else {
      let dosyaVar = false;
      try {
        dosyaVar = fs.existsSync(metin);
      } catch {
        dosyaVar = false;
      }
      if (dosyaVar) {
        try {
          veri = fs.readFileSync(metin);
        } catch (hata) {
          logoUyar(`dosya okunamadı (${hata.code || hata.message}).`);
          return null;
        }
      } else {
        const temiz = metin.replace(/\s+/g, '');
        if (temiz.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(temiz)) {
          logoUyar('kaynak ne geçerli bir dosya yolu ne de base64 verisi.');
          return null;
        }
        veri = Buffer.from(temiz, 'base64');
      }
    }
  } else {
    logoUyar('desteklenmeyen kaynak türü.');
    return null;
  }

  const tur = logoBicimi(veri);
  if (tur === 'webp') {
    logoUyar('WEBP biçimi PDFKit tarafından desteklenmiyor; lütfen PNG veya JPEG kullanın.');
    return null;
  }
  if (tur !== 'png' && tur !== 'jpeg') {
    logoUyar('desteklenmeyen görsel biçimi; yalnızca PNG veya JPEG gömülebilir.');
    return null;
  }
  return { veri, tur };
}

/** Şirket adını logo kutusuna taşmadan tek satıra sığdırır. */
function metniSigdir(doc, metin, genislik) {
  if (!metin || doc.widthOfString(metin) <= genislik) return metin;
  const nokta = '…';
  let kesik = metin;
  while (kesik.length > 0 && doc.widthOfString(`${kesik}${nokta}`) > genislik) {
    kesik = kesik.slice(0, -1);
  }
  return `${kesik.replace(/\s+$/, '')}${nokta}`;
}

function pdfUret({
  dokuman,
  sablon,
  sirket,
  tur,
  logoYolu = null,
  logoVerisi = null,
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
    // logoVerisi verilmişse (Buffer/data URI/yol) önceliklidir; aksi halde
    // geriye dönük uyumluluk için logoYolu kullanılır.
    const logoKaynagi =
      logoVerisi !== null && logoVerisi !== undefined && logoVerisi !== ''
        ? logoVerisi
        : logoYolu;
    const logo = logoKaynagi ? logoVerisiCoz(logoKaynagi) : null;

    function antetCiz() {
      const x = KENAR.sol;
      const ust = 34;
      doc.rect(x, ust, ICERIK_GENISLIK, 5).fillColor(antetRenk).fill();

      const logoKutuY = ust + 14;
      if (logo) {
        const icX = x + LOGO_KUTU.icBosluk;
        const icY = logoKutuY + LOGO_KUTU.icBosluk;
        const icGenislik = LOGO_KUTU.genislik - LOGO_KUTU.icBosluk * 2;
        const icYukseklik = LOGO_KUTU.yukseklik - LOGO_KUTU.icBosluk * 2;
        doc.save();
        doc
          .rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik)
          .fillColor('#ffffff')
          .fill();
        let gorselCizildi = false;
        try {
          doc.image(logo.veri, icX, icY, {
            fit: [icGenislik, icYukseklik],
            align: 'center',
            valign: 'center',
          });
          gorselCizildi = true;
        } catch (hata) {
          // Bozuk görsel PDF üretimini engellemesin; kutuyu tamamen kaldır.
          logoUyar(`görsel çizilemedi (${hata.message}).`);
          doc
            .rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik)
            .fillColor('#ffffff')
            .fill();
        }
        if (gorselCizildi) {
          doc
            .lineWidth(0.8)
            .strokeColor(antetRenk)
            .rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik)
            .stroke();
        }
        doc.restore();
      }

      // Logo varsa şirket adı sağdaki daralan bloğa sığdırılır; böylece
      // uzun adlar logonun üzerine binmez ve alt bilgiyle çakışmaz.
      const sirketX = logo ? x + LOGO_KUTU.genislik + 12 : x;
      const sirketGenislik = logo
        ? ICERIK_GENISLIK - LOGO_KUTU.genislik - 12
        : ICERIK_GENISLIK;
      doc.fillColor('#0f172a').font(kalin).fontSize(13.5);
      const sirketMetni = yazi(sirketAdi);
      doc.text(
        logo ? metniSigdir(doc, sirketMetni, sirketGenislik) : sirketMetni,
        sirketX,
        ust + 14,
        { width: sirketGenislik, align: 'right' }
      );
      doc
        .font(govde)
        .fontSize(8)
        .fillColor('#64748b')
        .text(yazi('Kalite Yönetim Sistemi Dokümanı'), sirketX, ust + 33, {
          width: sirketGenislik,
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

/**
 * Antetli Düzeltici / Önleyici Faaliyet (DÖF) raporu üretir.
 *
 * Rapor; şirket logosu ve antetini, DÖF künyesini, uygunsuzluk tanımını,
 * acil önlemi, kök neden analizini, aksiyon tablosunu ve etkinlik
 * değerlendirmesi / kapanış onayını içerir. Aksiyon tablosu sayfa sonunda
 * bölünebilir; her yeni sayfada antet yeniden basılır.
 */
function dofPdfUret({
  dof,
  aksiyonlar = [],
  sirket,
  logoYolu = null,
  logoVerisi = null,
  bugun = null,
  olusturanAd = '',
  kapatanAd = '',
}) {
  return new Promise((resolve, reject) => {
    const kayit = dof && typeof dof === 'object' ? dof : {};
    const dofRengi = '#b91c1c';
    let doc;
    try {
      doc = new PDFDocument({
        size: 'A4',
        margins: { top: KENAR.ust, bottom: KENAR.alt, left: KENAR.sol, right: KENAR.sag },
        bufferPages: true,
        info: {
          Title: `${kayit.kod || ''} DÖF Raporu`.trim(),
          Author: sirket?.ad || 'Kalite Yönetim Sistemi',
          Subject: 'Düzeltici ve Önleyici Faaliyet Raporu',
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

    const sirketAdi = sirket?.ad || 'Kurumsal Kalite Yönetim Sistemi';
    const logoKaynagi =
      logoVerisi !== null && logoVerisi !== undefined && logoVerisi !== ''
        ? logoVerisi
        : logoYolu;
    const logo = logoKaynagi ? logoVerisiCoz(logoKaynagi) : null;

    const turMetni = dofSabitleri.turEtiketi(kayit.tur);
    const durumMetni = dofSabitleri.durumEtiketi(kayit.durum);
    const kaynakMetni = dofSabitleri.kaynakEtiketi(kayit.kaynak);
    const liste = (Array.isArray(aksiyonlar) ? aksiyonlar : []).map((aksiyon, indeks) => {
      const etkin = aksiyon.etkin_durum || dofSabitleri.aksiyonEtkinDurum(aksiyon, bugun);
      return {
        ...aksiyon,
        sira: Number(aksiyon.sira) || indeks + 1,
        etkin_durum: etkin,
        etkin_durum_etiketi:
          aksiyon.etkin_durum_etiketi || dofSabitleri.aksiyonDurumEtiketi(etkin),
      };
    });

    const icerikAltSinir = () => A4.yukseklik - KENAR.alt;

    function yeniSayfa() {
      doc.addPage();
      doc.y = KENAR.ust;
      doc.x = KENAR.sol;
    }

    function yerVarMi(gerekli) {
      return doc.y + gerekli <= icerikAltSinir();
    }

    function boslukAyir(gerekli) {
      if (!yerVarMi(gerekli)) yeniSayfa();
    }

    function antetCiz() {
      const x = KENAR.sol;
      const ust = 34;
      doc.rect(x, ust, ICERIK_GENISLIK, 5).fillColor(dofRengi).fill();

      const logoKutuY = ust + 14;
      if (logo) {
        const icX = x + LOGO_KUTU.icBosluk;
        const icY = logoKutuY + LOGO_KUTU.icBosluk;
        const icGenislik = LOGO_KUTU.genislik - LOGO_KUTU.icBosluk * 2;
        const icYukseklik = LOGO_KUTU.yukseklik - LOGO_KUTU.icBosluk * 2;
        doc.save();
        doc.rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik).fillColor('#ffffff').fill();
        let gorselCizildi = false;
        try {
          doc.image(logo.veri, icX, icY, {
            fit: [icGenislik, icYukseklik],
            align: 'center',
            valign: 'center',
          });
          gorselCizildi = true;
        } catch (hata) {
          logoUyar(`DÖF raporu görseli çizilemedi (${hata.message}).`);
        }
        if (gorselCizildi) {
          doc
            .lineWidth(0.8)
            .strokeColor(dofRengi)
            .rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik)
            .stroke();
        }
        doc.restore();
      }

      const sirketX = logo ? x + LOGO_KUTU.genislik + 12 : x;
      const sirketGenislik = logo ? ICERIK_GENISLIK - LOGO_KUTU.genislik - 12 : ICERIK_GENISLIK;
      doc.fillColor('#0f172a').font(kalin).fontSize(13.5);
      doc.text(
        logo ? metniSigdir(doc, yazi(sirketAdi), sirketGenislik) : yazi(sirketAdi),
        sirketX,
        ust + 14,
        { width: sirketGenislik, align: 'right' }
      );
      doc
        .font(govde)
        .fontSize(8)
        .fillColor('#64748b')
        .text(yazi('Düzeltici ve Önleyici Faaliyet Formu'), sirketX, ust + 33, {
          width: sirketGenislik,
          align: 'right',
        });

      const tabloY = ust + 70;
      const hucreGenislik = ICERIK_GENISLIK / 4;
      const etiketler = ['DÖF No', 'Tür', 'Durum', 'Tespit Tarihi'];
      const degerler = [kayit.kod || '—', turMetni, durumMetni, tarihMetni(kayit.tespit_tarihi)];
      doc.rect(x, tabloY, ICERIK_GENISLIK, 40).fillColor(dofRengi).fill();
      etiketler.forEach((etiket, indeks) => {
        const hucreX = x + indeks * hucreGenislik;
        doc
          .fillColor('#ffffff')
          .font(govde)
          .fontSize(6.5)
          .text(yazi(etiket.toLocaleUpperCase('tr-TR')), hucreX + 7, tabloY + 6, {
            width: hucreGenislik - 12,
            lineBreak: false,
          });
        doc
          .font(kalin)
          .fontSize(8.2)
          .text(yazi(degerler[indeks]), hucreX + 7, tabloY + 16, {
            width: hucreGenislik - 14,
            height: 20,
            lineGap: 0.5,
          });
      });
      doc.strokeColor(dofRengi).lineWidth(0.8).rect(x, tabloY, ICERIK_GENISLIK, 40).stroke();

      if (kayit.durum === 'kapandi') {
        doc
          .font(govde)
          .fontSize(7.5)
          .fillColor('#475569')
          .text(
            yazi(
              `Kapatan: ${kapatanAd || kayit.kapatan_ad || '—'} · Kapanış Tarihi: ${tarihMetni(kayit.kapanis_tarihi)}`
            ),
            x,
            tabloY + 44,
            { width: ICERIK_GENISLIK, align: 'right', lineBreak: false }
          );
      }
    }

    antetCiz();
    doc.on('pageAdded', () => {
      antetCiz();
      doc.y = KENAR.ust;
      doc.x = KENAR.sol;
    });

    function bolumBasligi(baslik) {
      boslukAyir(36);
      const y = doc.y;
      doc.rect(KENAR.sol, y + 1, 3.5, 14).fillColor(dofRengi).fill();
      doc
        .fillColor('#0f172a')
        .font(kalin)
        .fontSize(10.5)
        .text(yazi(baslik), KENAR.sol + 10, y, { width: ICERIK_GENISLIK - 10 });
      doc.moveDown(0.35);
    }

    function paragraf(metin, bosluk = 0.4) {
      const deger = String(metin || '').trim();
      if (!deger) {
        doc
          .font(govde)
          .fontSize(9.5)
          .fillColor('#94a3b8')
          .text('—', KENAR.sol, doc.y, { width: ICERIK_GENISLIK });
        doc.moveDown(bosluk);
        return;
      }
      for (const satir of deger.split(/\r?\n/)) {
        if (!satir.trim()) {
          doc.moveDown(0.25);
          continue;
        }
        doc.font(govde).fontSize(9.5);
        const yukseklik = doc.heightOfString(yazi(satir), {
          width: ICERIK_GENISLIK,
          lineGap: 2,
        });
        if (!yerVarMi(yukseklik)) yeniSayfa();
        doc
          .fillColor('#1f2937')
          .text(yazi(satir), KENAR.sol, doc.y, {
            width: ICERIK_GENISLIK,
            lineGap: 2,
            align: 'left',
          });
        doc.moveDown(0.15);
      }
      doc.moveDown(bosluk);
    }

    function detayTablosu() {
      const satirlar = [
        [
          ['Uygunsuzluk Kaynağı', kaynakMetni],
          ['İlgili Departman', kayit.departman_ad || '—'],
          ['Talep Eden', kayit.talep_eden || '—'],
          ['İlgili Kalite Dokümanı', kayit.dokuman_kod || '—'],
        ],
        [
          ['Oluşturan', olusturanAd || kayit.olusturan_ad || '—'],
          ['Oluşturma Tarihi', tarihMetni(kayit.olusturma_tarihi)],
          ['Kapanış Tarihi', kayit.kapanis_tarihi ? tarihMetni(kayit.kapanis_tarihi) : '—'],
          ['Kapatan', kapatanAd || kayit.kapatan_ad || '—'],
        ],
      ];
      const hucreGenislik = ICERIK_GENISLIK / 4;
      const hucreYukseklik = 34;
      boslukAyir(hucreYukseklik * 2 + 8);
      let y = doc.y;
      for (const satir of satirlar) {
        satir.forEach(([etiket, deger], indeks) => {
          const x = KENAR.sol + indeks * hucreGenislik;
          doc
            .rect(x, y, hucreGenislik, hucreYukseklik)
            .fillColor(indeks % 2 === 0 ? '#f8fafc' : '#ffffff')
            .fill();
          doc
            .strokeColor('#cbd5e1')
            .lineWidth(0.6)
            .rect(x, y, hucreGenislik, hucreYukseklik)
            .stroke();
          doc
            .fillColor('#64748b')
            .font(govde)
            .fontSize(6.5)
            .text(yazi(etiket.toLocaleUpperCase('tr-TR')), x + 6, y + 5, {
              width: hucreGenislik - 12,
              lineBreak: false,
            });
          doc.font(kalin).fontSize(8.5);
          doc
            .fillColor('#0f172a')
            .text(
              yazi(metniSigdir(doc, String(deger || '—'), hucreGenislik - 12)),
              x + 6,
              y + 16,
              { width: hucreGenislik - 12, lineBreak: false }
            );
        });
        y += hucreYukseklik;
      }
      doc.y = y + 10;
    }

    function aksiyonTablosu() {
      const kolonlar = [
        { genislik: 24 },
        { genislik: 180 },
        { genislik: 90 },
        { genislik: 62 },
        { genislik: 70 },
        { genislik: 73.28 },
      ];
      const basliklar = ['No', 'Aksiyon', 'Sorumlu', 'Hedef Tarih', 'Durum', 'Kanıt / Açıklama'];

      function baslikSatiri(y) {
        let x = KENAR.sol;
        doc.rect(x, y, ICERIK_GENISLIK, 20).fillColor(dofRengi).fill();
        kolonlar.forEach((kolon, indeks) => {
          doc
            .fillColor('#ffffff')
            .font(kalin)
            .fontSize(7)
            .text(yazi(basliklar[indeks]), x + 4, y + 6, {
              width: kolon.genislik - 8,
              lineBreak: false,
            });
          x += kolon.genislik;
        });
        doc
          .strokeColor(dofRengi)
          .lineWidth(0.6)
          .rect(KENAR.sol, y, ICERIK_GENISLIK, 20)
          .stroke();
      }

      boslukAyir(44);
      let y = doc.y;
      baslikSatiri(y);
      y += 20;

      if (!liste.length) {
        doc
          .fillColor('#94a3b8')
          .font(govde)
          .fontSize(9.5)
          .text(yazi('Bu DÖF için henüz aksiyon tanımlanmamış.'), KENAR.sol, y + 6, {
            width: ICERIK_GENISLIK,
          });
        doc.y = y + 24;
        return;
      }

      liste.forEach((aksiyon) => {
        const aksiyonMetni = String(aksiyon.aciklama || '—');
        const sorumluMetni = String(aksiyon.sorumlu_ad || '—');
        const durumMetniAksiyon = String(aksiyon.etkin_durum_etiketi || '—');
        const kanitParcalari = [];
        if (aksiyon.kanit_aciklama) kanitParcalari.push(aksiyon.kanit_aciklama);
        if (aksiyon.kanit_dosya_adi) kanitParcalari.push(`Dosya: ${aksiyon.kanit_dosya_adi}`);
        const kanitMetni = kanitParcalari.join('\n') || '—';

        doc.font(govde).fontSize(7.6);
        const yukseklik = Math.max(
          doc.heightOfString(yazi(aksiyonMetni), { width: kolonlar[1].genislik - 8, lineGap: 1.5 }),
          doc.heightOfString(yazi(sorumluMetni), { width: kolonlar[2].genislik - 8, lineGap: 1.5 }),
          doc.heightOfString(yazi(durumMetniAksiyon), {
            width: kolonlar[4].genislik - 8,
            lineGap: 1.5,
          }),
          doc.heightOfString(yazi(kanitMetni), { width: kolonlar[5].genislik - 8, lineGap: 1.5 })
        );
        const satirYukseklik = Math.max(18, yukseklik + 8);

        if (y + satirYukseklik > icerikAltSinir() - 6) {
          yeniSayfa();
          y = doc.y;
          baslikSatiri(y);
          y += 20;
        }

        const degerler = [
          String(aksiyon.sira || ''),
          aksiyonMetni,
          sorumluMetni,
          tarihMetni(aksiyon.hedef_tarih),
          durumMetniAksiyon,
          kanitMetni,
        ];
        let x = KENAR.sol;
        kolonlar.forEach((kolon, indeks) => {
          doc
            .rect(x, y, kolon.genislik, satirYukseklik)
            .fillColor(indeks % 2 === 0 ? '#ffffff' : '#f8fafc')
            .fill();
          doc
            .strokeColor('#cbd5e1')
            .lineWidth(0.5)
            .rect(x, y, kolon.genislik, satirYukseklik)
            .stroke();
          doc
            .fillColor('#1f2937')
            .font(govde)
            .fontSize(7.6)
            .text(yazi(degerler[indeks]), x + 4, y + 4, {
              width: kolon.genislik - 8,
              lineGap: 1.5,
            });
          x += kolon.genislik;
        });
        y += satirYukseklik;
      });

      doc.y = y + 10;
    }

    function imzaKutulari() {
      boslukAyir(60);
      const kutuGenislik = (ICERIK_GENISLIK - 14) / 2;
      const y = doc.y;
      const kutular = [
        {
          etiket: "DÖF'Ü AÇAN / TALEP EDEN",
          ad: olusturanAd || kayit.olusturan_ad || kayit.talep_eden || '—',
          tarih: tarihMetni(kayit.olusturma_tarihi),
        },
        {
          etiket: 'ETKİNLİK DEĞERLENDİRMESİ / KAPATAN',
          ad: kapatanAd || kayit.kapatan_ad || (kayit.durum === 'kapandi' ? '—' : 'Bekliyor'),
          tarih: kayit.kapanis_tarihi ? tarihMetni(kayit.kapanis_tarihi) : '—',
        },
      ];
      kutular.forEach((kutu, indeks) => {
        const x = KENAR.sol + indeks * (kutuGenislik + 14);
        stilCiz(doc, x, y, kutuGenislik, 46, 'duz');
        doc
          .font(kalin)
          .fontSize(7)
          .fillColor('#334155')
          .text(yazi(kutu.etiket), x + 8, y + 7, { width: kutuGenislik - 16 });
        doc
          .font(govde)
          .fontSize(9)
          .fillColor('#0f172a')
          .text(yazi(kutu.ad), x + 8, y + 19, { width: kutuGenislik - 16, lineBreak: false });
        doc
          .font(govde)
          .fontSize(7.5)
          .fillColor('#64748b')
          .text(yazi(kutu.tarih), x + 8, y + 31, { width: kutuGenislik - 16, lineBreak: false });
      });
      doc.y = y + 56;
    }

    // -----------------------------------------------------------------------
    // Başlık
    // -----------------------------------------------------------------------
    doc
      .fillColor('#0f172a')
      .font(kalin)
      .fontSize(16)
      .text(yazi('DÖF RAPORU'), KENAR.sol, KENAR.ust + 6, {
        width: ICERIK_GENISLIK,
        align: 'center',
      });
    doc
      .font(govde)
      .fontSize(9)
      .fillColor('#475569')
      .text(yazi(`${kayit.kod || ''} · ${turMetni} · ${durumMetni}`), {
        width: ICERIK_GENISLIK,
        align: 'center',
      });
    doc.moveDown(0.7);
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.8)
      .moveTo(KENAR.sol, doc.y)
      .lineTo(KENAR.sol + ICERIK_GENISLIK, doc.y)
      .stroke();
    doc.moveDown(0.7);

    // -----------------------------------------------------------------------
    // İçerik
    // -----------------------------------------------------------------------
    bolumBasligi('DÖF BİLGİLERİ');
    detayTablosu();

    bolumBasligi('UYGUNSUZLUK TANIMI');
    paragraf(kayit.uygunsuzluk_tanimi);

    bolumBasligi('ACİL / GEÇİCİ ÖNLEM');
    paragraf(kayit.acil_onlem);

    bolumBasligi('KÖK NEDEN ANALİZİ');
    paragraf(kayit.kok_neden);

    bolumBasligi('DÜZELTİCİ / ÖNLEYİCİ AKSİYON PLANI');
    aksiyonTablosu();

    bolumBasligi('ETKİNLİK DEĞERLENDİRMESİ VE KAPANIŞ');
    if (kayit.durum === 'kapandi') {
      paragraf(kayit.etkinlik_degerlendirmesi);
      doc
        .font(govde)
        .fontSize(8.5)
        .fillColor('#475569')
        .text(
          yazi(
            `Kapatan: ${kapatanAd || kayit.kapatan_ad || '—'} · Kapanış Tarihi: ${tarihMetni(kayit.kapanis_tarihi)}`
          ),
          KENAR.sol,
          doc.y,
          { width: ICERIK_GENISLIK }
        );
      doc.moveDown(0.8);
    } else {
      doc
        .font(govde)
        .fontSize(9)
        .fillColor('#64748b')
        .text(
          yazi(
            'DÖF henüz kapatılmadı. Tüm aksiyonlar tamamlandığında Kalite Yöneticisi etkinlik değerlendirmesini girerek kaydı kapatır.'
          ),
          KENAR.sol,
          doc.y,
          { width: ICERIK_GENISLIK }
        );
      doc.moveDown(0.8);
    }
    imzaKutulari();

    // -----------------------------------------------------------------------
    // Alt bilgi: sayfa numarası ve kayıt kodu
    // -----------------------------------------------------------------------
    const aralik = doc.bufferedPageRange();
    const toplam = aralik.count;
    for (let i = 0; i < toplam; i += 1) {
      doc.switchToPage(i);
      const sayfa = doc.page;
      const eskiAltKenar = sayfa.margins.bottom;
      sayfa.margins.bottom = 0;
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
        .text(
          yazi(`${sirketAdi} · ${kayit.kod || ''} · ${turMetni}`),
          KENAR.sol,
          sayfa.height - 27,
          { width: ICERIK_GENISLIK, align: 'center' }
        );
      sayfa.margins.bottom = eskiAltKenar;
    }

    doc.end();
  });
}

module.exports = { pdfUret, dofPdfUret, logoVerisiCoz, turkceAscii, renkGecerliMi };
