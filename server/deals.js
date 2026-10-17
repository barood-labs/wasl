// Deal lifecycle:  DRAFT → AWAITING_FUNDS → FUNDED (hold) → IN_REVIEW → NEEDS_REVISION ↺ → RELEASED → PAID_OUT
//                                                      ↘ VOIDED (hold returned to brand)
import { store, id } from './store.js';
import { paypal } from './paypal.js';
import { config } from './config.js';
import { verifyDelivery } from './verify.js';
import { normalizeSplits } from './ai.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function createDeal(input, { chat } = {}) {
  const deal = normalizeSplits(structuredClone(input));
  deal.id = id('deal');
  deal.status = 'AWAITING_FUNDS';
  deal.createdAt = new Date().toISOString();
  deal.currency ||= 'USD';
  deal.amount = round2(Number(deal.amount) || 0);
  deal.platformFeePercent = Number(input.platformFeePercent ?? 5);
  deal.deliverables = (deal.deliverables || []).map((d, i) => ({ ...d, id: d.id || `d${i + 1}` }));
  deal.submissions = [];
  deal.payouts = [];
  deal.chat = chat || input.chat || '';
  if (!deal.amount) throw new Error('Deal amount is required');
  if (!deal.deliverables.length) throw new Error('At least one deliverable is required');
  store.saveDeal(deal);
  store.log(deal.id, 'deal.created', `Deal “${deal.title}” created for ${deal.currency} ${deal.amount}`, { deliverables: deal.deliverables.length });
  return deal;
}

export async function startFunding(deal) {
  deal.fundingAttempts = (deal.fundingAttempts || 0) + 1;
  const order = await paypal.createEscrowOrder(deal);
  deal.paypal = { ...(deal.paypal || {}), orderId: order.orderId, orderStatus: order.status };
  store.saveDeal(deal);
  store.log(deal.id, 'paypal.order.created', `PayPal order ${order.orderId} created (intent AUTHORIZE)`, order);
  return order;
}

export async function completeFunding(deal, orderId) {
  if (deal.paypal?.authorizationId) return deal;
  const r = await paypal.authorizeOrder(orderId || deal.paypal.orderId);
  deal.paypal = { ...deal.paypal, orderId: orderId || deal.paypal.orderId, orderStatus: r.status, authorizationId: r.authorizationId, authorizationStatus: r.authorizationStatus, holdExpiresAt: r.expiresAt, payer: r.payer };
  deal.status = 'FUNDED';
  deal.fundedAt = new Date().toISOString();
  store.saveDeal(deal);
  store.log(deal.id, 'paypal.authorized', `Brand funds held: authorization ${r.authorizationId} (${deal.currency} ${deal.amount})`, r);
  return deal;
}

export function computeSplit(deal) {
  const fee = round2(deal.amount * (deal.platformFeePercent / 100));
  const net = round2(deal.amount - fee);
  const items = deal.splits.map((s, i) => ({ ...s, itemId: `${deal.id}-${i}`, amount: round2(net * (s.percent / 100)) }));
  const drift = round2(net - items.reduce((a, b) => a + b.amount, 0));
  if (items.length) items[0].amount = round2(items[0].amount + drift); // pennies go to the creator
  return { fee, net, items };
}

const running = new Set();

export async function submitDelivery(deal, file, meta = {}) {
  if (!['FUNDED', 'NEEDS_REVISION'].includes(deal.status)) throw new Error(`Cannot submit while deal is ${deal.status}`);
  if (running.has(deal.id)) throw new Error('A verification is already running for this deal');
  const sub = { id: id('sub'), file: file.replace(config.dataDir, ''), name: meta.name || 'video', at: new Date().toISOString(), status: 'VERIFYING', steps: [] };
  deal.submissions.unshift(sub);
  deal.status = 'IN_REVIEW';
  store.saveDeal(deal);
  store.log(deal.id, 'delivery.submitted', `Creator submitted “${sub.name}” (version ${deal.submissions.length})`);
  running.add(deal.id);
  (async () => {
    try {
      const result = await verifyDelivery(deal, file, (step, msg) => {
        sub.steps.push({ step, msg, at: new Date().toISOString() }); store.saveDeal(deal);
        store.log(deal.id, `verify.${step}`, msg);
      });
      Object.assign(sub, { status: result.passed ? 'PASSED' : 'FAILED', result });
      deal.score = result.score;
      store.log(deal.id, result.passed ? 'verify.passed' : 'verify.failed',
        result.passed ? `All ${result.results.length} deliverables verified (score ${result.score})` : `${result.results.filter((r) => !r.pass).length} deliverable(s) need changes (score ${result.score})`,
        { results: result.results.map((r) => ({ id: r.id, pass: r.pass, evidence: r.evidence })) });
      if (result.passed) {
        deal.status = 'VERIFIED';
        store.saveDeal(deal);
        if (config.autoRelease && !(config.pauseOnRisk && result.risk_flags.length)) await release(deal, 'agent');
        else store.log(deal.id, 'agent.hold', config.autoRelease ? `Agent paused auto-release: ${result.risk_flags.join('; ')}` : 'Auto-release disabled; waiting for brand approval');
      } else {
        deal.status = 'NEEDS_REVISION';
        store.saveDeal(deal);
        store.log(deal.id, 'agent.revision', 'Agent sent bilingual revision request to creator; funds stay on hold', { feedback_en: result.feedback_en, feedback_ar: result.feedback_ar });
      }
    } catch (e) {
      sub.status = 'ERROR'; sub.error = e.message; deal.status = 'FUNDED';
      store.saveDeal(deal); store.log(deal.id, 'verify.error', `Verification error: ${e.message}`);
    } finally { running.delete(deal.id); }
  })();
  return sub;
}

export async function release(deal, by = 'brand') {
  if (!['VERIFIED', 'NEEDS_REVISION', 'FUNDED'].includes(deal.status)) throw new Error(`Cannot release while deal is ${deal.status}`);
  if (!deal.paypal?.authorizationId) throw new Error('Deal is not funded');
  const cap = await paypal.captureAuthorization(deal.paypal.authorizationId, deal);
  deal.paypal.captureId = cap.captureId; deal.paypal.captureStatus = cap.status; if (cap.status === 'COMPLETED') deal.paypal.authorizationStatus = 'CAPTURED';
  deal.status = 'RELEASED'; deal.releasedAt = new Date().toISOString(); deal.releasedBy = by;
  store.saveDeal(deal);
  store.log(deal.id, 'paypal.captured', `${by === 'agent' ? 'Agent' : 'Brand'} released funds: capture ${cap.captureId} (${cap.status})`, cap);
  const split = computeSplit(deal);
  const missing = split.items.filter((i) => !i.email);
  if (missing.length) {
    store.log(deal.id, 'payout.blocked', `Payout needs PayPal emails for: ${missing.map((m) => m.role).join(', ')}`);
    return deal;
  }
  const batch = await paypal.createPayoutBatch(deal, split.items);
  deal.payouts = split.items.map((i) => ({ ...i, batchId: batch.batchId, status: 'PENDING', fee: split.fee }));
  deal.paypal.payoutBatchId = batch.batchId; deal.platformFee = split.fee;
  store.saveDeal(deal);
  store.log(deal.id, 'paypal.payout.created', `Payout batch ${batch.batchId}: ${split.items.map((i) => `${i.role} ${deal.currency} ${i.amount}`).join(', ')} (platform fee ${split.fee})`, batch);
  return deal;
}

export async function voidDeal(deal) {
  if (!deal.paypal?.authorizationId || ['RELEASED', 'PAID_OUT', 'VOIDED'].includes(deal.status)) throw new Error(`Cannot void while deal is ${deal.status}`);
  await paypal.voidAuthorization(deal.paypal.authorizationId);
  deal.status = 'VOIDED'; deal.paypal.authorizationStatus = 'VOIDED';
  store.saveDeal(deal);
  store.log(deal.id, 'paypal.voided', 'Hold voided — brand funds returned');
  return deal;
}

export async function syncPayouts(deal) {
  if (!deal.paypal?.payoutBatchId) return deal;
  const b = await paypal.getPayoutBatch(deal.paypal.payoutBatchId);
  for (const it of b.items || []) {
    const p = deal.payouts.find((x) => x.itemId === it.payout_item?.sender_item_id);
    if (p && p.status !== it.transaction_status) {
      p.status = it.transaction_status; p.payoutItemId = it.payout_item_id; p.transactionId = it.transaction_id;
      store.log(deal.id, 'paypal.payout.item', `Payout to ${p.role} ${p.email}: ${p.status}`);
    }
  }
  if (deal.payouts.length && deal.payouts.every((p) => ['SUCCESS', 'UNCLAIMED'].includes(p.status)) && deal.status !== 'PAID_OUT') {
    deal.status = 'PAID_OUT'; deal.paidOutAt = new Date().toISOString();
    store.log(deal.id, 'deal.paid_out', `Everyone is paid: ${deal.payouts.length} recipients${deal.payouts.some((p) => p.status === 'UNCLAIMED') ? ' (some still need to claim with a PayPal account)' : ''}`);
  }
  store.saveDeal(deal);
  return deal;
}

/** Handle PayPal webhook events (sandbox). */
export async function handleWebhook(event) {
  const r = event.resource || {};
  const customId = r.custom_id || r.purchase_units?.[0]?.custom_id;
  const senderItem = r.payout_item?.sender_item_id || '';
  const deal = store.getDeal(customId) || store.getDeal(senderItem.split('-')[0])
    || store.findDeal((d) => d.paypal?.orderId === r.id || d.paypal?.authorizationId === r.id || d.paypal?.payoutBatchId === (r.payout_batch_id || r.batch_header?.payout_batch_id));
  store.log(deal?.id || null, 'webhook', `PayPal webhook ${event.event_type}`, { id: event.id });
  if (!deal) return;
  if (event.event_type?.startsWith('PAYMENT.PAYOUTS')) await syncPayouts(deal);
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED' && !deal.paypal?.authorizationId) await completeFunding(deal, r.id);
}

export function publicDeal(d) {
  const sub = d.submissions?.[0];
  return {
    id: d.id, title: d.title, brand: d.brand?.name, creator: d.creator?.name, currency: d.currency, amount: d.amount,
    status: d.status, deadline: d.deadline, score: d.score ?? null, deliverables: d.deliverables.length,
    versions: d.submissions?.length || 0, lastCheck: sub?.status || null,
    held: ['FUNDED', 'IN_REVIEW', 'NEEDS_REVISION', 'VERIFIED'].includes(d.status) ? d.amount : 0,
    released: ['RELEASED', 'PAID_OUT'].includes(d.status) ? d.amount : 0,
    recipients: d.splits?.length || 0, language: d.language || (/[\u0600-\u06FF]/.test(d.chat || '') ? 'AR+EN' : 'EN'),
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}
