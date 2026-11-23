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
