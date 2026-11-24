'use strict';

const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/db');
const { MailService } = require('./src/mailer');
const { createApp } = require('./src/app');
const { hatirlatmaZamanlayicisiBaslat } = require('./src/hatirlatmalar');
const { etkinAyarlar, mailModu } = require('./src/settings');

function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const mailService = new MailService({ db, config });
  const app = createApp({ db, config, mailService });

  const ayarlar = etkinAyarlar(db, config);
  const mod = mailModu(ayarlar);

  // Yaklaşan eğitimler için katılımcılara periyodik hatırlatma e-postası.
  const hatirlatici = hatirlatmaZamanlayicisiBaslat({ db, mail: mailService, config });

  const sunucu = app.listen(config.port, config.host, () => {
    console.log('');
    console.log('  QDMS — Kurumsal Kalite Yönetim Sistemi çalışıyor');
    console.log(`  Adres          : http://${config.host}:${config.port}`);
    console.log(`  Veritabanı     : ${config.dbPath}`);
    console.log(
      `  E-posta modu   : ${mod === 'test' ? 'TEST (data/outbox klasörüne kaydedilir)' : `SMTP (${ayarlar.smtp.host}:${ayarlar.smtp.port})`}`
    );
    console.log('  İlk giriş      : README.md dosyasındaki varsayılan yönetici hesabı');
    console.log('');
  });

  sunucu.on('error', (hata) => {
    if (hata.code === 'EADDRINUSE') {
      console.error(`Hata: ${config.host}:${config.port} portu kullanımda. PORT değişkenini değiştirin.`);
    } else {
      console.error('Sunucu başlatılamadı:', hata);
    }
    process.exitCode = 1;
  });

  function kapat(sinyal) {
    console.log(`\n${sinyal} alındı, kapatılıyor...`);
    hatirlatici.durdur();
    sunucu.close(() => {
      try {
        db.close();
      } catch {
        /* yoksay */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', () => kapat('SIGINT'));
  process.on('SIGTERM', () => kapat('SIGTERM'));
}

if (require.main === module) {
  main();
}

module.exports = { main };
