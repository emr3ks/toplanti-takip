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

/**
 * İç tetkik (denetim) için kurumsal PDF raporu üretir.
 *
 * Rapor; şirket antetini, tetkik künyesini, kapsam / amaç / yöntem özetini,
 * ağırlıklı puanı, sonuç sayılarını, bütün kontrol listesi maddelerini,
 * bulgu / DÖF bağlantılarını ve imza kutularını içerir. Kontrol listesi ve
 * bulgu tabloları sayfa sınırında bölünür; yeni sayfalarda tablo başlıkları
 * yeniden basılır.
 */
async function tetkikPdfUret({
  tetkik,
  maddeler = [],
  bulgular = [],
  sirket,
  logoYolu = null,
  logoVerisi = null,
  bugun = null,
  denetleyenAd = '',
  tamamlayanAd = '',
} = {}) {
  const kayit = tetkik && typeof tetkik === 'object' ? tetkik : {};
  const maddeKayitlari = Array.isArray(maddeler) ? maddeler : [];
  const bulguKayitlari = Array.isArray(bulgular) ? bulgular : [];

  function doluDeger(deger) {
    return (
      deger !== null &&
      deger !== undefined &&
      !(typeof deger === 'string' && deger.trim() === '')
    );
  }

  function ilkHam(nesne, anahtarlar) {
    if (!nesne || typeof nesne !== 'object') return null;
    for (const anahtar of anahtarlar) {
      if (Object.prototype.hasOwnProperty.call(nesne, anahtar) && doluDeger(nesne[anahtar])) {
        return nesne[anahtar];
      }
    }
    return null;
  }

  function metinDuzestir(deger) {
    if (!doluDeger(deger)) return null;
    if (typeof deger === 'object') {
      const nesneMetni = ilkHam(deger, [
        'aciklama',
        'description',
        'metin',
        'not',
        'ad',
        'name',
        'kod',
        'code',
        'referans',
      ]);
      if (nesneMetni !== null && typeof nesneMetni !== 'object') {
        const sonuc = String(nesneMetni).trim();
        return sonuc || null;
      }
      return null;
    }
    const sonuc = String(deger).trim();
    return sonuc || null;
  }

  function ilkMetin(nesne, anahtarlar) {
    for (const anahtar of anahtarlar) {
      if (!nesne || typeof nesne !== 'object') continue;
      const metin = metinDuzestir(nesne[anahtar]);
      if (metin !== null) return metin;
    }
    return null;
  }

  function sayiCoz(deger) {
    if (typeof deger === 'number') return Number.isFinite(deger) ? deger : null;
    if (typeof deger !== 'string') return null;
    const temiz = deger.trim().replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(temiz)) return null;
    const sayi = Number(temiz);
    return Number.isFinite(sayi) ? sayi : null;
  }

  function ilkSayi(nesne, anahtarlar) {
    for (const anahtar of anahtarlar) {
      if (!nesne || typeof nesne !== 'object') continue;
      const sayi = sayiCoz(nesne[anahtar]);
      if (sayi !== null) return sayi;
    }
    return null;
  }

  function normalizeEtiket(deger) {
    return turkceAscii(String(deger ?? ''))
      .toLocaleLowerCase('tr-TR')
      .replace(/[^a-z0-9]+/g, '');
  }

  const SONUC_TANIMLARI = Object.freeze({
    uygun: { etiket: 'Uygun', puan: 100 },
    minor: { etiket: 'Minör', puan: 50 },
    major: { etiket: 'Majör', puan: 0 },
    gozlem: { etiket: 'Gözlem', puan: 100 },
  });

  function sonucSinifi(deger) {
    const ham = String(deger ?? '').trim();
    if (!ham) return null;
    if (/^[1-4]$/.test(ham)) {
      return ['uygun', 'minor', 'major', 'gozlem'][Number(ham) - 1];
    }
    const normalize = normalizeEtiket(ham);
    if (
      normalize.includes('minor') ||
      normalize.includes('minur') ||
      normalize === 'mnr' ||
      normalize === 'minoruygunsuzluk'
    ) {
      return 'minor';
    }
    if (
      normalize.includes('major') ||
      normalize.includes('majur') ||
      normalize === 'mjr' ||
      normalize === 'majoruygunsuzluk'
    ) {
      return 'major';
    }
    if (
      normalize.includes('gozlem') ||
      normalize.includes('observation') ||
      normalize === 'obs'
    ) {
      return 'gozlem';
    }
    if (normalize.includes('uygunsuzluk')) return null;
    if (normalize.includes('uygun') || normalize.includes('conform') || normalize === 'ok') {
      return 'uygun';
    }
    return null;
  }

  function durumEtiketi(deger) {
    const metin = metinDuzestir(deger);
    if (!metin) return '—';
    const normalize = normalizeEtiket(metin);
    if (normalize.includes('tamamland') || normalize === 'complete' || normalize === 'completed') {
      return 'Tamamlandı';
    }
    if (normalize.includes('devam') || normalize.includes('devamediyor') || normalize === 'ongoing') {
      return 'Devam Ediyor';
    }
    if (normalize.includes('planland') || normalize === 'planned' || normalize === 'plan') {
      return 'Planlandı';
    }
    return metin;
  }

  function tarihAl(deger) {
    if (deger instanceof Date && !Number.isNaN(deger.getTime())) {
      return tarihMetni(deger.toISOString().slice(0, 10));
    }
    return tarihMetni(deger);
  }

  function puanBicimle(deger) {
    if (typeof deger !== 'number' || !Number.isFinite(deger)) return '—';
    return deger.toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  const departmanNesnesi = kayit.departman && typeof kayit.departman === 'object' ? kayit.departman : {};
  const sirketAdi =
    ilkMetin(sirket, ['ad', 'name', 'sirket_adi', 'company_name']) || '—';
  const tetkikBasligi = ilkMetin(kayit, ['baslik', 'title']) || '—';
  const tetkikKodu =
    ilkMetin(kayit, [
      'tetkik_kodu',
      'denetim_kodu',
      'audit_code',
      'kod',
      'code',
      'referans',
      'no',
    ]) || '—';
  const tetkikYili =
    ilkMetin(kayit, ['yil', 'denetim_yili', 'audit_year', 'year']) || '—';
  const tetkikDurumu = durumEtiketi(
    ilkHam(kayit, ['durum', 'status', 'denetim_durumu', 'audit_status'])
  );
  const departmanAdi =
    ilkMetin(kayit, [
      'departman_ad',
      'departman_adi',
      'departman',
      'birim_ad',
      'birim_adi',
      'department_name',
    ]) ||
    ilkMetin(departmanNesnesi, ['ad', 'name', 'departman_ad']) ||
    '—';

  const planTarihi = tarihAl(
    ilkHam(kayit, ['planlanan_tarih', 'plan_tarihi', 'planlama_tarihi', 'planned_date', 'tarih'])
  );
  const baslangicTarihi = tarihAl(
    ilkHam(kayit, ['baslangic_tarihi', 'baslangiç_tarihi', 'start_date', 'denetim_tarihi'])
  );
  const bitisTarihi = tarihAl(
    ilkHam(kayit, ['bitis_tarihi', 'bitiş_tarihi', 'end_date', 'tamamlama_tarihi'])
  );
  const raporTarihi = tarihAl(
    bugun || ilkHam(kayit, ['rapor_tarihi', 'raporlama_tarihi', 'tamamlama_tarihi'])
  );

  const denetleyen =
    denetleyenAd ||
    ilkMetin(kayit, [
      'denetleyen_ad',
      'denetleyen_adi',
      'denetleyen',
      'bas_denetci_ad',
      'lead_auditor',
    ]) || '—';
  const tamamlayan =
    tamamlayanAd ||
    ilkMetin(kayit, [
      'tamamlayan_ad',
      'tamamlayan_adi',
      'tamamlayan',
      'rapor_tamamlayan',
      'completed_by',
    ]) || '—';

  const duzenliMaddeler = maddeKayitlari.map((madde, indeks) => {
    const nesne = madde && typeof madde === 'object' ? madde : { madde };
    const sonucHam = ilkHam(nesne, ['sonuc', 'result', 'degerlendirme', 'kontrol_sonucu']);
    const sinif = sonucSinifi(sonucHam);
    const acikPuan = ilkSayi(nesne, [
      'puan',
      'skor',
      'score',
      'puan_degeri',
      'madd_puan',
    ]);
    const hamAgirlik = ilkSayi(nesne, [
      'agirlik',
      'ağırlık',
      'weight',
      'agirlik_degeri',
      'agirlik_puan',
    ]);
    const agirlik = hamAgirlik !== null && hamAgirlik > 0 ? hamAgirlik : 1;
    const puan =
      acikPuan !== null ? acikPuan : sinif ? SONUC_TANIMLARI[sinif].puan : null;
    return {
      nesne,
      sira:
        ilkMetin(nesne, ['sira', 'sıra', 'madde_no', 'no', 'numara']) || String(indeks + 1),
      baslik: ilkMetin(nesne, ['baslik', 'title']),
      kriter: ilkMetin(nesne, ['kriter', 'criterion']),
      gereklilik: ilkMetin(nesne, [
        'gereklilik',
        'requirement',
        'madde',
        'soru',
        'baslik',
        'aciklama',
      ]),
      referans: ilkMetin(nesne, [
        'referans',
        'reference',
        'kaynak',
        'standard',
        'denetim_gerekliligi',
      ]),
      sonucMetni: sinif
        ? SONUC_TANIMLARI[sinif].etiket
        : metinDuzestir(sonucHam) || '—',
      sinif,
      puan,
      agirlik,
    };
  });

  const duzenliBulgular = bulguKayitlari.map((bulgu, indeks) => {
    const nesne = bulgu && typeof bulgu === 'object' ? bulgu : { bulgu };
    const dogrudanSinif = sonucSinifi(
      ilkHam(nesne, ['siniflandirma', 'sinif', 'classification', 'tur', 'sonuc', 'result'])
    );
    const sinifMetni = dogrudanSinif
      ? SONUC_TANIMLARI[dogrudanSinif].etiket
      : ilkMetin(nesne, ['siniflandirma', 'sinif', 'classification', 'tur', 'sonuc', 'result']) || '—';
    const dofNesnesi = nesne.dof && typeof nesne.dof === 'object' ? nesne.dof : {};
    let dofReferansi = ilkMetin(nesne, [
      'dof_referansi',
      'dof_referans',
      'dof_kodu',
      'dof_kod',
      'dof_no',
      'dof_ref',
    ]);
    if (!dofReferansi) {
      dofReferansi = ilkMetin(dofNesnesi, ['referans', 'kod', 'code', 'no']);
    }
    if (!dofReferansi) {
      const dofId = ilkHam(nesne, ['dof_id', 'dofId']);
      if (doluDeger(dofId)) dofReferansi = `DÖF #${metinDuzestir(dofId) || dofId}`;
    }
    const sorumlu = ilkMetin(nesne, [
      'sorumlu_ad',
      'sorumlu_adi',
      'sorumlu',
      'responsible',
      'responsible_name',
    ]);
    const bulguDepartmani =
      ilkMetin(nesne, ['departman_ad', 'departman_adi', 'departman', 'department_name']) ||
      ilkMetin(departmanNesnesi, ['ad', 'name']);
    const bulguBasligi = ilkMetin(nesne, ['baslik', 'title']);
    const bulguTanimi = ilkMetin(nesne, [
      'aciklama',
      'description',
      'bulgu_aciklama',
      'tanim',
      'bulgu',
      'detail',
    ]);
    const bulguAciklamasi = [bulguBasligi, bulguTanimi]
      .filter((deger) => deger && deger !== '—')
      .filter((deger, indeks, dizi) => dizi.indexOf(deger) === indeks)
      .join('\n');
    return {
      nesne,
      referans:
        ilkMetin(nesne, ['bulgu_ref', 'bulgu_referansi', 'bulgu_no', 'referans', 'kod', 'no']) ||
        '—',
      sinifMetni,
      aciklama: bulguAciklamasi || '—',
      sorumlu: sorumlu || '—',
      departman: bulguDepartmani || '—',
      dofReferansi: dofReferansi || 'DÖF oluşturulmadı',
      sira: ilkMetin(nesne, ['sira', 'sıra', 'no', 'numara']) || String(indeks + 1),
    };
  });

  const bulguHaritasi = new Map();
  for (const bulgu of duzenliBulgular) {
    for (const anahtar of ['bulgu_ref', 'bulgu_referansi', 'bulgu_no', 'referans', 'kod', 'id']) {
      const referans = metinDuzestir(bulgu.nesne[anahtar]);
      if (referans) bulguHaritasi.set(normalizeEtiket(referans), bulgu);
    }
  }

  const sonucSayaclari = { uygun: 0, minor: 0, major: 0, gozlem: 0 };
  for (const madde of duzenliMaddeler) {
    if (madde.sinif && Object.prototype.hasOwnProperty.call(sonucSayaclari, madde.sinif)) {
      sonucSayaclari[madde.sinif] += 1;
    }
  }

  const puanlanabilirMaddeler = duzenliMaddeler.filter(
    (madde) => madde.puan !== null && madde.agirlik > 0
  );
  const kayitPuani = ilkSayi(kayit, [
    'genel_puan',
    'overall_score',
    'toplam_puan',
    'weighted_score',
    'puan',
  ]);
  const yerelGenelPuan = puanlanabilirMaddeler.length
    ? puanlanabilirMaddeler.reduce(
        (toplam, madde) => toplam + madde.puan * madde.agirlik,
        0
      ) / puanlanabilirMaddeler.reduce((toplam, madde) => toplam + madde.agirlik, 0)
    : null;
  const genelPuan = kayitPuani !== null ? kayitPuani : yerelGenelPuan;

  return new Promise((resolve, reject) => {
    const antetRenk = '#1e3a8a';
    const antetAcikRenk = '#e8eef9';
    let doc;
    try {
      doc = new PDFDocument({
        size: 'A4',
        margins: { top: KENAR.ust, bottom: KENAR.alt, left: KENAR.sol, right: KENAR.sag },
        bufferPages: true,
        info: {
          Title: `${tetkikKodu} İç Tetkik (Denetim) Raporu`.trim(),
          Author: sirketAdi,
          Subject: 'İç Tetkik (Denetim) Raporu',
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

    const logoKaynagi =
      logoVerisi !== null && logoVerisi !== undefined && logoVerisi !== ''
        ? logoVerisi
        : logoYolu;
    const logo = logoKaynagi ? logoVerisiCoz(logoKaynagi) : null;
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
      doc.rect(x, ust, ICERIK_GENISLIK, 5).fillColor(antetRenk).fill();

      const logoKutuY = ust + 14;
      if (logo) {
        const icX = x + LOGO_KUTU.icBosluk;
        const icY = logoKutuY + LOGO_KUTU.icBosluk;
        const icGenislik = LOGO_KUTU.genislik - LOGO_KUTU.icBosluk * 2;
        const icYukseklik = LOGO_KUTU.yukseklik - LOGO_KUTU.icBosluk * 2;
        doc.save();
        doc.rect(x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik).fillColor('#ffffff').fill();
        try {
          doc.image(logo.veri, icX, icY, {
            fit: [icGenislik, icYukseklik],
            align: 'center',
            valign: 'center',
          });
        } catch (hata) {
          logoUyar(`İç tetkik raporu görseli çizilemedi (${hata.message}).`);
          doc
            .font(govde)
            .fontSize(9)
            .fillColor('#94a3b8')
            .text(yazi('—'), icX, logoKutuY + LOGO_KUTU.yukseklik / 2 - 5, {
              width: icGenislik,
              align: 'center',
            });
        }
        doc.restore();
        stilCiz(doc, x, logoKutuY, LOGO_KUTU.genislik, LOGO_KUTU.yukseklik, 'duz');
      }

      const sirketX = logo ? x + LOGO_KUTU.genislik + 12 : x;
      const sirketGenislik = logo
        ? ICERIK_GENISLIK - LOGO_KUTU.genislik - 12
        : ICERIK_GENISLIK;
      doc.fillColor('#0f172a').font(kalin).fontSize(13.5);
      const sirketMetni = yazi(sirketAdi);
      doc.text(
        metniSigdir(doc, sirketMetni, sirketGenislik),
        sirketX,
        ust + 14,
        { width: sirketGenislik, align: 'right' }
      );
      doc
        .font(govde)
        .fontSize(8)
        .fillColor('#64748b')
        .text(yazi('Kalite Yönetim Sistemi | İç Tetkik / Denetim'), sirketX, ust + 33, {
          width: sirketGenislik,
          align: 'right',
        });

      const tabloY = 104;
      const hucreGenislik = ICERIK_GENISLIK / 4;
      const hucreYukseklik = 27;
      const bilgiler = [
        ['TETKİK KODU', tetkikKodu],
        ['YIL', tetkikYili],
        ['DURUM', tetkikDurumu],
        ['DEPARTMAN', departmanAdi],
        ['PLANLANAN TARİH', planTarihi],
        ['BAŞLANGIÇ TARİHİ', baslangicTarihi],
        ['BİTİŞ TARİHİ', bitisTarihi],
        ['RAPOR TARİHİ', raporTarihi],
      ];
      bilgiler.forEach(([etiket, deger], indeks) => {
        const satir = Math.floor(indeks / 4);
        const sutun = indeks % 4;
        const hucreX = x + sutun * hucreGenislik;
        const hucreY = tabloY + satir * hucreYukseklik;
        doc
          .rect(hucreX, hucreY, hucreGenislik, hucreYukseklik)
          .fillColor(satir === 0 ? antetRenk : '#274c9b')
          .fill();
        doc
          .fillColor('#ffffff')
          .font(govde)
          .fontSize(6.2)
          .text(yazi(etiket), hucreX + 6, hucreY + 4, {
            width: hucreGenislik - 12,
            lineBreak: false,
          });
        doc.font(kalin).fontSize(8.2);
        doc.text(
          yazi(metniSigdir(doc, String(deger || '—'), hucreGenislik - 12)),
          hucreX + 6,
          hucreY + 14,
          { width: hucreGenislik - 12, lineBreak: false }
        );
        doc
          .strokeColor(antetRenk)
          .lineWidth(0.6)
          .rect(hucreX, hucreY, hucreGenislik, hucreYukseklik)
          .stroke();
      });
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
      doc.rect(KENAR.sol, y + 1, 3.5, 14).fillColor(antetRenk).fill();
      doc
        .fillColor('#0f172a')
        .font(kalin)
        .fontSize(11)
        .text(yazi(baslik), KENAR.sol + 10, y, { width: ICERIK_GENISLIK - 10 });
      doc.y = y + 19;
    }

    function ozetSatiri(etiket, deger) {
      const metin = metinDuzestir(deger) || '—';
      doc.font(govde).fontSize(9.2);
      const metinYukseklik = doc.heightOfString(yazi(metin), {
        width: ICERIK_GENISLIK - 96,
        lineGap: 1.5,
      });
      const satirYukseklik = Math.max(19, metinYukseklik + 5);
      boslukAyir(satirYukseklik + 4);
      const y = doc.y;
      doc
        .rect(KENAR.sol, y, 88, satirYukseklik)
        .fillColor('#f1f5f9')
        .fill();
      doc
        .strokeColor('#cbd5e1')
        .lineWidth(0.5)
        .rect(KENAR.sol, y, 88, satirYukseklik)
        .stroke();
      doc
        .font(kalin)
        .fontSize(8.2)
        .fillColor('#334155')
        .text(yazi(etiket), KENAR.sol + 7, y + 6, {
          width: 74,
          lineBreak: false,
        });
      doc
        .font(govde)
        .fontSize(9.2)
        .fillColor('#1f2937')
        .text(yazi(metin), KENAR.sol + 96, y + 5, {
          width: ICERIK_GENISLIK - 96,
          lineGap: 1.5,
        });
      doc.y = y + satirYukseklik + 4;
    }

    function sonucOzetiCiz() {
      bolumBasligi('SONUÇ ÖZETİ');
      const kartY = doc.y;
      const kartYukseklik = 67;
      const puanGenislik = 150;
      const bosluk = 8;
      const sayacGenislik = (ICERIK_GENISLIK - puanGenislik - bosluk) / 4;

      doc
        .rect(KENAR.sol, kartY, puanGenislik, kartYukseklik)
        .fillColor(antetAcikRenk)
        .fill();
      doc
        .rect(KENAR.sol, kartY, 4, kartYukseklik)
        .fillColor(antetRenk)
        .fill();
      doc
        .font(govde)
        .fontSize(7.2)
        .fillColor('#475569')
        .text(yazi('Ağırlıklı Genel Puan'), KENAR.sol + 12, kartY + 10, {
          width: puanGenislik - 20,
          lineBreak: false,
        });
      const genelPuanMetni =
        genelPuan === null || genelPuan === undefined
          ? '—'
          : `${puanBicimle(genelPuan)} / 100`;
      doc
        .font(kalin)
        .fontSize(19)
        .fillColor(antetRenk)
        .text(yazi(genelPuanMetni), KENAR.sol + 12, kartY + 27, {
          width: puanGenislik - 20,
          lineBreak: false,
        });

      Object.entries(SONUC_TANIMLARI).forEach(([anahtar, tanim], indeks) => {
        const x = KENAR.sol + puanGenislik + bosluk + indeks * sayacGenislik;
        doc.rect(x, kartY, sayacGenislik, kartYukseklik).fillColor('#f8fafc').fill();
        doc
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .rect(x, kartY, sayacGenislik, kartYukseklik)
          .stroke();
        doc
          .font(govde)
          .fontSize(7.2)
          .fillColor('#475569')
          .text(yazi(tanim.etiket), x + 5, kartY + 10, {
            width: sayacGenislik - 10,
            align: 'center',
            lineBreak: false,
          });
        doc
          .font(kalin)
          .fontSize(18)
          .fillColor(antetRenk)
          .text(yazi(String(sonucSayaclari[anahtar])), x + 5, kartY + 27, {
            width: sayacGenislik - 10,
            align: 'center',
            lineBreak: false,
          });
      });

      doc.y = kartY + kartYukseklik + 6;
      doc
        .font(govde)
        .fontSize(7.5)
        .fillColor('#64748b')
        .text(
          yazi('Genel puan, puanlanabilen kontrol listesi maddelerinin ağırlıklarına göre hesaplanmıştır.'),
          KENAR.sol,
          doc.y,
          { width: ICERIK_GENISLIK }
        );
      doc.moveDown(0.55);
    }

    function kontrolListesiCiz() {
      bolumBasligi('KONTROL LİSTESİ SONUÇLARI');
      const kolonlar = [
        { genislik: 25 },
        { genislik: 180 },
        { genislik: 63 },
        { genislik: 46 },
        { genislik: 185.28 },
      ];
      const basliklar = ['No', 'Gereklilik / Referans', 'Sonuç', 'Puan', 'Bulgu / Kanıt'];

      function baslikSatiri(y) {
        let x = KENAR.sol;
        doc.rect(x, y, ICERIK_GENISLIK, 21).fillColor(antetRenk).fill();
        kolonlar.forEach((kolon, indeks) => {
          doc
            .fillColor('#ffffff')
            .font(kalin)
            .fontSize(6.8)
            .text(yazi(basliklar[indeks]), x + 4, y + 7, {
              width: kolon.genislik - 8,
              lineBreak: false,
            });
          x += kolon.genislik;
        });
        doc
          .strokeColor(antetRenk)
          .lineWidth(0.6)
          .rect(KENAR.sol, y, ICERIK_GENISLIK, 21)
          .stroke();
      }

      if (!duzenliMaddeler.length) {
        doc
          .font(govde)
          .fontSize(9.2)
          .fillColor('#94a3b8')
          .text(yazi('Bu tetkik için kontrol listesi maddesi tanımlanmamış.'), KENAR.sol, doc.y, {
            width: ICERIK_GENISLIK,
          });
        doc.moveDown(0.6);
        return;
      }

      let y = doc.y;
      baslikSatiri(y);
      y += 21;

      duzenliMaddeler.forEach((madde) => {
        let bulguMetni = ilkMetin(madde.nesne, [
          'bulgu_aciklama',
          'bulgu',
          'finding',
          'finding_description',
          'aciklama',
          'tespit',
          'not',
        ]);
        const bulguBaglanti = ilkMetin(madde.nesne, [
          'bulgu_ref',
          'bulgu_referansi',
          'bulgu_no',
          'bulgu_kodu',
        ]);
        if (!bulguMetni && bulguBaglanti) {
          bulguMetni = bulguHaritasi.get(normalizeEtiket(bulguBaglanti))?.aciklama || null;
        }
        const kanitMetni = ilkMetin(madde.nesne, [
          'kanit',
          'kanit_aciklama',
          'evidence',
          'evidence_description',
          'belge',
        ]);
        const bulguKanitParcalari = [];
        if (bulguMetni) bulguKanitParcalari.push(bulguMetni);
        if (kanitMetni) bulguKanitParcalari.push(`Kanıt: ${kanitMetni}`);
        const bulguKanitMetni = bulguKanitParcalari.join('\n') || '—';

        let gereklilikParcalari = [];
        if (madde.baslik && madde.baslik !== madde.kriter) gereklilikParcalari.push(madde.baslik);
        if (madde.kriter) gereklilikParcalari.push(madde.kriter);
        if (!gereklilikParcalari.length && madde.gereklilik) {
          gereklilikParcalari.push(madde.gereklilik);
        }
        let gereklilikMetni = gereklilikParcalari.join('\n') || '—';
        if (madde.referans && !gereklilikParcalari.includes(madde.referans)) {
          gereklilikMetni += `\nReferans: ${madde.referans}`;
        }

        const degerler = [
          madde.sira,
          gereklilikMetni,
          madde.sonucMetni,
          puanBicimle(madde.puan),
          bulguKanitMetni,
        ];
        doc.font(govde).fontSize(7.2);
        const icYukseklikler = degerler.map((deger, indeks) =>
          doc.heightOfString(yazi(deger), {
            width: kolonlar[indeks].genislik - 8,
            lineGap: 1.2,
          })
        );
        const satirYukseklik = Math.max(19, Math.ceil(Math.max(...icYukseklikler)) + 8);

        if (y + satirYukseklik > icerikAltSinir() - 4) {
          yeniSayfa();
          y = doc.y;
          baslikSatiri(y);
          y += 21;
        }

        let x = KENAR.sol;
        kolonlar.forEach((kolon, indeks) => {
          const sonucRengi =
            indeks === 2
              ? madde.sinif === 'uygun'
                ? '#ecfdf5'
                : madde.sinif === 'minor'
                  ? '#fffbeb'
                  : madde.sinif === 'major'
                    ? '#fef2f2'
                    : madde.sinif === 'gozlem'
                      ? '#eff6ff'
                      : '#f8fafc'
              : indeks % 2 === 0
                ? '#ffffff'
                : '#f8fafc';
          doc.rect(x, y, kolon.genislik, satirYukseklik).fillColor(sonucRengi).fill();
          doc
            .strokeColor('#cbd5e1')
            .lineWidth(0.5)
            .rect(x, y, kolon.genislik, satirYukseklik)
            .stroke();
          if (indeks === 0 || indeks === 2 || indeks === 3) {
            doc
              .font(kalin)
              .fontSize(7.2)
              .fillColor('#1f2937')
              .text(
                yazi(metniSigdir(doc, degerler[indeks], kolon.genislik - 8)),
                x + 4,
                y + 5,
                { width: kolon.genislik - 8, lineBreak: false }
              );
          } else {
            doc
              .font(govde)
              .fontSize(7.2)
              .fillColor('#1f2937')
              .text(yazi(degerler[indeks]), x + 4, y + 4, {
                width: kolon.genislik - 8,
                lineGap: 1.2,
              });
          }
          x += kolon.genislik;
        });
        y += satirYukseklik;
      });

      doc.y = y + 8;
    }

    function bulguTablosuCiz() {
      bolumBasligi('BULGULAR VE DÖF BAĞLANTILARI');
      const kolonlar = [
        { genislik: 60 },
        { genislik: 67 },
        { genislik: 156 },
        { genislik: 104 },
        { genislik: 112.28 },
      ];
      const basliklar = [
        'Bulgu Ref',
        'Sınıflandırma',
        'Açıklama',
        'Sorumlu / Departman',
        'DÖF Referansı',
      ];

      function baslikSatiri(y) {
        let x = KENAR.sol;
        doc.rect(x, y, ICERIK_GENISLIK, 21).fillColor(antetRenk).fill();
        kolonlar.forEach((kolon, indeks) => {
          doc
            .fillColor('#ffffff')
            .font(kalin)
            .fontSize(6.7)
            .text(yazi(basliklar[indeks]), x + 4, y + 7, {
              width: kolon.genislik - 8,
              lineBreak: false,
            });
          x += kolon.genislik;
        });
        doc
          .strokeColor(antetRenk)
          .lineWidth(0.6)
          .rect(KENAR.sol, y, ICERIK_GENISLIK, 21)
          .stroke();
      }

      let y = doc.y;
      baslikSatiri(y);
      y += 21;

      if (!duzenliBulgular.length) {
        const satirYukseklik = 24;
        doc
          .rect(KENAR.sol, y, ICERIK_GENISLIK, satirYukseklik)
          .fillColor('#f8fafc')
          .fill();
        doc
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .rect(KENAR.sol, y, ICERIK_GENISLIK, satirYukseklik)
          .stroke();
        doc
          .font(govde)
          .fontSize(8.5)
          .fillColor('#94a3b8')
          .text(yazi('Bu tetkik için bulgu kaydı bulunmuyor.'), KENAR.sol + 6, y + 8, {
            width: ICERIK_GENISLIK - 12,
            lineBreak: false,
          });
        doc.y = y + satirYukseklik + 8;
        return;
      }

      duzenliBulgular.forEach((bulgu) => {
        const sorumluDepartman = [bulgu.sorumlu, bulgu.departman]
          .filter((deger) => deger && deger !== '—')
          .join('\n');
        const degerler = [
          bulgu.referans,
          bulgu.sinifMetni,
          bulgu.aciklama,
          sorumluDepartman || '—',
          bulgu.dofReferansi,
        ];
        doc.font(govde).fontSize(7.2);
        const icYukseklikler = degerler.map((deger, indeks) =>
          doc.heightOfString(yazi(deger), {
            width: kolonlar[indeks].genislik - 8,
            lineGap: 1.2,
          })
        );
        const satirYukseklik = Math.max(21, Math.ceil(Math.max(...icYukseklikler)) + 8);

        if (y + satirYukseklik > icerikAltSinir() - 4) {
          yeniSayfa();
          y = doc.y;
          baslikSatiri(y);
          y += 21;
        }

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
            .font(govde)
            .fontSize(7.2)
            .fillColor('#1f2937')
            .text(yazi(degerler[indeks]), x + 4, y + 4, {
              width: kolon.genislik - 8,
              lineGap: 1.2,
            });
          x += kolon.genislik;
        });
        y += satirYukseklik;
      });

      doc.y = y + 8;
    }

    function imzaKutulariCiz() {
      boslukAyir(64);
      const kutuGenislik = (ICERIK_GENISLIK - 14) / 2;
      const y = doc.y;
      const kutular = [
        {
          etiket: 'BAŞ DENETÇİ / DENETLEYEN',
          ad: denetleyen,
          tarih: `Tarih: ${tarihAl(bugun || bitisTarihi)}`,
        },
        {
          etiket: 'RAPORU TAMAMLAYAN',
          ad: tamamlayan,
          tarih: `Tarih: ${tarihAl(bugun || bitisTarihi)}`,
        },
      ];
      kutular.forEach((kutu, indeks) => {
        const x = KENAR.sol + indeks * (kutuGenislik + 14);
        stilCiz(doc, x, y, kutuGenislik, 48, 'duz');
        doc
          .font(kalin)
          .fontSize(7)
          .fillColor('#334155')
          .text(yazi(kutu.etiket), x + 8, y + 7, { width: kutuGenislik - 16 });
        doc
          .font(govde)
          .fontSize(9)
          .fillColor('#0f172a')
          .text(
            yazi(metniSigdir(doc, kutu.ad, kutuGenislik - 16)),
            x + 8,
            y + 20,
            { width: kutuGenislik - 16, lineBreak: false }
          );
        doc
          .font(govde)
          .fontSize(7.5)
          .fillColor('#64748b')
          .text(yazi(kutu.tarih), x + 8, y + 33, {
            width: kutuGenislik - 16,
            lineBreak: false,
          });
      });
      doc.y = y + 58;
    }

    try {
      doc
        .fillColor('#0f172a')
        .font(kalin)
        .fontSize(16)
        .text(yazi('İÇ TETKİK (DENETİM) RAPORU'), KENAR.sol, KENAR.ust, {
          width: ICERIK_GENISLIK,
          align: 'center',
          lineBreak: false,
        });
      doc.y = KENAR.ust + 24;
      doc
        .font(govde)
        .fontSize(9)
        .fillColor('#334155')
        .text(
          yazi(metniSigdir(doc, tetkikBasligi, ICERIK_GENISLIK)),
          KENAR.sol,
          doc.y,
          { width: ICERIK_GENISLIK, align: 'center', lineBreak: false }
        );
      doc.moveDown(0.25);
      doc
        .font(govde)
        .fontSize(8.5)
        .fillColor('#475569')
        .text(yazi(`${tetkikKodu} · ${tetkikYili} · ${tetkikDurumu}`), KENAR.sol, doc.y, {
          width: ICERIK_GENISLIK,
          align: 'center',
          lineBreak: false,
        });
      doc.moveDown(0.55);
      doc
        .strokeColor('#cbd5e1')
        .lineWidth(0.8)
        .moveTo(KENAR.sol, doc.y)
        .lineTo(KENAR.sol + ICERIK_GENISLIK, doc.y)
        .stroke();
      doc.moveDown(0.65);

      bolumBasligi('TETKİK ÖZETİ');
      ozetSatiri(
        'Kapsam',
        ilkMetin(kayit, [
          'kapsam',
          'tetkik_kapsami',
          'denetim_kapsami',
          'scope',
          'kapsam_aciklamasi',
        ])
      );
      ozetSatiri(
        'Amaç',
        ilkMetin(kayit, [
          'amac',
          'tetkik_amaci',
          'denetim_amaci',
          'objective',
          'amac_aciklamasi',
        ])
      );
      ozetSatiri(
        'Yöntem',
        ilkMetin(kayit, [
          'yontem',
          'tetkik_yontemi',
          'denetim_yontemi',
          'metod',
          'method',
          'inceleme_metodu',
        ])
      );

      sonucOzetiCiz();
      kontrolListesiCiz();
      bulguTablosuCiz();
      imzaKutulariCiz();

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
          .text(yazi(`${sirketAdi} · ${tetkikKodu} · ${tetkikYili}`), KENAR.sol, sayfa.height - 27, {
            width: ICERIK_GENISLIK,
            align: 'center',
          });
        sayfa.margins.bottom = eskiAltKenar;
      }
    } catch (hata) {
      reject(hata);
      try {
        doc.end();
      } catch {
        /* Belge zaten kapanmış olabilir. */
      }
      return;
    }

    doc.end();
  });
}

module.exports = {
  pdfUret,
  dofPdfUret,
  tetkikPdfUret,
  logoVerisiCoz,
  turkceAscii,
  renkGecerliMi,
};
