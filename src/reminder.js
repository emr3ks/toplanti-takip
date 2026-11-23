'use strict';

const cron = require('node-cron');

const { bugunTz, gunEkle, gecerliSaat, tarihTr } = require('./dates');
const { etkinAyarlar } = require('./settings');
const { epostaGecerli } = require('./dogrulama');
const { hatirlatmaHtml, hatirlatmaKonusu } = require('./emails');

function cronIfadesi(saat) {
  if (!gecerliSaat(saat)) return null;
  const [saatDegeri, dakika] = saat.split(':').map(Number);
  return `${dakika} ${saatDegeri} * * *`;
}

/**
 * Durumu "aktif", hatırlatması gönderilmemiş ve hedef tarihi bugün/yarın
 * (veya geçmişte) olan işler için sorumlulara e-posta gönderir.
 * Başarılı gönderimden sonra hatirlatma_gonderildi = 1 yapılır.
 */
async function runReminderJob({ db, config, mailService, now = new Date(), kuruCalisma = false }) {
  const ayarlar = etkinAyarlar(db, config);
  const bugun = bugunTz(ayarlar.saatDilimi, now);
  const sinir = gunEkle(bugun, 1);

  const satirlar = db
    .prepare(
      `SELECT i.*, t.ad AS toplanti_ad, t.tarih AS toplanti_tarih,
              s.ad AS sorumlu_ad, s.email AS sorumlu_email
       FROM isler i
       JOIN toplantilar t ON t.id = i.toplanti_id
       LEFT JOIN sorumlular s ON s.id = i.sorumlu_id
       WHERE i.durum = 'aktif'
         AND i.hatirlatma_gonderildi = 0
         AND i.hedef_tarih IS NOT NULL
         AND i.hedef_tarih <> ''
         AND i.hedef_tarih <= ?
       ORDER BY i.hedef_tarih ASC, i.id ASC`
    )
    .all(sinir);

  const sonuc = {
    baslangic: bugun,
    sinir,
    taranan: satirlar.length,
    gonderilen: 0,
    atlanan: 0,
    hataSayisi: 0,
    hatalar: [],
    detaylar: [],
    mod: mailService.mod ? mailService.mod() : 'test',
  };

  for (const is of satirlar) {
    if (!epostaGecerli(is.sorumlu_email)) {
      sonuc.atlanan += 1;
      sonuc.detaylar.push({
        isId: is.id,
        baslik: is.baslik,
        durum: 'atlandi',
        neden: 'Sorumlunun geçerli bir e-posta adresi yok.',
      });
      continue;
    }

    if (kuruCalisma) {
      sonuc.detaylar.push({ isId: is.id, baslik: is.baslik, durum: 'aday', alici: is.sorumlu_email });
      continue;
    }

    const html = hatirlatmaHtml({
      is,
      toplanti: { ad: is.toplanti_ad, tarih: is.toplanti_tarih },
      sorumlu: { ad: is.sorumlu_ad, email: is.sorumlu_email },
      bugun,
    });

    const gonderim = await mailService.gonder({
      tur: 'hatirlatma',
      alici: is.sorumlu_email,
      konu: hatirlatmaKonusu(is, { ad: is.toplanti_ad }),
      html,
      toplantiId: is.toplami_id,
      isId: is.id,
    });

    if (gonderim.ok) {
      db.prepare(
        `UPDATE isler
         SET hatirlatma_gonderildi = 1, hatirlatma_tarihi = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(new Date().toISOString(), new Date().toISOString(), is.id);
      sonuc.gonderilen += 1;
      sonuc.detaylar.push({
        isId: is.id,
        baslik: is.baslik,
        durum: gonderim.durum,
        alici: is.sorumlu_email,
        hedefTarih: tarihTr(is.hedef_tarih),
      });
    } else {
      sonuc.hataSayisi += 1;
      sonuc.hatalar.push({ isId: is.id, baslik: is.baslik, hata: gonderim.hata });
      sonuc.detaylar.push({
        isId: is.id,
        baslik: is.baslik,
        durum: 'hata',
        alici: is.sorumlu_email,
        hata: gonderim.hata,
      });
    }
  }

  return sonuc;
}

/**
 * Günlük hatırlatma zamanlayıcısını başlatır.
 * Ayarlar her kaydedildiğinde yenidenPlanla() çağrılmalıdır.
 */
function startZamanlayici({ db, config, mailService, cronLib = cron, log = console }) {
  let gorev = null;

  async function calistir() {
    try {
      const sonuc = await runReminderJob({ db, config, mailService });
      log.log(
        `[hatırlatma] ${sonuc.baslangic}: ${sonuc.gonderilen} e-posta gönderildi, ` +
          `${sonuc.hatalar.length} hata, ${sonuc.atlanan} atlandı.`
      );
    } catch (hata) {
      log.error('[hatırlatma] Zamanlanmış görev çalıştırılamadı:', hata);
    }
  }

  function yenidenPlanla() {
    if (gorev) {
      try {
        gorev.stop();
      } catch {
        /* görev zaten durmuş olabilir */
      }
      gorev = null;
    }

    const ayarlar = etkinAyarlar(db, config);
    if (!gecerliSaat(ayarlar.hatirlatmaSaati)) {
      log.error(`[zamanlayıcı] Geçersiz hatırlatma saati: ${ayarlar.hatirlatmaSaati}`);
      return;
    }

    const ifade = cronIfadesi(ayarlar.hatirlatmaSaati);
    try {
      gorev = cronLib.schedule(ifade, calistir, { timezone: ayarlar.saatDilimi });
      log.log(
        `[zamanlayıcı] Günlük hatırlatma planlandı: ${ayarlar.hatirlatmaSaati} ` +
          `(${ayarlar.saatDilimi}), cron="${ifade}"`
      );
    } catch (hata) {
      log.error('[zamanlayıcı] Görev planlanamadı:', hata);
    }
  }

  function durdur() {
    if (gorev) {
      try {
        gorev.stop();
      } catch {
        /* yoksay */
      }
      gorev = null;
    }
  }

  yenidenPlanla();

  return { yenidenPlanla, durdur, gorevGetir: () => gorev };
}

module.exports = { cronIfadesi, runReminderJob, startZamanlayici };
