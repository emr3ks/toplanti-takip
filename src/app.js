'use strict';

const path = require('node:path');
const express = require('express');

const {
  bugunTz,
  gecerliTarih,
  gunFarki,
  tarihTr,
  zamanTr,
} = require('./dates');
const {
  DURUMLAR,
  DURUM_ANAHTARLARI,
  TOPLANTI_DURUMLARI,
  EPOSTA_DURUMLARI,
  EPOSTA_TURLERI,
  durumEtiketi,
  durumSinifi,
} = require('./sabitler');
const { epostaGecerli, guvenliDonus, mesajliYol, metin } = require('./dogrulama');
const {
  ayarlarFormu,
  ayarlariKaydet,
  etkinAyarlar,
  guvenliAyarlar,
  mailModu,
  testModuEtkin,
} = require('./settings');
const { MailService } = require('./mailer');
const { runReminderJob, cronIfadesi } = require('./reminder');
const {
  gonderimZamani,
  raporKonusu,
  testEpostasiHtml,
  toplantiRaporuHtml,
} = require('./emails');

const SAYFA_ADLARI = Object.freeze({
  'genel-bakis': 'Genel Bakış',
  toplantilar: 'Toplantılar',
  isler: 'İşler',
  sorumlular: 'Sorumlular',
  emailler: 'E-postalar',
  ayarlar: 'Ayarlar',
});

const TOPLANTI_SORGU = `
  SELECT t.*,
    (SELECT COUNT(*) FROM isler i WHERE i.toplanti_id = t.id) AS is_sayisi,
    (SELECT COUNT(*) FROM isler i WHERE i.toplanti_id = t.id AND i.durum = 'aktif') AS aktif_sayisi,
    (SELECT COUNT(*) FROM isler i WHERE i.toplanti_id = t.id AND i.durum = 'beklemede') AS beklemede_sayisi,
    (SELECT COUNT(*) FROM isler i WHERE i.toplanti_id = t.id AND i.durum = 'tamamlandi') AS tamamlandi_sayisi
  FROM toplantilar t
`;

const IS_SORGU = `
  SELECT i.*, t.ad AS toplanti_ad, t.tarih AS toplanti_tarih,
         s.ad AS sorumlu_ad, s.email AS sorumlu_email
  FROM isler i
  JOIN toplantilar t ON t.id = i.toplanti_id
  LEFT JOIN sorumlular s ON s.id = i.sorumlu_id
`;

const IS_SIRALAMA = `
  ORDER BY CASE i.durum WHEN 'aktif' THEN 0 WHEN 'beklemede' THEN 1 ELSE 2 END,
           CASE WHEN i.hedef_tarih IS NULL OR i.hedef_tarih = '' THEN 1 ELSE 0 END,
           i.hedef_tarih, i.id
`;

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

function basHarfler(ad) {
  const parcalar = String(ad || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const harfler = ((parcalar[0] || '')[0] || '') + ((parcalar[1] || '')[0] || '');
  return harfler ? harfler.toLocaleUpperCase('tr-TR') : '?';
}

function kisaMetin(deger, uzunluk = 90) {
  const metinDegeri = String(deger || '');
  return metinDegeri.length > uzunluk ? `${metinDegeri.slice(0, uzunluk - 1)}…` : metinDegeri;
}

function createApp({ db, config, mailService = null, zamanlayici = null }) {
  const mail = mailService || new MailService({ db, config });
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.kok, 'views'));

  app.locals.SAYFA_ADLARI = SAYFA_ADLARI;
  app.locals.DURUMLAR = DURUMLAR;
  app.locals.TOPLANTI_DURUMLARI = TOPLANTI_DURUMLARI;
  app.locals.EPOSTA_DURUMLARI = EPOSTA_DURUMLARI;
  app.locals.EPOSTA_TURLERI = EPOSTA_TURLERI;
  app.locals.durumEtiketi = durumEtiketi;
  app.locals.durumSinifi = durumSinifi;
  app.locals.tarihTr = tarihTr;
  app.locals.basHarfler = basHarfler;
  app.locals.kisaMetin = kisaMetin;
  app.locals.gunFarki = gunFarki;

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.static(path.join(config.kok, 'public'), { maxAge: '1h' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');

    const ayarlar = etkinAyarlar(db, config);
    const bugun = bugunTz(ayarlar.saatDilimi);
    const ok = tekDeger(req.query.ok);
    const hata = tekDeger(req.query.hata);
    const bilgi = tekDeger(req.query.bilgi);

    res.locals.ayarlar = guvenliAyarlar(ayarlar);
    res.locals.mailModu = mailModu(ayarlar);
    res.locals.testModu = testModuEtkin(ayarlar);
    res.locals.bugunIso = bugun;
    res.locals.bugunTr = tarihTr(bugun);
    res.locals.tamYol = req.originalUrl;
    res.locals.bildirim = ok
      ? { tur: 'basari', metin: String(ok).slice(0, 800) }
      : hata
        ? { tur: 'hata', metin: String(hata).slice(0, 800) }
        : bilgi
          ? { tur: 'bilgi', metin: String(bilgi).slice(0, 800) }
          : null;
    res.locals.zamanTr = (zaman) => zamanTr(zaman, ayarlar.saatDilimi);
    res.locals.geciktiMi = (hedef) => Boolean(hedef) && hedef < bugun;
    res.locals.hedefFarki = (hedef) => gunFarki(hedef, bugun);
    next();
  });

  app.locals.zamanlayici = zamanlayici;

  function toplantiGetir(id) {
    return db.prepare(`${TOPLANTI_SORGU} WHERE t.id = ?`).get(id);
  }

  function isGetir(id) {
    return db.prepare(`${IS_SORGU} WHERE i.id = ?`).get(id);
  }

  function sorumluGetir(id) {
    return db.prepare('SELECT * FROM sorumlular WHERE id = ?').get(id);
  }

  function tumSorumlular() {
    return db
      .prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM isler i WHERE i.sorumlu_id = s.id) AS is_sayisi,
           (SELECT COUNT(*) FROM isler i WHERE i.sorumlu_id = s.id AND i.durum = 'aktif') AS aktif_sayisi
         FROM sorumlular s
         ORDER BY s.ad COLLATE NOCASE`
      )
      .all();
  }

  function tumToplantilar() {
    return db.prepare(`${TOPLANTI_SORGU} ORDER BY t.tarih DESC, t.id DESC`).all();
  }

  function sayfaYok(res) {
    return res.status(404).render('404', {
      aktifSayfa: '',
      sayfaBaslik: 'Sayfa Bulunamadı',
    });
  }

  function toplantiYok(res) {
    return res.status(404).render('404', {
      aktifSayfa: 'toplantilar',
      sayfaBaslik: 'Toplantı Bulunamadı',
    });
  }

  // ---------------------------------------------------------------------------
  // Genel bakış
  // ---------------------------------------------------------------------------
  app.get('/', (req, res) => {
    const sayilar = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM toplantilar) AS toplanti_sayisi,
          (SELECT COUNT(*) FROM toplantilar WHERE durum = 'acik') AS acik_toplanti,
          (SELECT COUNT(*) FROM isler WHERE durum = 'aktif') AS aktif,
          (SELECT COUNT(*) FROM isler WHERE durum = 'beklemede') AS beklemede,
          (SELECT COUNT(*) FROM isler WHERE durum = 'tamamlandi') AS tamamlandi,
          (SELECT COUNT(*) FROM sorumlular) AS sorumlu_sayisi`
      )
      .get();

    const geciken = db
      .prepare(
        `SELECT COUNT(*) AS sayi FROM isler
         WHERE durum = 'aktif' AND hedef_tarih IS NOT NULL AND hedef_tarih <> '' AND hedef_tarih < ?`
      )
      .get(res.locals.bugunIso).sayi;

    const yaklasan = db
      .prepare(
        `${IS_SORGU}
         WHERE i.durum = 'aktif'
           AND i.hedef_tarih IS NOT NULL AND i.hedef_tarih <> ''
         ORDER BY i.hedef_tarih ASC, i.id ASC
         LIMIT 8`
      )
      .all();

    const sonToplantilar = db
      .prepare(`${TOPLANTI_SORGU} ORDER BY t.tarih DESC, t.id DESC LIMIT 4`)
      .all();

    res.render('genel-bakis', {
      aktifSayfa: 'genel-bakis',
      sayfaBaslik: 'Genel Bakış',
      sayilar,
      geciken,
      yaklasan,
      sonToplantilar,
    });
  });

  app.get('/saglik', (req, res) => {
    res.json({ ok: true, uygulama: 'toplanti-takip', zaman: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // Toplantılar
  // ---------------------------------------------------------------------------
  app.get('/toplantilar', (req, res) => {
    res.render('toplantilar', {
      aktifSayfa: 'toplantilar',
      sayfaBaslik: 'Toplantılar',
      toplantilar: tumToplantilar(),
    });
  });

  app.post('/toplantilar', (req, res) => {
    const ad = metin(req.body.ad);
    const tarih = metin(req.body.tarih);

    if (ad.length < 2 || ad.length > 150) {
      return res.redirect(303, mesajliYol('/toplantilar', 'hata', 'Toplantı adı 2-150 karakter arasında olmalıdır.'));
    }
    if (!gecerliTarih(tarih)) {
      return res.redirect(303, mesajliYol('/toplantilar', 'hata', 'Geçerli bir toplantı tarihi seçin.'));
    }

    const bilgi = db
      .prepare('INSERT INTO toplantilar (ad, tarih) VALUES (?, ?)')
      .run(ad, tarih);

    return res.redirect(
      303,
      mesajliYol(`/toplantilar/${Number(bilgi.lastInsertRowid)}`, 'ok', `"${ad}" toplantısı oluşturuldu.`)
    );
  });

  app.get('/toplantilar/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);

    const durumParam = queryMetin(req, 'durum', 'hepsi');
    const durum = ['hepsi', ...DURUM_ANAHTARLARI].includes(durumParam) ? durumParam : 'hepsi';

    let isler;
    if (durum === 'hepsi') {
      isler = db.prepare(`${IS_SORGU} WHERE i.toplanti_id = ? ${IS_SIRALAMA}`).all(id);
    } else {
      isler = db
        .prepare(`${IS_SORGU} WHERE i.toplanti_id = ? AND i.durum = ? ${IS_SIRALAMA}`)
        .all(id, durum);
    }

    const sonRapor = db
      .prepare(
        `SELECT * FROM email_kayitlari
         WHERE toplanti_id = ? AND tur = 'rapor'
         ORDER BY id DESC LIMIT 1`
      )
      .get(id);

    res.render('toplanti-detay', {
      aktifSayfa: 'toplantilar',
      sayfaBaslik: toplanti.ad,
      toplanti,
      isler,
      durum,
      sonRapor,
      sorumlular: tumSorumlular(),
      ilerleme: toplanti.is_sayisi
        ? Math.round((toplanti.tamamlandi_sayisi / toplanti.is_sayisi) * 100)
        : 0,
    });
  });

  app.post('/toplantilar/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);

    const ad = metin(req.body.ad);
    const tarih = metin(req.body.tarih);
    if (ad.length < 2 || ad.length > 150) {
      return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'hata', 'Toplantı adı 2-150 karakter arasında olmalıdır.'));
    }
    if (!gecerliTarih(tarih)) {
      return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'hata', 'Geçerli bir toplantı tarihi seçin.'));
    }

    db.prepare('UPDATE toplantilar SET ad = ?, tarih = ? WHERE id = ?').run(ad, tarih, id);
    return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'ok', 'Toplantı bilgileri güncellendi.'));
  });

  app.post('/toplantilar/:id/sil', (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);
    db.prepare('DELETE FROM toplantilar WHERE id = ?').run(id);
    return res.redirect(303, mesajliYol('/toplantilar', 'ok', `"${toplanti.ad}" toplantısı ve bağlı işleri silindi.`));
  });

  async function raporGonder(toplanti) {
    const ayarlar = etkinAyarlar(db, config);
    if (!epostaGecerli(ayarlar.raporAlici)) {
      return {
        ok: false,
        hata: 'Rapor alıcı e-postası tanımlı değil. Ayarlar bölümünden "Toplantı Sonu Rapor Alıcı E-postası" alanını doldurun.',
      };
    }

    const isler = db
      .prepare(`${IS_SORGU} WHERE i.toplanti_id = ? ${IS_SIRALAMA}`)
      .all(toplanti.id);
    const html = toplantiRaporuHtml({
      toplanti,
      isler,
      raporTarihi: gonderimZamani(new Date(), ayarlar.saatDilimi),
    });

    return mail.gonder({
      tur: 'rapor',
      alici: ayarlar.raporAlici,
      konu: raporKonusu(toplanti),
      html,
      toplantiId: toplanti.id,
    });
  }

  app.post('/toplantilar/:id/tamamla', async (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);

    const sonuc = await raporGonder(toplanti);
    if (!sonuc.ok) {
      return res.redirect(
        303,
        mesajliYol(
          `/toplantilar/${id}`,
          'hata',
          `Rapor gönderilemedi: ${sonuc.hata} Toplantı tamamlanmadı.`
        )
      );
    }

    if (toplanti.durum !== 'tamamlandi') {
      db.prepare(
        `UPDATE toplantilar SET durum = 'tamamlandi', tamamlanma_tarihi = ? WHERE id = ?`
      ).run(new Date().toISOString(), id);
    }

    const modMetni =
      sonuc.durum === 'test_modu'
        ? 'Rapor test modunda kaydedildi (gerçek e-posta gönderilmedi).'
        : 'Rapor tanımlı alıcıya gönderildi.';
    return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'ok', `Toplantı tamamlandı. ${modMetni}`));
  });

  app.post('/toplantilar/:id/rapor', async (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);

    const sonuc = await raporGonder(toplanti);
    if (!sonuc.ok) {
      return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'hata', `Rapor gönderilemedi: ${sonuc.hata}`));
    }

    const modMetni =
      sonuc.durum === 'test_modu'
        ? 'Rapor test modunda kaydedildi (gerçek e-posta gönderilmedi).'
        : 'Rapor tanımlı alıcıya gönderildi.';
    return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'ok', modMetni));
  });

  app.post('/toplantilar/:id/yeniden-ac', (req, res) => {
    const id = kimlik(req.params.id);
    const toplanti = id ? toplantiGetir(id) : null;
    if (!toplanti) return toplantiYok(res);
    db.prepare(`UPDATE toplantilar SET durum = 'acik', tamamlanma_tarihi = NULL WHERE id = ?`).run(id);
    return res.redirect(303, mesajliYol(`/toplantilar/${id}`, 'ok', 'Toplantı yeniden açıldı.'));
  });

  // ---------------------------------------------------------------------------
  // İşler
  // ---------------------------------------------------------------------------
  function isFormunuDogrula(body) {
    const baslik = metin(body.baslik);
    const notMetni = metin(body.not_metni);
    const hedefTarih = metin(body.hedef_tarih);
    const durum = metin(body.durum) || 'aktif';

    if (baslik.length < 2 || baslik.length > 200) {
      return { hata: 'İş başlığı 2-200 karakter arasında olmalıdır.' };
    }
    if (notMetni.length > 5000) {
      return { hata: 'Toplantı notu en fazla 5000 karakter olabilir.' };
    }
    if (hedefTarih && !gecerliTarih(hedefTarih)) {
      return { hata: 'Geçerli bir hedef tarih seçin.' };
    }
    if (!DURUM_ANAHTARLARI.includes(durum)) {
      return { hata: 'Geçersiz iş durumu.' };
    }

    let sorumluId = null;
    if (metin(body.sorumlu_id)) {
      sorumluId = kimlik(body.sorumlu_id);
      if (!sorumluId || !sorumluGetir(sorumluId)) {
        return { hata: 'Seçilen sorumlu bulunamadı.' };
      }
    }

    return {
      veri: {
        baslik,
        notMetni,
        hedefTarih: hedefTarih || null,
        sorumluId,
        durum,
      },
    };
  }

  app.get('/isler', (req, res) => {
    const durumParam = queryMetin(req, 'durum', 'hepsi');
    const durum = ['hepsi', ...DURUM_ANAHTARLARI].includes(durumParam) ? durumParam : 'hepsi';
    const toplantiId = kimlik(queryMetin(req, 'toplanti'));
    const sorumluId = kimlik(queryMetin(req, 'sorumlu'));
    const arama = queryMetin(req, 'q').slice(0, 100);

    const kosullar = [];
    const parametreler = [];

    if (durum !== 'hepsi') {
      kosullar.push('i.durum = ?');
      parametreler.push(durum);
    }
    if (toplantiId) {
      kosullar.push('i.toplanti_id = ?');
      parametreler.push(toplantiId);
    }
    if (sorumluId) {
      kosullar.push('i.sorumlu_id = ?');
      parametreler.push(sorumluId);
    }
    if (arama) {
      const desen = `%${arama}%`;
      kosullar.push('(i.baslik LIKE ? OR i.not_metni LIKE ? OR t.ad LIKE ? OR s.ad LIKE ?)');
      parametreler.push(desen, desen, desen, desen);
    }

    const nerede = kosullar.length ? `WHERE ${kosullar.join(' AND ')}` : '';
    const isler = db
      .prepare(`${IS_SORGU} ${nerede} ${IS_SIRALAMA} LIMIT 400`)
      .all(...parametreler);

    const durumSayilari = { aktif: 0, beklemede: 0, tamamlandi: 0 };
    for (const satir of db.prepare('SELECT durum, COUNT(*) AS sayi FROM isler GROUP BY durum').all()) {
      durumSayilari[satir.durum] = satir.sayi;
    }

    res.render('isler', {
      aktifSayfa: 'isler',
      sayfaBaslik: 'İşler',
      isler,
      toplantilar: tumToplantilar(),
      sorumlular: tumSorumlular(),
      durumSayilari,
      filtreler: { durum, toplanti: toplantiId, sorumlu: sorumluId, q: arama },
      sonucSayisi: isler.length,
    });
  });

  app.post('/isler', (req, res) => {
    const toplantiId = kimlik(req.body.toplanti_id);
    const toplanti = toplantiId ? toplantiGetir(toplantiId) : null;
    const varsayilanDonus = toplanti ? `/toplantilar/${toplanti.id}` : '/isler';
    const istenenDonus = guvenliDonus(req.body.donus, varsayilanDonus);
    const donus =
      istenenDonus === '/isler' ||
      (toplanti && istenenDonus.startsWith(`/toplantilar/${toplanti.id}`))
        ? istenenDonus
        : varsayilanDonus;

    if (!toplanti) {
      return res.redirect(303, mesajliYol(donus, 'hata', 'İş eklemek için geçerli bir toplantı seçin.'));
    }

    const kontrol = isFormunuDogrula(req.body);
    if (kontrol.hata) {
      return res.redirect(303, mesajliYol(donus, 'hata', kontrol.hata));
    }

    const simdi = new Date().toISOString();
    const { baslik, notMetni, hedefTarih, sorumluId, durum } = kontrol.veri;
    const bilgi = db
      .prepare(
        `INSERT INTO isler
          (toplanti_id, baslik, not_metni, sorumlu_id, hedef_tarih, durum, guncelleme_tarihi, tamamlanma_tarihi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        toplanti.id,
        baslik,
        notMetni,
        sorumluId,
        hedefTarih,
        durum,
        simdi,
        durum === 'tamamlandi' ? simdi : null
      );

    return res.redirect(
      303,
      mesajliYol(donus, 'ok', `"${baslik}" işi eklendi (#${Number(bilgi.lastInsertRowid)}).`)
    );
  });

  app.get('/isler/:id/duzenle', (req, res) => {
    const id = kimlik(req.params.id);
    const is = id ? isGetir(id) : null;
    if (!is) {
      return res.status(404).render('404', { aktifSayfa: 'isler', sayfaBaslik: 'İş Bulunamadı' });
    }
    res.render('is-duzenle', {
      aktifSayfa: 'isler',
      sayfaBaslik: 'İşi Düzenle',
      is,
      form: is,
      donus: guvenliDonus(req.query.donus, `/toplantilar/${is.toplanti_id}`),
      sorumlular: tumSorumlular(),
    });
  });

  app.post('/isler/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const is = id ? isGetir(id) : null;
    if (!is) {
      return res.status(404).render('404', { aktifSayfa: 'isler', sayfaBaslik: 'İş Bulunamadı' });
    }

    const donus = guvenliDonus(req.body.donus, `/toplantilar/${is.toplanti_id}`);
    const kontrol = isFormunuDogrula(req.body);
    if (kontrol.hata) {
      return res.status(400).render('is-duzenle', {
        aktifSayfa: 'isler',
        sayfaBaslik: 'İşi Düzenle',
        is,
        form: { ...is, ...req.body },
        donus,
        sorumlular: tumSorumlular(),
        hata: kontrol.hata,
      });
    }

    const { baslik, notMetni, hedefTarih, sorumluId, durum } = kontrol.veri;
    const simdi = new Date().toISOString();
    const hedefDegisti = (is.hedef_tarih || '') !== (hedefTarih || '');
    const hatirlatmaGonderildi = hedefDegisti ? 0 : is.hatirlatma_gonderildi;
    const hatirlatmaTarihi = hedefDegisti ? null : is.hatirlatma_tarihi;
    let tamamlanmaTarihi = is.tamamlanma_tarihi;
    if (durum === 'tamamlandi') {
      if (!tamamlanmaTarihi) tamamlanmaTarihi = simdi;
    } else {
      tamamlanmaTarihi = null;
    }

    db.prepare(
      `UPDATE isler
       SET baslik = ?, not_metni = ?, sorumlu_id = ?, hedef_tarih = ?, durum = ?,
           hatirlatma_gonderildi = ?, hatirlatma_tarihi = ?, tamamlanma_tarihi = ?,
           guncelleme_tarihi = ?
       WHERE id = ?`
    ).run(
      baslik,
      notMetni,
      sorumluId,
      hedefTarih,
      durum,
      hatirlatmaGonderildi,
      hatirlatmaTarihi,
      tamamlanmaTarihi,
      simdi,
      id
    );

    return res.redirect(303, mesajliYol(donus, 'ok', 'İş güncellendi.'));
  });

  app.post('/isler/:id/durum', (req, res) => {
    const id = kimlik(req.params.id);
    const is = id ? isGetir(id) : null;
    if (!is) {
      return res.status(404).render('404', { aktifSayfa: 'isler', sayfaBaslik: 'İş Bulunamadı' });
    }

    const durum = metin(req.body.durum);
    const donus = guvenliDonus(req.body.donus, '/isler');
    if (!DURUM_ANAHTARLARI.includes(durum)) {
      return res.redirect(303, mesajliYol(donus, 'hata', 'Geçersiz iş durumu.'));
    }

    const simdi = new Date().toISOString();
    const tamamlanma = durum === 'tamamlandi' ? is.tamamlanma_tarihi || simdi : null;
    db.prepare('UPDATE isler SET durum = ?, tamamlanma_tarihi = ?, guncelleme_tarihi = ? WHERE id = ?').run(
      durum,
      tamamlanma,
      simdi,
      id
    );

    return res.redirect(303, mesajliYol(donus, 'ok', `"${is.baslik}" işi ${durumEtiketi(durum)} durumuna alındı.`));
  });

  app.post('/isler/:id/sil', (req, res) => {
    const id = kimlik(req.params.id);
    const is = id ? isGetir(id) : null;
    if (!is) {
      return res.status(404).render('404', { aktifSayfa: 'isler', sayfaBaslik: 'İş Bulunamadı' });
    }
    const donus = guvenliDonus(req.body.donus, `/toplantilar/${is.toplanti_id}`);
    db.prepare('DELETE FROM isler WHERE id = ?').run(id);
    return res.redirect(303, mesajliYol(donus, 'ok', `"${is.baslik}" işi silindi.`));
  });

  // ---------------------------------------------------------------------------
  // Sorumlular
  // ---------------------------------------------------------------------------
  app.get('/sorumlular', (req, res) => {
    res.render('sorumlular', {
      aktifSayfa: 'sorumlular',
      sayfaBaslik: 'Sorumlular',
      sorumlular: tumSorumlular(),
    });
  });

  app.post('/sorumlular', (req, res) => {
    const ad = metin(req.body.ad);
    const email = metin(req.body.email).toLowerCase();

    if (ad.length < 2 || ad.length > 120) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Sorumlu adı 2-120 karakter arasında olmalıdır.'));
    }
    if (!epostaGecerli(email)) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Geçerli bir e-posta adresi girin.'));
    }

    try {
      db.prepare('INSERT INTO sorumlular (ad, email) VALUES (?, ?)').run(ad, email);
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu e-posta adresiyle kayıtlı bir sorumlu zaten var.'
        : 'Sorumlu eklenemedi.';
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', mesaj));
    }
    return res.redirect(303, mesajliYol('/sorumlular', 'ok', `"${ad}" sorumlusu eklendi.`));
  });

  app.post('/sorumlular/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const sorumlu = id ? sorumluGetir(id) : null;
    if (!sorumlu) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Sorumlu bulunamadı.'));
    }

    const ad = metin(req.body.ad);
    const email = metin(req.body.email).toLowerCase();
    if (ad.length < 2 || ad.length > 120) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Sorumlu adı 2-120 karakter arasında olmalıdır.'));
    }
    if (!epostaGecerli(email)) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Geçerli bir e-posta adresi girin.'));
    }

    try {
      db.prepare('UPDATE sorumlular SET ad = ?, email = ? WHERE id = ?').run(ad, email, id);
    } catch (hata) {
      const mesaj = String(hata.message).includes('UNIQUE')
        ? 'Bu e-posta adresiyle kayıtlı başka bir sorumlu var.'
        : 'Sorumlu güncellenemedi.';
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', mesaj));
    }
    return res.redirect(303, mesajliYol('/sorumlular', 'ok', 'Sorumlu güncellendi.'));
  });

  app.post('/sorumlular/:id/sil', (req, res) => {
    const id = kimlik(req.params.id);
    const sorumlu = id ? sorumluGetir(id) : null;
    if (!sorumlu) {
      return res.redirect(303, mesajliYol('/sorumlular', 'hata', 'Sorumlu bulunamadı.'));
    }

    const atanan = db.prepare('SELECT COUNT(*) AS sayi FROM isler WHERE sorumlu_id = ?').get(id).sayi;
    if (atanan > 0) {
      return res.redirect(
        303,
        mesajliYol(
          '/sorumlular',
          'hata',
          `"${sorumlu.ad}" sorumlusuna atanmış ${atanan} iş var. Önce işlerin sorumlusunu değiştirin.`
        )
      );
    }

    db.prepare('DELETE FROM sorumlular WHERE id = ?').run(id);
    return res.redirect(303, mesajliYol('/sorumlular', 'ok', 'Sorumlu silindi.'));
  });

  // ---------------------------------------------------------------------------
  // E-postalar
  // ---------------------------------------------------------------------------
  app.get('/emailler', (req, res) => {
    const kayitlar = db
      .prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 150')
      .all();
    res.render('emailler', {
      aktifSayfa: 'emailler',
      sayfaBaslik: 'E-posta Günlüğü',
      kayitlar,
      testModu: res.locals.testModu,
    });
  });

  app.get('/emailler/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? db.prepare('SELECT * FROM email_kayitlari WHERE id = ?').get(id) : null;
    if (!kayit) {
      return res.status(404).render('404', { aktifSayfa: 'emailler', sayfaBaslik: 'E-posta Bulunamadı' });
    }
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:;");
    res.set('X-Content-Type-Options', 'nosniff');
    res.type('html').send(kayit.icerik || '<p>Bu e-postanın içeriği kaydedilmemiş.</p>');
  });

  // ---------------------------------------------------------------------------
  // Ayarlar
  // ---------------------------------------------------------------------------
  app.get('/ayarlar', (req, res) => {
    const form = ayarlarFormu(db, config);
    res.render('ayarlar', {
      aktifSayfa: 'ayarlar',
      sayfaBaslik: 'Ayarlar',
      form,
      cron: cronIfadesi(form.hatirlatmaSaati),
      sonEmailler: db
        .prepare('SELECT * FROM email_kayitlari ORDER BY id DESC LIMIT 5')
        .all(),
    });
  });

  app.post('/ayarlar', (req, res) => {
    try {
      ayarlariKaydet(db, req.body, config);
      if (zamanlayici) zamanlayici.yenidenPlanla();
      const yeni = etkinAyarlar(db, config);
      return res.redirect(
        303,
        mesajliYol(
          '/ayarlar',
          'ok',
          `Ayarlar kaydedildi. Günlük hatırlatma ${yeni.hatirlatmaSaati} (${yeni.saatDilimi}) için planlandı.`
        )
      );
    } catch (hata) {
      return res.redirect(303, mesajliYol('/ayarlar', 'hata', hata.message));
    }
  });

  app.post('/ayarlar/smtp-test', async (req, res) => {
    const sonuc = await mail.baglantiTest();
    return res.redirect(303, mesajliYol('/ayarlar', sonuc.ok ? 'ok' : 'hata', sonuc.mesaj));
  });

  app.post('/ayarlar/test-eposta', async (req, res) => {
    const ayarlar = etkinAyarlar(db, config);
    const alici = metin(req.body.test_alici) || ayarlar.raporAlici || ayarlar.smtp.user;
    if (!epostaGecerli(alici)) {
      return res.redirect(303, mesajliYol('/ayarlar', 'hata', 'Test e-postası için geçerli bir alıcı adresi girin.'));
    }

    const html = testEpostasiHtml({
      mod: mailModu(ayarlar),
      alici,
      saatDilimi: ayarlar.saatDilimi,
      gonderimTarihi: gonderimZamani(new Date(), ayarlar.saatDilimi),
    });
    const sonuc = await mail.gonder({
      tur: 'test',
      alici,
      konu: 'Toplantı Takip — Test E-postası',
      html,
    });

    const mesaj = sonuc.ok
      ? sonuc.durum === 'test_modu'
        ? `Test e-postası test modunda kaydedildi (${alici}). E-posta Günlüğü sayfasından görüntüleyebilirsiniz.`
        : `Test e-postası ${alici} adresine gönderildi.`
      : `Test e-postası gönderilemedi: ${sonuc.hata}`;
    return res.redirect(303, mesajliYol('/ayarlar', sonuc.ok ? 'ok' : 'hata', mesaj));
  });

  app.post('/ayarlar/hatirlatma-calistir', async (req, res) => {
    try {
      const sonuc = await runReminderJob({ db, config, mailService: mail });
      const modMetni = sonuc.mod === 'test' ? 'test modunda kaydedildi' : 'gönderildi';
      let mesaj =
        `Hatırlatma çalıştırıldı (${tarihTr(sonuc.baslangic)}): ` +
        `${sonuc.taranan} iş tarandı, ${sonuc.gonderilen} e-posta ${modMetni}, ` +
        `${sonuc.atlanan} atlandı, ${sonuc.hataSayisi} hata.`;
      if (sonuc.hatalar.length) {
        mesaj += ` İlk hata: ${sonuc.hatalar[0].hata}`;
      }
      return res.redirect(303, mesajliYol('/ayarlar', 'ok', mesaj));
    } catch (hata) {
      return res.redirect(303, mesajliYol('/ayarlar', 'hata', `Hatırlatma çalıştırılamadı: ${hata.message}`));
    }
  });

  // ---------------------------------------------------------------------------
  // 404 ve hata yakalama
  // ---------------------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).render('404', {
      aktifSayfa: '',
      sayfaBaslik: 'Sayfa Bulunamadı',
    });
  });

  app.use((hata, req, res, next) => {
    console.error('[uygulama hatası]', hata);
    if (res.headersSent) return next(hata);
    if (!res.locals.ayarlar) {
      try {
        res.locals.ayarlar = guvenliAyarlar(etkinAyarlar(db, config));
        res.locals.mailModu = mailModu(etkinAyarlar(db, config));
        res.locals.testModu = testModuEtkin(etkinAyarlar(db, config));
        res.locals.bugunTr = tarihTr(bugunTz(etkinAyarlar(db, config).saatDilimi));
        res.locals.zamanTr = (zaman) => zamanTr(zaman, etkinAyarlar(db, config).saatDilimi);
        res.locals.geciktiMi = () => false;
        res.locals.hedefFarki = () => null;
        res.locals.tamYol = req.originalUrl;
        res.locals.bildirim = null;
      } catch {
        /* hata sayfası yine de gösterilmeye çalışılır */
      }
    }
    res.status(500).render('hata', {
      aktifSayfa: '',
      sayfaBaslik: 'Beklenmeyen Bir Hata Oluştu',
    });
  });

  return app;
}

module.exports = { createApp, SAYFA_ADLARI };
