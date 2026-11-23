'use strict';

const path = require('node:path');

const KOK = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(KOK, '.env'), quiet: true });

function mantiksal(deger, varsayilan = false) {
  if (deger === undefined || deger === null || String(deger).trim() === '') {
    return varsayilan;
  }
  return ['1', 'true', 'evet', 'yes', 'on'].includes(String(deger).trim().toLowerCase());
}

function sayi(deger, varsayilan) {
  const n = Number(deger);
  return Number.isFinite(n) ? n : varsayilan;
}

/**
 * Ortam değişkenlerinden uygulama yapılandırmasını üretir.
 * Testlerde `env` nesnesi doğrudan verilebilir.
 */
function loadConfig(env = process.env, kok = KOK) {
  const dataDir = path.resolve(kok, env.DATA_DIR || 'data');
  const dbPath = path.resolve(kok, env.DB_YOLU || path.join(dataDir, 'toplanti.db'));
  const outboxDir = path.resolve(kok, env.OUTBOX_DIR || path.join(dataDir, 'outbox'));

  return {
    kok,
    dataDir,
    dbPath,
    outboxDir,
    port: sayi(env.PORT, 3005),
    host: env.HOST || '127.0.0.1',
    env: {
      smtp: {
        host: (env.SMTP_HOST || '').trim(),
        port: sayi(env.SMTP_PORT, 587),
        secure: mantiksal(env.SMTP_SECURE, false),
        user: (env.SMTP_USER || '').trim(),
        pass: env.SMTP_PASS || '',
        fromEmail: (env.SMTP_FROM_EMAIL || '').trim(),
        fromName: (env.SMTP_FROM_NAME || 'Kurumsal Kalite Yönetim Sistemi').trim(),
      },
      saatDilimi: (env.SAAT_DILIMI || 'Europe/Istanbul').trim(),
      testModu: mantiksal(env.MAIL_TEST_MODE, false),
    },
  };
}

module.exports = { loadConfig, KOK, mantiksal };
