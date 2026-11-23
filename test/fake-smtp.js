'use strict';

const net = require('node:net');

/**
 * Testlerde Nodemailer'ın gerçek SMTP yolunu doğrulamak için küçük bir
 * sahte SMTP sunucusu. Gelen iletileri ham metin olarak saklar.
 */
function fakeSmtpBaslat() {
  const mesajlar = [];
  const soketler = new Set();

  const sunucu = net.createServer((soket) => {
    soketler.add(soket);
    soket.setEncoding('utf8');
    soket.on('close', () => soketler.delete(soket));
    soket.on('error', () => soketler.delete(soket));
    soket.write('220 localhost ESMTP toplanti-test\r\n');

    let tampon = '';
    let veriModu = false;
    let veri = '';
    let kimden = '';
    let alicilar = [];

    soket.on('data', (parca) => {
      tampon += parca;
      let indeks;
      while ((indeks = tampon.indexOf('\r\n')) !== -1) {
        const satir = tampon.slice(0, indeks);
        tampon = tampon.slice(indeks + 2);

        if (veriModu) {
          if (satir === '.') {
            mesajlar.push({ kimden, alicilar: [...alicilar], veri });
            veriModu = false;
            veri = '';
            kimden = '';
            alicilar = [];
            soket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            veri += `${satir}\r\n`;
          }
          continue;
        }

        const buyuk = satir.toUpperCase();
        if (buyuk.startsWith('EHLO') || buyuk.startsWith('HELO')) {
          soket.write('250-localhost\r\n250-PIPELINING\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n');
        } else if (buyuk.startsWith('MAIL FROM:')) {
          kimden = satir.slice(10).trim();
          soket.write('250 2.1.0 Ok\r\n');
        } else if (buyuk.startsWith('RCPT TO:')) {
          alicilar.push(satir.slice(8).trim());
          soket.write('250 2.1.5 Ok\r\n');
        } else if (buyuk === 'DATA') {
          veriModu = true;
          veri = '';
          soket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (buyuk === 'RSET' || buyuk === 'NOOP') {
          soket.write('250 2.0.0 Ok\r\n');
        } else if (buyuk === 'QUIT') {
          soket.write('221 2.0.0 Bye\r\n');
          soket.end();
        } else {
          soket.write('250 2.0.0 Ok\r\n');
        }
      }
    });
  });

  return new Promise((cozumle, reddet) => {
    sunucu.once('error', reddet);
    sunucu.listen(0, '127.0.0.1', () => {
      cozumle({
        port: sunucu.address().port,
        mesajlar,
        kapat() {
          for (const soket of soketler) soket.destroy();
          return new Promise((kapatCoz) => sunucu.close(kapatCoz));
        },
      });
    });
  });
}

/** Ham SMTP iletisinden başlık değerini çıkarır (basit test yardımcısı). */
function baslikDegeri(veri, ad) {
  const desen = new RegExp(`^${ad}:\\s*(.+)$`, 'im');
  const eslesme = veri.match(desen);
  return eslesme ? eslesme[1].trim() : '';
}

module.exports = { fakeSmtpBaslat, baslikDegeri };
