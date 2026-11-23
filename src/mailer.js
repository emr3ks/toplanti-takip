'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

const { epostaGecerli, metin } = require('./dogrulama');
const { etkinAyarlar, mailModu } = require('./settings');

function fromAdresi(smtp) {
  const adres = smtp.fromEmail || smtp.user;
  if (!adres) return null;
  return {
    name: smtp.fromName || 'Kurumsal Kalite Yönetim Sistemi',
    address: adres,
  };
}

class MailService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  ayarlar() {
    return etkinAyarlar(this.db, this.config);
  }

  mod() {
    return mailModu(this.ayarlar());
  }

  transporter(ayarlar) {
    return nodemailer.createTransport({
      host: ayarlar.smtp.host,
      port: ayarlar.smtp.port,
      secure: Boolean(ayarlar.smtp.secure),
      auth: ayarlar.smtp.user
        ? { user: ayarlar.smtp.user, pass: ayarlar.smtp.pass }
        : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  kaydet({ tur, alici, konu, durum, hata = null, icerik = '', dosya = null, toplantiId = null, isId = null }) {
    const bilgi = this.db
      .prepare(
        `INSERT INTO email_kayitlari
          (tur, alici, konu, durum, hata, icerik, dosya, toplanti_id, is_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tur,
        alici,
        konu,
        durum,
        hata,
        icerik,
        dosya,
        toplantiId === null ? null : Number(toplantiId),
        isId === null ? null : Number(isId)
      );
    return Number(bilgi.lastInsertRowid);
  }

  async outboxYaz(tur, html) {
    await fs.promises.mkdir(this.config.outboxDir, { recursive: true });
    const zaman = new Date().toISOString().replace(/[:.]/g, '-');
    const rastgele = crypto.randomBytes(3).toString('hex');
    const dosyaAdi = `${zaman}-${tur}-${rastgele}.html`;
    await fs.promises.writeFile(path.join(this.config.outboxDir, dosyaAdi), html, 'utf8');
    return dosyaAdi;
  }

  /**
   * HTML e-postayı gönderir. Test modunda gönderim yapmaz, e-postayı
   * data/outbox altına yazar ve veritabanına kaydeder.
   */
  async gonder({ tur, alici, konu, html, toplantiId = null, isId = null }) {
    const ayarlar = this.ayarlar();
    const mod = mailModu(ayarlar);
    const hedef = metin(alici);

    if (!epostaGecerli(hedef)) {
      const hata = 'Geçerli bir alıcı e-posta adresi tanımlı değil.';
      const kayitId = this.kaydet({
        tur,
        alici: hedef,
        konu,
        durum: 'hata',
        hata,
        icerik: html,
        toplantiId,
        isId,
      });
      return { ok: false, durum: 'hata', hata, mod, kayitId };
    }

    if (mod === 'test') {
      let dosya = null;
      try {
        dosya = await this.outboxYaz(tur, html);
      } catch (hata) {
        const mesaj = `Test modu e-postası kaydedilemedi: ${hata.message}`;
        const kayitId = this.kaydet({
          tur,
          alici: hedef,
          konu,
          durum: 'hata',
          hata: mesaj,
          icerik: html,
          toplantiId,
          isId,
        });
        return { ok: false, durum: 'hata', hata: mesaj, mod, kayitId };
      }

      const kayitId = this.kaydet({
        tur,
        alici: hedef,
        konu,
        durum: 'test_modu',
        icerik: html,
        dosya,
        toplantiId,
        isId,
      });
      return { ok: true, durum: 'test_modu', dosya, mod, kayitId };
    }

    const from = fromAdresi(ayarlar.smtp);
    if (!from) {
      const hata = 'Gönderen e-posta adresi tanımlı değil. Ayarlar bölümünde gönderen e-posta adresini girin.';
      const kayitId = this.kaydet({
        tur,
        alici: hedef,
        konu,
        durum: 'hata',
        hata,
        icerik: html,
        toplantiId,
        isId,
      });
      return { ok: false, durum: 'hata', hata, mod, kayitId };
    }

    try {
      const bilgi = await this.transporter(ayarlar).sendMail({
        from,
        to: hedef,
        subject: konu,
        html,
      });
      const kayitId = this.kaydet({
        tur,
        alici: hedef,
        konu,
        durum: 'gonderildi',
        icerik: html,
        toplantiId,
        isId,
      });
      return {
        ok: true,
        durum: 'gonderildi',
        mod,
        kayitId,
        mesajId: bilgi.messageId,
        yanit: bilgi.response,
      };
    } catch (hata) {
      const mesaj = `E-posta gönderilemedi: ${hata.message}`.slice(0, 1000);
      const kayitId = this.kaydet({
        tur,
        alici: hedef,
        konu,
        durum: 'hata',
        hata: mesaj,
        icerik: html,
        toplantiId,
        isId,
      });
      return { ok: false, durum: 'hata', hata: mesaj, mod, kayitId };
    }
  }

  async baglantiTest() {
    const ayarlar = this.ayarlar();
    const mod = mailModu(ayarlar);
    if (mod === 'test') {
      return {
        ok: true,
        testModu: true,
        mesaj:
          'Test modu etkin. E-postalar gönderilmez; data/outbox klasörüne ve E-posta Günlüğü sayfasına kaydedilir.',
      };
    }

    try {
      await this.transporter(ayarlar).verify();
      return {
        ok: true,
        testModu: false,
        mesaj: `SMTP bağlantısı başarılı: ${ayarlar.smtp.host}:${ayarlar.smtp.port}`,
      };
    } catch (hata) {
      return {
        ok: false,
        testModu: false,
        mesaj: `SMTP bağlantısı kurulamadı: ${hata.message}`,
      };
    }
  }
}

module.exports = { MailService, fromAdresi };
