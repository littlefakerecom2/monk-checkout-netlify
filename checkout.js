/* ============================================================
   TAO SHEN CHECKOUT — CHECKOUT.JS
   Frontend logic: form validasyon, checkbox zorlaması,
   Authorize.net tokenizasyon, backend'e gönderim
   ============================================================ */

/* ============================================================
   UYGULAMA KONFİGÜRASYONU
   Bu değerleri değiştirmen gerekirse buradan değiştir.
   ⚠️  API key'leri buraya YAZMA — Netlify Environment Variables'da.
       Bu dosya public GitHub'da duruyor.
   ============================================================ */
const CONFIG = {
  // Authorize.net Accept.js için public client key
  // Sandbox dashboard: Account → Security Settings → General Security Settings → Manage Public Client Key
  API_LOGIN_ID:          '5uDp8Rp8Une',        // Sandbox Login ID (public — güvenli)
  CLIENT_KEY:            '3NMV5wgD7Fd2vZg2ZQJ6XdGtM6U7gEb9q93AyJfHn55xHd6Uu36V4x9w6gYtBHUH', // Sandbox public client key

  ENVIRONMENT:           'SANDBOX',             // Production'da 'PRODUCTION' yap

  FRONT_END_PRICE:       '9.99',                // $9.99 — ebook fiyatı
  SUBSCRIPTION_PRICE:    '49.99',               // $49.99 — aylık abonelik
  TRIAL_DAYS:            14,                    // Ücretsiz deneme süresi (gün)

  PRODUCT_NAME:          '7-Day Monk Reset',    // Ürün adı
  SUBSCRIPTION_NAME:     'Tao Shen Inner Circle',

  STORE_NAME:            'Tao Shen',
  SUCCESS_URL:           '/success.html',       // Başarılı ödeme sonrası yönlendirme
};

/*
  (*) CLIENT_KEY nasıl alınır:
  sandbox.authorize.net → Account → Security Settings →
  General Security Settings → Manage Public Client Key → Generate
  O değeri buraya yaz.
  (API Login ID'den farklı, ayrıca üretilmesi gerekiyor)
*/

/* ============================================================
   DOM ELEMANLARINI SEÇ
   ============================================================ */
const vipCheckbox      = document.getElementById('vipCheckbox');
const payButton        = document.getElementById('payButton');
const payButtonText    = document.getElementById('payButtonText');
const payButtonSpinner = document.getElementById('payButtonSpinner');
// checkboxWarning removed — subscription is now optional
const errorMessageDiv  = document.getElementById('errorMessage');

/* ============================================================
   KART NUMARASI — Otomatik boşluk formatı (4444 4444 4444 4444)
   ============================================================ */
document.getElementById('cardNumber').addEventListener('input', function (e) {
  let val = e.target.value.replace(/\D/g, '').substring(0, 16);
  val = val.replace(/(\d{4})(?=\d)/g, '$1 ');
  e.target.value = val;
});

/* ============================================================
   SON KULLANMA TARİHİ — Otomatik format (MM / YY)
   ============================================================ */
document.getElementById('expiry').addEventListener('input', function (e) {
  let val = e.target.value.replace(/\D/g, '').substring(0, 4);
  if (val.length >= 3) {
    val = val.substring(0, 2) + ' / ' + val.substring(2);
  }
  e.target.value = val;
});

/* ============================================================
   CHECKBOX DEĞİŞİKLİĞİ — Inner Circle özet kutusunu göster/gizle
   Checkbox opsiyonel — sipariş her durumda tamamlanabilir.
   ============================================================ */
vipCheckbox.addEventListener('change', function () {
  const vipBox = document.getElementById('vipSummaryBox');
  if (vipBox) {
    vipBox.style.display = this.checked ? 'block' : 'none';
  }
});

/* ============================================================
   KOŞULLAR METNİNİ GÖSTER/GİZLE
   ============================================================ */
function toggleTerms(e) {
  e.preventDefault();
  const termsEl = document.getElementById('termsExpanded');
  const isVisible = termsEl.style.display !== 'none';
  termsEl.style.display = isVisible ? 'none' : 'block';
  e.target.textContent  = isVisible ? 'View full terms →' : 'Hide terms ↑';
}

/* ============================================================
   FORM VALIDASYON
   ============================================================ */
function validateForm() {
  const email      = document.getElementById('email').value.trim();
  const firstName  = document.getElementById('firstName').value.trim();
  const lastName   = document.getElementById('lastName').value.trim();
  const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
  const expiry     = document.getElementById('expiry').value.replace(/\s/g, '');
  const cvv        = document.getElementById('cvv').value.trim();
  const nameOnCard = document.getElementById('nameOnCard').value.trim();

  if (!email || !email.includes('@') || !email.includes('.')) {
    showError('Please enter a valid email address.'); return false;
  }
  if (!firstName || !lastName) {
    showError('Please enter your first and last name.'); return false;
  }
  if (cardNumber.length < 15 || cardNumber.length > 16) {
    showError('Please enter a valid card number.'); return false;
  }
  if (!expiry || expiry.replace('/', '').length < 4) {
    showError('Please enter a valid expiration date (MM/YY).'); return false;
  }
  if (!cvv || cvv.length < 3) {
    showError('Please enter your security code (CVV).'); return false;
  }
  if (!nameOnCard) {
    showError('Please enter the name on your card.'); return false;
  }

  return true;
}

/* ============================================================
   SIPARIŞ BUTONU TIKLANDI — Ana akış başlar
   ============================================================ */
function handleSubmit() {

  // 1. Form validasyonu
  hideError();
  if (!validateForm()) return;

  // 3. Butonu loading state'e al (çift tıklamayı önler)
  setLoading(true);

  // 4. Expiry'yi ay ve yıla ayır
  const expiryRaw  = document.getElementById('expiry').value.replace(/\s/g, '');
  const expiryParts = expiryRaw.split('/');
  const expMonth   = expiryParts[0].trim();
  const expYear    = '20' + expiryParts[1].trim(); // "26" → "2026"

  // 5. Authorize.net Accept.js için auth ve kart verisi hazırla
  const authData = {
    clientKey:    CONFIG.CLIENT_KEY,
    apiLoginID:   CONFIG.API_LOGIN_ID
  };

  const cardData = {
    cardNumber: document.getElementById('cardNumber').value.replace(/\s/g, ''),
    month:      expMonth,
    year:       expYear,
    cardCode:   document.getElementById('cvv').value.trim()
  };

  // 6. Accept.js kart bilgisini güvenli token'a çevirir
  //    Kart numarası sunucumuza hiç ulaşmaz — direkt Authorize.net'e gider
  Accept.dispatchData({ authData, cardData }, handleTokenResponse);
}

/* ============================================================
   TOKEN CEVABI — Accept.js'den dönen token
   ============================================================ */
async function handleTokenResponse(response) {

  // Token oluşturma başarısız olduysa (yanlış kart bilgisi vb.)
  if (response.messages.resultCode === 'Error') {
    const msg = response.messages.message[0].text;
    showError('Card error: ' + msg);
    setLoading(false);
    return;
  }

  // Token başarılı — Netlify backend'e gönder
  const opaqueData = response.opaqueData;

  try {
    const result = await fetch('/.netlify/functions/process-payment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        opaqueData:          opaqueData,
        email:               document.getElementById('email').value.trim(),
        firstName:           document.getElementById('firstName').value.trim(),
        lastName:            document.getElementById('lastName').value.trim(),
        amount:              CONFIG.FRONT_END_PRICE,
        subscriptionAmount:  CONFIG.SUBSCRIPTION_PRICE,
        trialDays:           CONFIG.TRIAL_DAYS,
        productName:         CONFIG.PRODUCT_NAME,
        subscriptionName:    CONFIG.SUBSCRIPTION_NAME
      })
    });

    const data = await result.json();

    if (data.success) {
      // Başarılı — success sayfasına yönlendir
      const email = encodeURIComponent(document.getElementById('email').value.trim());
      const vip = document.getElementById('vipCheckbox').checked ? '&vip=1' : '';
      window.location.href = CONFIG.SUCCESS_URL + '?email=' + email + vip;
    } else {
      // Backend'den hata döndü
      showError(data.error || 'Payment failed. Please check your card details and try again.');
      setLoading(false);
    }

  } catch (err) {
    // Network hatası
    showError('Connection error. Please check your internet and try again.');
    setLoading(false);
  }
}

/* ============================================================
   YARDIMCI FONKSİYONLAR
   ============================================================ */

// Butonu loading / normal state'e al
function setLoading(isLoading) {
  if (isLoading) {
    payButton.disabled          = true;
    payButtonText.style.display    = 'none';
    payButtonSpinner.style.display = 'inline';
  } else {
    payButton.disabled          = false;
    payButtonText.style.display    = 'inline';
    payButtonSpinner.style.display = 'none';
  }
}

// Hata mesajı göster
function showError(message) {
  errorMessageDiv.textContent    = message;
  errorMessageDiv.style.display  = 'block';
  errorMessageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Hata mesajını gizle
function hideError() {
  errorMessageDiv.style.display = 'none';
  errorMessageDiv.textContent   = '';
}
