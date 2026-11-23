'use strict';

const { tarihTr, gunFarki, zamanTr } = require('./dates');
const { DURUMLAR } = require('./sabitler');

function esc(deger) {
  return String(deger ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function satirliEsc(deger) {
  return esc(deger).replace(/\r?\n/g, '<br>');
}

function rozet(metin, arka, yazi) {
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${arka};color:${yazi};font-size:11px;font-weight:700;">${esc(metin)}</span>`;
}

function durumRozeti(durum) {
  if (durum === 'aktif') return rozet(DURUMLAR.aktif, '#ecfdf5', '#047857');
  if (durum === 'beklemede') return rozet(DURUMLAR.beklemede, '#fffbeb', '#b45309');
  return rozet(DURUMLAR.tamamlandi, '#f1f5f9', '#475569');
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
              <div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#c7d2fe;">Toplantı Takip</div>
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
                Toplantı Takip tarafından otomatik olarak gönderilmiştir.
                Bu e-postayı yanıtlamanıza gerek yoktur.
              </div>
            </td>
          </tr>
        </table>
        <div style="max-width:640px;margin:14px auto 0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">
          Toplantı Takip · Yerel toplantı notları, iş takibi ve raporlama uygulaması
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function isKarti(is, renk) {
  const sorumlu = is.sorumlu_ad || 'Atanmadı';
  const hedef = is.hedef_tarih ? tarihTr(is.hedef_tarih) : 'Belirtilmedi';
  const not = is.not_metni
    ? `<div style="margin-top:10px;padding:11px 13px;background-color:#f8fafc;border-left:3px solid ${renk};border-radius:0 8px 8px 0;font-size:13px;line-height:1.65;color:#475569;">${satirliEsc(is.not_metni)}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 10px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;">
    <tr>
      <td style="padding:14px 16px;">
        <div style="font-size:14px;font-weight:700;line-height:1.4;color:#0f172a;">${esc(is.baslik)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:7px;line-height:1.7;">
          <span style="display:inline-block;margin-right:14px;">Sorumlu: <strong style="color:#334155;">${esc(sorumlu)}</strong></span>
          <span style="display:inline-block;">Hedef: <strong style="color:#334155;">${esc(hedef)}</strong></span>
        </div>
        ${not}
      </td>
    </tr>
  </table>`;
}

function bolum(baslik, durum, isler) {
  if (!isler.length) return '';
  const renk = durum === 'aktif' ? '#10b981' : durum === 'beklemede' ? '#f59e0b' : '#94a3b8';
  return `<div style="margin-top:26px;">
    <div style="display:block;font-size:13px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#475569;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid ${renk};">
      ${esc(baslik)} <span style="color:#94a3b8;font-weight:600;">(${isler.length})</span>
    </div>
    ${isler.map((is) => isKarti(is, renk)).join('')}
  </div>`;
}

function sayiKutusu(sayi, etiket, arka, yazi) {
  return `<td width="33%" style="width:33%;padding:2px;">
    <div style="background-color:${arka};border-radius:12px;padding:14px 10px;text-align:center;">
      <div style="font-size:24px;font-weight:700;line-height:1;color:${yazi};">${sayi}</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${yazi};margin-top:6px;">${esc(etiket)}</div>
    </div>
  </td>`;
}

function toplantiRaporuHtml({ toplanti, isler, raporTarihi }) {
  const gruplar = { aktif: [], beklemede: [], tamamlandi: [] };
  for (const is of isler) {
    (gruplar[is.durum] || gruplar.aktif).push(is);
  }

  const ozet = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
    <tr>
      ${sayiKutusu(gruplar.aktif.length, 'Aktif', '#ecfdf5', '#047857')}
      ${sayiKutusu(gruplar.beklemede.length, 'Beklemede', '#fffbeb', '#b45309')}
      ${sayiKutusu(gruplar.tamamlandi.length, 'Tamamlandı', '#f1f5f9', '#475569')}
    </tr>
  </table>`;

  const bilgi = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:18px 0 4px;background-color:#f8fafc;border-radius:12px;">
    <tr>
      <td style="padding:14px 16px;font-size:13px;line-height:1.8;color:#475569;">
        <strong style="color:#1e293b;">Toplantı:</strong> ${esc(toplanti.ad)}<br>
        <strong style="color:#1e293b;">Toplantı tarihi:</strong> ${esc(tarihTr(toplanti.tarih))}<br>
        <strong style="color:#1e293b;">Rapor tarihi:</strong> ${esc(raporTarihi)}<br>
        <strong style="color:#1e293b;">Toplam iş:</strong> ${isler.length}
      </td>
    </tr>
  </table>`;

  const icerik = `
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      <strong style="color:#0f172a;">${esc(toplanti.ad)}</strong> toplantısının iş özeti aşağıdadır.
      Toplantı notları ve işlerin son durumları rapora dahil edilmiştir.
    </p>
    ${ozet}
    ${bilgi}
    ${isler.length === 0 ? '<div style="margin-top:24px;padding:22px;background-color:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;font-size:13px;color:#64748b;">Bu toplantıya henüz iş eklenmemiş.</div>' : ''}
    ${bolum('Aktif İşler', 'aktif', gruplar.aktif)}
    ${bolum('Beklemede', 'beklemede', gruplar.beklemede)}
    ${bolum('Tamamlanan', 'tamamlandi', gruplar.tamamlandi)}
    ${isler.length > 0 ? '<p style="margin:26px 0 0;font-size:12px;line-height:1.7;color:#94a3b8;">Durum değişikliklerini uygulama üzerinden yapabilirsiniz. Bu rapor, uygulamadaki güncel iş durumlarına göre oluşturulmuştur.</p>' : ''}
  `;

  return kabuk({
    baslik: 'Toplantı Sonu Raporu',
    altBaslik: `${toplanti.ad} · ${tarihTr(toplanti.tarih)}`,
    icerik,
  });
}

function hedefDurumu(is, bugun) {
  if (!is.hedef_tarih) return '';
  const fark = gunFarki(is.hedef_tarih, bugun);
  if (fark === null) return '';
  if (fark < 0) return `${Math.abs(fark)} gün gecikti`;
  if (fark === 0) return 'Bugün son gün';
  if (fark === 1) return 'Yarın son gün';
  return `${fark} gün kaldı`;
}

function hatirlatmaHtml({ is, toplanti, sorumlu, bugun }) {
  const durum = hedefDurumu(is, bugun);
  const not = is.not_metni
    ? `<div style="margin-top:12px;padding:12px 14px;background-color:#f8fafc;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;font-size:13px;line-height:1.7;color:#475569;">${satirliEsc(is.not_metni)}</div>`
    : '';
  const icerik = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#334155;">
      Merhaba <strong style="color:#0f172a;">${esc(sorumlu?.ad || '')}</strong>,
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#475569;">
      <strong style="color:#0f172a;">${esc(toplanti.ad)}</strong> toplantısındaki bir işin hedef tarihi yaklaşıyor.
      Lütfen işin son durumunu kontrol edin.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#eef2ff;border:1px solid #c7d2fe;border-radius:16px;">
      <tr>
        <td style="padding:20px 22px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4338ca;">${esc(durum)}</div>
          <div style="font-size:19px;font-weight:700;line-height:1.35;color:#1e1b4b;margin-top:6px;">${esc(is.baslik)}</div>
          <div style="font-size:13px;line-height:1.8;color:#475569;margin-top:10px;">
            <strong style="color:#312e81;">Toplantı:</strong> ${esc(toplanti.ad)}<br>
            <strong style="color:#312e81;">Hedef tarih:</strong> ${esc(tarihTr(is.hedef_tarih))}<br>
            <strong style="color:#312e81;">Durum:</strong> ${durumRozeti(is.durum)}
          </div>
          ${not}
        </td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#64748b;">
      İşi tamamladıysanız uygulamada durumunu <strong style="color:#0f172a;">Tamamlandı</strong> olarak güncelleyebilirsiniz.
      Bu hatırlatma yalnızca bir kez gönderilir.
    </p>
  `;
  return kabuk({
    baslik: 'Yaklaşan İş Hatırlatması',
    altBaslik: `${toplanti.ad} · Hedef: ${tarihTr(is.hedef_tarih)}`,
    icerik,
  });
}

function testEpostasiHtml({ mod, alici, saatDilimi, gonderimTarihi }) {
  const icerik = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#475569;">
      Bu e-posta, Toplantı Takip uygulamasının e-posta ayarlarını doğrulamak için gönderilmiştir.
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
      Eğer bu e-postayı görüyorsanız Toplantı Takip uygulamasının e-posta altyapısı çalışıyor demektir.
    </p>
  `;
  return kabuk({
    baslik: 'Test E-postası',
    altBaslik: 'E-posta yapılandırması doğrulaması',
    icerik,
  });
}

function raporKonusu(toplanti) {
  return `Toplantı Raporu: ${toplanti.ad} (${tarihTr(toplanti.tarih)})`;
}

function hatirlatmaKonusu(is, toplanti) {
  return `Hatırlatma: ${is.baslik} — ${toplanti.ad} (Hedef: ${tarihTr(is.hedef_tarih)})`;
}

function gonderimZamani(zaman, saatDilimi) {
  return zamanTr(zaman, saatDilimi);
}

module.exports = {
  esc,
  satirliEsc,
  toplantiRaporuHtml,
  hatirlatmaHtml,
  testEpostasiHtml,
  raporKonusu,
  hatirlatmaKonusu,
  gonderimZamani,
};
