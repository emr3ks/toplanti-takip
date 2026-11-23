'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { MailService } = require('../src/mailer');
const { createApp } = require('../src/app');
const { VARSAYILAN_ADMIN } = require('../src/auth');

const cerezler = new Map();

function testOrtami(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toplanti-test-'));
  const config = loadConfig({
    ...process.env,
    DATA_DIR: dir,
    DB_YOLU: path.join(dir, 'test.db'),
    OUTBOX_DIR: path.join(dir, 'outbox'),
    MAIL_TEST_MODE: '1',
    DISABLE_CRON: '1',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_SECURE: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM_EMAIL: '',
    SMTP_FROM_NAME: 'Kalite Yönetim Sistemi',
    RAPOR_ALICI: '',
    HATIRLATMA_SAATI: '09:00',
    SAAT_DILIMI: 'Europe/Istanbul',
    ...env,
  });

  const db = openDatabase(config.dbPath);
  const mailService = new MailService({ db, config });
  const app = createApp({ db, config, mailService, zamanlayici: null });

  return {
    dir,
    config,
    db,
    mailService,
    app,
    async kapat() {
      try {
        db.close();
      } catch {
        /* yoksay */
      }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** Verilen adres için saklanan oturum çerezini döndürür. */
function cerezAl(base) {
  return cerezler.get(base) || '';
}

/** Varsayılan admin (veya verilen kullanıcı) ile giriş yapıp çerezi saklar. */
async function girisYap(base, email = VARSAYILAN_ADMIN.email, sifre = VARSAYILAN_ADMIN.sifre) {
  const yanit = await fetch(`${base}/giris`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sifre, donus: '/' }),
    redirect: 'manual',
  });
  const setCookie =
    typeof yanit.headers.getSetCookie === 'function'
      ? yanit.headers.getSetCookie()
      : [yanit.headers.get('set-cookie')].filter(Boolean);
  const cerez = setCookie
    .map((satir) => String(satir).split(';')[0])
    .find((satir) => satir.startsWith('qdms_oturum='));
  if (cerez) {
    cerezler.set(base, cerez);
  }
  return { durum: yanit.status, konum: yanit.headers.get('location'), cerez: cerez || null };
}

function cerezliBasliklar(base, ek = {}) {
  const basliklar = { ...ek };
  const cerez = cerezler.get(base);
  if (cerez) basliklar.cookie = cerez;
  return basliklar;
}

function sunucuBaslat(app, { giris = true } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      if (giris) {
        try {
          const sonuc = await girisYap(base);
          if (!sonuc.cerez) throw new Error(`Giriş başarısız (HTTP ${sonuc.durum})`);
        } catch (hata) {
          server.close();
          reject(hata);
          return;
        }
      }
      resolve({
        server,
        base,
        kapat() {
          return new Promise((kapatResolve) => {
            server.close(kapatResolve);
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
          });
        },
      });
    });
    server.once('error', reject);
  });
}

async function formPost(base, yol, veri = {}) {
  const yanit = await fetch(`${base}${yol}`, {
    method: 'POST',
    headers: cerezliBasliklar(base, { 'content-type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(veri),
    redirect: 'manual',
  });
  return {
    durum: yanit.status,
    konum: yanit.headers.get('location'),
    metin: await yanit.text(),
  };
}

async function sayfaAl(base, yol) {
  const yanit = await fetch(`${base}${yol}`, { headers: cerezliBasliklar(base), redirect: 'manual' });
  return { durum: yanit.status, konum: yanit.headers.get('location'), metin: await yanit.text() };
}

function yolKimlik(konum, desen) {
  const eslesme = String(konum || '').match(desen);
  return eslesme ? Number(eslesme[1]) : null;
}

/** Yönlendirme adresindeki sorgu değerlerini çözer (+ işaretleri dahil). */
function konumMesaji(konum) {
  const url = new URL(String(konum), 'http://yerel');
  const sorgu = [...url.searchParams.entries()].map(([anahtar, deger]) => `${anahtar}=${deger}`).join('&');
  return sorgu ? `${url.pathname}?${sorgu}` : url.pathname;
}

module.exports = {
  testOrtami,
  sunucuBaslat,
  formPost,
  sayfaAl,
  girisYap,
  cerezAl,
  cerezliBasliklar,
  yolKimlik,
  konumMesaji,
};
