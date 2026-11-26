'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  testOrtami,
  sunucuBaslat,
  formPost,
  sayfaAl,
  girisYap,
  cerezliBasliklar,
  yolKimlik,
} = require('./helpers');
const { kullaniciOlustur } = require('../src/auth');
const { bugunTz } = require('../src/dates');
const { tetkikPdfUret } = require('../src/pdf');
const PDFDocument = require('pdfkit');

let ortam;
let sunucu;

let uretimId;
let bakimId;
let satinAlmaId;
let denetciId;
let gozlemciId;
let uretimPersonelId;
let yabancıId;

let isoChecklistId;
let tetkikId;
let tetkikKod;
let majorMaddeId;
let bulguId;
let bulguKod;
let dofKod;

const BUGUN = bugunTz('Europe/Istanbul');
const YIL = Number(BUGUN.slice(0, 4));

function db() {
  return ortam.db;
}

async function giris(email, sifre) {
  const sonuc = await girisYap(sunucu.base, email, sifre);
  assert.equal(sonuc.durum, 303, `${email} girişi başarılı olmalı`);
}

async function ikiliAl(yol) {
  const yanit = await fetch(`${sunucu.base}${yol}`, {
    headers: cerezliBasliklar(sunucu.base),
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    icerikTuru: yanit.headers.get('content-type'),
    duzen: yanit.headers.get('content-disposition'),
    tampon: Buffer.from(await yanit.arrayBuffer()),
  };
}

function planFormu(ek = {}) {
  return {
    yil: String(YIL),
    checklist_id: String(isoChecklistId),
    departman_id: String(uretimId),
    planlanan_tarih: `${YIL}-05-15`,
    baslik: `${YIL} Üretim Süreçleri İç Tetkik Planı`,
    amac: 'Üretim süreçlerinin kalite dokümanlarına uyumunu doğrulamak.',
    kapsam: 'Üretim planlama, operasyon talimatları, ilk ürün kontrolü ve sevkiyat kontrolleri.',
    yontem: 'Doküman incelemesi, saha gözlemi, kayıt örneklemesi ve görüşme.',
    bas_denetci_id: String(denetciId),
    ...ek,
  };
}

test.before(async () => {
  ortam = testOrtami();
  uretimId = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Üretim').id;
  bakimId = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Bakım').id;
  satinAlmaId = db().prepare('SELECT id FROM departmanlar WHERE ad = ?').get('Satın Alma').id;
  isoChecklistId = db()
    .prepare('SELECT id FROM ic_tetkik_checklistleri WHERE kod = ?')
    .get('CL-ISO-001').id;

  denetciId = kullaniciOlustur(db(), {
    ad: 'Atanmış Denetçi',
    email: 'denetci@ornek.com',
    sifre: 'Denetci123!',
    rol: 'kullanici',
    departmanId: bakimId,
  });
  gozlemciId = kullaniciOlustur(db(), {
    ad: 'Atanmış Gözlemci',
    email: 'gozlemci@ornek.com',
    sifre: 'Gozlemci123!',
    rol: 'kullanici',
    departmanId: bakimId,
  });
  uretimPersonelId = kullaniciOlustur(db(), {
    ad: 'Üretim Personeli',
    email: 'uretim@ornek.com',
    sifre: 'Uretim123!',
    rol: 'kullanici',
    departmanId: uretimId,
  });
  yabancıId = kullaniciOlustur(db(), {
    ad: 'İlgisiz Personel',
    email: 'yabanci@ornek.com',
    sifre: 'Standart123!',
    rol: 'kullanici',
    departmanId: satinAlmaId,
  });

  sunucu = await sunucuBaslat(ortam.app);
});

test.after(async () => {
  await sunucu.kapat();
  await ortam.kapat();
});

test('Faz 5 şeması, varsayılan checklistler ve aktivite logu hazırdır', () => {
  const tablolar = db()
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'ic_tetkikler', 'ic_tetkik_checklistleri', 'ic_tetkik_checklist_maddeleri',
        'ic_tetkik_denetcileri', 'ic_tetkik_maddeleri', 'ic_tetkik_bulgulari',
        'aktivite_loglari'
      )`
    )
    .all()
    .map((satir) => satir.name)
    .sort();
  assert.equal(tablolar.length, 7);
  assert.ok(tablolar.includes('ic_tetkikler'));
  assert.ok(tablolar.includes('aktivite_loglari'));

  const kolonlar = db().prepare('PRAGMA table_info(ic_tetkikler)').all().map((satir) => satir.name);
  for (const kolon of [
    'kod',
    'yil',
    'checklist_id',
    'departman_id',
    'planlanan_tarih',
    'durum',
    'tamamlayan_id',
  ]) {
    assert.ok(kolonlar.includes(kolon), `${kolon} sütunu bulunmalı`);
  }

  const bulguKolonlari = db()
    .prepare('PRAGMA table_info(ic_tetkik_bulgulari)')
    .all()
    .map((satir) => satir.name);
  assert.ok(bulguKolonlari.includes('dof_id'));

  assert.equal(db().prepare('PRAGMA user_version').get().user_version, 6);
  const checklistler = db()
    .prepare('SELECT kod, standart FROM ic_tetkik_checklistleri ORDER BY kod')
    .all();
  assert.deepEqual(
    checklistler.map((satir) => ({ kod: satir.kod, standart: satir.standart })),
    [
      { kod: 'CL-ISO-001', standart: 'iso_9001' },
      { kod: 'CL-KI-001', standart: 'kurum_ici' },
    ]
  );
});

test('İç tetkik liste, takvim, checklist ve menü sayfaları erişilebilir', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const liste = await sayfaAl(sunucu.base, '/tetkik');
  assert.equal(liste.durum, 200);
  assert.match(liste.metin, /İç Tetkik Yönetimi/);
  assert.match(liste.metin, /İç Tetkik Planı/);
  assert.match(liste.metin, /href="\/tetkik\/takvim\?/);
  assert.match(liste.metin, /href="\/tetkik\/checklistler"/);

  const takvim = await sayfaAl(sunucu.base, `/tetkik/takvim?yil=${YIL}`);
  assert.equal(takvim.durum, 200);
  assert.match(takvim.metin, /İç Tetkik Takvimi/);

  const checklist = await sayfaAl(sunucu.base, '/tetkik/checklistler');
  assert.equal(checklist.durum, 200);
  assert.match(checklist.metin, /ISO 9001/);
  assert.match(checklist.metin, /Kurum İçi/);
});

test('standart kullanıcı plan ve checklist oluşturamaz', async () => {
  await giris('yabanci@ornek.com', 'Standart123!');
  const yeni = await sayfaAl(sunucu.base, '/tetkik/yeni');
  assert.equal(yeni.durum, 403);

  const once = db().prepare('SELECT COUNT(*) AS sayi FROM ic_tetkikler').get().sayi;
  const plan = await formPost(sunucu.base, '/tetkik/yeni', planFormu());
  assert.equal(plan.durum, 403);
  assert.equal(db().prepare('SELECT COUNT(*) AS sayi FROM ic_tetkikler').get().sayi, once);

  const checklist = await formPost(sunucu.base, '/tetkik/checklistler', {
    ad: 'Yetkisiz Checklist',
    standart: 'kurum_ici',
    madde_satirlari: 'Test maddesi | Bu madde yeterli uzunlukta bir kriter içerir. | Test | 1',
  });
  assert.equal(checklist.durum, 403);
});

test('yıllık plan oluşturulur; denetçi atanır ve checklist maddeleri snapshotlanır', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const yanit = await formPost(sunucu.base, '/tetkik/yeni', planFormu());
  assert.equal(yanit.durum, 303);
  tetkikId = yolKimlik(yanit.konum, /\/tetkik\/(\d+)/);
  assert.ok(tetkikId);

  const kayit = db().prepare('SELECT * FROM ic_tetkikler WHERE id = ?').get(tetkikId);
  tetkikKod = kayit.kod;
  assert.equal(kayit.kod, `IT-${YIL}-001`);
  assert.equal(kayit.yil, YIL);
  assert.equal(kayit.durum, 'planlandi');
  assert.equal(kayit.departman_id, uretimId);
  assert.equal(kayit.checklist_id, isoChecklistId);

  const denetci = db()
    .prepare('SELECT * FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND kullanici_id = ?')
    .get(tetkikId, denetciId);
  assert.equal(denetci.gorev, 'bas_denetci');
  assert.equal(denetci.durum, 'atanmis');

  assert.equal(
    db().prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_maddeleri WHERE tetkik_id = ?').get(tetkikId).sayi,
    10
  );
  const log = db()
    .prepare("SELECT COUNT(*) AS sayi FROM aktivite_loglari WHERE modul = 'tetkik' AND kayit_id = ?")
    .get(tetkikId).sayi;
  assert.ok(log >= 1, 'plan aktivite logu yazılmalı');
});

test('gözlemci kaydı görebilir fakat denetimi başlatamaz, madde veya bulgu değiştiremez', async () => {
  db()
    .prepare(
      `INSERT INTO ic_tetkik_denetcileri
        (tetkik_id, kullanici_id, gorev, durum, atama_tarihi)
       VALUES (?, ?, 'gozlemci', 'atanmis', ?)`
    )
    .run(tetkikId, gozlemciId, new Date().toISOString());

  await giris('gozlemci@ornek.com', 'Gozlemci123!');
  const detay = await sayfaAl(sunucu.base, `/tetkik/${tetkikId}`);
  assert.equal(detay.durum, 200);
  assert.doesNotMatch(detay.metin, new RegExp(`action="/tetkik/${tetkikId}/maddeler/`));
  assert.doesNotMatch(detay.metin, new RegExp(`action="/tetkik/${tetkikId}/bulgular"`));

  const baslat = await formPost(sunucu.base, `/tetkik/${tetkikId}/durum`, {
    durum: 'devam_ediyor',
  });
  assert.equal(baslat.durum, 403);
  assert.equal(
    db().prepare('SELECT durum FROM ic_tetkikler WHERE id = ?').get(tetkikId).durum,
    'planlandi'
  );

  const madde = db()
    .prepare('SELECT * FROM ic_tetkik_maddeleri WHERE tetkik_id = ? ORDER BY sira LIMIT 1')
    .get(tetkikId);
  const degerlendir = await formPost(
    sunucu.base,
    `/tetkik/${tetkikId}/maddeler/${madde.id}`,
    { sonuc: 'uygun', puan: '100' }
  );
  assert.equal(degerlendir.durum, 403);
  assert.equal(
    db().prepare('SELECT sonuc FROM ic_tetkik_maddeleri WHERE id = ?').get(madde.id).sonuc,
    null
  );

  const bulgu = await formPost(sunucu.base, `/tetkik/${tetkikId}/bulgular`, {
    baslik: 'Gözlemci bulgu kaydı',
    tanim: 'Gözlemci tarafından oluşturulan bu bulgu kaydedilmemelidir.',
    sonuc: 'gozlem',
    departman_id: String(uretimId),
    sorumlu_id: String(gozlemciId),
    tespit_tarihi: `${YIL}-05-18`,
  });
  assert.equal(bulgu.durum, 403);
  assert.equal(
    db().prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_bulgulari WHERE tetkik_id = ?').get(tetkikId).sayi,
    0
  );
});

test('plan künyesi güncellenir ve baş denetçi ataması korunur', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const yanit = await formPost(sunucu.base, `/tetkik/${tetkikId}`, planFormu({
    baslik: `${YIL} Üretim Süreçleri İç Tetkik Planı (Güncel)`,
    kapsam: 'Güncellenmiş üretim süreçleri denetim kapsamı.',
  }));
  assert.equal(yanit.durum, 303);
  assert.match(String(yanit.konum), /ok=/);

  const kayit = db().prepare('SELECT * FROM ic_tetkikler WHERE id = ?').get(tetkikId);
  assert.match(kayit.baslik, /Güncel/);
  const planLoglari = db()
    .prepare(
      "SELECT * FROM aktivite_loglari WHERE modul = 'tetkik' AND islem = 'plan_guncelle' AND kayit_id = ?"
    )
    .all(tetkikId);
  const baslikLogu = planLoglari.find((log) => log.aciklama.includes('başlığı'));
  assert.ok(baslikLogu);
  assert.match(baslikLogu.eski_deger, /Üretim Süreçleri İç Tetkik Planı$/);
  assert.match(baslikLogu.yeni_deger, /Güncel/);
  const kapsamLogu = planLoglari.find((log) => log.aciklama.includes('kapsamı'));
  assert.ok(kapsamLogu);
  assert.match(kapsamLogu.yeni_deger, /Güncellenmiş üretim süreçleri/);
  const basDenetci = db()
    .prepare("SELECT * FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND gorev = 'bas_denetci'")
    .get(tetkikId);
  assert.equal(basDenetci.kullanici_id, denetciId);

  const yilDegisikligi = await formPost(sunucu.base, `/tetkik/${tetkikId}`, planFormu({
    yil: String(YIL + 1),
    planlanan_tarihi: `${YIL + 1}-05-15`,
  }));
  assert.equal(yilDegisikligi.durum, 303);
  assert.match(String(yilDegisikligi.konum), /hata=/);
  const degismemisKayit = db().prepare('SELECT * FROM ic_tetkikler WHERE id = ?').get(tetkikId);
  assert.equal(degismemisKayit.kod, `IT-${YIL}-001`);
  assert.equal(degismemisKayit.yil, YIL);
  assert.equal(degismemisKayit.planlanan_tarih, `${YIL}-05-15`);
});

test('atanmış denetçi kaydı görür ve tetkiki başlatabilir', async () => {
  await giris('denetci@ornek.com', 'Denetci123!');
  const detay = await sayfaAl(sunucu.base, `/tetkik/${tetkikId}`);
  assert.equal(detay.durum, 200);
  assert.match(detay.metin, new RegExp(tetkikKod));
  assert.match(detay.metin, /Kontrol Listesi ve Madde Değerlendirmeleri/);

  const baslat = await formPost(sunucu.base, `/tetkik/${tetkikId}/durum`, {
    durum: 'devam_ediyor',
  });
  assert.equal(baslat.durum, 303);
  assert.equal(db().prepare('SELECT durum FROM ic_tetkikler WHERE id = ?').get(tetkikId).durum, 'devam_ediyor');
});

test('dört sonuç sınıfıyla madde bazlı puanlama yapılır', async () => {
  await giris('denetci@ornek.com', 'Denetci123!');
  const maddeler = db()
    .prepare('SELECT * FROM ic_tetkik_maddeleri WHERE tetkik_id = ? ORDER BY sira')
    .all(tetkikId);

  for (const madde of maddeler) {
    const major = Number(madde.sira) === 8;
    const yanit = await formPost(sunucu.base, `/tetkik/${tetkikId}/maddeler/${madde.id}`, {
      sonuc: major ? 'major' : 'uygun',
      puan: major ? '0' : '100',
      bulgu_aciklama: major ? 'Uygunsuzluk için açıklama girildi.' : '',
      kanit: 'Test kanıtı',
    });
    assert.equal(yanit.durum, 303, `${madde.sira}. madde kaydedilmeli`);
  }

  const degerlendirilen = db()
    .prepare('SELECT sonuc, puan FROM ic_tetkik_maddeleri WHERE tetkik_id = ?')
    .all(tetkikId);
  assert.equal(degerlendirilen.filter((madde) => madde.sonuc === 'uygun').length, 9);
  assert.equal(degerlendirilen.filter((madde) => madde.sonuc === 'major').length, 1);

  const gecersiz = await formPost(sunucu.base, `/tetkik/${tetkikId}/maddeler/${maddeler[0].id}`, {
    sonuc: 'gecersiz',
  });
  assert.equal(gecersiz.durum, 303);
  assert.match(String(gecersiz.konum), /hata=/);
});

test('bulgu kaydedilir ve tek tıkla DÖF kaydına referanslarla aktarılır', async () => {
  await giris('denetci@ornek.com', 'Denetci123!');
  majorMaddeId = db()
    .prepare('SELECT id FROM ic_tetkik_maddeleri WHERE tetkik_id = ? AND sira = 8')
    .get(tetkikId).id;

  const gozlemYanit = await formPost(sunucu.base, `/tetkik/${tetkikId}/bulgular`, {
    baslik: 'Majör maddeye bağlanan gözlem',
    tanim: 'Bu gözlem majör uygunsuzluk sınıfındaki madde için eşleşen bulgu yerine geçmemelidir.',
    sonuc: 'gozlem',
    departman_id: String(uretimId),
    sorumlu_id: String(denetciId),
    tespit_tarihi: `${YIL}-05-18`,
    madde_id: String(majorMaddeId),
  });
  assert.equal(gozlemYanit.durum, 303);
  const gozlem = db()
    .prepare('SELECT * FROM ic_tetkik_bulgulari WHERE tetkik_id = ? ORDER BY id DESC LIMIT 1')
    .get(tetkikId);
  assert.match(gozlem.kod, new RegExp(`^BUL-${YIL}-001$`));
  assert.equal(gozlem.dof_id, null);

  await giris('admin@qdms.local', 'Admin123!');
  const uyumsuzTamamla = await formPost(sunucu.base, `/tetkik/${tetkikId}/durum`, {
    durum: 'tamamlandi',
  });
  assert.equal(uyumsuzTamamla.durum, 303);
  assert.match(String(uyumsuzTamamla.konum), /hata=/);
  assert.equal(
    db().prepare('SELECT durum FROM ic_tetkikler WHERE id = ?').get(tetkikId).durum,
    'devam_ediyor'
  );

  await giris('denetci@ornek.com', 'Denetci123!');
  const bulguYanit = await formPost(sunucu.base, `/tetkik/${tetkikId}/bulgular`, {
    baslik: 'Düzeltici faaliyet kaydı bulunamadı',
    tanim: 'İncelenen uygunsuzluk için kayıt ve sorumluluk ataması bulunmamaktadır.',
    sonuc: 'major',
    departman_id: String(uretimId),
    sorumlu_id: String(denetciId),
    tespit_tarihi: `${YIL + 1}-01-15`,
    madde_id: String(majorMaddeId),
  });
  assert.equal(bulguYanit.durum, 303);

  const bulgu = db()
    .prepare('SELECT * FROM ic_tetkik_bulgulari WHERE tetkik_id = ? ORDER BY id DESC LIMIT 1')
    .get(tetkikId);
  bulguId = bulgu.id;
  bulguKod = bulgu.kod;
  assert.match(bulguKod, new RegExp(`^BUL-${YIL}-002$`));
  assert.equal(bulgu.durum, 'acik');
  assert.equal(bulgu.dof_id, null);

  await giris('admin@qdms.local', 'Admin123!');
  const dofYanit = await formPost(
    sunucu.base,
    `/tetkik/${tetkikId}/bulgular/${bulguId}/dof`,
    {}
  );
  assert.equal(dofYanit.durum, 303);

  const bagliBulgu = db().prepare('SELECT * FROM ic_tetkik_bulgulari WHERE id = ?').get(bulguId);
  assert.ok(bagliBulgu.dof_id);
  assert.equal(bagliBulgu.durum, 'dof_acildi');

  const dofKaydi = db().prepare('SELECT * FROM dof_kayitlari WHERE id = ?').get(bagliBulgu.dof_id);
  dofKod = dofKaydi.kod;
  assert.equal(dofKaydi.kod, `DOF-${YIL + 1}-001`);
  assert.equal(dofKaydi.tespit_tarihi, `${YIL + 1}-01-15`);
  assert.equal(dofKaydi.kaynak, 'ic_tetkik');
  assert.equal(dofKaydi.departman_id, uretimId);
  assert.match(dofKaydi.uygunsuzluk_tanimi, new RegExp(`${tetkikKod}`));
  assert.match(dofKaydi.uygunsuzluk_tanimi, new RegExp(bulguKod));

  const dofBildirimi = db()
    .prepare(
      `SELECT * FROM bildirimler
       WHERE kullanici_id = ? AND baslik LIKE 'Yeni DÖF açıldı:%'
       ORDER BY id DESC LIMIT 1`
    )
    .get(uretimPersonelId);
  assert.ok(dofBildirimi);
  assert.equal(dofBildirimi.baglanti, `/dof/${bagliBulgu.dof_id}`);

  db()
    .prepare(
      `INSERT INTO dof_aksiyonlari
        (dof_id, sira, aciklama, sorumlu_id, hedef_tarih, durum, tamamlanma_tarihi)
       VALUES (?, 1, ?, ?, ?, 'tamamlandi', ?)`
    )
    .run(
      bagliBulgu.dof_id,
      'Düzeltici faaliyetin uygulanması ve doğrulanması.',
      denetciId,
      `${YIL + 1}-02-01`,
      new Date().toISOString()
    );
  db()
    .prepare("UPDATE dof_kayitlari SET durum = 'etkinlik_bekliyor' WHERE id = ?")
    .run(bagliBulgu.dof_id);
  const dofKapat = await formPost(sunucu.base, `/dof/${bagliBulgu.dof_id}/kapat`, {
    etkinlik_degerlendirmesi: 'Düzeltici faaliyetin etkinliği doğrulandı ve sürdürülebilirliği teyit edildi.',
  });
  assert.equal(dofKapat.durum, 303);
  assert.match(String(dofKapat.konum), /ok=/);
  assert.equal(
    db().prepare('SELECT durum FROM ic_tetkik_bulgulari WHERE id = ?').get(bulguId).durum,
    'kapandi'
  );

  const ikinci = await formPost(
    sunucu.base,
    `/tetkik/${tetkikId}/bulgular/${bulguId}/dof`,
    {}
  );
  assert.equal(ikinci.durum, 303);
  assert.equal(
    db().prepare('SELECT COUNT(*) AS sayi FROM dof_kayitlari').get().sayi,
    1,
    'çift tıklama ikinci DÖF oluşturmamalı'
  );

  const dofDetay = await sayfaAl(sunucu.base, `/dof/${bagliBulgu.dof_id}`);
  assert.equal(dofDetay.durum, 200);
  assert.match(dofDetay.metin, new RegExp(tetkikKod));
  assert.match(dofDetay.metin, new RegExp(bulguKod));
  assert.match(dofDetay.metin, new RegExp(`href="/tetkik/${tetkikId}`));
});

test('tüm değerlendirmeler ve DÖF bağlantısı tamamlanınca tetkik tamamlanır', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const yanit = await formPost(sunucu.base, `/tetkik/${tetkikId}/durum`, {
    durum: 'tamamlandi',
  });
  assert.equal(yanit.durum, 303);
  assert.match(String(yanit.konum), /ok=/);

  const kayit = db().prepare('SELECT * FROM ic_tetkikler WHERE id = ?').get(tetkikId);
  assert.equal(kayit.durum, 'tamamlandi');
  assert.ok(kayit.bitis_tarihi);
  assert.ok(kayit.tamamlayan_id);
});

test('kurumsal logolu iç tetkik PDF raporu üretilir', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const logoKok = path.join(ortam.dir, 'yuklemeler', 'logo');
  fs.mkdirSync(logoKok, { recursive: true });
  fs.writeFileSync(
    path.join(logoKok, 'tetkik-test-logo.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
  );
  db()
    .prepare(
      `INSERT INTO ayarlar (anahtar, deger) VALUES ('sirket_logo', ?)
       ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger`
    )
    .run('tetkik-test-logo.png');

  try {
    const pdf = await ikiliAl(`/tetkik/${tetkikId}/pdf`);
    assert.equal(pdf.durum, 200);
    assert.match(String(pdf.icerikTuru), /application\/pdf/);
    assert.equal(pdf.tampon.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdf.tampon.length > 3000);
    assert.ok(
      pdf.tampon.includes(Buffer.from('/Subtype /Image')),
      'şirket logosu PDF içine görsel nesnesi olarak gömülmeli'
    );

    const indir = await ikiliAl(`/tetkik/${tetkikId}/pdf?indir=1`);
    assert.equal(indir.durum, 200);
    assert.match(String(indir.duzen), /attachment/);
  } finally {
    db().prepare("DELETE FROM ayarlar WHERE anahtar = 'sirket_logo'").run();
  }
});

test('kayıt görünürlüğü departman ve denetçi atamasıyla korunur', async () => {
  await giris('yabanci@ornek.com', 'Standart123!');
  const detay = await sayfaAl(sunucu.base, `/tetkik/${tetkikId}`);
  assert.equal(detay.durum, 404);
  const liste = await sayfaAl(sunucu.base, '/tetkik');
  assert.equal(liste.durum, 200);
  assert.doesNotMatch(liste.metin, new RegExp(`href="/tetkik/${tetkikId}"`));

  const pdf = await ikiliAl(`/tetkik/${tetkikId}/pdf`);
  assert.equal(pdf.durum, 404);
});

test('kurum içi yeni kontrol listesi oluşturulabilir', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const yanit = await formPost(sunucu.base, '/tetkik/checklistler', {
    ad: 'Satın Alma Süreçleri Kontrol Listesi',
    standart: 'kurum_ici',
    aciklama: 'Satın alma ve tedarikçi süreçlerinin örnek kontrol listesi.',
    madde_satirlari:
      'Tedarikçi onayı | Kritik tedarikçiler onaylı listede ve performans değerlendirmesi yapılmış mı? | Test | 3\nSipariş kontrolü | Sipariş, teslim ve kabul kayıtları izlenebilir mi? | Test | 2',
  });
  assert.equal(yanit.durum, 303);

  const checklist = db()
    .prepare("SELECT * FROM ic_tetkik_checklistleri WHERE ad = 'Satın Alma Süreçleri Kontrol Listesi'")
    .get();
  assert.ok(checklist);
  assert.equal(checklist.standart, 'kurum_ici');
  assert.equal(
    db().prepare('SELECT COUNT(*) AS sayi FROM ic_tetkik_checklist_maddeleri WHERE checklist_id = ?').get(checklist.id).sayi,
    2
  );
});

test('geçmiş denetim departmanı silinemez ve görünmez yıllar yıl filtresinde açığa çıkmaz', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const adminId = db().prepare('SELECT id FROM kullanicilar WHERE email = ?').get('admin@qdms.local').id;
  const departmanSonuc = db()
    .prepare('INSERT INTO departmanlar (ad, aciklama) VALUES (?, ?)')
    .run('Geçmiş Denetim Departmanı', 'Silme koruması testi');
  const departman = { id: Number(departmanSonuc.lastInsertRowid) };
  const simdi = new Date().toISOString();
  const gizliAuditSonuc = db()
    .prepare(
      `INSERT INTO ic_tetkikler
        (kod, yil, checklist_id, baslik, amac, kapsam, yontem, departman_id,
         planlanan_tarih, durum, olusturan_id, olusturma_tarihi, guncelleme_tarihi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planlandi', ?, ?, ?)`
    )
    .run(
      `IT-${YIL + 1}-999`,
      YIL + 1,
      isoChecklistId,
      `${YIL + 1} Gizli Denetim Planı`,
      'Gizli yıl görünürlük testi.',
      'Kapsam testi.',
      'Yöntem testi.',
      departman.id,
      `${YIL + 1}-05-15`,
      adminId,
      simdi,
      simdi
    );
  const gizliAudit = { id: Number(gizliAuditSonuc.lastInsertRowid) };

  const silme = await formPost(
    sunucu.base,
    `/organizasyon/departmanlar/${departman.id}/sil`,
    {}
  );
  assert.equal(silme.durum, 303);
  assert.match(String(silme.konum), /hata=/);
  assert.ok(db().prepare('SELECT id FROM departmanlar WHERE id = ?').get(departman.id));
  assert.equal(
    db().prepare('SELECT departman_id FROM ic_tetkikler WHERE id = ?').get(gizliAudit.id).departman_id,
    departman.id
  );

  await giris('yabanci@ornek.com', 'Standart123!');
  const liste = await sayfaAl(sunucu.base, '/tetkik');
  assert.equal(liste.durum, 200);
  assert.doesNotMatch(liste.metin, new RegExp(`<option value="${YIL + 1}"`));
});

test('azami geçerli içerik PDF hücrelerini satır içinde sınırlar ve kısaltma işareti gösterir', async () => {
  const originalText = PDFDocument.prototype.text;
  let implikSayfaEklemeleri = 0;
  let kisaltmaIsareti = '';
  PDFDocument.prototype.text = function (...args) {
    const oncekiSayfa = this.bufferedPageRange().count;
    const secenekler = args[3] && typeof args[3] === 'object' ? args[3] : {};
    if (secenekler.ellipsis) kisaltmaIsareti = String(secenekler.ellipsis);
    const sonuc = originalText.apply(this, args);
    const sonrakiSayfa = this.bufferedPageRange().count;
    if (sonrakiSayfa > oncekiSayfa) implikSayfaEklemeleri += 1;
    return sonuc;
  };

  let pdf;
  try {
    pdf = await tetkikPdfUret({
      tetkik: {
        kod: `IT-${YIL}-999`,
        yil: YIL,
        durum: 'tamamlandi',
        baslik: 'Azami Uzunlukta İç Tetkik Planı',
        amac: 'A'.repeat(2000),
        kapsam: 'S'.repeat(5000),
        yontem: 'Y'.repeat(2000),
        departman_ad: 'Üretim',
        planlanan_tarih: `${YIL}-01-01`,
        baslangic_tarihi: `${YIL}-01-02`,
        bitis_tarihi: `${YIL}-01-03`,
      },
      maddeler: [
        {
          sira: '1',
          baslik: 'B'.repeat(240),
          kriter: 'K'.repeat(1500),
          referans: 'R'.repeat(120),
          agirlik: 10,
          sonuc: 'major',
          puan: 0,
          bulgu_aciklama: 'D'.repeat(3000),
          kanit: 'E'.repeat(2000),
        },
      ],
      bulgular: [
        {
          kod: 'BUL-999',
          baslik: 'F'.repeat(240),
          tanim: 'T'.repeat(5000),
          sonuc: 'major',
          sorumlu_ad: 'Sorumlu',
          departman_ad: 'Üretim',
          dof_kodu: 'DOF-999',
        },
      ],
      sirket: { ad: 'Örnek Sanayi A.Ş.' },
      bugun: `${YIL}-12-31`,
      denetleyenAd: 'Baş Denetçi',
      tamamlayanAd: 'Tamamlayan',
    });
  } finally {
    PDFDocument.prototype.text = originalText;
  }

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 5000);
  assert.equal(implikSayfaEklemeleri, 0, 'PDF hücresi içinde sayfa eklenmemeli');
  assert.match(kisaltmaIsareti, /kısaltıldı|kisaltildi/i);
});
