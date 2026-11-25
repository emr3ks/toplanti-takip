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

let ortam;
let sunucu;

let uretimId;
let bakimId;
let satinAlmaId;
let denetciId;
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

test('plan künyesi güncellenir ve baş denetçi ataması korunur', async () => {
  await giris('admin@qdms.local', 'Admin123!');
  const yanit = await formPost(sunucu.base, `/tetkik/${tetkikId}`, planFormu({
    baslik: `${YIL} Üretim Süreçleri İç Tetkik Planı (Güncel)`,
  }));
  assert.equal(yanit.durum, 303);
  assert.match(String(yanit.konum), /ok=/);

  const kayit = db().prepare('SELECT * FROM ic_tetkikler WHERE id = ?').get(tetkikId);
  assert.match(kayit.baslik, /Güncel/);
  const basDenetci = db()
    .prepare("SELECT * FROM ic_tetkik_denetcileri WHERE tetkik_id = ? AND gorev = 'bas_denetci'")
    .get(tetkikId);
  assert.equal(basDenetci.kullanici_id, denetciId);
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
  const bulguYanit = await formPost(sunucu.base, `/tetkik/${tetkikId}/bulgular`, {
    baslik: 'Düzeltici faaliyet kaydı bulunamadı',
    tanim: 'İncelenen uygunsuzluk için kayıt ve sorumluluk ataması bulunmamaktadır.',
    sonuc: 'major',
    departman_id: String(uretimId),
    sorumlu_id: String(denetciId),
    tespit_tarihi: `${YIL}-05-18`,
    madde_id: String(majorMaddeId),
  });
  assert.equal(bulguYanit.durum, 303);

  const bulgu = db()
    .prepare('SELECT * FROM ic_tetkik_bulgulari WHERE tetkik_id = ? ORDER BY id DESC LIMIT 1')
    .get(tetkikId);
  bulguId = bulgu.id;
  bulguKod = bulgu.kod;
  assert.match(bulguKod, new RegExp(`^BUL-${YIL}-001$`));
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
  assert.equal(dofKaydi.kaynak, 'ic_tetkik');
  assert.equal(dofKaydi.departman_id, uretimId);
  assert.match(dofKaydi.uygunsuzluk_tanimi, new RegExp(`${tetkikKod}`));
  assert.match(dofKaydi.uygunsuzluk_tanimi, new RegExp(bulguKod));

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
