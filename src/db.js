'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { varsayilanVerileriYukle } = require('./varsayilanlar');

const SEMA = `
CREATE TABLE IF NOT EXISTS ayarlar (
  anahtar TEXT PRIMARY KEY,
  deger TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS email_kayitlari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tur TEXT NOT NULL,
  alici TEXT NOT NULL,
  konu TEXT NOT NULL,
  durum TEXT NOT NULL,
  hata TEXT,
  icerik TEXT NOT NULL DEFAULT '',
  dosya TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_kayitlari_tarih ON email_kayitlari (olusturma_tarihi);

-- ---------------------------------------------------------------------------
-- Kalite Yönetim Sistemi (QDMS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departmanlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL COLLATE NOCASE,
  aciklama TEXT NOT NULL DEFAULT '',
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_departmanlar_ad ON departmanlar (ad COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS kullanicilar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  sifre_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'kullanici'
    CHECK (rol IN ('admin', 'kalite', 'hazirlayan', 'onaylayan', 'kullanici')),
  departman_id INTEGER REFERENCES departmanlar (id) ON DELETE SET NULL,
  aktif INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kullanicilar_email ON kullanicilar (email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_kullanicilar_departman ON kullanicilar (departman_id);

CREATE TABLE IF NOT EXISTS oturumlar (
  token TEXT PRIMARY KEY,
  kullanici_id INTEGER NOT NULL REFERENCES kullanicilar (id) ON DELETE CASCADE,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  son_gecerlilik TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oturumlar_kullanici ON oturumlar (kullanici_id);

CREATE TABLE IF NOT EXISTS dokuman_turleri (
  kod TEXT PRIMARY KEY,
  ad TEXT NOT NULL,
  sira INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sablonlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tur_kod TEXT NOT NULL UNIQUE REFERENCES dokuman_turleri (kod),
  baslik TEXT NOT NULL,
  bolumler TEXT NOT NULL DEFAULT '[]',
  antet_renk TEXT NOT NULL DEFAULT '#1e3a8a',
  kenarlik_stili TEXT NOT NULL DEFAULT 'duz' CHECK (kenarlik_stili IN ('duz', 'kesikli', 'cift')),
  logo_yolu TEXT,
  altbilgi_hazirlayan TEXT NOT NULL DEFAULT 'Hazırlayan',
  altbilgi_onaylayan TEXT NOT NULL DEFAULT 'Onaylayan',
  guncelleme_tarihi TEXT,
  guncelleyen_id INTEGER REFERENCES kullanicilar (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dokumanlar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kod TEXT NOT NULL,
  tur_kod TEXT NOT NULL REFERENCES dokuman_turleri (kod),
  baslik TEXT NOT NULL,
  aciklama TEXT NOT NULL DEFAULT '',
  revizyon INTEGER NOT NULL DEFAULT 0,
  durum TEXT NOT NULL DEFAULT 'taslak'
    CHECK (durum IN ('taslak', 'kontrol', 'yayinda', 'iptal')),
  icerik TEXT NOT NULL DEFAULT '[]',
  degisiklik_notu TEXT NOT NULL DEFAULT '',
  hazirlayan_id INTEGER REFERENCES kullanicilar (id) ON DELETE SET NULL,
  onaylayan_id INTEGER REFERENCES kullanicilar (id) ON DELETE SET NULL,
  onay_tarihi TEXT,
  yayin_tarihi TEXT,
  dosya_yolu TEXT,
  dosya_adi TEXT,
  dosya_turu TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  guncelleme_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kod, revizyon)
);
CREATE INDEX IF NOT EXISTS idx_dokumanlar_tur ON dokumanlar (tur_kod);
CREATE INDEX IF NOT EXISTS idx_dokumanlar_durum ON dokumanlar (durum);
CREATE INDEX IF NOT EXISTS idx_dokumanlar_kod ON dokumanlar (kod);

CREATE TABLE IF NOT EXISTS dokuman_hedef_departmanlar (
  dokuman_id INTEGER NOT NULL REFERENCES dokumanlar (id) ON DELETE CASCADE,
  departman_id INTEGER NOT NULL REFERENCES departmanlar (id) ON DELETE CASCADE,
  PRIMARY KEY (dokuman_id, departman_id)
);

CREATE TABLE IF NOT EXISTS dokuman_okumalari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dokuman_id INTEGER NOT NULL REFERENCES dokumanlar (id) ON DELETE CASCADE,
  kullanici_id INTEGER NOT NULL REFERENCES kullanicilar (id) ON DELETE CASCADE,
  okundu INTEGER NOT NULL DEFAULT 0 CHECK (okundu IN (0, 1)),
  okunma_tarihi TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (dokuman_id, kullanici_id)
);
CREATE INDEX IF NOT EXISTS idx_dokuman_okumalari_kullanici ON dokuman_okumalari (kullanici_id);

CREATE TABLE IF NOT EXISTS dokuman_onaylari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dokuman_id INTEGER NOT NULL REFERENCES dokumanlar (id) ON DELETE CASCADE,
  kullanici_id INTEGER REFERENCES kullanicilar (id) ON DELETE SET NULL,
  islem TEXT NOT NULL,
  not_metni TEXT NOT NULL DEFAULT '',
  tarih TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_dokuman_onaylari_dokuman ON dokuman_onaylari (dokuman_id);

CREATE TABLE IF NOT EXISTS bildirimler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kullanici_id INTEGER NOT NULL REFERENCES kullanicilar (id) ON DELETE CASCADE,
  tur TEXT NOT NULL,
  baslik TEXT NOT NULL,
  mesaj TEXT NOT NULL DEFAULT '',
  baglanti TEXT,
  dokuman_id INTEGER REFERENCES dokumanlar (id) ON DELETE CASCADE,
  okundu INTEGER NOT NULL DEFAULT 0 CHECK (okundu IN (0, 1)),
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_bildirimler_kullanici ON bildirimler (kullanici_id, okundu);

-- ---------------------------------------------------------------------------
-- Eğitim Yönetimi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS egitimler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  tur TEXT NOT NULL DEFAULT 'ic' CHECK (tur IN ('ic', 'dis')),
  egitmen TEXT NOT NULL DEFAULT '',
  planlanan_tarih TEXT NOT NULL,
  sure_saat REAL NOT NULL DEFAULT 1 CHECK (sure_saat > 0),
  dokuman_id INTEGER REFERENCES dokumanlar (id) ON DELETE SET NULL,
  aciklama TEXT NOT NULL DEFAULT '',
  durum TEXT NOT NULL DEFAULT 'planlandi'
    CHECK (durum IN ('planlandi', 'tamamlandi', 'iptal')),
  olusturan_id INTEGER REFERENCES kullanicilar (id) ON DELETE SET NULL,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  guncelleme_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_egitimler_tarih ON egitimler (planlanan_tarih);

CREATE TABLE IF NOT EXISTS egitim_katilimcilari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  egitim_id INTEGER NOT NULL REFERENCES egitimler (id) ON DELETE CASCADE,
  kullanici_id INTEGER NOT NULL REFERENCES kullanicilar (id) ON DELETE CASCADE,
  katilim_durumu TEXT NOT NULL DEFAULT 'bekliyor'
    CHECK (katilim_durumu IN ('bekliyor', 'katildi', 'katilmadi')),
  degerlendirme_puani REAL CHECK (degerlendirme_puani IS NULL OR (degerlendirme_puani >= 0 AND degerlendirme_puani <= 100)),
  etkinlik_durumu TEXT NOT NULL DEFAULT 'bekliyor'
    CHECK (etkinlik_durumu IN ('bekliyor', 'etkin', 'etkin_degil')),
  sertifika_no TEXT NOT NULL DEFAULT '',
  not_metni TEXT NOT NULL DEFAULT '',
  hatirlatma_tarihi TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (egitim_id, kullanici_id)
);
CREATE INDEX IF NOT EXISTS idx_egitim_katilimcilari_kullanici ON egitim_katilimcilari (kullanici_id);
CREATE INDEX IF NOT EXISTS idx_egitim_katilimcilari_egitim ON egitim_katilimcilari (egitim_id);
`;

function openDatabase(dbYolu) {
  fs.mkdirSync(path.dirname(dbYolu), { recursive: true });
  const db = new DatabaseSync(dbYolu);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SEMA);
  db.exec('PRAGMA user_version = 4;');
  varsayilanVerileriYukle(db);
  return db;
}

/** node:sqlite büyük kimlikleri bigint döndürebildiği için güvenli sayıya çevirir. */
function sonKimlik(bilgi) {
  return Number(bilgi.lastInsertRowid);
}

module.exports = { openDatabase, sonKimlik };
