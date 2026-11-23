'use strict';

const { zamanTr } = require('./dates');

function esc(deger) {
  return String(deger ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function kabuk({ baslik, altBaslik, icerik }) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(baslik)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef1f8;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px -30px rgba(15,23,42,.55);">
          <tr>
            <td style="background-color:#4338ca;background-image:linear-gradient(135deg,#312e81 0%,#4f46e5 60%,#7c3aed 100%);padding:30px 34px;color:#ffffff;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#c7d2fe;">Kurumsal Kalite Yönetim Sistemi</div>
              <div style="font-size:24px;font-weight:700;line-height:1.25;margin-top:8px;">${esc(baslik)}</div>
              ${altBaslik ? `<div style="font-size:13px;color:#ddd6fe;margin-top:7px;">${esc(altBaslik)}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:30px 34px;">${icerik}</td>
          </tr>
          <tr>
            <td style="padding:18px 34px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <div style="font-size:12px;line-height:1.6;color:#64748b;">
                Kurumsal Kalite Yönetim Sistemi tarafından otomatik olarak gönderilmiştir.
                Bu e-postayı yanıtlamanıza gerek yoktur.
              </div>
            </td>
          </tr>
        </table>
        <div style="max-width:640px;margin:14px auto 0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">
          QDMS · Doküman yönetimi, onay akışı ve okuma takibi
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function testEpostasiHtml({ mod, alici, saatDilimi, gonderimTarihi }) {
  const icerik = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#475569;">
      Bu e-posta, QDMS uygulamasının e-posta ayarlarını doğrulamak için gönderilmiştir.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;font-size:13px;line-height:1.9;color:#475569;">
          <strong style="color:#1e293b;">Gönderim modu:</strong> ${mod === 'test' ? 'Test modu (e-posta dosyaya kaydedildi)' : 'Gerçek SMTP gönderimi'}<br>
          <strong style="color:#1e293b;">Alıcı:</strong> ${esc(alici)}<br>
          <strong style="color:#1e293b;">Saat dilimi:</strong> ${esc(saatDilimi)}<br>
          <strong style="color:#1e293b;">Gönderim zamanı:</strong> ${esc(gonderimTarihi)}
        </td>
      </tr>
    </table>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#64748b;">
      Eğer bu e-postayı görüyorsanız QDMS e-posta altyapısı çalışıyor demektir.
    </p>
  `;
  return kabuk({
    baslik: 'Test E-postası',
    altBaslik: 'E-posta yapılandırması doğrulaması',
    icerik,
  });
}

function gonderimZamani(zaman, saatDilimi) {
  return zamanTr(zaman, saatDilimi);
}

module.exports = {
  esc,
  testEpostasiHtml,
  gonderimZamani,
};
