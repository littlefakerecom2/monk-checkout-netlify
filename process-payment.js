const https = require('https');

const AUTH_NET_LOGIN_ID        = process.env.AUTH_NET_LOGIN_ID;
const AUTH_NET_TRANSACTION_KEY = process.env.AUTH_NET_TRANSACTION_KEY;
const AUTH_NET_ENV             = process.env.AUTH_NET_ENV || 'sandbox';
const SHOPIFY_STORE_URL        = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN     = process.env.SHOPIFY_ACCESS_TOKEN;

// Shopify ürün variant ID — Filemonk bu ID ile eşleşiyor
const SHOPIFY_VARIANT_ID = '47674782744788';

const AUTH_NET_ENDPOINT = AUTH_NET_ENV === 'production'
  ? 'api.authorize.net'
  : 'apitest.authorize.net';

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false }) };

  var body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid request' }) }; }

  var opaqueData       = body.opaqueData;
  var email            = body.email;
  var firstName        = body.firstName;
  var lastName         = body.lastName;
  var amount           = body.amount;
  var subscriptionAmount = body.subscriptionAmount;
  var trialDays        = body.trialDays;
  var subscriptionName = body.subscriptionName;
  var productName      = body.productName;

  if (!opaqueData || !email || !firstName || !lastName) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing fields' }) };
  }

  try {
    // ADIM 1: $9.99 charge
    var chargePayload = {
      createTransactionRequest: {
        merchantAuthentication: { name: AUTH_NET_LOGIN_ID, transactionKey: AUTH_NET_TRANSACTION_KEY },
        transactionRequest: {
          transactionType: 'authCaptureTransaction',
          amount: amount,
          payment: { opaqueData: { dataDescriptor: opaqueData.dataDescriptor, dataValue: opaqueData.dataValue } },
          billTo: { firstName: firstName, lastName: lastName, email: email }
        }
      }
    };

    var chargeResponse = safeParse(await anetRequest(chargePayload));
    console.log('CHARGE:', JSON.stringify(chargeResponse));

    var txResponse = chargeResponse.transactionResponse;
    if (!txResponse || txResponse.responseCode !== '1') {
      var err = txResponse && txResponse.errors
        ? txResponse.errors[0].errorText
        : (chargeResponse.messages && chargeResponse.messages.message ? chargeResponse.messages.message[0].text : 'Payment declined');
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err }) };
    }

    var transactionId = txResponse.transId;
    console.log('Charge success, transId:', transactionId);

    // ADIM 2: Customer Profile oluştur
    var profilePayload = {
      createCustomerProfileFromTransactionRequest: {
        merchantAuthentication: { name: AUTH_NET_LOGIN_ID, transactionKey: AUTH_NET_TRANSACTION_KEY },
        transId: transactionId,
        customer: { email: email }
      }
    };

    var profileResponse = safeParse(await anetRequest(profilePayload));
    console.log('PROFILE:', JSON.stringify(profileResponse));

    var customerProfileId        = profileResponse.customerProfileId;
    var customerPaymentProfileId = profileResponse.customerPaymentProfileIdList
      ? profileResponse.customerPaymentProfileIdList[0] : null;

    if (!customerProfileId || !customerPaymentProfileId) {
      console.error('Profile creation failed');
      // Ödeme başarılı, Shopify order oluştur ve devam et
      await createShopifyOrder({ email, firstName, lastName, amount, productName });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ADIM 3: ARB Subscription — 3 saniye bekle (sandbox propagation)
    var startDate = new Date();
    startDate.setDate(startDate.getDate() + parseInt(trialDays));
    var startDateStr = startDate.toISOString().split('T')[0];

    await new Promise(function(resolve) { setTimeout(resolve, 3000); });

    var subPayload = {
      ARBCreateSubscriptionRequest: {
        merchantAuthentication: { name: AUTH_NET_LOGIN_ID, transactionKey: AUTH_NET_TRANSACTION_KEY },
        subscription: {
          name: subscriptionName,
          paymentSchedule: {
            interval: { length: '1', unit: 'months' },
            startDate: startDateStr,
            totalOccurrences: '9999',
            trialOccurrences: '0'
          },
          amount: subscriptionAmount,
          trialAmount: '0.00',
          profile: {
            customerProfileId: customerProfileId,
            customerPaymentProfileId: customerPaymentProfileId
          }
        }
      }
    };

    var subResponse = safeParse(await anetRequest(subPayload));
    console.log('SUBSCRIPTION:', JSON.stringify(subResponse));

    if (subResponse.subscriptionId) {
      console.log('Subscription created, ID:', subResponse.subscriptionId);
    } else {
      console.error('Subscription error:', JSON.stringify(subResponse.messages));
    }

    // ADIM 4: Shopify order oluştur (variant_id ile — Filemonk tetiklenir)
    try {
      var orderResult = await createShopifyOrder({ email, firstName, lastName, amount, productName });
      console.log('Shopify order created:', orderResult.substring(0, 300));
    } catch (shopifyErr) {
      console.error('Shopify order error:', shopifyErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Payment processing error. Please try again.' }) };
  }
};

function safeParse(str) {
  return JSON.parse(str.replace(/^[\s\uFEFF\xEF\xBB\xBF]+/, '').trim());
}

function anetRequest(payload) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(payload);
    var req = https.request({
      hostname: AUTH_NET_ENDPOINT,
      path: '/xml/v1/request.api',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function createShopifyOrder(opts) {
  var orderPayload = JSON.stringify({
    order: {
      email: opts.email,
      financial_status: 'paid',
      send_receipt: true,
      line_items: [{
        // variant_id ile bağlanıyor — Filemonk bu sayede tetikleniyor
        variant_id: SHOPIFY_VARIANT_ID,
        title: opts.productName || '7-Day Monk Reset',
        price: opts.amount,
        quantity: 1,
        requires_shipping: false,
        taxable: false
      }],
      customer: {
        first_name: opts.firstName,
        last_name: opts.lastName,
        email: opts.email
      },
      tags: 'inner-circle-trial,checkout-external'
    }
  });

  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: SHOPIFY_STORE_URL,
      path: '/admin/api/2024-01/orders.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Length': Buffer.byteLength(orderPayload)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.write(orderPayload);
    req.end();
  });
}
