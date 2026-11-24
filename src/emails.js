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

// ---------------------------------------------------------------------------
// Faz 3 bildirim şablonları
// ---------------------------------------------------------------------------

function bilgiTablosu(satirlar) {
  const dolu = (Array.isArray(satirlar) ? satirlar : []).filter(
    (satir) =>
      Array.isArray(satir) &&
      satir[1] !== undefined &&
      satir[1] !== null &&
      String(satir[1]).trim() !== ''
  );
  if (!dolu.length) return '';

  const rows = dolu
    .map(
      ([etiket, deger]) => `<tr>
              <td style="padding:5px 0;font-size:13px;line-height:1.6;color:#64748b;width:150px;vertical-align:top;">${esc(etiket)}</td>
              <td style="padding:5px 0;font-size:13px;line-height:1.6;color:#1e293b;font-weight:600;">${esc(deger)}</td>
            </tr>`
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:12px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>`;
}

function dugmeBlogu(baglanti, etiket) {
  if (!baglanti) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:22px 0 0;">
      <tr>
        <td align="center" style="padding:16px;background-color:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;">
          <a href="${esc(baglanti)}" style="display:inline-block;padding:12px 28px;background-color:#4338ca;background-image:linear-gradient(135deg,#4338ca 0%,#6d28d9 100%);border-radius:9px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${esc(etiket)}</a>
        </td>
      </tr>
    </table>
    <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#64748b;">
      Düğme çalışmazsa aşağıdaki adresi tarayıcınızın adres çubuğuna kopyalayabilirsiniz:<br>
      <span style="color:#4338ca;word-break:break-all;">${esc(baglanti)}</span>
    </p>`;
}

function otomatikNot() {
  return `<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.7;color:#94a3b8;">
      Bu e-posta otomatik olarak gönderilmiştir; yanıtlamanıza gerek yoktur.
    </p>`;
}

function altBaslikOlustur(sirketAdi, konu) {
  const sirket = String(sirketAdi || '').trim();
  return sirket ? `${sirket} · ${konu}` : konu;
}

function onayBekliyorEpostasi({
  dokuman,
  aliciAd,
  turAd,
  revizyonEtiketi,
  sirketAdi,
  baglanti,
  saatDilimi,
} = {}) {
  const dok = dokuman && typeof dokuman === 'object' ? dokuman : {};
  const kod = dok.kod || '—';
  const icerik = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">
      Sayın ${esc(aliciAd || 'Yetkili')},
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      <strong>${esc(kod)}</strong> kodlu doküman onayınızı bekliyor.
      Onay akışını tamamlamak için dokümanı inceleyip kararınızı kaydetmeniz gerekiyor.
    </p>
    ${bilgiTablosu([
      ['Doküman kodu', kod],
      ['Başlık', dok.baslik || '—'],
      ['Doküman türü', turAd || dok.tur_ad || dok.tur_kod || '—'],
      ['Revizyon', revizyonEtiketi || '—'],
      ['Bildirim zamanı', gonderimZamani(new Date(), saatDilimi)],
    ])}
    ${dugmeBlogu(baglanti, 'Dokümanı İncele')}
    ${otomatikNot()}
  `;
  return kabuk({
    baslik: 'Onay Bekleyen Doküman',
    altBaslik: altBaslikOlustur(sirketAdi, 'Doküman onay akışı'),
    icerik,
  });
}

function dokumanYayinlandiEpostasi({
  dokuman,
  aliciAd,
  turAd,
  revizyonEtiketi,
  sirketAdi,
  baglanti,
  saatDilimi,
} = {}) {
  const dok = dokuman && typeof dokuman === 'object' ? dokuman : {};
  const kod = dok.kod || '—';
  const icerik = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">
      Sayın ${esc(aliciAd || 'Yetkili')},
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      <strong>${esc(kod)}</strong> kodlu doküman yayınlandı. Dokümanı açıp incelemeniz ve
      <strong>“Okudum, Anladım”</strong> onayını vermeniz bekleniyor.
    </p>
    ${bilgiTablosu([
      ['Doküman kodu', kod],
      ['Başlık', dok.baslik || '—'],
      ['Doküman türü', turAd || dok.tur_ad || dok.tur_kod || '—'],
      ['Revizyon', revizyonEtiketi || '—'],
      ['Yayın tarihi', dok.yayin_tarihi ? gonderimZamani(dok.yayin_tarihi, saatDilimi) : '—'],
      ['Okuma onayı', 'Bekleniyor'],
    ])}
    ${dugmeBlogu(baglanti, 'Dokümanı Aç ve Onayla')}
    ${otomatikNot()}
  `;
  return kabuk({
    baslik: 'Doküman Yayınlandı',
    altBaslik: altBaslikOlustur(sirketAdi, 'Doküman okuma ve onay bildirimi'),
    icerik,
  });
}

function egitimHatirlatmaEpostasi({
  egitim,
  kisiAd,
  turEtiketi,
  tarih,
  sureSaat,
  egitmen,
  dokumanKodu,
  baglanti,
  sirketAdi,
  saatDilimi,
} = {}) {
  const egitimBilgi = egitim && typeof egitim === 'object' ? egitim : {};
  const sureMetni =
    sureSaat === undefined || sureSaat === null || String(sureSaat).trim() === '' || sureSaat === '—'
      ? '—'
      : `${sureSaat} saat`;

  const icerik = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">
      Sayın ${esc(kisiAd || 'Katılımcı')},
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      Planlanan <strong>${esc(egitimBilgi.ad || 'eğitim')}</strong> için hatırlatma yapıyoruz.
      Eğitime katılımınız bekleniyor; ayrıntıları ve katılımcı bilgilerini bağlantıdan görüntüleyebilirsiniz.
    </p>
    ${bilgiTablosu([
      ['Eğitim', egitimBilgi.ad || '—'],
      ['Eğitim türü', turEtiketi || '—'],
      ['Tarih', tarih || '—'],
      ['Süre', sureMetni],
      ['Eğitmen', egitmen || '—'],
      ['İlgili doküman', dokumanKodu || ''],
      ['Hatırlatma zamanı', gonderimZamani(new Date(), saatDilimi)],
    ])}
    ${dugmeBlogu(baglanti, 'Eğitim Detayını Gör')}
    ${otomatikNot()}
  `;
  return kabuk({
    baslik: 'Eğitim Hatırlatması',
    altBaslik: altBaslikOlustur(sirketAdi, 'Yaklaşan eğitim planı'),
    icerik,
  });
}

function dofAcildiEpostasi({
  dof,
  aliciAd,
  turEtiketi,
  kaynakEtiketi,
  departmanAd,
  tespitTarihi,
  sirketAdi,
  baglanti,
  saatDilimi,
} = {}) {
  const kayit = dof && typeof dof === 'object' ? dof : {};
  const kod = kayit.kod || '—';
  const tanim = String(kayit.uygunsuzluk_tanimi || '').trim();
  const tanimOzet = tanim.length > 280 ? `${tanim.slice(0, 279)}…` : tanim;
  const icerik = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">
      Sayın ${esc(aliciAd || 'Yetkili')},
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      Departmanınızla ilgili <strong>${esc(kod)}</strong> numaralı bir DÖF kaydı açıldı.
      Uygunsuzluğu inceleyip kök neden ve aksiyon planının hazırlanmasına destek vermeniz bekleniyor.
    </p>
    ${bilgiTablosu([
      ['DÖF No', kod],
      ['Tür', turEtiketi || '—'],
      ['Uygunsuzluk kaynağı', kaynakEtiketi || '—'],
      ['İlgili departman', departmanAd || '—'],
      ['Talep eden', kayit.talep_eden || '—'],
      ['Tespit tarihi', tespitTarihi || '—'],
      ['Uygunsuzluk', tanimOzet || '—'],
      ['Bildirim zamanı', gonderimZamani(new Date(), saatDilimi)],
    ])}
    ${dugmeBlogu(baglanti, 'DÖF Kaydını Aç')}
    ${otomatikNot()}
  `;
  return kabuk({
    baslik: 'Yeni DÖF Açıldı',
    altBaslik: altBaslikOlustur(sirketAdi, 'Düzeltici ve önleyici faaliyet bildirimi'),
    icerik,
  });
}

function dofAksiyonAtandiEpostasi({
  dof,
  aksiyon,
  aliciAd,
  sorumluAd,
  hedefTarihi,
  sirketAdi,
  baglanti,
  saatDilimi,
} = {}) {
  const kayit = dof && typeof dof === 'object' ? dof : {};
  const is = aksiyon && typeof aksiyon === 'object' ? aksiyon : {};
  const kod = kayit.kod || '—';
  const icerik = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">
      Sayın ${esc(aliciAd || sorumluAd || 'Yetkili')},
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;">
      <strong>${esc(kod)}</strong> numaralı DÖF kapsamında size bir aksiyon atandı.
      Aksiyonun hedef tarihine kadar tamamlanması ve kanıtlarının kayda eklenmesi bekleniyor.
    </p>
    ${bilgiTablosu([
      ['DÖF No', kod],
      ['Uygunsuzluk', kayit.uygunsuzluk_tanimi || '—'],
      ['Aksiyon', is.aciklama || '—'],
      ['Sorumlu', sorumluAd || aliciAd || '—'],
      ['Hedef tarih', hedefTarihi || '—'],
      ['Aksiyon durumu', is.durum_etiketi || 'Açık'],
      ['Bildirim zamanı', gonderimZamani(new Date(), saatDilimi)],
    ])}
    ${dugmeBlogu(baglanti, 'Aksiyonu Görüntüle')}
    ${otomatikNot()}
  `;
  return kabuk({
    baslik: 'DÖF Aksiyonu Atandı',
    altBaslik: altBaslikOlustur(sirketAdi, 'Aksiyon sorumluluğu bildirimi'),
    icerik,
  });
}

module.exports = {
  esc,
  kabuk,
  testEpostasiHtml,
  gonderimZamani,
  onayBekliyorEpostasi,
  dokumanYayinlandiEpostasi,
  egitimHatirlatmaEpostasi,
  dofAcildiEpostasi,
  dofAksiyonAtandiEpostasi,
};
