// Local PayPal REST simulator — used only when no sandbox credentials are configured (PAYPAL_ENV=mock),
// so judges can run the whole flow offline. Mirrors the request/response shapes of the real sandbox
// endpoints Wasl uses. Set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET to talk to the real PayPal sandbox instead.
import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';

import fs from 'node:fs';
import path from 'node:path';

// Simulator state survives restarts (data/mock-paypal.json) so held authorizations stay capturable.
const STATE = path.join(config.dataDir, 'mock-paypal.json');
const saved = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const orders = new Map(saved.orders || []);
const auths = new Map(saved.auths || []);
const batches = new Map(saved.batches || []);
const save = () => fs.writeFileSync(STATE, JSON.stringify({ orders: [...orders], auths: [...auths], batches: [...batches] }));
const rid = (n = 17) => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n);
const now = () => new Date().toISOString();
const err = (res, status, name, message) => res.status(status).json({ name, message, debug_id: rid(13).toLowerCase() });

export function mockPayPalRouter() {
  const r = express.Router();
  r.use(express.json());
  r.use(express.urlencoded({ extended: false }));

  r.use((req, res, next) => { if (req.method !== 'GET' || req.path.startsWith('/v1/payments/payouts/')) res.on('finish', save); next(); });

  r.post('/v1/oauth2/token', (req, res) => {
    if (!req.headers.authorization?.startsWith('Basic ')) return err(res, 401, 'AUTHENTICATION_FAILURE', 'Missing basic auth');
    res.json({ scope: 'https://uri.paypal.com/services/payments/payment', access_token: `A21_MOCK_${rid(24)}`, token_type: 'Bearer', app_id: 'APP-MOCK', expires_in: 32400 });
  });

  r.use((req, res, next) => {
    if (req.path.startsWith('/checkoutnow') || req.path.startsWith('/approve')) return next();
    if (!req.headers.authorization?.startsWith('Bearer ')) return err(res, 401, 'AUTHENTICATION_FAILURE', 'Missing bearer token');
    next();
  });

  r.post('/v2/checkout/orders', (req, res) => {
    const b = req.body;
    if (!['CAPTURE', 'AUTHORIZE'].includes(b.intent)) return err(res, 422, 'UNPROCESSABLE_ENTITY', 'intent invalid');
    const id = rid(17);
    const order = { id, intent: b.intent, status: 'PAYER_ACTION_REQUIRED', purchase_units: b.purchase_units, ctx: b.payment_source?.paypal?.experience_context || {}, create_time: now() };
    orders.set(id, order);
    res.status(201).json({
      id, status: order.status, payment_source: { paypal: {} },
      links: [
        { href: `${config.paypal.baseUrl}/v2/checkout/orders/${id}`, rel: 'self', method: 'GET' },
        { href: `${config.publicUrl}/mock-paypal/checkoutnow?token=${id}`, rel: 'payer-action', method: 'GET' },
      ],
    });
  });

  r.get('/v2/checkout/orders/:id', (req, res) => {
    const o = orders.get(req.params.id);
    if (!o) return err(res, 404, 'RESOURCE_NOT_FOUND', 'order not found');
    res.json({ id: o.id, intent: o.intent, status: o.status, purchase_units: o.purchase_units, payer: o.payer });
  });

  // Simulated buyer approval page (stands in for the PayPal sandbox login + consent screen).
  r.get('/checkoutnow', (req, res) => {
    const o = orders.get(req.query.token);
    if (!o) return res.status(404).send('Unknown order');
    const pu = o.purchase_units[0];
    res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox approval (simulator)</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6fb;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border-radius:16px;box-shadow:0 10px 40px #0002;padding:32px;width:380px}h1{font-size:18px;margin:0 0 4px}.s{color:#667;font-size:13px}
.amt{font-size:34px;font-weight:700;margin:18px 0}.row{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid #eee}
button{width:100%;padding:14px;border:0;border-radius:999px;font-size:16px;font-weight:600;margin-top:18px;cursor:pointer;background:#1f3a8a;color:#fff}
a{display:block;text-align:center;margin-top:12px;color:#667;font-size:13px}.tag{display:inline-block;background:#fff4d6;color:#8a5a00;border-radius:6px;padding:2px 8px;font-size:12px;margin-bottom:10px}</style></head>
<body><form class="c" method="post" action="/mock-paypal/approve"><span class="tag">LOCAL SANDBOX SIMULATOR</span><h1>Approve payment hold</h1><div class="s">Signed in as buyer-sandbox@wasl.example</div>
<div class="amt">${pu.amount.currency_code} ${pu.amount.value}</div><div class="row"><span>Merchant</span><b>${o.ctx.brand_name || 'Merchant'}</b></div>
<div class="row"><span>For</span><span>${(pu.description || '').replace(/</g, '&lt;')}</span></div><div class="row"><span>Type</span><span>Authorization (held, not charged)</span></div>
<input type="hidden" name="token" value="${o.id}"><button id="approve" type="submit">Agree &amp; Continue</button><a href="${o.ctx.cancel_url || '/'}">Cancel</a></form></body></html>`);
  });

  r.post('/approve', (req, res) => {
    const o = orders.get(req.body.token);
    if (!o) return res.status(404).send('Unknown order');
    o.status = 'APPROVED';
    o.payer = { email_address: 'buyer-sandbox@wasl.example', payer_id: rid(13), name: { given_name: 'Sandbox', surname: 'Brand' } };
    const url = new URL(o.ctx.return_url || `${config.publicUrl}/`);
    url.searchParams.set('token', o.id); url.searchParams.set('PayerID', o.payer.payer_id);
    res.redirect(url.toString());
  });

  r.post('/v2/checkout/orders/:id/authorize', (req, res) => {
    const o = orders.get(req.params.id);
    if (!o) return err(res, 404, 'RESOURCE_NOT_FOUND', 'order not found');
    if (o.status === 'COMPLETED' && o.authId) return res.status(201).json(authorized(o));
    if (o.status !== 'APPROVED') return err(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED');
    const authId = rid(17);
    const pu = o.purchase_units[0];
    auths.set(authId, { id: authId, status: 'CREATED', amount: { currency_code: pu.amount.currency_code, value: pu.amount.value }, orderId: o.id, expiration_time: new Date(Date.now() + 29 * 864e5).toISOString() });
    o.status = 'COMPLETED'; o.authId = authId;
    res.status(201).json(authorized(o));
  });
  const authorized = (o) => ({ id: o.id, status: o.status, payer: o.payer, purchase_units: [{ ...o.purchase_units[0], payments: { authorizations: [auths.get(o.authId)] } }] });

  r.post('/v2/payments/authorizations/:id/capture', (req, res) => {
    const a = auths.get(req.params.id);
    if (!a) return err(res, 404, 'RESOURCE_NOT_FOUND', 'authorization not found');
    if (a.status === 'VOIDED') return err(res, 422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED');
    if (!a.captureId) { a.captureId = rid(17); a.status = 'CAPTURED'; }
    res.status(201).json({ id: a.captureId, status: 'COMPLETED', amount: a.amount, final_capture: true, create_time: now() });
  });

  r.post('/v2/payments/authorizations/:id/void', (req, res) => {
    const a = auths.get(req.params.id);
    if (!a) return err(res, 404, 'RESOURCE_NOT_FOUND', 'authorization not found');
    if (a.status === 'CAPTURED') return err(res, 422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
    a.status = 'VOIDED';
    res.status(204).end();
  });

  r.post('/v1/payments/payouts', (req, res) => {
    const b = req.body;
    const id = rid(13);
    const items = (b.items || []).map((it) => ({ payout_item_id: rid(13), transaction_id: rid(17), transaction_status: 'PENDING', payout_item: it, time_processed: null }));
    batches.set(id, { id, header: b.sender_batch_header, items, created: Date.now() });
    res.status(201).json({ batch_header: { payout_batch_id: id, batch_status: 'PENDING', sender_batch_header: b.sender_batch_header }, links: [] });
  });

  r.get('/v1/payments/payouts/:id', (req, res) => {
    const bt = batches.get(req.params.id);
    if (!bt) return err(res, 404, 'RESOURCE_NOT_FOUND', 'batch not found');
    const done = Date.now() - bt.created > 4000; // simulate async processing like the real sandbox
    for (const it of bt.items) if (done) { it.transaction_status = 'SUCCESS'; it.time_processed ||= now(); }
    const total = bt.items.reduce((s, it) => s + Number(it.payout_item.amount.value), 0);
    res.json({
      batch_header: { payout_batch_id: bt.id, batch_status: done ? 'SUCCESS' : 'PROCESSING', sender_batch_header: bt.header, amount: { currency: bt.items[0]?.payout_item.amount.currency, value: total.toFixed(2) }, fees: { currency: 'USD', value: '0.00' } },
      items: bt.items.map((it) => ({ ...it, payout_batch_id: bt.id })),
    });
  });

  r.post('/v1/notifications/verify-webhook-signature', (req, res) => res.json({ verification_status: 'SUCCESS' }));
  return r;
}
