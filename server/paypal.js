// Minimal, dependency-free PayPal REST client (OAuth2, Orders v2, Payments v2, Payouts v1, Webhooks v1).
// Works against the real PayPal sandbox, or against the local simulator in server/mock-paypal.js.
import crypto from 'node:crypto';
import { config } from './config.js';

let token = null;

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError('OAuth token request failed', res.status, body);
  token = { value: body.access_token, exp: Date.now() + (body.expires_in || 3000) * 1000 };
  return token.value;
}

export class PayPalError extends Error {
  constructor(message, status, body) {
    super(`${message} (HTTP ${status})${body?.name ? `: ${body.name}` : ''}${body?.message ? ` — ${body.message}` : ''}`);
    this.status = status; this.body = body;
  }
}

async function call(method, path, body, { idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;
  const res = await fetch(`${config.paypal.baseUrl}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(`${method} ${path} failed`, res.status, json);
  return { json, debugId: res.headers.get('paypal-debug-id') };
}

const money = (v) => Number(v).toFixed(2);

export const paypal = {
  get env() { return config.paypal.env; },

  /** Brand funds the deal. intent=AUTHORIZE places a hold on the brand's funds without capturing them. */
  async createEscrowOrder(deal) {
    const { json } = await call('POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [{
        reference_id: deal.id,
        custom_id: deal.id,
        invoice_id: `WASL-${deal.id}-${Date.now()}`,
        description: `Sponsorship: ${deal.title}`.slice(0, 127),
        soft_descriptor: 'WASL SPONSOR',
        amount: {
          currency_code: deal.currency,
          value: money(deal.amount),
          breakdown: { item_total: { currency_code: deal.currency, value: money(deal.amount) } },
        },
        items: [{
          name: `Sponsored content: ${deal.title}`.slice(0, 127),
          description: `${deal.deliverables.length} AI-verified deliverable(s), paid on verified delivery`.slice(0, 127),
          quantity: '1',
          category: 'DIGITAL_GOODS',
          unit_amount: { currency_code: deal.currency, value: money(deal.amount) },
        }],
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Wasl',
            user_action: 'CONTINUE',
            shipping_preference: 'NO_SHIPPING',
            landing_page: 'LOGIN',
            return_url: `${config.publicUrl}/paypal/return?deal=${deal.id}`,
            cancel_url: `${config.publicUrl}/paypal/cancel?deal=${deal.id}`,
          },
        },
      },
    }, { idempotencyKey: `order-${deal.id}-${deal.fundingAttempts || 0}` });
    const approve = json.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    return { orderId: json.id, status: json.status, approveUrl: approve?.href };
  },

  getOrder: async (orderId) => (await call('GET', `/v2/checkout/orders/${orderId}`)).json,

  /** After buyer approval: create the authorization (the hold). */
  async authorizeOrder(orderId) {
    const { json } = await call('POST', `/v2/checkout/orders/${orderId}/authorize`, {}, { idempotencyKey: `auth-${orderId}` });
    const auth = json.purchase_units?.[0]?.payments?.authorizations?.[0];
    return {
      status: json.status,
      authorizationId: auth?.id,
      authorizationStatus: auth?.status,
      expiresAt: auth?.expiration_time,
      payer: json.payer ? { email: json.payer.email_address, name: [json.payer.name?.given_name, json.payer.name?.surname].filter(Boolean).join(' ') } : null,
    };
  },

  /** Release: capture the held authorization once AI verification passes. */
  async captureAuthorization(authorizationId, deal) {
    const { json } = await call('POST', `/v2/payments/authorizations/${authorizationId}/capture`, {
      final_capture: true,
      invoice_id: `WASL-CAP-${deal.id}`,
      note_to_payer: `Released by Wasl after verified delivery of "${deal.title}"`.slice(0, 255),
    }, { idempotencyKey: `cap-${authorizationId}` });
    return { captureId: json.id, status: json.status };
  },

  /** Brand cancels / deadline passed without a passing delivery: release the hold back to the brand. */
  async voidAuthorization(authorizationId) {
    await call('POST', `/v2/payments/authorizations/${authorizationId}/void`, {}, { idempotencyKey: `void-${authorizationId}` });
    return { status: 'VOIDED' };
  },

  /** Split the captured funds to the creator and collaborators in one batch. */
  async createPayoutBatch(deal, items) {
    const senderBatchId = `wasl-${deal.id}-${Date.now()}`;
    const { json } = await call('POST', '/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: `You've been paid for "${deal.title}"`,
        email_message: 'Your share of a verified sponsorship deal was released by Wasl. شكراً!',
      },
      items: items.map((it) => ({
        recipient_type: 'EMAIL',
        receiver: it.email,
        amount: { value: money(it.amount), currency: deal.currency },
        note: `${it.role} share (${it.percent}%) — ${deal.title}`.slice(0, 4000),
        sender_item_id: it.itemId,
      })),
    }, { idempotencyKey: senderBatchId });
    return { batchId: json.batch_header.payout_batch_id, status: json.batch_header.batch_status };
  },

  getPayoutBatch: async (batchId) => (await call('GET', `/v1/payments/payouts/${batchId}`)).json,

  /** Verify a webhook delivery using PayPal's verify-webhook-signature endpoint. */
  async verifyWebhook(headers, event) {
    if (config.paypal.env === 'mock') return true;
    if (!config.paypal.webhookId) return false;
    const { json } = await call('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId,
      webhook_event: event,
    });
    return json.verification_status === 'SUCCESS';
  },
};

export const _test = { money, randomId: () => crypto.randomUUID() };
