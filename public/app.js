const kenar = document.querySelector('.kenar');
const karartma = document.querySelector('.kenar-karartma');
const menuDugmesi = document.querySelector('.menu-dugme');

function menuyuKapat() {
  kenar?.classList.remove('acik');
  karartma?.classList.remove('acik');
}

menuDugmesi?.addEventListener('click', () => {
  kenar?.classList.toggle('acik');
  karartma?.classList.toggle('acik');
});

karartma?.addEventListener('click', menuyuKapat);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') menuyuKapat();
});

document.querySelectorAll('form[data-onay]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.onay)) {
      event.preventDefault();
    }
  });
});

// Filtre formlarında seçim değişince otomatik gönder.
document.querySelectorAll('form[data-otomatik-gonder] select').forEach((secim) => {
  secim.addEventListener('change', () => secim.form?.requestSubmit());
});

// Şablon tasarımcısı: dinamik bölüm ekleme/kaldırma.
const bolumListesi = document.getElementById('bolum-listesi');
const bolumSablonu = document.getElementById('bolum-satiri-sablonu');
const bolumEkleDugmesi = document.querySelector('[data-bolum-ekle]');

bolumEkleDugmesi?.addEventListener('click', () => {
  if (!bolumListesi || !bolumSablonu) return;
  const kopya = bolumSablonu.content.cloneNode(true);
  bolumListesi.appendChild(kopya);
  const sonSatir = bolumListesi.lastElementChild;
  sonSatir?.querySelector('input[name="bolum_baslik"]')?.focus();
});

document.addEventListener('click', (event) => {
  const silDugmesi = event.target.closest('[data-bolum-sil]');
  if (!silDugmesi) return;
  const satir = silDugmesi.closest('.bolum-editor-satiri');
  if (satir) satir.remove();
});

// Antet rengi canlı önizleme.
const renkSecici = document.querySelector('[data-renk-secici]');
if (renkSecici) {
  const ornek = document.querySelector('[data-renk-ornek]');
  const deger = document.querySelector('[data-renk-deger]');
  renkSecici.addEventListener('input', () => {
    if (ornek) ornek.style.background = renkSecici.value;
    if (deger) deger.textContent = renkSecici.value;
  });
}
