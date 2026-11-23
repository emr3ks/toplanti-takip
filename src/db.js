'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SEMA = `
CREATE TABLE IF NOT EXISTS sorumlular (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sorumlular_email ON sorumlular (email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS toplantilar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad TEXT NOT NULL,
  tarih TEXT NOT NULL,
  durum TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'tamamlandi')),
  tamamlanma_tarihi TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS isler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  toplanti_id INTEGER NOT NULL REFERENCES toplantilar (id) ON DELETE CASCADE,
  baslik TEXT NOT NULL,
  not_metni TEXT NOT NULL DEFAULT '',
  sorumlu_id INTEGER REFERENCES sorumlular (id) ON DELETE SET NULL,
  hedef_tarih TEXT,
  durum TEXT NOT NULL DEFAULT 'aktif' CHECK (durum IN ('aktif', 'beklemede', 'tamamlandi')),
  hatirlatma_gonderildi INTEGER NOT NULL DEFAULT 0 CHECK (hatirlatma_gonderildi IN (0, 1)),
  hatirlatma_tarihi TEXT,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  guncelleme_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  tamamlanma_tarihi TEXT
);
CREATE INDEX IF NOT EXISTS idx_isler_toplanti ON isler (toplanti_id);
CREATE INDEX IF NOT EXISTS idx_isler_durum ON isler (durum);
CREATE INDEX IF NOT EXISTS idx_isler_hedef ON isler (hedef_tarih);

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
  toplanti_id INTEGER,
  is_id INTEGER,
  olusturma_tarihi TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_kayitlari_tarih ON email_kayitlari (olusturma_tarihi);
`;

function openDatabase(dbYolu) {
  fs.mkdirSync(path.dirname(dbYolu), { recursive: true });
  const db = new DatabaseSync(dbYolu);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SEMA);
  db.exec('PRAGMA user_version = 1;');
  return db;
}

/** node:sqlite büyük kimlikleri bigint döndürebildiği için güvenli sayıya çevirir. */
function sonKimlik(bilgi) {
  return Number(bilgi.lastInsertRowid);
}

module.exports = { openDatabase, sonKimlik };
