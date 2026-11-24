'use strict';

/**
 * Kurumsal raporlama ve CSV/Excel dışa aktarma rotaları (Faz 3).
 *
 * Raporlar yalnızca `rapor` iznine sahip kullanıcılara (admin ve kalite)
 * açıktır. Üç rapor sunulur:
 *   - Güncel doküman ana listesi        (/raporlar/dokumanlar)
 *   - Okundu onayı matrisi / listesi    (/raporlar/okundu-onayi)
 *   - Yıllık eğitim gerçekleşme raporu  (/raporlar/egitim)
 *
 * Her rapor hem HTML hem de bağımlılıksız `disa-aktarma` yardımcılarıyla
 * üretilen CSV (.csv) ve gerçek Excel (.xlsx) çıktısı sunar. Filtreler dışa
 * aktarmalarda da korunur. Sorgular tek tek hücre başına çalıştırılmaz;
 * matris hücreleri tek sorguda toplanır.
 */

const { csvOlustur, xlsxOlustur } = require('./disa-aktarma');
const { bugunTz, tarihTr, zamanTr } = require('./dates');
const { TUR_KODLARI, turGetir, revizyonEtiketi } = require('./qdms');
const { etkinAyarlar } = require('./settings');

const GORUNUMLER = Object.freeze(['matris', 'liste']);
const OKUNDU_DURUMLARI = Object.freeze(['hepsi', 'okundu', 'bekliyor']);

const EGITIM_TURLERI = Object.freeze({
  ic: 'İç Eğitim',
  dis: 'Dış Eğitim',
});

const EGITIM_DURUMLARI = Object.freeze({
  planlandi: 'Planlandı',
  tamamlandi: 'Tamamlandı',
  iptal: 'İptal',
});

const EGITIM_DURUM_ANAHTARLARI = Object.freeze(Object.keys(EGITIM_DURUMLARI));

const KATILIM_ETIKETLERI = Object.freeze({
  katildi: 'Katıldı',
  katilmadi: 'Katılmadı',
  bekliyor: 'Bekliyor',
});

const DOKUMAN_CSV_BASLIKLARI = Object.freeze([
  'Doküman Kodu',
  'Başlık',
  'Tür',
  'Revizyon',
  'Yayın Tarihi',
  'Hedef Departmanlar',
  'Hazırlayan',
]);

const OKUNDU_LISTE_BASLIKLARI = Object.freeze([
  'Personel',
  'Departman',
  'Doküman Kodu',
  'Doküman',
  'Revizyon',
  'Durum',
  'Okunma Tarihi',
]);

const EGITIM_LISTE_BASLIKLARI = Object.freeze([
  'Eğitim',
  'Tür',
  'Tarih',
  'Eğitmen',
  'Süre (saat)',
  'İlgili Doküman',
  'Planlanan',
  'Katılan',
  'Katılmayan',
  'Bekleyen',
  'Katılım %',
  'Ort. Puan',
  'Etkinlik %',
]);

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

function tekDeger(deger) {
  return Array.isArray(deger) ? deger[0] : deger;
}

function queryMetin(req, ad, varsayilan = '') {
  const deger = tekDeger(req.query[ad]);
  return typeof deger === 'string' ? deger.trim() : varsayilan;
}

function kimlik(deger) {
  const sayi = Number(tekDeger(deger));
  return Number.isInteger(sayi) && sayi > 0 ? sayi : null;
}

function sayiAraligi(deger, enAz, enCok, varsayilan) {
  const sayi = Number(tekDeger(deger));
  return Number.isInteger(sayi) && sayi >= enAz && sayi <= enCok ? sayi : varsayilan;
}

function gorunumCoz(req, varsayilan = 'matris') {
  const ham = queryMetin(req, 'gorunum').toLowerCase();
  return GORUNUMLER.includes(ham) ? ham : varsayilan;
}

/** Sorgu parametrelerini URL'ye güvenli biçimde ekler; boş değerleri atlar. */
function sorguDizesi(parametreler = {}) {
  const arama = new URLSearchParams();
  for (const [anahtar, deger] of Object.entries(parametreler)) {
    if (deger === undefined || deger === null || deger === '') continue;
    arama.set(anahtar, String(deger));
  }
  const metin = arama.toString();
  return metin ? `?${metin}` : '';
}

function yuzdeHesapla(pay, payda) {
  const bolunen = Number(pay) || 0;
  const bolen = Number(payda) || 0;
  return bolen > 0 ? Math.round((bolunen / bolen) * 100) : null;
}

function yuzdeMetni(deger) {
  return deger === null || deger === undefined ? '—' : `%${deger}`;
}

function puanMetni(deger) {
  if (deger === null || deger === undefined || deger === '') return '—';
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return '—';
  const yuvarlak = Math.round(sayi * 10) / 10;
  return Number.isInteger(yuvarlak) ? String(yuvarlak) : yuvarlak.toFixed(1).replace('.', ',');
}

function sayiMetni(deger) {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return '—';
  const yuvarlak = Math.round(sayi * 100) / 100;
  return Number.isInteger(yuvarlak) ? String(yuvarlak) : String(yuvarlak).replace('.', ',');
}

function tarihMetni(deger) {
  const ham = String(deger || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ham) ? tarihTr(ham) : '—';
}

function zamanMetni(zaman, saatDilimi) {
  return zaman ? zamanTr(zaman, saatDilimi) : '—';
}

function departmanlarGetir(db) {
  return db
    .prepare('SELECT id, ad FROM departmanlar ORDER BY ad COLLATE NOCASE')
    .all();
}

function departmanIdCoz(db, deger) {
  const id = kimlik(deger);
  if (!id) return null;
  return db.prepare('SELECT id FROM departmanlar WHERE id = ?').get(id) ? id : null;
}

function yayinDokumanIdCoz(db, deger) {
  const id = kimlik(deger);
  if (!id) return null;
  const satir = db
    .prepare("SELECT id FROM dokumanlar WHERE id = ? AND durum = 'yayinda'")
    .get(id);
  return satir ? satir.id : null;
}

function yayinDokumanlariGetir(db, dokumanId = null) {
  const kosullar = ["d.durum = 'yayinda'"];
  const parametreler = [];
  if (dokumanId) {
    kosullar.push('d.id = ?');
    parametreler.push(dokumanId);
  }
  return db
    .prepare(
      `SELECT d.id, d.kod, d.baslik, d.tur_kod, d.revizyon
       FROM dokumanlar d
       WHERE ${kosullar.join(' AND ')}
       ORDER BY d.tur_kod, d.kod`
    )
    .all(...parametreler);
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

/**
 * CSV veya XLSX yanıtı üretir. Boş `satirlar` başlık satırı olan geçerli bir
 * dosya üretir; bu nedenle boş veri hiçbir zaman hata fırlatmaz.
 */
function disaAktar(res, { bicim, dosyaAdi, sayfaAdi = 'Rapor', basliklar, satirlar, genislikler = [] }) {
  const tampon =
    bicim === 'csv'
      ? csvOlustur({ basliklar, satirlar })
      : xlsxOlustur({ sayfaAdi, basliklar, satirlar, genislikler });

  const icerikTuru =
    bicim === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  res.set('Content-Type', icerikTuru);
  res.set('Content-Disposition', `attachment; filename="${dosyaAdi}.${bicim}"`);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Length', String(tampon.length));
  return res.send(tampon);
}

function guvenliDisaAktar(res, veri) {
  try {
    return disaAktar(res, veri);
  } catch (hata) {
    console.error('[rapor dışa aktarma]', hata);
    if (!res.headersSent) {
      return res.status(500).type('text/plain; charset=utf-8').send('Rapor dışa aktarılamadı.');
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Doküman ana listesi
// ---------------------------------------------------------------------------

function dokumanFiltreleriCoz(db, req) {
  const tur = turGetir(queryMetin(req, 'tur'));
  return {
    turKodu: tur ? tur.kod : '',
    departmanId: departmanIdCoz(db, queryMetin(req, 'departman')),
    arama: queryMetin(req, 'q').slice(0, 100),
  };
}

/**
 * Yayındaki dokümanları filtreleyerek döndürür. Hedef departmanlar tek bir
 * korelasyonlu alt sorguyla virgülle birleştirilir; doküman başına ayrı
 * sorgu çalıştırılmaz.
 */
function dokumanRaporuOlustur(db, filtreler) {
  const kosullar = ["d.durum = 'yayinda'"];
  const parametreler = [];

  if (filtreler.turKodu) {
    kosullar.push('d.tur_kod = ?');
    parametreler.push(filtreler.turKodu);
  }
  if (filtreler.departmanId) {
    kosullar.push(
      'EXISTS (SELECT 1 FROM dokuman_hedef_departmanlar hd WHERE hd.dokuman_id = d.id AND hd.departman_id = ?)'
    );
    parametreler.push(filtreler.departmanId);
  }
  if (filtreler.arama) {
    const desen = `%${filtreler.arama}%`;
    kosullar.push('(d.kod LIKE ? OR d.baslik LIKE ?)');
    parametreler.push(desen, desen);
  }

  return db
    .prepare(
      `SELECT d.id, d.kod, d.baslik, d.tur_kod, t.ad AS tur_ad, d.revizyon, d.yayin_tarihi,
              h.ad AS hazirlayan_ad,
              COALESCE((
                SELECT GROUP_CONCAT(dp.ad, ', ')
                FROM (
                  SELECT dp2.ad
                  FROM dokuman_hedef_departmanlar hd
                  JOIN departmanlar dp2 ON dp2.id = hd.departman_id
                  WHERE hd.dokuman_id = d.id
                  ORDER BY dp2.ad COLLATE NOCASE
                ) AS dp
              ), '') AS hedef_departmanlar
       FROM dokumanlar d
       JOIN dokuman_turleri t ON t.kod = d.tur_kod
       LEFT JOIN kullanicilar h ON h.id = d.hazirlayan_id
       WHERE ${kosullar.join(' AND ')}
       ORDER BY d.tur_kod, d.kod`
    )
    .all(...parametreler);
}

function dokumanDisaAktarmaSatirlari(dokumanlar) {
  return dokumanlar.map((dokuman) => [
    dokuman.kod,
    dokuman.baslik,
    dokuman.tur_ad,
    revizyonEtiketi(dokuman.revizyon),
    tarihMetni(dokuman.yayin_tarihi),
    dokuman.hedef_departmanlar || '—',
    dokuman.hazirlayan_ad || '—',
  ]);
}

// ---------------------------------------------------------------------------
// Okundu onayı
// ---------------------------------------------------------------------------

function okunduFiltreleriCoz(db, req) {
  const durumHam = queryMetin(req, 'durum', 'hepsi');
  return {
    dokuman: yayinDokumanIdCoz(db, queryMetin(req, 'dokuman')),
    departman: departmanIdCoz(db, queryMetin(req, 'departman')),
    durum: OKUNDU_DURUMLARI.includes(durumHam) ? durumHam : 'hepsi',
    arama: queryMetin(req, 'q').slice(0, 100),
  };
}

/**
 * Okundu onayı raporunun tüm verisini üretir. `gorunum` yalnızca liste ya da
 * matris ayrıntısını hesaplamayı belirler; özet ve seçenekler her zaman hazırdır.
 */
function okunduRaporuOlustur(db, filtreler, gorunum, saatDilimi) {
  const tumDokumanlar = yayinDokumanlariGetir(db, null);
  const matrisDokumanlari = filtreler.dokuman
    ? tumDokumanlar.filter((dokuman) => dokuman.id === filtreler.dokuman)
    : tumDokumanlar;

  // Matris/liste yalnızca yayındaki dokümanlar ve aktif kullanıcılar üzerinden
  // çalışır; böylece pasif personel geçmişi raporu kirletmez.
  const kosullar = ["d.durum = 'yayinda'", 'k.aktif = 1'];
  const parametreler = [];
  if (filtreler.dokuman) {
    kosullar.push('d.id = ?');
    parametreler.push(filtreler.dokuman);
  }
  if (filtreler.departman) {
    kosullar.push('k.departman_id = ?');
    parametreler.push(filtreler.departman);
  }
  if (filtreler.arama) {
    kosullar.push('k.ad LIKE ?');
    parametreler.push(`%${filtreler.arama}%`);
  }
  if (filtreler.durum === 'okundu') kosullar.push('r.okundu = 1');
  else if (filtreler.durum === 'bekliyor') kosullar.push('r.okundu = 0');

  const from = `FROM dokuman_okumalari r
    JOIN dokumanlar d ON d.id = r.dokuman_id
    JOIN kullanicilar k ON k.id = r.kullanici_id
    LEFT JOIN departmanlar dp ON dp.id = k.departman_id`;
  const where = kosullar.join(' AND ');

  const ozetSatiri = db
    .prepare(
      `SELECT COUNT(*) AS toplam,
              COALESCE(SUM(CASE WHEN r.okundu = 1 THEN 1 ELSE 0 END), 0) AS okunan,
              COALESCE(SUM(CASE WHEN r.okundu = 0 THEN 1 ELSE 0 END), 0) AS bekleyen
       ${from} WHERE ${where}`
    )
    .get(...parametreler);

  const ozet = {
    toplam: Number(ozetSatiri.toplam) || 0,
    okunan: Number(ozetSatiri.okunan) || 0,
    bekleyen: Number(ozetSatiri.bekleyen) || 0,
    oran: null,
  };
  ozet.oran = yuzdeHesapla(ozet.okunan, ozet.toplam);

  const departmanlar = departmanlarGetir(db);
  let liste = [];
  let matris = null;

  if (gorunum === 'liste') {
    liste = db
      .prepare(
        `SELECT k.ad AS personel, dp.ad AS departman_ad,
                d.id AS dokuman_id, d.kod AS dokuman_kod, d.baslik AS dokuman_baslik,
                d.tur_kod, d.revizyon, r.okundu, r.okunma_tarihi
         ${from}
         WHERE ${where}
         ORDER BY dp.ad COLLATE NOCASE, k.ad COLLATE NOCASE, d.tur_kod, d.kod`
      )
      .all(...parametreler);
  } else {
    const kisiler = db
      .prepare(
        `SELECT k.id, k.ad, MAX(dp.ad) AS departman_ad
         ${from}
         WHERE ${where}
         GROUP BY k.id, k.ad
         ORDER BY departman_ad COLLATE NOCASE, k.ad COLLATE NOCASE`
      )
      .all(...parametreler);

    const hucreHaritasi = new Map();
    if (kisiler.length && matrisDokumanlari.length) {
      const dokumanYerleri = matrisDokumanlari.map(() => '?').join(', ');
      const kullaniciYerleri = kisiler.map(() => '?').join(', ');
      const hucreler = db
        .prepare(
          `SELECT r.kullanici_id, r.dokuman_id, r.okundu, r.okunma_tarihi
           FROM dokuman_okumalari r
           WHERE r.dokuman_id IN (${dokumanYerleri})
             AND r.kullanici_id IN (${kullaniciYerleri})`
        )
        .all(
          ...matrisDokumanlari.map((dokuman) => dokuman.id),
          ...kisiler.map((kisi) => kisi.id)
        );
      for (const hucre of hucreler) {
        hucreHaritasi.set(`${hucre.kullanici_id}:${hucre.dokuman_id}`, hucre);
      }
    }

    const satirlar = kisiler.map((kisi) => {
      const hucreler = {};
      let okunan = 0;
      let toplam = 0;
      for (const dokuman of matrisDokumanlari) {
        const hucre = hucreHaritasi.get(`${kisi.id}:${dokuman.id}`);
        if (!hucre) {
          hucreler[dokuman.id] = null;
          continue;
        }
        hucreler[dokuman.id] = {
          okundu: Number(hucre.okundu) === 1,
          okunma_tarihi: hucre.okunma_tarihi,
        };
        toplam += 1;
        if (Number(hucre.okundu) === 1) okunan += 1;
      }
      return { ...kisi, hucreler, okunan, toplam };
    });

    matris = { dokumanlar: matrisDokumanlari, satirlar };
  }

  return {
    filtreler,
    tumDokumanlar,
    dokumanlar: matrisDokumanlari,
    departmanlar,
    seciliDokuman: tumDokumanlar.find((dokuman) => dokuman.id === filtreler.dokuman) || null,
    seciliDepartman:
      departmanlar.find((departman) => departman.id === filtreler.departman) || null,
    ozet,
    liste,
    matris,
  };
}

function okunduListeDisaAktarmaSatirlari(kayitlar, saatDilimi) {
  return kayitlar.map((kayit) => [
    kayit.personel,
    kayit.departman_ad || '—',
    kayit.dokuman_kod,
    kayit.dokuman_baslik,
    revizyonEtiketi(kayit.revizyon),
    Number(kayit.okundu) === 1 ? 'Okudu' : 'Bekliyor',
    Number(kayit.okundu) === 1 ? zamanMetni(kayit.okunma_tarihi, saatDilimi) : '—',
  ]);
}

function okunduMatrisBasliklari(matris) {
  return ['Personel', 'Departman', ...matris.dokumanlar.map((dokuman) => dokuman.kod)];
}

function okunduMatrisDisaAktarmaSatirlari(matris) {
  return matris.satirlar.map((kisi) => [
    kisi.ad,
    kisi.departman_ad || '—',
    ...matris.dokumanlar.map((dokuman) => {
      const hucre = kisi.hucreler[dokuman.id];
      if (!hucre) return '—';
      return hucre.okundu ? 'Okundu' : 'Bekliyor';
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Eğitim raporu
// ---------------------------------------------------------------------------

function egitimFiltreleriCoz(req, buYil) {
  const durumHam = queryMetin(req, 'durum', 'hepsi');
  return {
    yil: sayiAraligi(queryMetin(req, 'yil'), 2000, 2100, buYil),
    durum: ['hepsi', ...EGITIM_DURUM_ANAHTARLARI].includes(durumHam) ? durumHam : 'hepsi',
  };
}

function egitimRaporuOlustur(db, filtreler, gorunum, buYil) {
  const kosullar = ['substr(e.planlanan_tarih, 1, 4) = ?'];
  const parametreler = [String(filtreler.yil)];
  if (filtreler.durum !== 'hepsi') {
    kosullar.push('e.durum = ?');
    parametreler.push(filtreler.durum);
  }

  const satirlar = db
    .prepare(
      `SELECT e.id, e.ad, e.tur, e.egitmen, e.planlanan_tarih, e.sure_saat, e.durum, e.dokuman_id,
              d.kod AS dokuman_kod, d.baslik AS dokuman_baslik,
              COALESCE(k.katilimci_sayisi, 0) AS katilimci_sayisi,
              COALESCE(k.katilan_sayisi, 0) AS katilan_sayisi,
              COALESCE(k.katilmayan_sayisi, 0) AS katilmayan_sayisi,
              COALESCE(k.bekleyen_sayisi, 0) AS bekleyen_sayisi,
              COALESCE(k.puan_sayisi, 0) AS puan_sayisi,
              COALESCE(k.puan_toplam, 0) AS puan_toplam,
              COALESCE(k.etkin_sayisi, 0) AS etkin_sayisi,
              COALESCE(k.etkin_degil_sayisi, 0) AS etkin_degil_sayisi
       FROM egitimler e
       LEFT JOIN dokumanlar d ON d.id = e.dokuman_id
       LEFT JOIN (
         SELECT egitim_id,
                COUNT(*) AS katilimci_sayisi,
                SUM(CASE WHEN katilim_durumu = 'katildi' THEN 1 ELSE 0 END) AS katilan_sayisi,
                SUM(CASE WHEN katilim_durumu = 'katilmadi' THEN 1 ELSE 0 END) AS katilmayan_sayisi,
                SUM(CASE WHEN katilim_durumu = 'bekliyor' THEN 1 ELSE 0 END) AS bekleyen_sayisi,
                SUM(CASE WHEN degerlendirme_puani IS NOT NULL THEN 1 ELSE 0 END) AS puan_sayisi,
                SUM(CASE WHEN degerlendirme_puani IS NOT NULL THEN degerlendirme_puani ELSE 0 END) AS puan_toplam,
                SUM(CASE WHEN etkinlik_durumu = 'etkin' THEN 1 ELSE 0 END) AS etkin_sayisi,
                SUM(CASE WHEN etkinlik_durumu = 'etkin_degil' THEN 1 ELSE 0 END) AS etkin_degil_sayisi
         FROM egitim_katilimcilari
         GROUP BY egitim_id
       ) k ON k.egitim_id = e.id
       WHERE ${kosullar.join(' AND ')}
       ORDER BY e.planlanan_tarih ASC, e.id ASC`
    )
    .all(...parametreler);

  const egitimler = satirlar.map((satir) => {
    const katilimciSayisi = Number(satir.katilimci_sayisi) || 0;
    const katilan = Number(satir.katilan_sayisi) || 0;
    const katilmayan = Number(satir.katilmayan_sayisi) || 0;
    const bekleyen = Number(satir.bekleyen_sayisi) || 0;
    const puanSayisi = Number(satir.puan_sayisi) || 0;
    const puanToplam = Number(satir.puan_toplam) || 0;
    const etkin = Number(satir.etkin_sayisi) || 0;
    const etkinDegil = Number(satir.etkin_degil_sayisi) || 0;
    return {
      ...satir,
      katilimci_sayisi: katilimciSayisi,
      katilan_sayisi: katilan,
      katilmayan_sayisi: katilmayan,
      bekleyen_sayisi: bekleyen,
      puan_sayisi: puanSayisi,
      puan_toplam: puanToplam,
      etkin_sayisi: etkin,
      etkin_degil_sayisi: etkinDegil,
      katilimYuzdesi: yuzdeHesapla(katilan, katilan + katilmayan),
      etkinlikYuzdesi: yuzdeHesapla(etkin, etkin + etkinDegil),
      ortalamaPuan: puanSayisi > 0 ? Math.round((puanToplam / puanSayisi) * 10) / 10 : null,
    };
  });

  const ozet = {
    toplam: egitimler.length,
    planlanan: 0,
    tamamlanan: 0,
    katilimci: 0,
    katilimOrani: null,
    ortalamaPuan: null,
    etkinlikOrani: null,
  };
  let katilanToplam = 0;
  let katilmayanToplam = 0;
  let puanToplamTum = 0;
  let puanSayisiTum = 0;
  let etkinToplam = 0;
  let etkinDegilToplam = 0;

  for (const egitim of egitimler) {
    if (egitim.durum === 'planlandi') ozet.planlanan += 1;
    if (egitim.durum === 'tamamlandi') ozet.tamamlanan += 1;
    ozet.katilimci += egitim.katilimci_sayisi;
    katilanToplam += egitim.katilan_sayisi;
    katilmayanToplam += egitim.katilmayan_sayisi;
    puanToplamTum += egitim.puan_toplam;
    puanSayisiTum += egitim.puan_sayisi;
    etkinToplam += egitim.etkin_sayisi;
    etkinDegilToplam += egitim.etkin_degil_sayisi;
  }

  ozet.katilimOrani = yuzdeHesapla(katilanToplam, katilanToplam + katilmayanToplam);
  ozet.etkinlikOrani = yuzdeHesapla(etkinToplam, etkinToplam + etkinDegilToplam);
  ozet.ortalamaPuan =
    puanSayisiTum > 0 ? Math.round((puanToplamTum / puanSayisiTum) * 10) / 10 : null;

  let matris = null;
  if (gorunum === 'matris') {
    matris = { egitimler, satirlar: [] };
    if (egitimler.length) {
      const egitimIdler = egitimler.map((egitim) => egitim.id);
      const yerler = egitimIdler.map(() => '?').join(', ');
      const kisiler = db
        .prepare(
          `SELECT k.id, k.ad, MAX(dp.ad) AS departman_ad
           FROM egitim_katilimcilari kk
           JOIN kullanicilar k ON k.id = kk.kullanici_id
           LEFT JOIN departmanlar dp ON dp.id = k.departman_id
           WHERE kk.egitim_id IN (${yerler})
           GROUP BY k.id, k.ad
           ORDER BY departman_ad COLLATE NOCASE, k.ad COLLATE NOCASE`
        )
        .all(...egitimIdler);

      const hucreHaritasi = new Map();
      const hucreler = db
        .prepare(
          `SELECT kk.kullanici_id, kk.egitim_id, kk.katilim_durumu, kk.degerlendirme_puani
           FROM egitim_katilimcilari kk
           WHERE kk.egitim_id IN (${yerler})`
        )
        .all(...egitimIdler);
      for (const hucre of hucreler) {
        hucreHaritasi.set(`${hucre.kullanici_id}:${hucre.egitim_id}`, hucre);
      }

      matris.satirlar = kisiler.map((kisi) => {
        const satirHucreleri = {};
        let katildi = 0;
        let toplam = 0;
        for (const egitim of egitimler) {
          const hucre = hucreHaritasi.get(`${kisi.id}:${egitim.id}`);
          if (!hucre) {
            satirHucreleri[egitim.id] = null;
            continue;
          }
          satirHucreleri[egitim.id] = {
            katilim_durumu: hucre.katilim_durumu,
            degerlendirme_puani:
              hucre.degerlendirme_puani === null ? null : Number(hucre.degerlendirme_puani),
          };
          toplam += 1;
          if (hucre.katilim_durumu === 'katildi') katildi += 1;
        }
        return { ...kisi, hucreler: satirHucreleri, katildi, toplam };
      });
    }
  }

  const yilKayitlari = db
    .prepare("SELECT DISTINCT substr(planlanan_tarih, 1, 4) AS yil FROM egitimler")
    .all()
    .map((satir) => Number(satir.yil))
    .filter((deger) => Number.isInteger(deger) && deger > 0);
  const yillar = [...new Set([...yilKayitlari, buYil - 1, buYil, buYil + 1, filtreler.yil])].sort(
    (a, b) => b - a
  );

  return { filtreler, egitimler, ozet, yillar, matris };
}

function egitimListeDisaAktarmaSatirlari(egitimler) {
  return egitimler.map((egitim) => [
    egitim.ad,
    EGITIM_TURLERI[egitim.tur] || egitim.tur,
    tarihMetni(egitim.planlanan_tarih),
    egitim.egitmen || '—',
    Number(egitim.sure_saat),
    egitim.dokuman_kod || '—',
    egitim.katilimci_sayisi,
    egitim.katilan_sayisi,
    egitim.katilmayan_sayisi,
    egitim.bekleyen_sayisi,
    egitim.katilimYuzdesi,
    egitim.ortalamaPuan,
    egitim.etkinlikYuzdesi,
  ]);
}

function egitimMatrisBasliklari(matris) {
  return [
    'Personel',
    'Departman',
    ...matris.egitimler.map((egitim) => `${egitim.ad} (${tarihMetni(egitim.planlanan_tarih)})`),
  ];
}

function egitimMatrisHucreMetni(hucre) {
  if (!hucre) return '—';
  const etiket = KATILIM_ETIKETLERI[hucre.katilim_durumu] || hucre.katilim_durumu;
  if (hucre.katilim_durumu === 'katildi' && hucre.degerlendirme_puani !== null) {
    return `${etiket} (${puanMetni(hucre.degerlendirme_puani)})`;
  }
  return etiket;
}

function egitimMatrisDisaAktarmaSatirlari(matris) {
  return matris.satirlar.map((kisi) => [
    kisi.ad,
    kisi.departman_ad || '—',
    ...matris.egitimler.map((egitim) => egitimMatrisHucreMetni(kisi.hucreler[egitim.id])),
  ]);
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

function raporRotalariniKur(app, { db, auth, mail, config }) {
  void mail;

  app.locals.EGITIM_TURLERI = EGITIM_TURLERI;
  app.locals.EGITIM_DURUMLARI = EGITIM_DURUMLARI;
  app.locals.raporYuzde = yuzdeMetni;
  app.locals.raporPuan = puanMetni;
  app.locals.raporSayi = sayiMetni;

  const raporYetkisi = auth.izinGerekli('rapor');

  function bugunVeDilim() {
    const ayarlar = etkinAyarlar(db, config);
    const bugun = bugunTz(ayarlar.saatDilimi);
    return { bugun, saatDilimi: ayarlar.saatDilimi, buYil: Number(bugun.slice(0, 4)) };
  }

  // -------------------------------------------------------------------------
  // Güncel doküman ana listesi
  // -------------------------------------------------------------------------
  app.get('/raporlar/dokumanlar', raporYetkisi, (req, res) => {
    const filtreler = dokumanFiltreleriCoz(db, req);
    const dokumanlar = dokumanRaporuOlustur(db, filtreler);
    const tur = filtreler.turKodu ? turGetir(filtreler.turKodu) : null;
    const departmanlar = departmanlarGetir(db);
    const departman =
      departmanlar.find((kayit) => kayit.id === filtreler.departmanId) || null;

    const ortakSorgu = {
      departman: filtreler.departmanId,
      q: filtreler.arama,
    };
    const turAdresleri = { '': `/raporlar/dokumanlar${sorguDizesi(ortakSorgu)}` };
    for (const kod of TUR_KODLARI) {
      turAdresleri[kod] = `/raporlar/dokumanlar${sorguDizesi({ ...ortakSorgu, tur: kod })}`;
    }

    const disaAktarSorgusu = {
      tur: filtreler.turKodu,
      departman: filtreler.departmanId,
      q: filtreler.arama,
    };

    const filtreOzeti = [];
    if (tur) filtreOzeti.push(`Tür: ${tur.ad}`);
    if (departman) filtreOzeti.push(`Departman: ${departman.ad}`);
    if (filtreler.arama) filtreOzeti.push(`Arama: “${filtreler.arama}”`);
    if (!filtreOzeti.length) filtreOzeti.push('Tüm yayındaki dokümanlar');

    res.render('rapor-dokumanlar', {
      aktifSayfa: 'raporlar',
      sayfaBaslik: 'Güncel Doküman Ana Listesi',
      filtreler,
      tur,
      departman,
      departmanlar,
      dokumanlar,
      turAdresleri,
      filtreOzeti,
      adresler: {
        temiz: '/raporlar/dokumanlar',
        csv: `/raporlar/dokumanlar.csv${sorguDizesi(disaAktarSorgusu)}`,
        xlsx: `/raporlar/dokumanlar.xlsx${sorguDizesi(disaAktarSorgusu)}`,
      },
    });
  });

  app.get('/raporlar/dokumanlar.csv', raporYetkisi, (req, res) => {
    const { bugun } = bugunVeDilim();
    const dokumanlar = dokumanRaporuOlustur(db, dokumanFiltreleriCoz(db, req));
    return guvenliDisaAktar(res, {
      bicim: 'csv',
      dosyaAdi: `dokuman-ana-listesi-${bugun}`,
      basliklar: DOKUMAN_CSV_BASLIKLARI,
      satirlar: dokumanDisaAktarmaSatirlari(dokumanlar),
    });
  });

  app.get('/raporlar/dokumanlar.xlsx', raporYetkisi, (req, res) => {
    const { bugun } = bugunVeDilim();
    const dokumanlar = dokumanRaporuOlustur(db, dokumanFiltreleriCoz(db, req));
    return guvenliDisaAktar(res, {
      bicim: 'xlsx',
      dosyaAdi: `dokuman-ana-listesi-${bugun}`,
      sayfaAdi: 'Doküman Listesi',
      basliklar: DOKUMAN_CSV_BASLIKLARI,
      satirlar: dokumanDisaAktarmaSatirlari(dokumanlar),
      genislikler: [16, 42, 16, 12, 14, 30, 22],
    });
  });

  // -------------------------------------------------------------------------
  // Okundu onayı
  // -------------------------------------------------------------------------
  app.get('/raporlar/okundu-onayi', raporYetkisi, (req, res) => {
    const { saatDilimi } = bugunVeDilim();
    const filtreler = okunduFiltreleriCoz(db, req);
    const gorunum = gorunumCoz(req, 'matris');
    const rapor = okunduRaporuOlustur(db, filtreler, gorunum, saatDilimi);

    const temelSorgu = {
      dokuman: filtreler.dokuman,
      departman: filtreler.departman,
      durum: filtreler.durum !== 'hepsi' ? filtreler.durum : '',
      q: filtreler.arama,
    };

    const filtreOzeti = [];
    if (rapor.seciliDokuman) {
      filtreOzeti.push(`Doküman: ${rapor.seciliDokuman.kod}`);
    }
    if (rapor.seciliDepartman) filtreOzeti.push(`Departman: ${rapor.seciliDepartman.ad}`);
    if (filtreler.durum !== 'hepsi') {
      filtreOzeti.push(`Durum: ${filtreler.durum === 'okundu' ? 'Okudu' : 'Bekliyor'}`);
    }
    if (filtreler.arama) filtreOzeti.push(`Personel: “${filtreler.arama}”`);
    if (!filtreOzeti.length) filtreOzeti.push('Tüm yayındaki dokümanlar, tüm aktif personel');

    res.render('rapor-okundu', {
      aktifSayfa: 'raporlar',
      sayfaBaslik: 'Okundu Onayı Matrisi',
      gorunum,
      filtreler,
      rapor,
      filtreOzeti,
      adresler: {
        matris: `/raporlar/okundu-onayi${sorguDizesi({ ...temelSorgu, gorunum: 'matris' })}`,
        liste: `/raporlar/okundu-onayi${sorguDizesi({ ...temelSorgu, gorunum: 'liste' })}`,
        temiz: '/raporlar/okundu-onayi',
        listeCsv: `/raporlar/okundu-onayi.csv${sorguDizesi(temelSorgu)}`,
        listeXlsx: `/raporlar/okundu-onayi.xlsx${sorguDizesi(temelSorgu)}`,
        matrisCsv: `/raporlar/okundu-onayi.csv${sorguDizesi({
          ...temelSorgu,
          gorunum: 'matris',
        })}`,
        matrisXlsx: `/raporlar/okundu-onayi.xlsx${sorguDizesi({
          ...temelSorgu,
          gorunum: 'matris',
        })}`,
      },
    });
  });

  app.get('/raporlar/okundu-onayi.csv', raporYetkisi, (req, res) => {
    const { bugun, saatDilimi } = bugunVeDilim();
    const filtreler = okunduFiltreleriCoz(db, req);
    const matrisMi = gorunumCoz(req, 'liste') === 'matris';
    const rapor = okunduRaporuOlustur(db, filtreler, matrisMi ? 'matris' : 'liste', saatDilimi);

    return guvenliDisaAktar(res, {
      bicim: 'csv',
      dosyaAdi: matrisMi ? `okundu-onayi-matrisi-${bugun}` : `okundu-onayi-${bugun}`,
      basliklar: matrisMi ? okunduMatrisBasliklari(rapor.matris) : OKUNDU_LISTE_BASLIKLARI,
      satirlar: matrisMi
        ? okunduMatrisDisaAktarmaSatirlari(rapor.matris)
        : okunduListeDisaAktarmaSatirlari(rapor.liste, saatDilimi),
    });
  });

  app.get('/raporlar/okundu-onayi.xlsx', raporYetkisi, (req, res) => {
    const { bugun, saatDilimi } = bugunVeDilim();
    const filtreler = okunduFiltreleriCoz(db, req);
    const matrisMi = gorunumCoz(req, 'liste') === 'matris';
    const rapor = okunduRaporuOlustur(db, filtreler, matrisMi ? 'matris' : 'liste', saatDilimi);

    return guvenliDisaAktar(res, {
      bicim: 'xlsx',
      dosyaAdi: matrisMi ? `okundu-onayi-matrisi-${bugun}` : `okundu-onayi-${bugun}`,
      sayfaAdi: matrisMi ? 'Okundu Matrisi' : 'Okundu Onayı',
      basliklar: matrisMi ? okunduMatrisBasliklari(rapor.matris) : OKUNDU_LISTE_BASLIKLARI,
      satirlar: matrisMi
        ? okunduMatrisDisaAktarmaSatirlari(rapor.matris)
        : okunduListeDisaAktarmaSatirlari(rapor.liste, saatDilimi),
      genislikler: matrisMi
        ? [24, 18, ...rapor.matris.dokumanlar.map(() => 16)]
        : [24, 18, 16, 40, 12, 12, 20],
    });
  });

  // -------------------------------------------------------------------------
  // Yıllık eğitim raporu
  // -------------------------------------------------------------------------
  app.get('/raporlar/egitim', raporYetkisi, (req, res) => {
    const { buYil } = bugunVeDilim();
    const filtreler = egitimFiltreleriCoz(req, buYil);
    const gorunum = gorunumCoz(req, 'matris');
    const rapor = egitimRaporuOlustur(db, filtreler, gorunum, buYil);

    const temelSorgu = {
      yil: filtreler.yil,
      durum: filtreler.durum !== 'hepsi' ? filtreler.durum : '',
    };

    const filtreOzeti = [`Yıl: ${filtreler.yil}`];
    if (filtreler.durum !== 'hepsi') {
      filtreOzeti.push(`Durum: ${EGITIM_DURUMLARI[filtreler.durum]}`);
    }

    res.render('rapor-egitim', {
      aktifSayfa: 'raporlar',
      sayfaBaslik: 'Yıllık Eğitim Matrisi',
      gorunum,
      filtreler,
      rapor,
      filtreOzeti,
      adresler: {
        matris: `/raporlar/egitim${sorguDizesi({ ...temelSorgu, gorunum: 'matris' })}`,
        liste: `/raporlar/egitim${sorguDizesi({ ...temelSorgu, gorunum: 'liste' })}`,
        temiz: '/raporlar/egitim',
        listeCsv: `/raporlar/egitim.csv${sorguDizesi(temelSorgu)}`,
        listeXlsx: `/raporlar/egitim.xlsx${sorguDizesi(temelSorgu)}`,
        matrisCsv: `/raporlar/egitim.csv${sorguDizesi({ ...temelSorgu, gorunum: 'matris' })}`,
        matrisXlsx: `/raporlar/egitim.xlsx${sorguDizesi({ ...temelSorgu, gorunum: 'matris' })}`,
      },
    });
  });

  app.get('/raporlar/egitim.csv', raporYetkisi, (req, res) => {
    const { bugun, buYil } = bugunVeDilim();
    const filtreler = egitimFiltreleriCoz(req, buYil);
    const matrisMi = gorunumCoz(req, 'liste') === 'matris';
    const rapor = egitimRaporuOlustur(db, filtreler, matrisMi ? 'matris' : 'liste', buYil);

    return guvenliDisaAktar(res, {
      bicim: 'csv',
      dosyaAdi: matrisMi ? `egitim-matrisi-${bugun}` : `egitim-listesi-${bugun}`,
      basliklar: matrisMi ? egitimMatrisBasliklari(rapor.matris) : EGITIM_LISTE_BASLIKLARI,
      satirlar: matrisMi
        ? egitimMatrisDisaAktarmaSatirlari(rapor.matris)
        : egitimListeDisaAktarmaSatirlari(rapor.egitimler),
    });
  });

  app.get('/raporlar/egitim.xlsx', raporYetkisi, (req, res) => {
    const { bugun, buYil } = bugunVeDilim();
    const filtreler = egitimFiltreleriCoz(req, buYil);
    const matrisMi = gorunumCoz(req, 'liste') === 'matris';
    const rapor = egitimRaporuOlustur(db, filtreler, matrisMi ? 'matris' : 'liste', buYil);

    return guvenliDisaAktar(res, {
      bicim: 'xlsx',
      dosyaAdi: matrisMi ? `egitim-matrisi-${bugun}` : `egitim-listesi-${bugun}`,
      sayfaAdi: matrisMi ? 'Eğitim Matrisi' : 'Eğitim Listesi',
      basliklar: matrisMi ? egitimMatrisBasliklari(rapor.matris) : EGITIM_LISTE_BASLIKLARI,
      satirlar: matrisMi
        ? egitimMatrisDisaAktarmaSatirlari(rapor.matris)
        : egitimListeDisaAktarmaSatirlari(rapor.egitimler),
      genislikler: matrisMi
        ? [24, 18, ...rapor.egitimler.map(() => 20)]
        : [34, 12, 12, 24, 10, 14, 10, 10, 12, 10, 10, 10, 10],
    });
  });

  // -------------------------------------------------------------------------
  // Rapor merkezi
  // -------------------------------------------------------------------------
  app.get('/raporlar', raporYetkisi, (req, res) => {
    const { bugun, buYil } = bugunVeDilim();

    const sayilar = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM dokumanlar WHERE durum = 'yayinda') AS yayinda_dokuman,
           (SELECT COUNT(*) FROM dokuman_okumalari) AS toplam_okuma,
           (SELECT COUNT(*) FROM dokuman_okumalari WHERE okundu = 1) AS okunan_okuma,
           (SELECT COUNT(*) FROM egitimler
             WHERE substr(planlanan_tarih, 1, 4) = ?) AS yil_egitim`
      )
      .get(String(buYil));

    const katilim = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kk.katilim_durumu = 'katildi' THEN 1 ELSE 0 END), 0) AS katilan,
           COALESCE(SUM(CASE WHEN kk.katilim_durumu = 'katilmadi' THEN 1 ELSE 0 END), 0) AS katilmayan
         FROM egitim_katilimcilari kk
         JOIN egitimler e ON e.id = kk.egitim_id
         WHERE substr(e.planlanan_tarih, 1, 4) = ? AND e.durum <> 'iptal'`
      )
      .get(String(buYil));

    const ozet = {
      yayindaDokuman: Number(sayilar.yayinda_dokuman) || 0,
      toplamOkuma: Number(sayilar.toplam_okuma) || 0,
      okunmaOrani: yuzdeHesapla(Number(sayilar.okunan_okuma) || 0, Number(sayilar.toplam_okuma) || 0),
      yilEgitim: Number(sayilar.yil_egitim) || 0,
      katilimOrani: yuzdeHesapla(Number(katilim.katilan) || 0, (Number(katilim.katilan) || 0) + (Number(katilim.katilmayan) || 0)),
    };

    const raporlar = [
      {
        ikon: 'dokuman',
        baslik: 'Güncel Doküman Ana Listesi',
        aciklama:
          'Yayındaki tüm dokümanları kod, tür, revizyon, yayın tarihi ve hedef departmanlarıyla listeler.',
        adres: '/raporlar/dokumanlar',
        csv: '/raporlar/dokumanlar.csv',
        xlsx: '/raporlar/dokumanlar.xlsx',
      },
      {
        ikon: 'onay',
        baslik: 'Okundu Onayı Matrisi',
        aciklama:
          'Personelin yayındaki dokümanları okuyup okumadığını matris veya ayrıntılı liste olarak gösterir.',
        adres: '/raporlar/okundu-onayi',
        csv: '/raporlar/okundu-onayi.csv',
        xlsx: '/raporlar/okundu-onayi.xlsx',
      },
      {
        ikon: 'egitim',
        baslik: 'Eğitim Matrisi',
        aciklama:
          'Seçilen yılın eğitimlerini, katılım durumlarını, değerlendirme puanlarını ve etkinlik oranlarını raporlar.',
        adres: '/raporlar/egitim',
        csv: '/raporlar/egitim.csv',
        xlsx: '/raporlar/egitim.xlsx',
      },
    ];

    res.render('raporlar', {
      aktifSayfa: 'raporlar',
      sayfaBaslik: 'Kurumsal Raporlar',
      bugun,
      buYil,
      ozet,
      raporlar,
    });
  });
}

module.exports = { raporRotalariniKur };
