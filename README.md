# QDMS — Kurumsal Kalite Yönetim Sistemi

Yerel bilgisayarda çalışan, SQLite üzerinde saklanan, Türkçe arayüzlü bir **Kalite Yönetim Sistemi (QDMS)**. Kullanıcı ve rol yönetimi, departmanlar, doküman şablonları, otomatik antetli PDF üretimi, çok aşamalı onay, revizyon geçmişi, **“Okudum, Anladım”** takibi, **eğitim yönetimi**, **DÖF (Düzeltici ve Önleyici Faaliyetler) yönetimi**, **CSV/Excel kurumsal raporları** ve **otomatik e-posta bildirimleri** Faz 1–4 kapsamında hazırdır. Uygulama yalnızca QDMS arayüzü sunar; eski **Toplantı ve Aksiyon Takibi** modülü kaldırılmıştır.

## Öne Çıkanlar

- **Kurumsal sol menü:** Dashboard, Doküman Yönetimi (Prosedür `PR`, Talimat `TL`, El Kitabı `EK`, Liste `LS`, Form `FR`), Doküman Şablon Tasarımcısı, Eğitim Yönetimi, Personel Eğitim Sicili, DÖF Yönetimi, Kurumsal Raporlar, Organizasyon ve Kullanıcılar, Sistem Ayarları.
- **Giriş ve rol bazlı yetkilendirme:** Sistem Yöneticisi, Kalite Yöneticisi, Doküman Hazırlayan, Onaylayan, Standart Kullanıcı. İlk kurulumda otomatik yönetici hesabı oluşturulur.
- **Departman yönetimi:** Üretim, Kalite Güvence, İnsan Kaynakları, Bakım, Satın Alma hazır gelir; yeni birim eklenebilir, kullanıcılar departmanlara atanır.
- **Şablon tasarımcısı:** Her doküman türü için bölüm başlıkları, açıklamalar, zorunluluk, antet rengi, kenarlık stili, logo ve hazırlayan/onaylayan alt bilgi etiketleri tanımlanır. PDF önizlemesi anında alınır.
- **Otomatik kod ve PDF:** `PR-001`, `TL-001`, `EK-001`, `LS-001`, `FR-001` kodları otomatik atanır. Kurumsal antet, **sol üst logo kutusu**, doküman kodu, yayın tarihi, `Rev.00`, `Sayfa 1/X`, hazırlayan/onaylayan kutuları ve Türkçe karakter desteğiyle PDF üretilir.
- **Logo güvenilirliği:** PNG/JPG logo dosyası veya Base64 verisi PDF motoruna doğrudan bağlanır; logo tüm sayfalarda orantılı basılır. Desteklenmeyen formatlar sessizce yutulmaz, yükleme sırasında açık hata verir.
- **Onay ve revizyon:** `Taslak` → `Kontrol / Onay Bekliyor` → `Yayında` → `İptal / Arşiv`. Taslak PDF’inde **TASLAK** filigranı vardır; onaylandığında filigran kalkar, onaylayan ve onay tarihi belgeye işlenir. Yeni revizyon eski revizyonu arşivler; değişiklik notları saklanır.
- **Dağıtım ve okuma takibi:** Doküman yayınlandığında seçilen departman personeline bildirim ve e-posta düşer; personel “Okudum, Anladım” onayı verir. Kalite yöneticisi yüzdelik ve isim listesiyle takip eder.
- **Eğitim yönetimi:** Yıllık eğitim planı, iç/dış eğitim türü, eğitmen, süre, ilgili kalite dokümanı; personel/departman bazında katılımcı atama; katılım, puan ve etkinlik sonuçları; personel eğitim sicili.
- **DÖF yönetimi:** Otomatik `DOF-YYYY-NNN` kodlama; uygunsuzluk kaynağı, departman, talep eden, tespit tarihi ve ilgili kalite dokümanı; 5 Neden/kök neden ve acil önlem; çok maddeli aksiyon planı (sorumlu, hedef tarih, durum, kanıt dosyası); `Açık → Kök Neden & Aksiyon Aşamasında → Etkinlik Kontrolü Bekliyor → Kapandı` akışı; antetli DÖF raporu PDF’i; dashboard özeti ve CSV/XLSX listesi.
- **Kurumsal raporlama:** Güncel doküman ana listesi, okundu onayı matrisi ve yıllık eğitim matrisi; tümü **CSV** ve gerçek **XLSX** olarak indirilebilir.
- **Otomatik e-postalar:** Onaya gönderimde onaylayanlara, yayında hedef departman personeline ve yaklaşan eğitimlerde katılımcılara e-posta. SMTP tanımlı değilse uygulama hata vermez; e-postalar test modunda outbox’a ve E-posta Günlüğü’ne kaydedilir.
- **İsteğe bağlı hazır dosya:** Sistem PDF’i üretmek yerine PDF/Excel dosyası yüklenebilir.
- **Varsayılan port:** `3005` (`PORT` ortam değişkeniyle değiştirilebilir). Tüm tablolar SQLite’tadır.

## Ekran Görüntüleri

| Dashboard (Faz 3 menüsü) | Eğitim Yönetimi |
| --- | --- |
| ![Dashboard](docs/screenshots/after-faz3-dashboard.png) | ![Eğitim Yönetimi](docs/screenshots/after-faz3-egitim.png) |

| Eğitim Detayı ve Sonuç Girişi | Yeni Eğitim |
| --- | --- |
| ![Eğitim Detayı](docs/screenshots/after-faz3-egitim-detay.png) | ![Yeni Eğitim](docs/screenshots/after-faz3-egitim-yeni.png) |

| Personel Eğitim Sicili | Personel Eğitim Geçmişi |
| --- | --- |
| ![Personel Sicili](docs/screenshots/after-faz3-personel-sicil.png) | ![Personel Detayı](docs/screenshots/after-faz3-personel-detay.png) |

| Kurumsal Raporlar | Güncel Doküman Ana Listesi |
| --- | --- |
| ![Raporlar](docs/screenshots/after-faz3-raporlar.png) | ![Doküman Listesi](docs/screenshots/after-faz3-rapor-dokumanlar.png) |

| Okundu Onayı Matrisi | Yıllık Eğitim Matrisi |
| --- | --- |
| ![Okundu Onayı](docs/screenshots/after-faz3-rapor-okundu.png) | ![Eğitim Matrisi](docs/screenshots/after-faz3-rapor-egitim.png) |

| Otomatik E-postalar | PDF Antetinde Logo |
| --- | --- |
| ![E-posta Günlüğü](docs/screenshots/after-faz3-emailler.png) | ![PDF Logo](docs/screenshots/after-faz3-pdf-logo.png) |

### DÖF Yönetimi — Faz 4

Faz 3 dashboard’unda DÖF menüsü ve özet kartı yoktu; Faz 4 ile sol menüye **DÖF Yönetimi** ve dashboard’a **Açık ve Geciken DÖF’ler** kartı eklendi.

| Önce — Faz 3 dashboard (DÖF menüsü/kartı yok) | Sonra — Faz 4 dashboard |
| --- | --- |
| ![Önce Dashboard](docs/screenshots/before-faz4-dof-dashboard.png) | ![Sonra Dashboard](docs/screenshots/after-faz4-dashboard.png) |

| DÖF Ana Listesi | DÖF Detayı ve Aksiyon Planı |
| --- | --- |
| ![DÖF Listesi](docs/screenshots/after-faz4-dof-liste.png) | ![DÖF Detayı](docs/screenshots/after-faz4-dof-detay.png) |

| Yeni DÖF | Etkinlik Kontrolü ve Kapatma |
| --- | --- |
| ![Yeni DÖF](docs/screenshots/after-faz4-dof-yeni.png) | ![Etkinlik Kontrolü](docs/screenshots/after-faz4-dof-etkinlik.png) |

| Kapanmış DÖF | Antetli DÖF Raporu PDF — çok aksiyonlu |
| --- | --- |
| ![Kapanmış DÖF](docs/screenshots/after-faz4-dof-kapali.png) | ![DÖF PDF](docs/screenshots/after-faz4-dof-pdf-2.png) |

| Antetli DÖF Raporu PDF — kapanış onayı |
| --- |
| ![DÖF PDF Kapalı](docs/screenshots/after-faz4-dof-pdf.png) |

### PDF Logo — Önce / Sonra

Faz 2 temel revizyonunda (`4fb8d0a`) yüklenen WEBP logo PDFKit tarafından sessizce atlanıyordu; PNG logo ise antet tablosunun dışında, ayrı bir görsel olarak basılıyordu. Faz 3 revizyonunda logo, tüm PDF’lerde sol üst antet kutusunda orantılı olarak basılır ve desteklenmeyen formatlar sessizce kaybolmaz.

| Önce — WEBP logo (logo yok) | Sonra — PNG logo (antet kutusu) |
| --- | --- |
| ![Önce WEBP](docs/screenshots/before-faz3-pdf-logo-webp.png) | ![Sonra PNG](docs/screenshots/after-faz3-pdf-logo.png) |

| Önce — PNG logo (antet dışında) | Sonra — yayındaki doküman PDF’i |
| --- | --- |
| ![Önce PNG](docs/screenshots/before-faz3-pdf-logo.png) | ![Sonra Doküman](docs/screenshots/after-faz3-pdf-dokuman.png) |

| Önce — Eğitim yer tutucusu | Sonra — Eğitim Yönetimi |
| --- | --- |
| ![Önce Eğitim](docs/screenshots/before-faz3-egitim.png) | ![Sonra Eğitim](docs/screenshots/after-faz3-egitim.png) |

## Teknolojiler

| Katman | Teknoloji |
| --- | --- |
| Sunucu | Node.js, Express 5 |
| Arayüz | EJS sunucu taraflı şablonlar, saf CSS/JS |
| Veritabanı | SQLite (`node:sqlite`, ek native derleme gerekmez) |
| PDF | PDFKit (Unicode TTF gömme, Base64/Buffer logo, filigran, sayfa numarası) |
| Raporlama | Bağımlılıksız CSV (UTF-8 BOM) ve XLSX (OOXML/ZIP) üretimi |
| Dosya yükleme | Multer (logo, PDF/Excel) |
| E-posta | Nodemailer + zamanlanmış eğitim hatırlatmaları |
| Test | Node.js yerleşik `node:test`, HTTP üzerinden uçtan uca akışlar |

## Gereksinimler

- **Node.js 24 veya üzeri** (Node 26 ile test edildi)
- npm
- PDF’lerde Türkçe karakterler için işletim sisteminde bir Unicode yazı tipi (Windows’ta Segoe UI/Arial, Linux’ta DejaVu Sans, macOS’ta Arial otomatik aranır). İsterseniz `PDF_FONT_YOLU` ve `PDF_FONT_KALIN_YOLU` ile kendi TTF dosyalarınızı gösterebilirsiniz.
- E-posta göndermek için SMTP hesabı. Test modunda SMTP gerekmez.

## Kurulum

```bash
git clone https://github.com/emr3ks/toplanti-takip.git
cd toplanti-takip
npm install
```

Windows CMD/PowerShell:

```powershell
copy .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Uygulamayı başlatın:

```bash
npm start
```

Tarayıcıda **http://127.0.0.1:3005** adresini açın. Farklı bir port için `.env` içinde `PORT=3006` gibi bir değer verin.

### İlk Giriş (Varsayılan Yönetici)

İlk çalıştırmada veritabanı boşsa otomatik olarak bir **Sistem Yöneticisi** hesabı oluşturulur:

| Rol | E-posta | Şifre |
| --- | --- | --- |
| Sistem Yöneticisi | `admin@qdms.local` | `Admin123!` |

> İlk girişten sonra **Organizasyon ve Kullanıcılar → Şifre Değiştir** bölümünden şifreyi değiştirin. Bu bilgiler yalnızca ilk kurulum içindir; üretim ortamında mutlaka değiştirilmelidir.

## Roller ve Yetkiler

| Rol | Yetkiler |
| --- | --- |
| **Sistem Yöneticisi** (`admin`) | Tüm modüller, kullanıcı/departman yönetimi, şirket ve SMTP ayarları, onay ve arşivleme, eğitim yönetimi, DÖF yönetimi ve kapatma, raporlar |
| **Kalite Yöneticisi** (`kalite`) | Şablon tasarımı, doküman oluşturma/düzenleme, onaylama, dağıtım ve okuma takibi, eğitim yönetimi, DÖF yönetimi ve kapatma, raporlar |
| **Doküman Hazırlayan** (`hazirlayan`) | Doküman oluşturma, kendi taslaklarını düzenleme ve onaya gönderme; eğitim planını, kendi sicilini ve departmanının DÖF kayıtlarını görüntüleme |
| **Onaylayan** (`onaylayan`) | Kontrol / onay bekleyen dokümanları onaylama veya iade etme; eğitim planını, kendi sicilini ve departmanının DÖF kayıtlarını görüntüleme |
| **Standart Kullanıcı** (`kullanici`) | Kendisine dağıtılan yayınlanmış dokümanları okuma, “Okudum, Anladım” onayı verme, kendi eğitim sicilini görüntüleme; departmanına ait veya aksiyon sorumlusu olduğu DÖF kayıtlarını görüntüleme ve kendi aksiyonunun durumunu güncelleme |

DÖF görünürlüğü: Sistem Yöneticisi ve Kalite Yöneticisi tüm kayıtları görür; diğer kullanıcılar yalnızca kendi departmanlarının, kendilerinin açtığı veya aksiyon sorumlusu oldukları DÖF kayıtlarını görüntüler. Yetkisiz sayfalara erişim `403`, oturum yoksa giriş ekranına yönlendirme ile korunur. Tüm POST işlemleri oturum gerektirir.

## Modüller

### 1. Dashboard

- Bekleyen onaylar (onaylama yetkisi olanlara), okunmamış dokümanlar, yayındaki ve taslak doküman sayıları.
- **Açık ve Geciken DÖF’ler** özet kartı: açık, geciken, etkinlik kontrolü bekleyen ve kapanan DÖF sayıları; karttan filtrelenmiş DÖF listesine geçilir.
- Bildirimler, doküman tür dağılımı ve son dokümanlar.
- Bildirimler tek tıkla okundu işaretlenebilir.

### 2. Doküman Yönetimi

- Tür sekmeleri ve durum filtresiyle listeleme, kod/başlık/açıklama araması.
- Her doküman için revizyon, durum, hazırlayan ve okunma yüzdesi görünür.
- Standart kullanıcı yalnızca kendisine dağıtılan yayınlanmış dokümanları görür; taslaklar hazırlayan ve kalite ekibiyle sınırlıdır.

### 3. Doküman Şablon Tasarımcısı

- Her tür için ayrı şablon: şablon adı, antet/tablo rengi, kenarlık stili (düz/kesikli/çift), şablona özel logo, alt bilgi etiketleri.
- Bölüm düzenleyici: başlık, kullanıcıya gösterilen ipucu ve zorunlu/isteğe bağlı seçimi.
- PDF önizleme, tasarımı kaydetmeden önce görsel doğrulama sağlar.
- Logo yüklenmezse **Sistem Ayarları**’ndaki şirket logosu, o da yoksa şirket baş harfleri kullanılır.

### 4. Doküman Oluşturma ve PDF

1. Doküman türü seçilir; sıradaki kod otomatik hesaplanır (`PR-001`, `PR-002`, …).
2. Şablon bölümleri form alanları olarak gelir; zorunlu bölümler boş bırakılamaz.
3. Hedef departmanlar seçilir (en az bir zorunlu).
4. “Dokümanı Oluştur” ile **Taslak** kaydı oluşur.
5. `PDF’i Aç` / `PDF İndir` bağlantısı belgeyi üretir. PDF’de:
   - şirket adı ve logo,
   - doküman kodu, türü, revizyonu ve yayın tarihi tablosu,
   - başlık ve bölüm içerikleri,
   - hazırlayan ve onaylayan alt bilgi kutuları,
   - `Sayfa 1/X` numarası,
   - taslak durumunda çapraz **TASLAK** filigranı bulunur.
6. İsteğe bağlı olarak hazır PDF/Excel dosyası yüklenebilir (en fazla 10 MB). Bu durumda hazır dosya indirilebilir; sistem PDF’i yerine yüklenen dosya kullanılır.

### 5. Onay Akışı ve Revizyon Yönetimi

| Durum | Açıklama |
| --- | --- |
| `Taslak` | Hazırlanıyor; yalnızca hazırlayan ve kalite ekibi görür. PDF’de `TASLAK` filigranı vardır. |
| `Kontrol / Onay Bekliyor` | Onaya gönderildi; onaylayanlar inceler. |
| `Yayında` | Onaylandı; filigran kalkar, onaylayan/tarih PDF antetine işlenir, dağıtım başlar. |
| `İptal / Arşiv` | Yürürlükten kaldırıldı veya yeni revizyonla arşivlendi. Geçmiş korunur. |

- **Onaya Gönder:** Hazırlayan veya kalite ekibi, hedef departman ve içerik kontrolünden sonra gönderir; onaylayanlara bildirim gider.
- **Onayla ve Yayınla:** Onaylayan/kalite yöneticisi/yönetici yapar. Onaylayan ve onay tarihi kaydedilir, hedef departman personeline okuma bildirimi oluşturulur.
- **Reddet / İade Et:** Gerekçe zorunludur; doküman taslağa döner, hazırlayana bildirim gider.
- **Yeni Revizyon:** Yayındaki veya arşivdeki en güncel revizyon için değişiklik notuyla açılır. Önceki revizyon otomatik `İptal / Arşiv` olur; tüm revizyonlar ve notlar saklanır.
- **İptal / Arşivle:** Yetkili kullanıcı dokümanı yürürlükten kaldırır.

### 6. Dağıtım ve “Okudum, Anladım” Takibi

- Yayınlama anında hedef departmanların aktif kullanıcıları için okuma kaydı ve bildirim oluşturulur.
- Standart kullanıcı doküman detayında **“✓ Okudum, Anladım”** butonunu görür; onay zamanı kaydedilir.
- Kalite yöneticisi/yönetici, detay sayfasında okunma yüzdesini ve personel bazında okudu/bekliyor listesini görür.
- Yeni revizyon yayınlandığında okuma takibi yeni revizyon için yeniden başlar.

### 7. Eğitim Yönetimi

- **Yıllık Eğitim Planı:** Eğitim adı, türü (İç Eğitim / Dış Eğitim), eğitmen, planlanan tarih, süre (saat) ve ilgili kalite dokümanı (Prosedür, Talimat vb.) ile eğitim oluşturma.
- **Katılımcı Atama:** Eğitime departman bazında (departmandaki tüm aktif personel) ve/veya tek tek personel atanır; katılımcılara uygulama içi bildirim gider.
- **Sonuç Girişi:** Eğitim sonrasında her katılımcı için katılım durumu (“Katıldı” / “Katılmadı” / “Bekliyor”), 0–100 değerlendirme puanı, eğitim etkinlik durumu (“Etkin” / “Etkin Değil”), sertifika numarası ve not kaydedilir.
- **Özet ve oranlar:** Eğitim detayında katılım oranı, bekleyen katılımcı sayısı, ortalama puan ve etkinlik oranı; yıllık planda planlanan/tamamlanan sayıları ve yaklaşan eğitimler görünür.
- **Personel Eğitim Sicili:** Her personelin katıldığı eğitimler, puanları, sertifikaları ve etkinlik bilgileri tek ekranda; personel kendi sicilini görür, kalite/yönetici tüm personeli görüntüler.
- **Hatırlatma:** Yaklaşan eğitimler için katılımcılara otomatik e-posta hatırlatması (sunucu açılışında ve 6 saatte bir) veya detay ekranından elle hatırlatma gönderilebilir.

### 8. Kurumsal Raporlar ve CSV/Excel Çıktıları

- **Güncel Doküman Ana Listesi:** Yayındaki tüm Prosedür, Talimat, El Kitabı, Liste ve Formların kodu, başlığı, revizyonu, yayın tarihi ve hedef departmanları; tür/departman filtresiyle listelenir, CSV ve XLSX olarak indirilir.
- **Okundu Onayı Raporu:** Hangi personelin hangi dokümanı okuyup okumadığı; personel–doküman matrisi ve ayrıntı listesi, okunma tarihleriyle birlikte CSV/XLSX.
- **Eğitim Matrisi:** Yıllık eğitim gerçekleşme oranları; eğitim bazında planlanan/katılan/katılmayan/bekleyen sayıları, ortalama puan ve etkinlik oranı; personel–eğitim matrisi CSV/XLSX.
- CSV dosyaları UTF-8 BOM ve `;` ayırıcı ile Türkçe Excel’e uyumludur; XLSX gerçek bir Office Open XML çalışma kitabıdır (başlık biçimlendirmesi, donmuş başlık satırı, otomatik filtre ve sütun genişlikleri).

### 9. Otomatik E-posta Bildirimleri

- **Onaya gönderim:** Doküman onaya gönderildiğinde onaylayan ve kalite yöneticisi rolündeki kullanıcılara “onay bekliyor” e-postası gider.
- **Yayın:** Doküman yayınlandığında hedef departmanların aktif personeline, dokümanı açıp **“Okudum, Anladım”** onayı vermeleri için e-posta gider.
- **Eğitim hatırlatması:** Önümüzdeki 7 gün içindeki planlı eğitimlerin henüz katılım bildirmemiş katılımcılarına hatırlatma e-postası gider; aynı eğitim için tekrar gönderilmez.
- **Test / güvenli mod:** SMTP tanımlı değilse veya test modu açıksa e-posta gönderilmez; hata vermeden `data/outbox` klasörüne ve E-posta Günlüğü sayfasına kaydedilir. SMTP hataları kullanıcı işlemini engellemez.

### 10. Organizasyon ve Kullanıcılar

- Sistem Yöneticisi yeni departman açar/düzenler/siler (kullanıcı atanmış departman silinemez).
- Kullanıcı oluşturma, rol ve departman atama, hesabı aktif/pasif yapma, şifre belirleme.
- Her kullanıcı kendi şifresini değiştirebilir. Sistemde en az bir aktif yönetici kalması korunur.

### 11. Sistem Ayarları

- **Şirket Kimliği:** Şirket adı ve PNG/JPG logosu; PDF antetlerinde ve arayüzde kullanılır. “PDF Antet Önizlemesi” ile logonun PDF’te nasıl göründüğü doğrulanır.
- **SMTP:** Sunucu, port, SSL/TLS, kullanıcı, şifre, gönderen adı/e-postası. Gmail için uygulama şifresi gerekir.
- **Görünüm ve Test:** Saat dilimi ve e-posta test modu.
- **Test araçları:** SMTP bağlantı testi ve test e-postası.
- Varsayılan sunucu portu `3005`’tir.

### 12. DÖF Yönetimi (Faz 4)

- **Kayıt ve otomatik kodlama:** Sol menüdeki **DÖF Yönetimi** ekranından yeni kayıt açılır. `DOF-YYYY-NNN` numarası tespit tarihinin yılına göre otomatik üretilir. Kayıt alanları: DÖF türü (Düzeltici Faaliyet / Önleyici Faaliyet), uygunsuzluk kaynağı (İç Tetkik, Müşteri Şikayeti, Süreç/Üretim Hatası, YGG, Diğer), ilgili departman, talep eden kişi, tespit tarihi, uygunsuzluk tanımı ve yayındaki kalite dokümanlarından ilgili doküman seçimi.
- **Kök neden ve aksiyon planı:** 5 Neden / kök neden açıklaması ve acil/geçici önlem alanları. Bir DÖF altında birden çok aksiyon maddesi; her biri için sorumlu personel, hedef tarih, durum (`Açık`, `Devam Ediyor`, `Tamamlandı`, `Gecikti`) ve kanıt açıklaması/dosyası (PDF, Word, Excel, PNG, JPG veya TXT; en fazla 10 MB). Hedef tarihi geçen tamamlanmamış aksiyonlar otomatik “Gecikti” görünür.
- **Etkinlik ve kapatma:** `Açık → Kök Neden & Aksiyon Aşamasında → Etkinlik Kontrolü Bekliyor → Kapandı`. Tüm aksiyonlar tamamlandığında durum otomatik etkinlik kontrolüne geçer; Kalite Yöneticisi/Sistem Yöneticisi etkinlik değerlendirmesi notuyla kapatır. Kapanmış kayıtlar salt okunurdur.
- **Antetli DÖF raporu PDF:** Şirket adı/logosu, DÖF künyesi, uygunsuzluk tanımı, acil önlem, kök neden, aksiyon tablosu ve kapanış onayı/imza kutularıyla A4 PDF; `PDF Önizle` ve `PDF İndir`.
- **Liste, filtreler ve dışa aktarma:** Durum, tür, kaynak, departman ve geciken filtreleri; DÖF ana listesinin CSV ve gerçek XLSX çıktısı. Dışa aktarma yalnızca `dof` yetkisi olan kullanıcılara açıktır.
- **Bildirimler:** DÖF açıldığında ilgili departmanın aktif personeline, aksiyon atandığında sorumluya uygulama içi bildirim ve SMTP e-postası gider; SMTP yoksa test modunda outbox ve E-posta Günlüğü’ne kaydedilir. Sorumlu personel kendi aksiyonunun durumunu ve kanıtını güncelleyebilir.

## PDF Tasarımı

- A4 dikey sayfa, kurumsal antet bandı, **sol üstte şirket/şablon logosu için ayrı kutu** ve sağda şirket adı.
- Dört hücreli doküman bilgi tablosu (kod, tür, revizyon, yayın tarihi).
- Bölüm başlıkları renkli işaretle, gövde metni satır sonu ve paragrafları koruyarak yazılır.
- Alt bilgide hazırlayan ve onaylayan kutuları; onay öncesi “Onay bekliyor”, yayında onay tarihi görünür.
- Her sayfada `Sayfa X/Y` ve doküman kodu; logo tüm sayfalarda tekrar basılır.
- Taslakta her sayfada açılı **TASLAK** filigranı.
- Logo; yüklenen PNG/JPG dosyasından veya Base64/data-URI verisinden okunur, en-boy oranı korunarak kutuya sığdırılır. WEBP gibi PDFKit’in çözemediği formatlar sessizce atlanmaz; yükleme reddedilir ve mevcut kayıt için uyarı gösterilir.
- Türkçe karakterler için Unicode TTF gömülür; font bulunamazsa güvenli bir yedek yazı tipi ve Türkçe karakter dönüşümü kullanılır.
- **DÖF raporu** ayrı bir antetli form olarak üretilir: kırmızı kurumsal antet bandı, logo kutusu ve şirket adı; DÖF No, tür, durum ve tespit tarihi tablosu; künye, uygunsuzluk tanımı, acil önlem, kök neden, aksiyon tablosu (sorumlu, hedef tarih, durum, kanıt) ve etkinlik değerlendirmesi/kapanış imza kutuları. Aksiyon tablosu sayfa sonunda bölünebilir ve her yeni sayfada antet yeniden basılır.

## Demo Verisi

Ekran görüntülerindeki gibi örnek verilerle denemek için:

```bash
npm run demo
npm start
```

Mevcut demo verilerini silip yeniden oluşturmak için:

```bash
npm run demo -- --sifirla
```

Demo komutu; örnek kullanıcıları, departman atamalarını, şablon kontrollü dokümanları, revizyonları, onay bekleyen kayıtları, okuma durumlarını, **eğitim planı/katılım sonuçlarını** ve **örnek DÖF kayıtları/aksiyonlarını** oluşturur. E-posta ayarları **test modunda** kaydedilir; gerçek e-posta gönderilmez.

### Demo Giriş Bilgileri

| Rol | E-posta | Şifre |
| --- | --- | --- |
| Sistem Yöneticisi | `admin@qdms.local` | `Admin123!` |
| Kalite Yöneticisi | `kalite@ornek.com` | `Kalite123!` |
| Doküman Hazırlayan | `hazirlayan@ornek.com` | `Hazirlayan123!` |
| Onaylayan | `onaylayan@ornek.com` | `Onaylayan123!` |
| Standart Kullanıcı (Üretim) | `saha@ornek.com` | `Standart123!` |
| Standart Kullanıcı (Bakım) | `bakim@ornek.com` | `Standart123!` |

> Demo şifreleri yalnızca yerel deneme içindir.

## Testler

```bash
npm test
```

Testler şunları kapsar:

- Giriş, oturum, varsayılan yönetici, rol bazlı yetkilendirme ve şifre değişimi
- Departman/kullanıcı oluşturma, yönetim ekranlarının yetki koruması
- Doküman oluşturma, otomatik kodlama ve zorunlu alan doğrulaması
- Taslak/onaylı PDF üretimi, Türkçe karakterler ve taslak-yayın farkı
- Onaya gönderme, onaylama, iade ve arşivleme
- Yeni revizyon oluşturma, eski revizyonun arşivlenmesi ve değişiklik notu
- Dağıtım, “Okudum, Anladım”, yüzdelik takip ve erişim sınırları
- Şablon ve logo kaydetme, PDF önizleme, şirket kimliği
- Logo Buffer/base64/dosya yolu, antet kutusu, WEBP reddi ve çok sayfalı logo basımı
- Hazır PDF yükleme/indirme
- SMTP bağlantısı, e-posta günlüğü ve ayar yönetimi
- Onay/yayın/eğitim hatırlatma e-postaları, alıcı filtreleri, tekrar gönderim engeli ve test modu
- Eğitim planı oluşturma, departman/personel atama, katılım-puan-etkinlik sonuçları ve personel sicili
- Rapor sayfaları, filtreler, CSV (BOM/`;`) ve gerçek XLSX çıktıları, yetki koruması
- CSV/XLSX üreticisinin biçim, kaçış ve boş veri davranışı
- DÖF tabloları, otomatik `DOF-YYYY-NNN` kodlama, görünürlük, kök neden ve aksiyon akışı, kanıt yükleme/indirme, etkinlik kontrolü ve kapatma
- DÖF PDF raporu, CSV/XLSX listesi, dashboard özet kartı ve DÖF e-posta bildirimleri (test modu)
- Kaldırılan toplantı/aksiyon sayfalarının artık 404 döndürmesi ve menüde görünmemesi

## Proje Yapısı

```text
.
├── server.js                 # Uygulama giriş noktası (varsayılan port 3005)
├── src/
│   ├── app.js                # Express rotaları: QDMS arayüzü
│   ├── auth.js               # Şifre (scrypt), oturum, roller ve yetkiler
│   ├── qdms.js               # Doküman türleri, durumlar, şablon/kod yardımcıları
│   ├── varsayilanlar.js      # İlk kurulum seed: departman, tür, şablon, admin
│   ├── pdf.js                # PDFKit ile antetli/filigranlı doküman ve DÖF PDF üretimi
│   ├── dof.js                # DÖF tür/kaynak/durum sabitleri, kodlama ve görünürlük yardımcıları
│   ├── dof-rotalari.js       # DÖF kayıt/aksiyon/kapatma, kanıt, PDF ve CSV/XLSX rotaları
│   ├── egitim-rotalari.js    # Eğitim planı, katılımcı, sonuç ve personel sicili rotaları
│   ├── rapor-rotalari.js     # Doküman/okundu/eğitim raporları ve CSV/XLSX indirme
│   ├── disa-aktarma.js       # Bağımlılıksız CSV ve gerçek XLSX üretici
│   ├── bildirimler.js        # Onay/yayın/eğitim e-postalarının gönderim kuralları
│   ├── hatirlatmalar.js      # Yaklaşan eğitimler için zamanlanmış hatırlatma
│   ├── emails.js             # HTML e-posta şablonları
│   ├── mailer.js             # Nodemailer + test modu outbox
│   ├── db.js                 # SQLite şeması ve bağlantı
│   ├── config.js             # .env ve yapılandırma
│   ├── dates.js              # Tarih/saat/saat dilimi yardımcıları
│   ├── dogrulama.js          # Form ve e-posta doğrulama
│   ├── settings.js           # Ayar okuma/yazma, şirket kimliği
│   └── sabitler.js           # E-posta durum ve tür etiketleri
├── views/                    # EJS sayfaları ve partial'lar (DÖF: dof, dof-yeni, dof-detay)
├── public/                   # CSS (styles, egitim, raporlar, dof), JS, favicon
├── scripts/demo-verisi.js    # Örnek QDMS verisi (doküman + eğitim + DÖF)
├── test/                     # node:test testleri (dof.test.js dahil)
├── docs/screenshots/         # Önce/sonra ekran görüntüleri
├── data/                     # SQLite, outbox ve yüklemeler (gitignore)
└── .github/workflows/test.yml
```

## Veritabanı Şeması (Özet)

- `kullanicilar`: `id`, `ad`, `email`, `sifre_hash` (scrypt), `rol`, `departman_id`, `aktif`
- `departmanlar`: `id`, `ad`, `aciklama`
- `oturumlar`: `token`, `kullanici_id`, `son_gecerlilik`
- `dokuman_turleri`: `kod` (`PR`, `TL`, `EK`, `LS`, `FR`), `ad`, `sira`
- `sablonlar`: `tur_kod`, `baslik`, `bolumler` (JSON), `antet_renk`, `kenarlik_stili`, `logo_yolu`, `altbilgi_hazirlayan`, `altbilgi_onaylayan`
- `dokumanlar`: `kod`, `tur_kod`, `baslik`, `revizyon`, `durum`, `icerik` (JSON bölümler), `degisiklik_notu`, `hazirlayan_id`, `onaylayan_id`, `onay_tarihi`, `yayin_tarihi`, `dosya_yolu`
- `dokuman_hedef_departmanlar`: doküman ↔ departman dağıtım hedefi
- `dokuman_okumalari`: `dokuman_id`, `kullanici_id`, `okundu`, `okunma_tarihi`
- `dokuman_onaylari`: doküman üzerindeki işlem geçmişi (`olustur`, `onaya_gonder`, `onayla`, `reddet`, `arsivle`, `revizyon`)
- `bildirimler`: kullanıcıya özel onay/doküman/eğitim bildirimleri
- `egitimler`: `ad`, `tur` (`ic`/`dis`), `egitmen`, `planlanan_tarih`, `sure_saat`, `dokuman_id`, `aciklama`, `durum` (`planlandi`/`tamamlandi`/`iptal`)
- `egitim_katilimcilari`: `egitim_id`, `kullanici_id`, `katilim_durumu`, `degerlendirme_puani` (0–100), `etkinlik_durumu`, `sertifika_no`, `not_metni`, `hatirlatma_tarihi`
- `dof_kayitlari`: `kod` (`DOF-YYYY-NNN`), `tur` (`duzeltici`/`onleyici`), `kaynak`, `departman_id`, `talep_eden`, `tespit_tarihi`, `uygunsuzluk_tanimi`, `dokuman_id`, `kok_neden`, `acil_onlem`, `durum` (`acik`/`kok_neden`/`etkinlik_bekliyor`/`kapandi`), `etkinlik_degerlendirmesi`, `kapatan_id`, `kapanis_tarihi`, `olusturan_id`
- `dof_aksiyonlari`: `dof_id`, `sira`, `aciklama`, `sorumlu_id`, `hedef_tarih`, `durum` (`acik`/`devam_ediyor`/`tamamlandi`/`gecikti`), `kanit_aciklama`, `kanit_dosya`, `kanit_dosya_adi`, `tamamlanma_tarihi`
- `ayarlar`, `email_kayitlari`: sistem ayarları ve e-posta günlüğü

Doküman kodları `(kod, revizyon)` çiftinde benzersizdir; aynı kodun farklı revizyonları geçmiş olarak saklanır. Yabancı anahtarlar açıktır (`PRAGMA foreign_keys = ON`).

## Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3005` | HTTP portu |
| `HOST` | `127.0.0.1` | Dinlenecek adres (yalnızca yerel kullanım için değiştirmeyin) |
| `DATA_DIR` | `./data` | Veri klasörü |
| `DB_YOLU` | `./data/toplanti.db` | SQLite veritabanı yolu |
| `OUTBOX_DIR` | `./data/outbox` | Test modu e-posta çıktı klasörü |
| `SMTP_HOST` | boş | SMTP sunucusu |
| `SMTP_PORT` | `587` | SMTP portu |
| `SMTP_SECURE` | `false` | `true` ise SSL/TLS (genellikle 465) |
| `SMTP_USER` | boş | SMTP kullanıcısı |
| `SMTP_PASS` | boş | SMTP şifresi / uygulama şifresi |
| `SMTP_FROM_EMAIL` | boş | Gönderen adresi |
| `SMTP_FROM_NAME` | `Kurumsal Kalite Yönetim Sistemi` | Gönderen adı |
| `SAAT_DILIMI` | `Europe/Istanbul` | Tarih/saat gösterimi için IANA saat dilimi |
| `MAIL_TEST_MODE` | boş | `1` ise e-postalar gönderilmez, outbox’a yazılır |
| `PDF_FONT_YOLU` | boş | PDF için isteğe bağlı normal TTF yolu |
| `PDF_FONT_KALIN_YOLU` | boş | PDF için isteğe bağlı kalın TTF yolu |

Arayüzden kaydedilen değerler `.env` değerlerini geçersiz kılar. SMTP şifresi boş bırakılırsa mevcut şifre korunur.

## Güvenlik Notları

- İlk kurulum yönetici şifresi `README.md`’de açıkça yer alır; **ilk girişte değiştirilmelidir**.
- Parolalar `scrypt` ile tuzlanmış olarak saklanır. Oturumlar `HttpOnly`, `SameSite=Lax` çerezle ve sunucu tarafındaki rastgele token ile yönetilir; süre 7 gündür.
- Uygulama varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler. İnternete açık bir sunucuya taşınacaksa HTTPS, ters vekil (reverse proxy), güvenlik duvarı ve istek sınırlandırma eklenmelidir.
- Yüklenen logolar PNG/JPG ile, belgeler PDF/XLS/XLSX ile, DÖF kanıt dosyaları PDF/Word/Excel/PNG/JPG/TXT ile ve 10 MB sınırıyla kısıtlanır; dosyalar yalnızca oturum açmış ve kayda erişimi olan kullanıcılara sunulur.
- Formlarda CSRF token’ı ve giriş denemesi sınırlandırması yoktur; yerel/kurum içi kullanım için tasarlanmıştır.
- SMTP şifresi SQLite’ta düz metin olarak saklanır. `data/` klasörünü ve `.env` dosyasını koruyun; depoya eklemeyin.

## Sınırlamalar

- Uygulama tek sunucu/tek veritabanı için tasarlanmıştır; çok kiracılı (multi-tenant) değildir.
- Yüklenen hazır PDF’lerin üzerine **TASLAK** filigranı eklenmez; filigran yalnızca sistem tarafından üretilen PDF’lerde uygulanır. Excel dosyaları tarayıcıda önizlenemez.
- PDF üretimi işletim sistemindeki Unicode yazı tipine bağlıdır. Hiçbir TTF bulunamazsa Türkçe karakterler ASCII karşılıklarıyla yazılır (`PDF_FONT_YOLU` ile giderilebilir).
- PDFKit PNG ve JPEG logoları basar; **WEBP logo PDF’e gömülemez**. WEBP yüklemeleri reddedilir; eski kayıtlı WEBP logolar PNG/JPG olarak yeniden yüklenmelidir.
- E-posta teslimi SMTP sağlayıcısına bağlıdır. Eğitim hatırlatmaları uygulama açıkken çalışır (açılışta ve 6 saatte bir); uygulama kapalıyken planlanmış gönderim yapılmaz.
- E-posta ekleri ve takvim (iCal) entegrasyonu yoktur.
- Kurumsal raporlar tek tablo/çalışma sayfası olarak indirilir; XLSX dosyalarında formül veya grafik üretilmez.
- DÖF kayıtları silinmez; kapanmış DÖF’ler salt okunurdur ve yeniden açılmaz. Kanıt dosyaları uygulama içinden indirilebilir, ayrı bir sürüm geçmişi tutulmaz.

## Sorun Giderme

| Sorun | Çözüm |
| --- | --- |
| `Cannot find module 'node:sqlite'` | Node.js sürümünüzü 24+ yapın. |
| `EADDRINUSE` | Port kullanımda; `.env` içinde `PORT=3006` gibi başka bir port seçin. |
| Giriş yapılamıyor | Varsayılan yönetici bilgileriyle (`admin@qdms.local` / `Admin123!`) deneyin; şifre değiştirildiyse yöneticinizden sıfırlamasını isteyin. |
| PDF’de Türkçe karakter bozuk | `PDF_FONT_YOLU` ile Unicode bir TTF dosyası gösterin (örn. Segoe UI veya DejaVu Sans). |
| Logo görünmüyor | PNG veya JPG formatında ve 10 MB altında olduğundan emin olun; WEBP desteklenmez. Şablona özel logo yoksa şirket logosu kullanılır. **Sistem Ayarları → PDF Antet Önizlemesi** ile kontrol edin. |
| SMTP bağlantısı kurulamıyor | Sunucu/port değerlerini, Gmail için uygulama şifresini ve 2FA’yı kontrol edin. |
| Tarih alanı `mm/dd/yyyy` gösteriyor | Tarayıcı yerel ayarıdır; uygulama tarihleri `gg.aa.yyyy` olarak gösterir. |

## Lisans

MIT
