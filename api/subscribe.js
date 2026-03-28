// api/subscribe.js
// Vercel serverless function — runs server-side, never exposed to browser
// Deploy by placing this file at /api/subscribe.js in your GitHub repo root
// Vercel auto-detects it and exposes it at /api/subscribe

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { email, kidName, age, plan, paymentMethodId } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!email || !paymentMethodId) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // Pick the right price based on plan selection
  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) {
    console.error('Missing price ID env var for plan:', plan);
    return res.status(500).json({ error: 'Server configuration error. Please contact hello@wildcoders.org.' });
  }

  try {
    // ── 1. Create Stripe customer ────────────────────────────────────────────
    const customer = await stripe.customers.create({
      email,
      name: kidName || 'WildCoder',
      payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId },
      metadata: {
        kidName: kidName || '',
        kidAge:  String(age || ''),
        plan:    plan    || 'monthly',
        source:  'wildcoders-subscribe'
      }
    });

    // ── 2. Create subscription with 7-day trial ──────────────────────────────
    const subscription = await stripe.subscriptions.create({
      customer:            customer.id,
      items:               [{ price: priceId }],
      trial_period_days:   7,
      payment_behavior:    'default_incomplete',
      expand:              ['latest_invoice.payment_intent'],
      metadata: {
        kidName: kidName || '',
        kidAge:  String(age || ''),
        plan:    plan    || 'monthly'
      }
    });

    // ── 3. Create HubSpot contact ────────────────────────────────────────────
    try {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`
        },
        body: JSON.stringify({
          properties: {
            email,
            firstname:        kidName || '',
            lifecyclestage:   'customer',
            hs_lead_source:   'WildCoders Trial',
            // Custom properties — add these in HubSpot if you want them stored:
            // kid_age:       String(age || ''),
            // subscription_plan: plan || 'monthly',
            // stripe_customer_id: customer.id
          }
        })
      });
    } catch (hubspotErr) {
      // Don't fail the whole request if HubSpot is down — log and continue
      console.error('HubSpot contact creation failed:', hubspotErr.message);
    }

    // ── 4. Return success ────────────────────────────────────────────────────
    return res.status(200).json({
      success:        true,
      subscriptionId: subscription.id,
      customerId:     customer.id,
      trialEnd:       subscription.trial_end,   // Unix timestamp
      plan
    });

  } catch (err) {
    console.error('Stripe error:', err);

    // Surface Stripe's card errors clearly to the user
    if (err.type === 'StripeCardError') {
      return res.status(402).json({ error: err.message });
    }
    if (err.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: 'Invalid payment details. Please try again.' });
    }

    return res.status(500).json({
      error: 'Something went wrong on our end. Please try again or email hello@wildcoders.org.'
    });
  }
};
