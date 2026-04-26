// api/subscribe.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Vercel doesn't auto-parse bodies for plain Node functions — do it manually
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Parse body explicitly
  const body = req.body && typeof req.body === 'object' ? req.body : await parseBody(req);
  const { email, kidName, age, plan, paymentMethodId } = body;

  // Debug log — shows in Vercel function logs, never sent to browser
  console.log('Request body received:', { email, kidName, age, plan, hasPaymentMethod: !!paymentMethodId });
  console.log('Env vars present:', {
    hasSecretKey:    !!process.env.STRIPE_SECRET_KEY,
    hasPriceMonthly: !!process.env.STRIPE_PRICE_MONTHLY,
    hasPriceAnnual:  !!process.env.STRIPE_PRICE_ANNUAL,
    hasHubspot:      !!process.env.HUBSPOT_TOKEN,
  });

  if (!email || !paymentMethodId) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  console.log('Selected plan:', plan, '-> priceId:', priceId);

  if (!priceId) {
    return res.status(500).json({ error: 'Server configuration error. Please contact hello@wildcoders.org.' });
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name: kidName || 'WildCoder',
      payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId },
      metadata: { kidName: kidName || '', kidAge: String(age || ''), plan: plan || 'monthly', source: 'wildcoders-subscribe' }
    });

    const subscription = await stripe.subscriptions.create({
      customer:          customer.id,
      items:             [{ price: priceId }],
      trial_period_days: 7,
      payment_behavior:  'default_incomplete',
      expand:            ['latest_invoice.payment_intent'],
      metadata:          { kidName: kidName || '', kidAge: String(age || ''), plan: plan || 'monthly' }
    });

    // HubSpot — uses https module for Vercel Node compatibility (fetch is unreliable)
    console.log('Attempting HubSpot contact creation for:', email);
    console.log('HubSpot token present:', !!process.env.HUBSPOT_TOKEN, 'length:', (process.env.HUBSPOT_TOKEN || '').length);
    try {
      await new Promise((resolve) => {
        const https = require('https');
        const hubBody = JSON.stringify({
          properties: {
            email,
            firstname: kidName || '',
            lifecyclestage: 'customer'
          }
        });
        const hubReq = https.request({
          hostname: 'api.hubapi.com',
          path: '/crm/v3/objects/contacts',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
            'Content-Length': Buffer.byteLength(hubBody)
          }
        }, (hubRes) => {
          let data = '';
          hubRes.on('data', chunk => { data += chunk; });
          hubRes.on('end', () => {
            console.log('HubSpot status:', hubRes.statusCode);
            console.log('HubSpot body:', data.substring(0, 500));
            resolve();
          });
        });
        hubReq.on('error', (e) => {
          console.error('HubSpot request error:', e.message);
          resolve();
        });
        hubReq.write(hubBody);
        hubReq.end();
      });
    } catch (hubErr) {
      console.error('HubSpot failed (non-fatal):', hubErr.message);
    }

    return res.status(200).json({
      success:        true,
      subscriptionId: subscription.id,
      customerId:     customer.id,
      trialEnd:       subscription.trial_end,
      plan
    });

  } catch (err) {
    console.error('Stripe error:', err.type, err.message);
    if (err.type === 'StripeCardError')           return res.status(402).json({ error: err.message });
    if (err.type === 'StripeInvalidRequestError') return res.status(400).json({ error: 'Invalid payment details. Please try again.' });
    return res.status(500).json({ error: 'Something went wrong. Please try again or email hello@wildcoders.org.' });
  }
};
