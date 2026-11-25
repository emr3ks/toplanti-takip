'use strict';

/**
 * QDMS derleme/ sözdizimi kontrolü.
 *
 * Bu uygulama sunucu tarafında çalışır ve ayrı bir paketleme adımı yoktur.
 * Bu nedenle "build" komutu bütün JavaScript kaynaklarını Node.js'in resmi
 * `--check` ayrıştırıcısından geçirerek sıfır sözdizimi hatası doğrular.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const kok = path.resolve(__dirname, '..');
const haricKlasorler = new Set(['.git', 'node_modules', 'data', 'coverage', 'docs']);

function jsDosyalari(klasor) {
  const sonuc = [];
  for (const ad of fs.readdirSync(klasor, { withFileTypes: true })) {
    if (ad.isDirectory() && haricKlasorler.has(ad.name)) continue;
    const tam = path.join(klasor, ad.name);
    if (ad.isDirectory()) sonuc.push(...jsDosyalari(tam));
    else if (ad.isFile() && ad.name.endsWith('.js')) sonuc.push(tam);
  }
  return sonuc;
}

const dosyalar = jsDosyalari(kok).sort();
let hatali = 0;
for (const dosya of dosyalar) {
  const sonuc = spawnSync(process.execPath, ['--check', dosya], { stdio: 'inherit' });
  if (sonuc.status !== 0) hatali += 1;
}

if (hatali > 0) {
  console.error(`[build] ${hatali} JavaScript dosyasında sözdizimi hatası bulundu.`);
  process.exit(1);
}

console.log(`[build] ${dosyalar.length} JavaScript dosyası sözdizimi kontrolünden geçti.`);
