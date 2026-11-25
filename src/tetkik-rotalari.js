'use strict';

/**
 * Faz 5 — İç Tetkik (Denetim) Yönetimi rotaları.
 *
 * Yıllık departman bazlı planlama, denetçi ataması, kontrol listesi
 * değerlendirmesi, bulgu kaydı, tek tıkla DÖF oluşturma, aktivite izi ve
 * kurumsal PDF raporu bu modülde yer alır.
 */

const fs = require('node:fs');
const path = require('node:path');

const { metin, mesajliYol } = require('./dogrulama');
const { bugunTz, gecerliTarih, tarihTr } = require('./dates');
const { etkinAyarlar, sirketAyarlari } = require('./settings');
const { tetkikPdfUret } = require('./pdf');
const bildirimler = require('./bildirimler');
const dof = require('./dof');
const tetkik = require('./tetkik');

const LISTE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------

function tekDeger(deger) {
  return Array.isArray(deger) ? deger[0] : deger;
}

function dizi(deger) {
  if (Array.isArray(deger)) return deger;
  if (deger === undefined || deger === null || deger === '') return [];
  return [deger];
}

function kimlik(deger) {
  const sayi = Number(tekDeger(deger));
  return Number.isInteger(sayi) && sayi > 0 ? sayi : null;
}

function kimlikListesi(deger) {
  const sonuc = new Set();
  for (const parca of dizi(deger)) {
    if (typeof parca === 'string' && parca.includes(',')) {
      for (const altParca of parca.split(',')) {
        const sayi = Number(altParca);
        if (Number.isInteger(sayi) && sayi > 0) sonuc.add(sayi);
      }
      continue;
    }
    const sayi = Number(parca);
    if (Number.isInteger(sayi) && sayi > 0) sonuc.add(sayi);
  }
  return [...sonuc];
}

function queryMetin(req, ad, varsayilan = '') {
  const deger = tekDeger(req.query[ad]);
  return typeof deger === 'string' ? deger.trim() : varsayilan;
}

function yonlendir(res, yol, anahtar, mesaj) {
  return res.redirect(303, mesajliYol(yol, anahtar, mesaj));
}

function sayfaYok(res, baslik = 'İç Tetkik Bulunamadı') {
  return res.status(404).render('404', {
    aktifSayfa: 'tetkik',
    sayfaBaslik: baslik,
  });
}

function bugunOku(db, config) {
  try {
    return bugunTz(etkinAyarlar(db, config).saatDilimi);
  } catch {
    return bugunTz('Europe/Istanbul');
  }
}

function aktiviteEkle(db, kayit) {
  db.prepare(
    `INSERT INTO aktivite_loglari
      (modul, islem, kayit_tipi, kayit_id, referans_no, kullanici_id, aciklama,
       eski_deger, yeni_deger, tarih)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(kayit.modul || 'tetkik'),
    String(kayit.islem || ''),
    String(kayit.kayitTipi || ''),
    kayit.kayitId || null,
    String(kayit.referansNo || ''),
    kayit.kullaniciId || null,
    String(kayit.aciklama || '').slice(0, 1000),
    String(kayit.eskiDeger || '').slice(0, 500),
    String(kayit.yeniDeger || '').slice(0, 500),
    new Date().toISOString()
  );
}

function bildirimEkle(db, kullaniciId, baslik, mesaj, tetkikId) {
  db.prepare(
    `INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj, baglanti, dokuman_id)
     VALUES (?, 'tetkik', ?, ?, ?, NULL)`
  ).run(
    kullaniciId,
    String(baslik).slice(0, 200),
    String(mesaj || '').slice(0, 500),
    `/tetkik/${tetkikId}`
  );
}

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------

function departmanlarGetir(db) {
  return db.prepare('SELECT id, ad FROM departmanlar ORDER BY ad COLLATE NOCASE').all();
}

function aktifKullanicilar(db) {
  return db
    .prepare(
      `SELECT k.id, k.ad, k.email, k.rol, k.departman_id, d.ad AS departman_ad
       FROM kullanicilar k
       LEFT JOIN departmanlar d ON d.id = k.departman_id
       WHERE k.aktif = 1
       ORDER BY d.ad COLLATE NOCASE, k.ad COLLATE NOCASE`
    )
    .all();
}

function checklistlerGetir(db, { sadeceAktif = false } = {}) {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM ic_tetkik_checklist_maddeleri m WHERE m.checklist_id = c.id) AS madde_sayisi,
        (SELECT COUNT(*) FROM ic_tetkikler t WHERE t.checklist_id = c.id) AS kullanim_sayisi
       FROM ic_tetkik_checklistleri c
       ${sadeceAktif ? 'WHERE c.aktif = 1' : ''}
       ORDER BY c.standart, c.ad COLLATE NOCASE`
    )
    .all();
}

function checklistGetir(db, id) {
  return db.prepare('SELECT * FROM ic_tetkik_checklistleri WHERE id = ?').get(id);
}

function checklistMaddeleriGetir(db, checklistId) {
  return db
    .prepare('SELECT * FROM ic_tetkik_checklist_maddeleri WHERE checklist_id = ? ORDER BY sira, id')
    .all(checklistId);
}

function tetkikGetir(db, id) {
  return db
    .prepare(
      `SELECT t.*,
        dep.ad AS departman_ad,
        c.ad AS checklist_ad,
        c.standart AS checklist_standart,
        o.ad AS olusturan_ad,
        o.email AS olusturan_email,
        tm.ad AS tamamlayan_ad,
        (SELECT k.ad FROM ic_tetkik_denetcileri td
          JOIN kullanicilar k ON k.id = td.kullanici_id
          WHERE td.tetkik_id = t.id AND td.gorev = 'bas_denetci'
          ORDER BY td.id LIMIT 1) AS denetleyen_ad,
        (SELECT COUNT(*) FROM ic_tetkik_maddeleri m WHERE m.tetkik_id = t.id) AS madde_sayisi,
        (SELECT COUNT(*) FROM ic_tetkik_maddeleri m WHERE m.tetkik_id = t.id AND m.sonuc IS NOT NULL) AS degerlendirilen_madde,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b WHERE b.tetkik_id = t.id) AS bulgu_sayisi,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b WHERE b.tetkik_id = t.id AND b.dof_id IS NOT NULL) AS dof_sayisi
       FROM ic_tetkikler t
       LEFT JOIN departmanlar dep ON dep.id = t.departman_id
       LEFT JOIN ic_tetkik_checklistleri c ON c.id = t.checklist_id
       LEFT JOIN kullanicilar o ON o.id = t.olusturan_id
       LEFT JOIN kullanicilar tm ON tm.id = t.tamamlayan_id
       WHERE t.id = ?`
    )
    .get(id);
}

function denetcilerGetir(db, tetkikId) {
  return db
    .prepare(
      `SELECT td.*, k.ad AS kullanici_ad, k.email AS kullanici_email,
        d.ad AS departman_ad, a.ad AS atayan_ad
       FROM ic_tetkik_denetcileri td
       JOIN kullanicilar k ON k.id = td.kullanici_id
       LEFT JOIN departmanlar d ON d.id = k.departman_id
       LEFT JOIN kullanicilar a ON a.id = td.atayan_id
       WHERE td.tetkik_id = ?
       ORDER BY CASE td.gorev WHEN 'bas_denetci' THEN 0 WHEN 'denetci' THEN 1 ELSE 2 END, k.ad COLLATE NOCASE`
    )
    .all(tetkikId);
}

function maddelerGetir(db, tetkikId) {
  return db
    .prepare(
      `SELECT m.*, k.ad AS degerlendiren_ad
       FROM ic_tetkik_maddeleri m
       LEFT JOIN kullanicilar k ON k.id = m.degerlendiren_id
       WHERE m.tetkik_id = ?
       ORDER BY m.sira, m.id`
    )
    .all(tetkikId);
}

function bulgularGetir(db, tetkikId) {
  return db
    .prepare(
      `SELECT b.*, dep.ad AS departman_ad, k.ad AS sorumlu_ad,
        d.kod AS dof_kod, d.durum AS dof_durum, m.sira AS madde_sira
       FROM ic_tetkik_bulgulari b
       LEFT JOIN departmanlar dep ON dep.id = b.departman_id
       LEFT JOIN kullanicilar k ON k.id = b.sorumlu_id
       LEFT JOIN dof_kayitlari d ON d.id = b.dof_id
       LEFT JOIN ic_tetkik_maddeleri m ON m.id = b.madde_id
       WHERE b.tetkik_id = ?
       ORDER BY b.id`
    )
    .all(tetkikId);
}

function aktivitelerGetir(db, tetkikId) {
  return db
    .prepare(
      `SELECT a.*, k.ad AS kullanici_ad
       FROM aktivite_loglari a
       LEFT JOIN kullanicilar k ON k.id = a.kullanici_id
       WHERE a.modul = 'tetkik' AND a.kayit_tipi = 'ic_tetkik' AND a.kayit_id = ?
       ORDER BY a.id DESC`
    )
    .all(tetkikId);
}

function filtreleriCoz(req, varsayilanYil) {
  const yilHam = Number(queryMetin(req, 'yil', String(varsayilanYil)));
  const yil = tetkik.yilGecerliMi(yilHam) ? yilHam : varsayilanYil;
  const durumHam = queryMetin(req, 'durum', 'hepsi');
  const durum = ['hepsi', ...tetkik.TETKIK_DURUM_ANAHTARLARI].includes(durumHam)
    ? durumHam
    : 'hepsi';
  const departmanId = kimlik(req.query.departman);
  const arama = queryMetin(req, 'q').slice(0, 100);
  return { yil, durum, departmanId, arama };
}

function tetkikListesi(db, { kullanici, tamErisim, filtreler, limit = LISTE_LIMIT }) {
  const erisim = tetkik.tetkikGorunurlukSql(kullanici, tamErisim);
  const kosullar = [erisim.sql, 't.yil = ?'];
  const parametreler = [...erisim.parametreler, filtreler.yil];
  if (filtreler.durum !== 'hepsi') {
    kosullar.push('t.durum = ?');
    parametreler.push(filtreler.durum);
  }
  if (filtreler.departmanId) {
    kosullar.push('t.departman_id = ?');
    parametreler.push(filtreler.departmanId);
  }
  if (filtreler.arama) {
    const desen = `%${filtreler.arama}%`;
    kosullar.push('(t.kod LIKE ? OR t.baslik LIKE ? OR t.kapsam LIKE ?)');
    parametreler.push(desen, desen, desen);
  }
  const sinir = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : LISTE_LIMIT;
  return db
    .prepare(
      `SELECT t.*, dep.ad AS departman_ad, c.ad AS checklist_ad, c.standart AS checklist_standart,
        o.ad AS olusturan_ad,
        (SELECT k.ad FROM ic_tetkik_denetcileri td JOIN kullanicilar k ON k.id = td.kullanici_id
          WHERE td.tetkik_id = t.id AND td.gorev = 'bas_denetci' ORDER BY td.id LIMIT 1) AS denetleyen_ad,
        (SELECT COUNT(*) FROM ic_tetkik_maddeleri m WHERE m.tetkik_id = t.id) AS madde_sayisi,
        (SELECT COUNT(*) FROM ic_tetkik_maddeleri m WHERE m.tetkik_id = t.id AND m.sonuc IS NOT NULL) AS degerlendirilen_madde,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b WHERE b.tetkik_id = t.id) AS bulgu_sayisi,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b WHERE b.tetkik_id = t.id AND b.dof_id IS NOT NULL) AS dof_sayisi
       FROM ic_tetkikler t
       LEFT JOIN departmanlar dep ON dep.id = t.departman_id
       LEFT JOIN ic_tetkik_checklistleri c ON c.id = t.checklist_id
       LEFT JOIN kullanicilar o ON o.id = t.olusturan_id
       WHERE ${kosullar.join(' AND ')}
       ORDER BY t.planlanan_tarih ASC, t.id ASC
       LIMIT ${sinir}`
    )
    .all(...parametreler);
}

function tetkikOzeti(db, kullanici, tamErisim, yil) {
  const erisim = tetkik.tetkikGorunurlukSql(kullanici, tamErisim);
  const satir = db
    .prepare(
      `SELECT COUNT(*) AS toplam,
        COALESCE(SUM(CASE WHEN t.durum = 'planlandi' THEN 1 ELSE 0 END), 0) AS planlandi,
        COALESCE(SUM(CASE WHEN t.durum = 'devam_ediyor' THEN 1 ELSE 0 END), 0) AS devam_ediyor,
        COALESCE(SUM(CASE WHEN t.durum = 'tamamlandi' THEN 1 ELSE 0 END), 0) AS tamamlandi,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b
          JOIN ic_tetkikler tt ON tt.id = b.tetkik_id
          WHERE tt.yil = ? AND (${erisim.sql.replaceAll('t.', 'tt.')})) AS bulgu,
        (SELECT COUNT(*) FROM ic_tetkik_bulgulari b
          JOIN ic_tetkikler tt ON tt.id = b.tetkik_id
          WHERE tt.yil = ? AND b.dof_id IS NOT NULL AND (${erisim.sql.replaceAll('t.', 'tt.')})) AS dof
       FROM ic_tetkikler t
       WHERE t.yil = ? AND ${erisim.sql}`
    )
    .get(
      yil,
      ...erisim.parametreler,
      yil,
      ...erisim.parametreler,
      yil,
      ...erisim.parametreler
    );
  return {
    toplam: Number(satir.toplam) || 0,
    planlandi: Number(satir.planlandi) || 0,
    devamEdiyor: Number(satir.devam_ediyor) || 0,
    tamamlandi: Number(satir.tamamlandi) || 0,
    bulgu: Number(satir.bulgu) || 0,
    dof: Number(satir.dof) || 0,
  };
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

function planDegerleriniDogrula(db, body, varsayilanYil) {
  const yil = Number(metin(body.yil) || varsayilanYil);
  if (!tetkik.yilGecerliMi(yil)) {
    return { hata: 'Geçerli bir denetim yılı seçin.' };
  }

  const checklistId = kimlik(body.checklist_id);
  const checklist = checklistId ? checklistGetir(db, checklistId) : null;
  if (!checklist || !checklist.aktif) {
    return { hata: 'Geçerli ve aktif bir kontrol listesi seçin.' };
  }

  const departmanId = kimlik(body.departman_id);
  const departman = departmanId
    ? db.prepare('SELECT id FROM departmanlar WHERE id = ?').get(departmanId)
    : null;
  if (!departman) return { hata: 'Denetlenecek departmanı seçin.' };

  const baslik = metin(body.baslik);
  if (baslik.length < 3 || baslik.length > 200) {
    return { hata: 'Denetim başlığı 3-200 karakter arasında olmalıdır.' };
  }
  const amac = metin(body.amac);
  if (amac.length < 5 || amac.length > 2000) {
    return { hata: 'Denetim amacı 5-2000 karakter arasında olmalıdır.' };
  }
  const kapsam = metin(body.kapsam);
  if (kapsam.length < 5 || kapsam.length > 5000) {
    return { hata: 'Denetim kapsamı 5-5000 karakter arasında olmalıdır.' };
  }
  const yontem = metin(body.yontem);
  if (yontem.length < 5 || yontem.length > 2000) {
    return { hata: 'Denetim yöntemi 5-2000 karakter arasında olmalıdır.' };
  }

  const planlananTarih = metin(body.planlanan_tarih);
  if (!gecerliTarih(planlananTarih)) {
    return { hata: 'Geçerli bir planlanma tarihi seçin.' };
  }
  if (Number(planlananTarih.slice(0, 4)) !== yil) {
    return { hata: 'Planlanma tarihi seçilen denetim yılına ait olmalıdır.' };
  }

  const basDenetciId = kimlik(body.bas_denetci_id);
  const basDenetci = basDenetciId
    ? db.prepare('SELECT id, ad FROM kullanicilar WHERE id = ? AND aktif = 1').get(basDenetciId)
    : null;
  if (!basDenetci) return { hata: 'Baş denetçi olarak aktif bir kullanıcı seçin.' };

  return {
    degerler: {
      yil,
      checklist_id: checklistId,
      baslik,
      amac,
      kapsam,
      yontem,
      departman_id: departmanId,
      planlanan_tarih: planlananTarih,
      bas_denetci_id: basDenetci.id,
      denetci_idler: kimlikListesi(body.denetci_id).filter((id) => id !== basDenetci.id),
      gozlemci_idler: kimlikListesi(body.gozlemci_id).filter((id) => id !== basDenetci.id),
    },
  };
}

function checklistSatirlariniCoz(body) {
  let maddeler = [];
  const jsonMetni = metin(body.items_json || body.items);
  if (jsonMetni) {
    try {
      const cozulen = JSON.parse(jsonMetni);
      if (Array.isArray(cozulen)) maddeler = cozulen;
    } catch {
      return { hata: 'Kontrol listesi maddeleri geçerli JSON olarak girilmelidir.' };
    }
  } else {
    const satirlar = metin(body.madde_satirlari)
      .split(/\r?\n/)
      .map((satir) => satir.trim())
      .filter(Boolean);
    maddeler = satirlar.map((satir) => {
      const parcalar = satir.split('|').map((parca) => parca.trim());
      return {
        baslik: parcalar[0] || '',
        kriter: parcalar[1] || '',
        referans: parcalar[2] || '',
        agirlik: Number(parcalar[3]) || 1,
      };
    });
  }
  if (!maddeler.length) {
    return { hata: 'En az bir kontrol listesi maddesi girilmelidir.' };
  }
  if (maddeler.length > 100) {
    return { hata: 'Bir kontrol listesinde en fazla 100 madde bulunabilir.' };
  }
  const temiz = [];
  for (const madde of maddeler) {
    const baslik = metin(madde.baslik);
    const kriter = metin(madde.kriter);
    const referans = metin(madde.referans).slice(0, 120);
    const agirlik = Number(madde.agirlik);
    if (baslik.length < 3 || baslik.length > 240) {
      return { hata: 'Her kontrol listesi maddesinin başlığı 3-240 karakter arasında olmalıdır.' };
    }
    if (kriter.length < 5 || kriter.length > 1500) {
      return { hata: 'Her kontrol listesi maddesinin kriteri 5-1500 karakter arasında olmalıdır.' };
    }
    if (!Number.isInteger(agirlik) || agirlik < 1 || agirlik > 10) {
      return { hata: 'Madde ağırlığı 1-10 arasında tam sayı olmalıdır.' };
    }
    temiz.push({ baslik, kriter, referans, agirlik });
  }
  return { maddeler: temiz };
}

function checklistKoduUret(db, standart) {
  const onEk = standart === 'iso_9001' ? 'CL-ISO-' : 'CL-KI-';
  let sira = Number(
    db.prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_checklistleri WHERE kod LIKE ?').get(`${onEk}%`).sayi
  ) + 1;
  let kod = `${onEk}${String(sira).padStart(3, '0')}`;
  while (db.prepare('SELECT 1 FROM ic_tetkik_checklistleri WHERE kod = ?').get(kod)) {
    sira += 1;
    kod = `${onEk}${String(sira).padStart(3, '0')}`;
  }
  return kod;
}

function aktifKullaniciCoz(db, id) {
  const kimlikDegeri = kimlik(id);
  if (!kimlikDegeri) return null;
  return db.prepare('SELECT id, ad, email FROM kullanicilar WHERE id = ? AND aktif = 1').get(kimlikDegeri) || null;
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

function tetkikRotalariniKur(app, { db, auth, mail, config }) {
  app.locals.TETKIK_DURUMLARI = tetkik.TETKIK_DURUMLARI;
  app.locals.TETKIK_SONUCLARI = tetkik.TETKIK_SONUCLARI;
  app.locals.TETKIK_STANDARTLARI = tetkik.TETKIK_STANDARTLARI;
  app.locals.TETKIK_DENETCI_GOREVLERI = tetkik.TETKIK_DENETCI_GOREVLERI;
  app.locals.TETKIK_DENETCI_DURUMLARI = tetkik.TETKIK_DENETCI_DURUMLARI;
  app.locals.TETKIK_BULGU_DURUMLARI = tetkik.TETKIK_BULGU_DURUMLARI;
  app.locals.TETKIK_DURUM_ANAHTARLARI = tetkik.TETKIK_DURUM_ANAHTARLARI;
  app.locals.TETKIK_SONUC_ANAHTARLARI = tetkik.TETKIK_SONUC_ANAHTARLARI;
  app.locals.TETKIK_STANDART_ANAHTARLARI = tetkik.TETKIK_STANDART_ANAHTARLARI;
  app.locals.TETKIK_DENETCI_GOREV_ANAHTARLARI = tetkik.TETKIK_DENETCI_GOREV_ANAHTARLARI;
  app.locals.TETKIK_DENETCI_DURUM_ANAHTARLARI = tetkik.TETKIK_DENETCI_DURUM_ANAHTARLARI;
  app.locals.tetkikDurumEtiketi = tetkik.durumEtiketi;
  app.locals.tetkikSonucEtiketi = tetkik.sonucEtiketi;
  app.locals.tetkikStandartEtiketi = tetkik.standartEtiketi;
  app.locals.tetkikDenetciGorevEtiketi = tetkik.denetciGorevEtiketi;
  app.locals.tetkikDenetciDurumEtiketi = tetkik.denetciDurumEtiketi;
  app.locals.tetkikBulguDurumEtiketi = tetkik.bulguDurumEtiketi;
  app.locals.tetkikDurumSinifi = tetkik.durumSinifi;
  app.locals.tetkikSonucSinifi = tetkik.sonucSinifi;

  // -------------------------------------------------------------------------
  // Yıllık plan listesi
  // -------------------------------------------------------------------------
  app.get('/tetkik', (req, res) => {
    const bugun = bugunOku(db, config);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    const filtreler = filtreleriCoz(req, Number(bugun.slice(0, 4)));
    const liste = tetkikListesi(db, { kullanici: req.kullanici, tamErisim, filtreler });
    const ozet = tetkikOzeti(db, req.kullanici, tamErisim, filtreler.yil);
    const yillar = db
      .prepare('SELECT DISTINCT yil FROM ic_tetkikler ORDER BY yil DESC')
      .all()
      .map((satir) => Number(satir.yil));
    if (!yillar.includes(filtreler.yil)) yillar.unshift(filtreler.yil);
    res.render('tetkik', {
      aktifSayfa: 'tetkik',
      sayfaBaslik: 'İç Tetkik Yönetimi',
      liste,
      ozet,
      filtreler,
      yillar,
      departmanlar: departmanlarGetir(db),
      tetkikYetkisi: tamErisim,
      bugun,
    });
  });

  // -------------------------------------------------------------------------
  // Yıllık takvim
  // -------------------------------------------------------------------------
  app.get('/tetkik/takvim', (req, res) => {
    const bugun = bugunOku(db, config);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    const filtreler = filtreleriCoz(req, Number(bugun.slice(0, 4)));
    const liste = tetkikListesi(db, { kullanici: req.kullanici, tamErisim, filtreler, limit: 2000 });
    const aylar = Array.from({ length: 12 }, (_, indeks) => ({
      no: indeks + 1,
      ad: new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date(Date.UTC(2024, indeks, 1))),
      kayitlar: liste.filter((kayit) => Number(String(kayit.planlanan_tarih).slice(5, 7)) === indeks + 1),
    }));
    res.render('tetkik-takvim', {
      aktifSayfa: 'tetkik',
      sayfaBaslik: `${filtreler.yil} İç Tetkik Takvimi`,
      aylar,
      filtreler,
      departmanlar: departmanlarGetir(db),
    });
  });

  // -------------------------------------------------------------------------
  // Kontrol listeleri
  // -------------------------------------------------------------------------
  app.get('/tetkik/checklistler', (req, res) => {
    const listeler = checklistlerGetir(db).map((checklist) => ({
      ...checklist,
      maddeler: checklistMaddeleriGetir(db, checklist.id),
    }));
    res.render('tetkik-checklistler', {
      aktifSayfa: 'tetkik-checklistler',
      sayfaBaslik: 'Denetim Kontrol Listeleri',
      listeler,
      tetkikYetkisi: auth.yetkiliMi(req.kullanici, 'tetkik'),
      standartlar: tetkik.TETKIK_STANDARTLARI,
      standartAnahtarlari: tetkik.TETKIK_STANDART_ANAHTARLARI,
    });
  });

  app.post('/tetkik/checklistler', auth.izinGerekli('tetkik'), (req, res) => {
    const ad = metin(req.body.ad);
    const standart = metin(req.body.standart);
    const aciklama = metin(req.body.aciklama).slice(0, 2000);
    if (ad.length < 3 || ad.length > 200) {
      return yonlendir(res, '/tetkik/checklistler', 'hata', 'Kontrol listesi adı 3-200 karakter arasında olmalıdır.');
    }
    if (!Object.prototype.hasOwnProperty.call(tetkik.TETKIK_STANDARTLARI, standart)) {
      return yonlendir(res, '/tetkik/checklistler', 'hata', 'Geçerli bir kontrol listesi standardı seçin.');
    }
    const maddeKontrol = checklistSatirlariniCoz(req.body);
    if (maddeKontrol.hata) {
      return yonlendir(res, '/tetkik/checklistler', 'hata', maddeKontrol.hata);
    }

    const simdi = new Date().toISOString();
    let checklistId = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const kod = checklistKoduUret(db, standart);
      const bilgi = db
        .prepare(
          `INSERT INTO ic_tetkik_checklistleri
            (kod, ad, standart, aciklama, versiyon, aktif, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, '1.0', 1, ?, ?, ?)`
        )
        .run(kod, ad, standart, aciklama, req.kullanici.id, simdi, simdi);
      checklistId = Number(bilgi.lastInsertRowid);
      const ekle = db.prepare(
        `INSERT INTO ic_tetkik_checklist_maddeleri
          (checklist_id, sira, baslik, kriter, referans, agirlik, zorunlu)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      );
      maddeKontrol.maddeler.forEach((madde, indeks) => {
        ekle.run(checklistId, indeks + 1, madde.baslik, madde.kriter, madde.referans, madde.agirlik);
      });
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'checklist_olustur',
        kayitTipi: 'checklist',
        kayitId: checklistId,
        referansNo: kod,
        kullaniciId: req.kullanici.id,
        aciklama: `${ad} kontrol listesi oluşturuldu (${maddeKontrol.maddeler.length} madde).`,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik checklist oluşturma]', hata);
      return yonlendir(res, '/tetkik/checklistler', 'hata', 'Kontrol listesi oluşturulamadı.');
    }
    return yonlendir(res, '/tetkik/checklistler', 'ok', `${ad} kontrol listesi oluşturuldu.`);
  });

  // -------------------------------------------------------------------------
  // Yeni yıllık iç tetkik planı
  // -------------------------------------------------------------------------
  app.get('/tetkik/yeni', auth.izinGerekli('tetkik'), (req, res) => {
    const bugun = bugunOku(db, config);
    const yil = Number(bugun.slice(0, 4));
    res.render('tetkik-yeni', {
      aktifSayfa: 'tetkik-yeni',
      sayfaBaslik: 'Yeni İç Tetkik Planı',
      yil,
      bugun,
      departmanlar: departmanlarGetir(db),
      kullanicilar: aktifKullanicilar(db),
      checklistler: checklistlerGetir(db, { sadeceAktif: true }),
      onKod: tetkik.tetkikKoduUret(db, yil),
    });
  });

  app.post('/tetkik/yeni', auth.izinGerekli('tetkik'), (req, res) => {
    const bugun = bugunOku(db, config);
    const kontrol = planDegerleriniDogrula(db, req.body, Number(bugun.slice(0, 4)));
    if (kontrol.hata) return yonlendir(res, '/tetkik/yeni', 'hata', kontrol.hata);
    const degerler = kontrol.degerler;

    const secilenKisiler = new Set([degerler.bas_denetci_id]);
    const atamalar = [
      { kullanici_id: degerler.bas_denetci_id, gorev: 'bas_denetci' },
      ...degerler.denetci_idler.filter((id) => !secilenKisiler.has(id)).map((id) => {
        secilenKisiler.add(id);
        return { kullanici_id: id, gorev: 'denetci' };
      }),
      ...degerler.gozlemci_idler
        .filter((id) => !secilenKisiler.has(id))
        .map((id) => {
          secilenKisiler.add(id);
          return { kullanici_id: id, gorev: 'gozlemci' };
        }),
    ];
    for (const atama of atamalar) {
      if (!aktifKullaniciCoz(db, atama.kullanici_id)) {
        return yonlendir(res, '/tetkik/yeni', 'hata', 'Denetçi atamasındaki kullanıcılardan biri aktif değil.');
      }
    }

    const simdi = new Date().toISOString();
    let tetkikId = null;
    let kod = '';
    db.exec('BEGIN IMMEDIATE');
    try {
      kod = tetkik.tetkikKoduUret(db, degerler.yil);
      const bilgi = db
        .prepare(
          `INSERT INTO ic_tetkikler
            (kod, yil, checklist_id, baslik, amac, kapsam, yontem, departman_id,
             planlanan_tarih, durum, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planlandi', ?, ?, ?)`
        )
        .run(
          kod,
          degerler.yil,
          degerler.checklist_id,
          degerler.baslik,
          degerler.amac,
          degerler.kapsam,
          degerler.yontem,
          degerler.departman_id,
          degerler.planlanan_tarih,
          req.kullanici.id,
          simdi,
          simdi
        );
      tetkikId = Number(bilgi.lastInsertRowid);

      const atamaEkle = db.prepare(
        `INSERT INTO ic_tetkik_denetcileri
          (tetkik_id, kullanici_id, gorev, durum, atayan_id, atama_tarihi)
         VALUES (?, ?, ?, 'atanmis', ?, ?)`
      );
      for (const atama of atamalar) {
        atamaEkle.run(tetkikId, atama.kullanici_id, atama.gorev, req.kullanici.id, simdi);
      }

      const kaynakMaddeler = checklistMaddeleriGetir(db, degerler.checklist_id);
      const maddeEkle = db.prepare(
        `INSERT INTO ic_tetkik_maddeleri
          (tetkik_id, checklist_madde_id, sira, baslik, kriter, referans, agirlik)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const madde of kaynakMaddeler) {
        maddeEkle.run(
          tetkikId,
          madde.id,
          madde.sira,
          madde.baslik,
          madde.kriter,
          madde.referans,
          madde.agirlik
        );
      }

      for (const atama of atamalar) {
        bildirimEkle(
          db,
          atama.kullanici_id,
          `İç tetkik atandı: ${kod}`,
          `${degerler.baslik} · Planlanan tarih: ${tarihTr(degerler.planlanan_tarih)}.`,
          tetkikId
        );
      }
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'plan_olustur',
        kayitTipi: 'ic_tetkik',
        kayitId: tetkikId,
        referansNo: kod,
        kullaniciId: req.kullanici.id,
        aciklama: `${degerler.baslik} için ${degerler.yil} yılı iç tetkik planı oluşturuldu.`,
        yeniDeger: 'planlandi',
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik plan oluşturma]', hata);
      return yonlendir(res, '/tetkik/yeni', 'hata', 'İç tetkik planı oluşturulamadı.');
    }
    return yonlendir(res, `/tetkik/${tetkikId}`, 'ok', `${kod} numaralı iç tetkik planı oluşturuldu.`);
  });

  // -------------------------------------------------------------------------
  // İç tetkik detayı
  // -------------------------------------------------------------------------
  app.get('/tetkik/:id', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    if (!kayit || !tetkik.tetkikErisimiVar(db, req.kullanici, kayit, tamErisim)) return sayfaYok(res);

    db.prepare("UPDATE bildirimler SET okundu = 1 WHERE kullanici_id = ? AND baglanti = ?").run(
      req.kullanici.id,
      `/tetkik/${kayit.id}`
    );

    const denetciler = denetcilerGetir(db, kayit.id);
    const maddeler = maddelerGetir(db, kayit.id);
    const bulgular = bulgularGetir(db, kayit.id);
    const aktiviteler = aktivitelerGetir(db, kayit.id);
    const dagilim = tetkik.sonucDagilimi(maddeler);
    const puan = tetkik.puanHesapla(maddeler);
    const degerlendirmeYetkisi = tetkik.tetkikDuzenlemeErisimiVar(db, req.kullanici, kayit, tamErisim);

    res.render('tetkik-detay', {
      aktifSayfa: 'tetkik',
      sayfaBaslik: kayit.kod,
      kayit,
      denetciler,
      maddeler,
      bulgular,
      aktiviteler,
      dagilim,
      puan,
      degerlendirmeYetkisi,
      tetkikYetkisi: tamErisim,
      kapatmaYetkisi: auth.yetkiliMi(req.kullanici, 'tetkik.kapat'),
      departmanlar: departmanlarGetir(db),
      kullanicilar: aktifKullanicilar(db),
      checklistler: checklistlerGetir(db, { sadeceAktif: true }),
      bugun: bugunOku(db, config),
    });
  });

  // -------------------------------------------------------------------------
  // Plan künyesini güncelle
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id', auth.izinGerekli('tetkik'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    if (kayit.durum === 'tamamlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Tamamlanmış iç tetkik kaydı düzenlenemez.');
    }
    const kontrol = planDegerleriniDogrula(db, req.body, kayit.yil);
    if (kontrol.hata) return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', kontrol.hata);
    const degerler = kontrol.degerler;
    const checklistDegisti = Number(kayit.checklist_id) !== Number(degerler.checklist_id);
    if (checklistDegisti && kayit.durum !== 'planlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Kontrol listesi yalnızca planlanmış tetkiklerde değiştirilebilir.');
    }

    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE ic_tetkikler
         SET checklist_id = ?, baslik = ?, amac = ?, kapsam = ?, yontem = ?, departman_id = ?,
             planlanan_tarih = ?, guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(
        degerler.checklist_id,
        degerler.baslik,
        degerler.amac,
        degerler.kapsam,
        degerler.yontem,
        degerler.departman_id,
        degerler.planlanan_tarih,
        simdi,
        kayit.id
      );
      if (checklistDegisti) {
        db.prepare('DELETE FROM ic_tetkik_maddeleri WHERE tetkik_id = ?').run(kayit.id);
        const kaynakMaddeler = checklistMaddeleriGetir(db, degerler.checklist_id);
        const maddeEkle = db.prepare(
          `INSERT INTO ic_tetkik_maddeleri
            (tetkik_id, checklist_madde_id, sira, baslik, kriter, referans, agirlik)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const madde of kaynakMaddeler) {
          maddeEkle.run(kayit.id, madde.id, madde.sira, madde.baslik, madde.kriter, madde.referans, madde.agirlik);
        }
      }
      const eskiBasDenetci = db
        .prepare(
          "SELECT kullanici_id FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND gorev = 'bas_denetci' LIMIT 1"
        )
        .get(kayit.id);
      if (eskiBasDenetci && Number(eskiBasDenetci.kullanici_id) !== Number(degerler.bas_denetci_id)) {
        db.prepare(
          "UPDATE ic_tetkik_denetcileri SET gorev = 'denetci' WHERE tetkik_id = ? AND kullanici_id = ?"
        ).run(kayit.id, eskiBasDenetci.kullanici_id);
      }
      db.prepare(
        `INSERT INTO ic_tetkik_denetcileri
          (tetkik_id, kullanici_id, gorev, durum, atayan_id, atama_tarihi)
         VALUES (?, ?, 'bas_denetci', 'atanmis', ?, ?)
         ON CONFLICT (tetkik_id, kullanici_id) DO UPDATE SET
           gorev = 'bas_denetci', atayan_id = excluded.atayan_id, atama_tarihi = excluded.atama_tarihi`
      ).run(kayit.id, degerler.bas_denetci_id, req.kullanici.id, simdi);
      bildirimEkle(
        db,
        degerler.bas_denetci_id,
        `İç tetkik baş denetçisi olarak atandı: ${kayit.kod}`,
        `${degerler.baslik} planının baş denetçiliği size verildi.`,
        kayit.id
      );
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'plan_guncelle',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: kayit.kod,
        kullaniciId: req.kullanici.id,
        aciklama: 'İç tetkik plan künyesi güncellendi.',
        eskiDeger: kayit.baslik,
        yeniDeger: degerler.baslik,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik plan güncelleme]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'İç tetkik planı güncellenemedi.');
    }
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', 'İç tetkik plan künyesi güncellendi.');
  });

  // -------------------------------------------------------------------------
  // Denetçi ataması / atama durumu
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id/denetciler', auth.izinGerekli('tetkik'), (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    if (kayit.durum === 'tamamlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Tamamlanmış iç tetkik kaydına denetçi atanamaz.');
    }
    const kullanici = aktifKullaniciCoz(db, req.body.kullanici_id);
    if (!kullanici) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Denetçi olarak aktif bir kullanıcı seçin.');
    }
    const gorev = metin(req.body.gorev) || 'denetci';
    if (!Object.prototype.hasOwnProperty.call(tetkik.TETKIK_DENETCI_GOREVLERI, gorev)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Geçerli bir denetçi görevi seçin.');
    }
    const durum = metin(req.body.durum) || 'atanmis';
    if (!Object.prototype.hasOwnProperty.call(tetkik.TETKIK_DENETCI_DURUMLARI, durum)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Geçerli bir denetçi durumu seçin.');
    }

    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (gorev === 'bas_denetci') {
        db.prepare(
          `UPDATE ic_tetkik_denetcileri
           SET gorev = 'denetci'
           WHERE tetkik_id = ? AND gorev = 'bas_denetci' AND kullanici_id <> ?`
        ).run(kayit.id, kullanici.id);
      }
      db.prepare(
        `INSERT INTO ic_tetkik_denetcileri
          (tetkik_id, kullanici_id, gorev, durum, atayan_id, atama_tarihi, yanit_tarihi, tamamlanma_tarihi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tetkik_id, kullanici_id) DO UPDATE SET
           gorev = excluded.gorev,
           durum = excluded.durum,
           atayan_id = excluded.atayan_id,
           atama_tarihi = excluded.atama_tarihi,
           yanit_tarihi = CASE
             WHEN excluded.durum IN ('kabul_edildi', 'tamamlandi') THEN excluded.yanit_tarihi
             ELSE ic_tetkik_denetcileri.yanit_tarihi
           END,
           tamamlanma_tarihi = CASE
             WHEN excluded.durum = 'tamamlandi' THEN excluded.tamamlanma_tarihi
             ELSE ic_tetkik_denetcileri.tamamlanma_tarihi
           END`
      ).run(
        kayit.id,
        kullanici.id,
        gorev,
        durum,
        req.kullanici.id,
        simdi,
        durum === 'atanmis' ? null : simdi,
        durum === 'tamamlandi' ? simdi : null
      );
      bildirimEkle(
        db,
        kullanici.id,
        `İç tetkik görevi: ${kayit.kod}`,
        `${tetkik.denetciGorevEtiketi(gorev)} · ${kayit.baslik}`,
        kayit.id
      );
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'denetci_atama',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: kayit.kod,
        kullaniciId: req.kullanici.id,
        aciklama: `${kullanici.ad} ${tetkik.denetciGorevEtiketi(gorev)} olarak atandı; durum: ${tetkik.denetciDurumEtiketi(durum)}.`,
        yeniDeger: durum,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik denetçi atama]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Denetçi ataması kaydedilemedi.');
    }
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', 'Denetçi ataması güncellendi.');
  });

  // -------------------------------------------------------------------------
  // Denetim durumu
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id/durum', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    const atanmisMi = tetkik.tetkikDuzenlemeErisimiVar(db, req.kullanici, kayit, tamErisim);
    if (!atanmisMi) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'tetkik',
      });
    }

    const yeniDurum = metin(req.body.durum);
    if (!Object.prototype.hasOwnProperty.call(tetkik.TETKIK_DURUMLARI, yeniDurum)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Geçerli bir denetim durumu seçin.');
    }
    if (kayit.durum === 'tamamlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Tamamlanmış iç tetkik durumu değiştirilemez.');
    }
    if (yeniDurum === 'devam_ediyor' && kayit.durum !== 'planlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'İç tetkik yalnızca planlandı durumundan başlatılabilir.');
    }
    if (yeniDurum === 'tamamlandi' && kayit.durum !== 'devam_ediyor') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'İç tetkik önce devam ediyor durumuna alınmalıdır.');
    }
    if (yeniDurum === 'tamamlandi' && !auth.yetkiliMi(req.kullanici, 'tetkik.kapat')) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'tetkik.kapat',
      });
    }

    if (yeniDurum === 'tamamlandi') {
      const maddeler = maddelerGetir(db, kayit.id);
      const degerlendirilmemis = maddeler.filter((madde) => !madde.sonuc);
      if (degerlendirilmemis.length) {
        return yonlendir(
          res,
          `/tetkik/${kayit.id}`,
          'hata',
          `İç tetkik tamamlanamaz: ${degerlendirilmemis.length} kontrol listesi maddesi değerlendirilmemiş.`
        );
      }
      const bulgular = bulgularGetir(db, kayit.id);
      const uygunsuzlukMaddeleri = maddeler.filter((madde) => ['minor', 'major'].includes(madde.sonuc));
      for (const madde of uygunsuzlukMaddeleri) {
        const bulguVar = bulgular.some((bulgu) => Number(bulgu.madde_id) === Number(madde.id));
        if (!bulguVar) {
          return yonlendir(
            res,
            `/tetkik/${kayit.id}`,
            'hata',
            `İç tetkik tamamlanamaz: ${madde.sira}. madde için uygunsuzluk bulgusu kaydedilmeli.`
          );
        }
      }
      for (const bulgu of bulgular.filter((kayit) => ['minor', 'major'].includes(kayit.sonuc))) {
        if (!bulgu.dof_id) {
          return yonlendir(
            res,
            `/tetkik/${kayit.id}`,
            'hata',
            `İç tetkik tamamlanamaz: ${bulgu.kod} bulgusu için DÖF kaydı oluşturulmalı.`
          );
        }
      }
    }

    const simdi = new Date().toISOString();
    const bugun = bugunOku(db, config);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (yeniDurum === 'devam_ediyor') {
        db.prepare(
          `UPDATE ic_tetkikler
           SET durum = 'devam_ediyor', baslangic_tarihi = COALESCE(baslangic_tarihi, ?), guncelleme_tarihi = ?
           WHERE id = ?`
        ).run(bugun, simdi, kayit.id);
      } else {
        db.prepare(
          `UPDATE ic_tetkikler
           SET durum = 'tamamlandi', bitis_tarihi = ?, tamamlayan_id = ?, guncelleme_tarihi = ?
           WHERE id = ?`
        ).run(bugun, req.kullanici.id, simdi, kayit.id);
        db.prepare(
          `UPDATE ic_tetkik_denetcileri
           SET durum = 'tamamlandi', tamamlanma_tarihi = ?
           WHERE tetkik_id = ?`
        ).run(simdi, kayit.id);
      }
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'durum_degistir',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: kayit.kod,
        kullaniciId: req.kullanici.id,
        aciklama: `İç tetkik durumu ${tetkik.durumEtiketi(kayit.durum)} durumundan ${tetkik.durumEtiketi(yeniDurum)} durumuna değiştirildi.`,
        eskiDeger: kayit.durum,
        yeniDeger: yeniDurum,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik durum]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'İç tetkik durumu güncellenemedi.');
    }
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', `İç tetkik durumu ${tetkik.durumEtiketi(yeniDurum)} olarak güncellendi.`);
  });

  // -------------------------------------------------------------------------
  // Madde bazlı değerlendirme
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id/maddeler/:maddeId', (req, res) => {
    const id = kimlik(req.params.id);
    const maddeId = kimlik(req.params.maddeId);
    const kayit = id ? tetkikGetir(db, id) : null;
    const madde = kayit && maddeId
      ? db.prepare('SELECT * FROM ic_tetkik_maddeleri WHERE id = ? AND tetkik_id = ?').get(maddeId, kayit.id)
      : null;
    if (!kayit || !madde) return sayfaYok(res);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    if (!tetkik.tetkikDuzenlemeErisimiVar(db, req.kullanici, kayit, tamErisim)) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'tetkik',
      });
    }
    if (kayit.durum !== 'devam_ediyor') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Değerlendirme yalnızca devam ediyor durumundaki tetkiklerde yapılabilir.');
    }

    const sonuc = metin(req.body.sonuc);
    if (!Object.prototype.hasOwnProperty.call(tetkik.TETKIK_SONUCLARI, sonuc)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Geçerli bir değerlendirme sonucu seçin.');
    }
    const hamPuan = metin(req.body.puan);
    let puan = tetkik.TETKIK_SONUC_PUANLARI[sonuc];
    if (hamPuan) {
      puan = Number(hamPuan);
      if (!Number.isFinite(puan) || puan < 0 || puan > 100) {
        return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Madde puanı 0-100 arasında olmalıdır.');
      }
    }
    const bulguAciklama = metin(req.body.bulgu_aciklama);
    const kanit = metin(req.body.kanit);
    if (bulguAciklama.length > 3000 || kanit.length > 2000) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Madde açıklaması veya kanıt alanı çok uzun.');
    }
    if (['minor', 'major'].includes(sonuc) && bulguAciklama.length < 5) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Uygunsuzluk sonuçları için madde açıklaması zorunludur.');
    }

    const simdi = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE ic_tetkik_maddeleri
         SET sonuc = ?, puan = ?, bulgu_aciklama = ?, kanit = ?,
             degerlendiren_id = ?, degerlendirme_tarihi = ?
         WHERE id = ? AND tetkik_id = ?`
      ).run(sonuc, puan, bulguAciklama, kanit, req.kullanici.id, simdi, madde.id, kayit.id);
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'madde_degerlendir',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: kayit.kod,
        kullaniciId: req.kullanici.id,
        aciklama: `${madde.sira}. madde değerlendirildi: ${tetkik.sonucEtiketi(sonuc)} (${puan} puan).`,
        eskiDeger: madde.sonuc || '',
        yeniDeger: sonuc,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik madde değerlendirme]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Madde değerlendirmesi kaydedilemedi.');
    }
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', `${madde.sira}. madde değerlendirmesi kaydedildi.`);
  });

  // -------------------------------------------------------------------------
  // Bulgu kaydı
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id/bulgular', (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    if (!kayit) return sayfaYok(res);
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    if (!tetkik.tetkikDuzenlemeErisimiVar(db, req.kullanici, kayit, tamErisim)) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'tetkik',
      });
    }
    if (kayit.durum !== 'devam_ediyor') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu yalnızca devam ediyor durumundaki tetkiklerde kaydedilebilir.');
    }

    const baslik = metin(req.body.baslik);
    const tanim = metin(req.body.tanim);
    const sonuc = metin(req.body.sonuc);
    const departmanId = kimlik(req.body.departman_id) || kayit.departman_id;
    const sorumlu = aktifKullaniciCoz(db, req.body.sorumlu_id);
    const tespitTarihi = metin(req.body.tespit_tarihi) || bugunOku(db, config);
    const maddeId = kimlik(req.body.madde_id);

    if (baslik.length < 3 || baslik.length > 240) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu başlığı 3-240 karakter arasında olmalıdır.');
    }
    if (tanim.length < 10 || tanim.length > 5000) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu tanımı 10-5000 karakter arasında olmalıdır.');
    }
    if (!['minor', 'major', 'gozlem'].includes(sonuc)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu sınıfı minor, major veya gozlem olmalıdır.');
    }
    const departman = departmanId
      ? db.prepare('SELECT id FROM departmanlar WHERE id = ?').get(departmanId)
      : null;
    if (!departman) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu için geçerli bir departman seçin.');
    }
    if (!gecerliTarih(tespitTarihi)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu tespit tarihi geçersiz.');
    }
    let madde = null;
    if (maddeId) {
      madde = db
        .prepare('SELECT * FROM ic_tetkik_maddeleri WHERE id = ? AND tetkik_id = ?')
        .get(maddeId, kayit.id);
      if (!madde) {
        return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Seçilen kontrol listesi maddesi bu tetkike ait değil.');
      }
    }

    const simdi = new Date().toISOString();
    let bulguId = null;
    let kod = '';
    db.exec('BEGIN IMMEDIATE');
    try {
      kod = tetkik.bulguKoduUret(db, kayit.yil);
      const bilgi = db
        .prepare(
          `INSERT INTO ic_tetkik_bulgulari
            (kod, tetkik_id, madde_id, baslik, tanim, sonuc, departman_id, sorumlu_id,
             tespit_tarihi, durum, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'acik', ?, ?, ?)`
        )
        .run(
          kod,
          kayit.id,
          madde?.id || null,
          baslik,
          tanim,
          sonuc,
          departmanId,
          sorumlu?.id || null,
          tespitTarihi,
          req.kullanici.id,
          simdi,
          simdi
        );
      bulguId = Number(bilgi.lastInsertRowid);
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'bulgu_olustur',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: `${kayit.kod} / ${kod}`,
        kullaniciId: req.kullanici.id,
        aciklama: `${tetkik.sonucEtiketi(sonuc)} bulgusu kaydedildi: ${baslik}`,
        yeniDeger: 'acik',
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik bulgu oluşturma]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu kaydı oluşturulamadı.');
    }
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', `${kod} numaralı bulgu kaydedildi.`);
  });

  // -------------------------------------------------------------------------
  // Tek tıkla DÖF oluşturma
  // -------------------------------------------------------------------------
  app.post('/tetkik/:id/bulgular/:bulguId/dof', auth.izinGerekli('tetkik'), async (req, res) => {
    const id = kimlik(req.params.id);
    const bulguId = kimlik(req.params.bulguId);
    const kayit = id ? tetkikGetir(db, id) : null;
    const bulgu = kayit && bulguId
      ? db.prepare('SELECT * FROM ic_tetkik_bulgulari WHERE id = ? AND tetkik_id = ?').get(bulguId, kayit.id)
      : null;
    if (!kayit || !bulgu) return sayfaYok(res);
    if (!auth.yetkiliMi(req.kullanici, 'dof')) {
      return res.status(403).render('yetkisiz', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'Yetkisiz İşlem',
        gerekliIzin: 'dof',
      });
    }
    if (bulgu.dof_id) {
      const dof = db.prepare('SELECT kod FROM dof_kayitlari WHERE id = ?').get(bulgu.dof_id);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'bilgi', `Bu bulgu zaten ${dof?.kod || 'DÖF'} kaydına bağlı.`);
    }
    if (!tetkik.bulguDofAktarilabilirMi(bulgu)) {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Yalnızca minör ve majör uygunsuzluk bulguları DÖF kaydına aktarılabilir.');
    }
    if (kayit.durum === 'tamamlandi') {
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Tamamlanmış iç tetkikten yeni DÖF oluşturulamaz.');
    }

    const denetleyenler = denetcilerGetir(db, kayit.id);
    const basDenetci = denetleyenler.find((kisi) => kisi.gorev === 'bas_denetci');
    const talepEden = basDenetci?.kullanici_ad || kayit.denetleyen_ad || req.kullanici.ad;
    const simdi = new Date().toISOString();
    let dofId = null;
    let dofKodu = '';
    db.exec('BEGIN IMMEDIATE');
    try {
      const guncelBulgu = db
        .prepare('SELECT * FROM ic_tetkik_bulgulari WHERE id = ? AND tetkik_id = ?')
        .get(bulgu.id, kayit.id);
      if (guncelBulgu.dof_id) {
        db.exec('COMMIT');
        const mevcut = db.prepare('SELECT kod FROM dof_kayitlari WHERE id = ?').get(guncelBulgu.dof_id);
        return yonlendir(res, `/tetkik/${kayit.id}`, 'bilgi', `Bu bulgu zaten ${mevcut?.kod || 'DÖF'} kaydına bağlı.`);
      }
      dofKodu = dof.dofKoduUret(db, Number(kayit.yil));
      const tanim = `[${kayit.kod} / ${bulgu.kod}] ${bulgu.tanim}`;
      const bilgi = db
        .prepare(
          `INSERT INTO dof_kayitlari
            (kod, tur, kaynak, departman_id, talep_eden, tespit_tarihi, uygunsuzluk_tanimi,
             durum, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
           VALUES (?, 'duzeltici', 'ic_tetkik', ?, ?, ?, ?, 'acik', ?, ?, ?)`
        )
        .run(
          dofKodu,
          bulgu.departman_id || kayit.departman_id,
          talepEden,
          bulgu.tespit_tarihi,
          tanim,
          req.kullanici.id,
          simdi,
          simdi
        );
      dofId = Number(bilgi.lastInsertRowid);
      db.prepare(
        `UPDATE ic_tetkik_bulgulari
         SET dof_id = ?, durum = 'dof_acildi', guncelleme_tarihi = ?
         WHERE id = ?`
      ).run(dofId, simdi, bulgu.id);
      aktiviteEkle(db, {
        modul: 'tetkik',
        islem: 'dof_aktar',
        kayitTipi: 'ic_tetkik',
        kayitId: kayit.id,
        referansNo: `${kayit.kod} / ${bulgu.kod} → ${dofKodu}`,
        kullaniciId: req.kullanici.id,
        aciklama: `${bulgu.kod} bulgusu tek tıkla ${dofKodu} numaralı DÖF kaydına aktarıldı.`,
        eskiDeger: 'acik',
        yeniDeger: dofKodu,
      });
      db.exec('COMMIT');
    } catch (hata) {
      db.exec('ROLLBACK');
      console.error('[tetkik DÖF aktarımı]', hata);
      return yonlendir(res, `/tetkik/${kayit.id}`, 'hata', 'Bulgu DÖF modülüne aktarılamadı.');
    }

    const kisiler = db
      .prepare('SELECT id FROM kullanicilar WHERE aktif = 1 AND departman_id = ? AND id <> ?')
      .all(bulgu.departman_id || kayit.departman_id, req.kullanici.id);
    for (const kisi of kisiler) {
      bildirimEkle(db, kisi.id, `Yeni DÖF açıldı: ${dofKodu}`, `${kayit.kod} / ${bulgu.kod} bulgusundan oluşturuldu.`, kayit.id);
    }

    let epostaAdet = 0;
    try {
      const dofKaydi = db
        .prepare(
          `SELECT d.*, dep.ad AS departman_ad FROM dof_kayitlari d
           LEFT JOIN departmanlar dep ON dep.id = d.departman_id WHERE d.id = ?`
        )
        .get(dofId);
      const sonuc = await bildirimler.dofAcildiBildiriminiGonder({
        db,
        mail,
        config,
        dof: dofKaydi,
      });
      epostaAdet = sonuc.gonderilen;
    } catch (hata) {
      console.error('[tetkik DÖF e-postası]', hata);
    }

    const mesaj =
      `${bulgu.kod} bulgusu ${dofKodu} numaralı DÖF kaydına aktarıldı.` +
      (epostaAdet > 0 ? ` ${epostaAdet} kişiye e-posta gönderildi.` : '');
    return yonlendir(res, `/tetkik/${kayit.id}`, 'ok', mesaj);
  });

  // -------------------------------------------------------------------------
  // Kurumsal PDF denetim raporu
  // -------------------------------------------------------------------------
  app.get('/tetkik/:id/pdf', async (req, res) => {
    const id = kimlik(req.params.id);
    const kayit = id ? tetkikGetir(db, id) : null;
    const tamErisim = auth.yetkiliMi(req.kullanici, 'tetkik');
    if (!kayit || !tetkik.tetkikErisimiVar(db, req.kullanici, kayit, tamErisim)) return sayfaYok(res);

    const maddeler = maddelerGetir(db, kayit.id);
    const bulgular = bulgularGetir(db, kayit.id);
    const puan = tetkik.puanHesapla(maddeler);
    const sirket = sirketAyarlari(db);
    const indir = ['1', 'true', 'evet'].includes(queryMetin(req, 'indir').toLowerCase());
    const dosyaAdi = `${kayit.kod}.pdf`;

    let logoVerisi = null;
    if (sirket.logo) {
      const logoDosyasi = path.join(config.dataDir, 'yuklemeler', 'logo', path.basename(String(sirket.logo)));
      try {
        if (fs.existsSync(logoDosyasi)) logoVerisi = fs.readFileSync(logoDosyasi);
      } catch {
        logoVerisi = null;
      }
    }

    try {
      const pdf = await tetkikPdfUret({
        tetkik: {
          ...kayit,
          genel_puan: puan.puan,
          denetleyen_ad: kayit.denetleyen_ad || '',
          tamamlayan_ad: kayit.tamamlayan_ad || '',
        },
        maddeler,
        bulgular,
        sirket,
        logoVerisi,
        bugun: bugunOku(db, config),
        denetleyenAd: kayit.denetleyen_ad || '',
        tamamlayanAd: kayit.tamamlayan_ad || '',
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Cache-Control', 'no-store');
      res.set(
        'Content-Disposition',
        `${indir ? 'attachment' : 'inline'}; filename="${dosyaAdi.replace(/[^A-Za-z0-9._-]/g, '-')}"`
      );
      return res.send(pdf);
    } catch (hata) {
      console.error('[tetkik pdf]', hata);
      return res.status(500).render('hata', {
        aktifSayfa: 'tetkik',
        sayfaBaslik: 'PDF Üretilemedi',
        hataMesaji: 'İç tetkik raporu oluşturulurken bir hata oluştu.',
      });
    }
  });
}

module.exports = {
  tetkikRotalariniKur,
  tetkikListesi,
  tetkikOzeti,
};
