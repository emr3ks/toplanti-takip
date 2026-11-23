'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bugunTz,
  gecerliSaat,
  gecerliTarih,
  gunEkle,
  gunFarki,
  tarihTr,
  zamanTr,
} = require('../src/dates');
const { cronIfadesi } = require('../src/reminder');

test('geçerliTarih gerçek takvim tarihlerini doğrular', () => {
  assert.equal(gecerliTarih('2026-11-23'), true);
  assert.equal(gecerliTarih('2024-02-29'), true);
  assert.equal(gecerliTarih('2026-02-29'), false);
  assert.equal(gecerliTarih('23.11.2026'), false);
  assert.equal(gecerliTarih(''), false);
  assert.equal(gecerliTarih(null), false);
});

test('gecerliSaat SS:DD biçimini doğrular', () => {
  assert.equal(gecerliSaat('09:00'), true);
  assert.equal(gecerliSaat('23:59'), true);
  assert.equal(gecerliSaat('24:00'), false);
  assert.equal(gecerliSaat('9:00'), false);
  assert.equal(gecerliSaat('09:60'), false);
});

test('gunEkle ay ve yıl sınırlarını doğru aşar', () => {
  assert.equal(gunEkle('2026-11-30', 1), '2026-12-01');
  assert.equal(gunEkle('2026-12-31', 1), '2027-01-01');
  assert.equal(gunEkle('2024-02-28', 1), '2024-02-29');
  assert.equal(gunEkle('2024-02-29', 1), '2024-03-01');
  assert.equal(gunEkle('2026-11-23', 0), '2026-11-23');
});

test('gunFarki hedef ile bugün arasındaki gün sayısını verir', () => {
  assert.equal(gunFarki('2026-11-24', '2026-11-23'), 1);
  assert.equal(gunFarki('2026-11-23', '2026-11-23'), 0);
  assert.equal(gunFarki('2026-11-20', '2026-11-23'), -3);
  assert.equal(gunFarki('gecersiz', '2026-11-23'), null);
});

test('bugunTz saat dilimine göre tarihi döndürür', () => {
  const gece = new Date('2026-11-23T22:30:00.000Z');
  assert.equal(bugunTz('Europe/Istanbul', gece), '2026-11-24');
  assert.equal(bugunTz('UTC', gece), '2026-11-23');
  assert.equal(bugunTz('America/New_York', gece), '2026-11-23');
});

test('tarihTr ve zamanTr Türkçe biçimlendirir', () => {
  assert.equal(tarihTr('2026-11-23'), '23.11.2026');
  assert.equal(tarihTr(null), '—');
  assert.match(zamanTr('2026-11-23T12:00:00.000Z', 'Europe/Istanbul'), /23 Kas 2026/);
});

test('cronIfadesi günlük ifade üretir', () => {
  assert.equal(cronIfadesi('09:00'), '0 9 * * *');
  assert.equal(cronIfadesi('14:05'), '5 14 * * *');
  assert.equal(cronIfadesi('23:59'), '59 23 * * *');
  assert.equal(cronIfadesi('25:00'), null);
});
