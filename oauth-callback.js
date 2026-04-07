/* ============================================================
   SHOPIFY OAUTH CALLBACK — netlify/functions/oauth-callback.js
   
   Shopify authorization code'unu yakalar ve
   anında access token'a çevirir.
   Bu function sadece token almak için kullanılır,
   production'da kaldırılabilir.
   ============================================================ */

const https = require('https');

exports.handler = async (event) => {

  const params = event.queryStringParameters || {};
  const code   = params.code;
  const shop   = params.shop;

  // Eğer code yoksa bilgi sayfası göster
  if (!code || !shop) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#f0ebe3;">
          <h2 style="color:#c9a96e;">OAuth Callback</h2>
          <p>No code received. Go back and try the authorization URL again.</p>
        </body></html>
      `
    };
  }

  // Client credentials — Netlify env'den al
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#f0ebe3;">
          <h2 style="color:#c47a7a;">Config Error</h2>
          <p>SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not set in Netlify environment variables.</p>
        </body></html>
      `
    };
  }

  // Code'u token'a çevir
  try {
    const tokenData = JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      code:          code
    });

    const token = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: shop,
        path:     '/admin/oauth/access_token',
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(tokenData)
        }
      }, (res) => {
        let data = '';
        res.on('data',  chunk => { data += chunk; });
        res.on('end',   ()    => { resolve(data); });
      });
      req.on('error', reject);
      req.write(tokenData);
      req.end();
    });

    const parsed = JSON.parse(token);

    if (parsed.access_token) {
      // Başarılı — token'ı göster
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#f0ebe3;">
            <h2 style="color:#c9a96e;">✅ Access Token Alındı!</h2>
            <p>Aşağıdaki token'ı kopyala ve Netlify'da<br>
            <strong>SHOPIFY_ACCESS_TOKEN</strong> olarak ekle:</p>
            <div style="background:#1a1612;border:2px solid #c9a96e;padding:20px;border-radius:8px;margin:20px 0;">
              <code style="color:#e8c98a;font-size:16px;word-break:break-all;">
                ${parsed.access_token}
              </code>
            </div>
            <p style="color:#7ab87a;">Scope: ${parsed.scope || 'unknown'}</p>
            <p style="color:#a09080;font-size:13px;">
              Bu token'ı kopyaladıktan sonra bu sayfayı kapatabilirsin.<br>
              Bu function'ı güvenlik için sonradan silebilirsin.
            </p>
          </body></html>
        `
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#f0ebe3;">
            <h2 style="color:#c47a7a;">❌ Hata</h2>
            <pre style="background:#1a1612;padding:20px;border-radius:8px;color:#c47a7a;">
              ${JSON.stringify(parsed, null, 2)}
            </pre>
          </body></html>
        `
      };
    }

  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#f0ebe3;">
          <h2 style="color:#c47a7a;">❌ Network Error</h2>
          <p>${err.message}</p>
        </body></html>
      `
    };
  }
};
