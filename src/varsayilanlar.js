'use strict';

const { TUR_KODLARI, DOKUMAN_TURLERI, varsayilanSablonlar } = require('./qdms');
const { varsayilanAdminOlustur } = require('./auth');

const VARSAYILAN_DEPARTMANLAR = Object.freeze([
  { ad: 'Üretim', aciklama: 'Üretim hattı, montaj ve saha ekipleri.' },
  { ad: 'Kalite Güvence', aciklama: 'Kalite yönetim sistemi, denetim ve dokümantasyon.' },
  { ad: 'İnsan Kaynakları', aciklama: 'İşe alım, eğitim ve personel süreçleri.' },
  { ad: 'Bakım', aciklama: 'Makine, ekipman ve tesis bakım süreçleri.' },
  { ad: 'Satın Alma', aciklama: 'Tedarikçi, satın alma ve depo süreçleri.' },
]);

/**
 * İlk kurulumda gerekli varsayılan kayıtları oluşturur.
 * Var olan kullanıcı/taslak kayıtlarının üzerine yazmaz.
 */
function varsayilanVerileriYukle(db) {
  const simdi = new Date().toISOString();
  const turEkle = db.prepare(
    `INSERT INTO dokuman_turleri (kod, ad, sira)
     VALUES (?, ?, ?)
     ON CONFLICT (kod) DO UPDATE SET ad = excluded.ad, sira = excluded.sira`
  );
  TUR_KODLARI.forEach((kod, sira) => {
    turEkle.run(kod, DOKUMAN_TURLERI[kod].ad, sira);
  });

  const departmanEkle = db.prepare(
    `INSERT OR IGNORE INTO departmanlar (ad, aciklama)
     VALUES (?, ?)`
  );
  for (const departman of VARSAYILAN_DEPARTMANLAR) {
    departmanEkle.run(departman.ad, departman.aciklama);
  }
  const digerDepartman = db
    .prepare('SELECT id FROM departmanlar WHERE ad = ? COLLATE NOCASE')
    .get('Kalite Güvence');

  const sablonEkle = db.prepare(
    `INSERT INTO sablonlar
      (tur_kod, baslik, bolumler, antet_renk, kenarlik_stili, altbilgi_hazirlayan, altbilgi_onaylayan, guncelleme_tarihi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tur_kod) DO NOTHING`
  );
  for (const sablon of varsayilanSablonlar()) {
    sablonEkle.run(
      sablon.turKod,
      sablon.baslik,
      JSON.stringify(sablon.bolumler, null, 2),
      sablon.antetRenk,
      sablon.kenarlikStili,
      sablon.altbilgiHazirlayan,
      sablon.altbilgiOnaylayan,
      simdi
    );
  }

  const yeniAdmin = varsayilanAdminOlustur(db);
  if (yeniAdmin && digerDepartman) {
    db.prepare('UPDATE kullanicilar SET departman_id = ? WHERE departman_id IS NULL AND rol = ?').run(
      digerDepartman.id,
      'admin'
    );
  }
  return { yeniAdmin };
}

module.exports = { varsayilanVerileriYukle, VARSAYILAN_DEPARTMANLAR };
