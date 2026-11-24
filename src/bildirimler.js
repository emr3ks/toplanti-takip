'use strict';

/**
 * Faz 3 otomatik e-posta bildirimleri.
 *
 * Bu modüldeki her fonksiyon HTTP isteği içinde çalışabilir; hiçbiri hata
 * fırlatmaz, tek tek gönderim hatalarını toplayıp `hatalar` dizisinde döndürür.
 * E-posta günlüğü ve test modu davranışı `src/mailer.js` içindedir.
 */

const { epostaGecerli } = require('./dogrulama');
const { etkinAyarlar, sirketAyarlari } = require('./settings');
const { bugunTz, gecerliTarih, gunEkle, tarihTr } = require('./dates');
const qdms = require('./qdms');
const {
  onayBekliyorEpostasi,
  dokumanYayinlandiEpostasi,
  egitimHatirlatmaEpostasi,
} = require('./emails');

const EGITIM_TUR_ETIKETLERI = Object.freeze({
  ic: 'İç Eğitim',
  dis: 'Dış Eğitim',
});

const VARSAYILAN_GUN = 7;

function sonucNesnesi() {
  return { gonderilen: 0, atlanan: 0, hatalar: [] };
}

function hataMesaji(hata) {
  if (hata instanceof Error) return hata.message || String(hata);
  return String(hata || 'Bilinmeyen hata');
}

/** Hatayı sonuca ekler ve bağlamıyla birlikte bir kez günlüğe yazar. */
function hataEkle(hatalar, baglam, hata, alici = null) {
  const mesaj = hataMesaji(hata);
  hatalar.push(alici ? `${alici}: ${mesaj}` : mesaj);
  console.error(`[${baglam}]`, alici ? `${alici}:` : '', mesaj);
}

function ayarlarOku(db, config) {
  try {
    return etkinAyarlar(db, config);
  } catch (hata) {
    console.error('[bildirim ayarları]', hataMesaji(hata));
    return { saatDilimi: 'Europe/Istanbul', smtp: {}, testModu: true };
  }
}

function sirketOku(db) {
  try {
    return sirketAyarlari(db).ad;
  } catch (hata) {
    console.error('[bildirim şirket ayarları]', hataMesaji(hata));
    return '';
  }
}

/** Uygulama içi yolu, yapılandırma varsa mutlak adrese çevirir. */
function mutlakBaglanti(config, yol) {
  const temizYol = String(yol || '').startsWith('/') ? String(yol) : `/${String(yol || '')}`;
  const host = config && config.host ? String(config.host).trim() : '';
  if (!host) return temizYol;

  const temizHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const portVar = config.port !== undefined && config.port !== null && String(config.port).trim() !== '';
  const port = portVar && Number.isFinite(Number(config.port)) ? Number(config.port) : null;
  const hostPortVar = /:\d+$/.test(temizHost);
  return `http://${temizHost}${port !== null && !hostPortVar ? `:${port}` : ''}${temizYol}`;
}

function dokumanCoz(db, dokuman) {
  if (!dokuman) return null;

  if (typeof dokuman === 'number' || (typeof dokuman === 'string' && /^\d+$/.test(dokuman.trim()))) {
    const id = Number(dokuman);
    if (!Number.isInteger(id) || id <= 0) return null;
    return db
      .prepare(
        `SELECT d.*, t.ad AS tur_ad
         FROM dokumanlar d
         LEFT JOIN dokuman_turleri t ON t.kod = d.tur_kod
         WHERE d.id = ?`
      )
      .get(id) || null;
  }

  if (typeof dokuman !== 'object' || dokuman.id === undefined || dokuman.id === null) return null;
  if (dokuman.kod && dokuman.baslik) return dokuman;

  const tam = db
    .prepare(
      `SELECT d.*, t.ad AS tur_ad
       FROM dokumanlar d
       LEFT JOIN dokuman_turleri t ON t.kod = d.tur_kod
       WHERE d.id = ?`
    )
    .get(Number(dokuman.id));
  return tam ? { ...tam, ...dokuman } : null;
}

function dokumanTurAdi(dokuman) {
  return dokuman.tur_ad || qdms.turGetir(dokuman.tur_kod)?.ad || dokuman.tur_kod || '—';
}

async function kisiyeGonder({ mail, kisiler, hatalar, baglam, konu, tur, htmlOlustur }) {
  const sonuclar = await Promise.all(
    kisiler.map(async (kisi) => {
      if (!kisi || !epostaGecerli(kisi.email)) return false;
      try {
        const html = htmlOlustur(kisi);
        const yanit = await mail.gonder({
          tur,
          alici: String(kisi.email).trim(),
          konu,
          html,
        });
        if (yanit && yanit.ok) return true;
        hataEkle(hatalar, baglam, (yanit && yanit.hata) || 'E-posta gönderilemedi.', kisi.email);
        return false;
      } catch (hata) {
        hataEkle(hatalar, baglam, hata, kisi.email);
        return false;
      }
    })
  );
  return sonuclar.filter(Boolean).length;
}

/**
 * Onay bekleyen dokümanı onaylayan/kalite rollerine e-posta ile bildirir.
 * Gönderen kullanıcı ve geçersiz e-posta adresleri hariç tutulur.
 *
 * @returns {Promise<{gonderilen:number, atlanan:number, hatalar:string[]}>}
 */
async function onayBekleyenleriBilgilendir({ db, mail, config, dokuman, gonderenId } = {}) {
  const sonuc = sonucNesnesi();
  try {
    if (!db || !mail) {
      hataEkle(sonuc.hatalar, 'dokuman onay bildirimi', 'Veritabanı veya e-posta servisi hazır değil.');
      return sonuc;
    }

    const dok = dokumanCoz(db, dokuman);
    if (!dok) {
      hataEkle(sonuc.hatalar, 'dokuman onay bildirimi', 'Doküman bulunamadı.');
      return sonuc;
    }

    const ayarlar = ayarlarOku(db, config);
    const sirketAdi = sirketOku(db);
    const baglanti = mutlakBaglanti(config, `/dokumanlar/${dok.id}`);
    const turAd = dokumanTurAdi(dok);
    const revizyonEtiketi = qdms.revizyonEtiketi(dok.revizyon);
    const gonderen = Number(gonderenId);
    const gonderenVar = Number.isInteger(gonderen) && gonderen > 0;

    let kisiler;
    try {
      kisiler = db
        .prepare(
          `SELECT id, ad, email FROM kullanicilar
           WHERE aktif = 1 AND rol IN ('onaylayan', 'kalite')
           ORDER BY ad COLLATE NOCASE`
        )
        .all();
    } catch (hata) {
      hataEkle(sonuc.hatalar, 'dokuman onay bildirimi', `Onaylayıcı listesi alınamadı: ${hataMesaji(hata)}`);
      return sonuc;
    }

    const hedefler = [];
    for (const kisi of kisiler) {
      if (gonderenVar && Number(kisi.id) === gonderen) continue;
      if (!epostaGecerli(kisi.email)) {
        sonuc.atlanan += 1;
        continue;
      }
      hedefler.push(kisi);
    }

    sonuc.gonderilen = await kisiyeGonder({
      mail,
      kisiler: hedefler,
      hatalar: sonuc.hatalar,
      baglam: 'dokuman onay bildirimi',
      tur: 'dokuman_onay',
      konu: `Onay bekleyen doküman: ${dok.kod}`,
      htmlOlustur: (kisi) =>
        onayBekliyorEpostasi({
          dokuman: dok,
          aliciAd: kisi.ad,
          turAd,
          revizyonEtiketi,
          sirketAdi,
          baglanti,
          saatDilimi: ayarlar.saatDilimi,
        }),
    });
  } catch (hata) {
    hataEkle(sonuc.hatalar, 'dokuman onay bildirimi', hata);
  }
  return sonuc;
}

/**
 * Yayınlanan dokümanı hedef departmanlardaki aktif kullanıcılara duyurur.
 *
 * @returns {Promise<{gonderilen:number, atlanan:number, hatalar:string[]}>}
 */
async function yayinBilgileriniGonder({ db, mail, config, dokuman } = {}) {
  const sonuc = sonucNesnesi();
  try {
    if (!db || !mail) {
      hataEkle(sonuc.hatalar, 'dokuman yayın bildirimi', 'Veritabanı veya e-posta servisi hazır değil.');
      return sonuc;
    }

    const dok = dokumanCoz(db, dokuman);
    if (!dok) {
      hataEkle(sonuc.hatalar, 'dokuman yayın bildirimi', 'Doküman bulunamadı.');
      return sonuc;
    }

    const ayarlar = ayarlarOku(db, config);
    const sirketAdi = sirketOku(db);
    const baglanti = mutlakBaglanti(config, `/dokumanlar/${dok.id}`);
    const turAd = dokumanTurAdi(dok);
    const revizyonEtiketi = qdms.revizyonEtiketi(dok.revizyon);

    let kisiler;
    try {
      kisiler = db
        .prepare(
          `SELECT DISTINCT k.id, k.ad, k.email
           FROM dokuman_hedef_departmanlar h
           JOIN kullanicilar k ON k.departman_id = h.departman_id
           WHERE h.dokuman_id = ? AND k.aktif = 1
           ORDER BY k.ad COLLATE NOCASE`
        )
        .all(dok.id);
    } catch (hata) {
      hataEkle(sonuc.hatalar, 'dokuman yayın bildirimi', `Hedef kullanıcılar alınamadı: ${hataMesaji(hata)}`);
      return sonuc;
    }

    const hedefler = [];
    for (const kisi of kisiler) {
      if (!epostaGecerli(kisi.email)) {
        sonuc.atlanan += 1;
        continue;
      }
      hedefler.push(kisi);
    }

    sonuc.gonderilen = await kisiyeGonder({
      mail,
      kisiler: hedefler,
      hatalar: sonuc.hatalar,
      baglam: 'dokuman yayın bildirimi',
      tur: 'dokuman_yayin',
      konu: `Doküman yayınlandı: ${dok.kod}`,
      htmlOlustur: (kisi) =>
        dokumanYayinlandiEpostasi({
          dokuman: dok,
          aliciAd: kisi.ad,
          turAd,
          revizyonEtiketi,
          sirketAdi,
          baglanti,
          saatDilimi: ayarlar.saatDilimi,
        }),
    });
  } catch (hata) {
    hataEkle(sonuc.hatalar, 'dokuman yayın bildirimi', hata);
  }
  return sonuc;
}

function sayiBicim(deger) {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return '—';
  return sayi.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

/**
 * Yaklaşan planlı eğitimler için katılımcılara hatırlatma e-postası gönderir.
 * Başarılı gönderimde katılım kaydına `hatirlatma_tarihi` yazılır; böylece
 * aynı katılımcıya tekrar hatırlatma gönderilmez.
 *
 * @returns {Promise<{gonderilen:number, atlanan:number, hatalar:string[]}>}
 */
async function egitimHatirlatmalariGonder({
  db,
  mail,
  config,
  egitimId = null,
  gun = VARSAYILAN_GUN,
  bugun = null,
} = {}) {
  const sonuc = sonucNesnesi();
  try {
    if (!db || !mail) {
      hataEkle(sonuc.hatalar, 'egitim hatırlatması', 'Veritabanı veya e-posta servisi hazır değil.');
      return sonuc;
    }

    const ayarlar = ayarlarOku(db, config);
    const sirketAdi = sirketOku(db);

    const gunSayi = Number(gun);
    const pencereGun = Number.isFinite(gunSayi) && gunSayi >= 0 ? Math.floor(gunSayi) : VARSAYILAN_GUN;
    const baslangic =
      typeof bugun === 'string' && gecerliTarih(bugun) ? bugun : bugunTz(ayarlar.saatDilimi);
    const bitis = gunEkle(baslangic, pencereGun);

    let egitimFiltresi = null;
    if (egitimId !== null && egitimId !== undefined && String(egitimId).trim() !== '') {
      const idSayi = Number(egitimId);
      if (!Number.isInteger(idSayi) || idSayi <= 0) return sonuc;
      egitimFiltresi = idSayi;
    }

    const kosullar = [
      "e.durum = 'planlandi'",
      'e.planlanan_tarih BETWEEN ? AND ?',
      "kat.katilim_durumu = 'bekliyor'",
      'kat.hatirlatma_tarihi IS NULL',
      'k.aktif = 1',
    ];
    const parametreler = [baslangic, bitis];
    if (egitimFiltresi !== null) {
      kosullar.push('e.id = ?');
      parametreler.push(egitimFiltresi);
    }

    let satirlar;
    try {
      satirlar = db
        .prepare(
          `SELECT e.*,
                  kat.id AS katilim_id,
                  kat.kullanici_id AS kullanici_id,
                  kat.hatirlatma_tarihi AS hatirlatma_tarihi,
                  k.ad AS kisi_ad,
                  k.email AS kisi_email,
                  d.kod AS dokuman_kodu
           FROM egitimler e
           JOIN egitim_katilimcilari kat ON kat.egitim_id = e.id
           JOIN kullanicilar k ON k.id = kat.kullanici_id
           LEFT JOIN dokumanlar d ON d.id = e.dokuman_id
           WHERE ${kosullar.join(' AND ')}
           ORDER BY e.planlanan_tarih ASC, e.id ASC, k.ad COLLATE NOCASE`
        )
        .all(...parametreler);
    } catch (hata) {
      hataEkle(sonuc.hatalar, 'egitim hatırlatması', `Hatırlatma listesi alınamadı: ${hataMesaji(hata)}`);
      return sonuc;
    }

    const hedefler = [];
    for (const satir of satirlar) {
      if (!epostaGecerli(satir.kisi_email)) {
        sonuc.atlanan += 1;
        continue;
      }
      hedefler.push(satir);
    }

    let gonderilen = 0;
    await Promise.all(
      hedefler.map(async (satir) => {
        try {
          const html = egitimHatirlatmaEpostasi({
            egitim: satir,
            kisiAd: satir.kisi_ad,
            turEtiketi: EGITIM_TUR_ETIKETLERI[satir.tur] || satir.tur || 'Eğitim',
            tarih: tarihTr(satir.planlanan_tarih),
            sureSaat: sayiBicim(satir.sure_saat),
            egitmen: satir.egitmen,
            dokumanKodu: satir.dokuman_kodu || '',
            baglanti: mutlakBaglanti(config, `/egitim/${satir.id}`),
            sirketAdi,
            saatDilimi: ayarlar.saatDilimi,
          });
          const yanit = await mail.gonder({
            tur: 'egitim_hatirlatma',
            alici: String(satir.kisi_email).trim(),
            konu: `Eğitim hatırlatması: ${satir.ad}`,
            html,
          });
          if (!yanit || !yanit.ok) {
            hataEkle(
              sonuc.hatalar,
              'egitim hatırlatması',
              (yanit && yanit.hata) || 'E-posta gönderilemedi.',
              satir.kisi_email
            );
            return;
          }

          gonderilen += 1;
          try {
            db.prepare('UPDATE egitim_katilimcilari SET hatirlatma_tarihi = ? WHERE id = ?').run(
              new Date().toISOString(),
              satir.katilim_id
            );
          } catch (hata) {
            hataEkle(
              sonuc.hatalar,
              'egitim hatırlatması',
              `Gönderim yapıldı ancak hatırlatma tarihi kaydedilemedi: ${hataMesaji(hata)}`,
              satir.kisi_email
            );
          }
        } catch (hata) {
          hataEkle(sonuc.hatalar, 'egitim hatırlatması', hata, satir.kisi_email);
        }
      })
    );
    sonuc.gonderilen = gonderilen;
  } catch (hata) {
    hataEkle(sonuc.hatalar, 'egitim hatırlatması', hata);
  }
  return sonuc;
}

module.exports = {
  onayBekleyenleriBilgilendir,
  yayinBilgileriniGonder,
  egitimHatirlatmalariGonder,
};
