import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.js';
import { store } from './store.js';
import { mockPayPalRouter } from './mock-paypal.js';
import { extractDeal, gridQuery, aiHealth, DealSchema } from './ai.js';
import { createDeal, startFunding, completeFunding, submitDelivery, release, voidDeal, syncPayouts, handleWebhook, publicDeal, computeSplit } from './deals.js';
import { paypal } from './paypal.js';
import { groundDeal } from './ground.js';

const app = express();
app.disable('x-powered-by');
if (config.paypal.env === 'mock') app.use('/mock-paypal', mockPayPalRouter());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(config.dataDir, 'uploads'),
    filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}${path.extname(file.originalname || '.mp4').slice(0, 6)}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(video|audio)\//.test(file.mimetype) || /\.(mp4|mov|webm|mkv|m4a|mp3|wav)$/i.test(file.originalname)),
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(e.status && e.status < 600 ? (e.status >= 500 ? 502 : 400) : 400).json({ error: e.message, paypal: e.body?.details || undefined });
});
const dealOr404 = (req, res) => { const d = store.getDeal(req.params.id); if (!d) res.status(404).json({ error: 'Deal not found' }); return d; };

app.get('/api/health', wrap(async (req, res) => res.json({ ok: true, paypalEnv: paypal.env, ai: await aiHealth(), autoRelease: config.autoRelease })));

app.post('/api/extract', wrap(async (req, res) => {
  const chat = String(req.body.chat || '').trim();
  if (chat.length < 20) throw new Error('Paste the conversation with the brand first');
  const t = Date.now();
  const deal = groundDeal(await extractDeal(chat), chat);
  res.json({ deal, ms: Date.now() - t, model: config.ai.model });
}));

app.get('/api/deals', (req, res) => res.json(store.listDeals().map(publicDeal)));
app.post('/api/deals', wrap(async (req, res) => {
  const parsed = DealSchema.parse(req.body.deal || req.body);
  const deal = createDeal({ ...parsed, platformFeePercent: req.body.platformFeePercent ?? 5 }, { chat: req.body.chat });
  res.status(201).json(deal);
}));
app.get('/api/deals/:id', (req, res) => { const d = dealOr404(req, res); if (d) res.json({ ...d, split: computeSplit(d), events: store.events(d.id) }); });

app.post('/api/deals/:id/fund', wrap(async (req, res) => {
  const d = dealOr404(req, res); if (!d) return;
  if (d.status !== 'AWAITING_FUNDS') throw new Error(`Deal is already ${d.status}`);
  res.json(await startFunding(d));
}));

app.get('/paypal/return', wrap(async (req, res) => {
  const d = store.getDeal(req.query.deal);
  if (!d) return res.status(404).send('Unknown deal');
  try { await completeFunding(d, req.query.token); } catch (e) { store.log(d.id, 'paypal.error', `Authorization failed: ${e.message}`); }
  res.redirect(`/#/deal/${d.id}`);
}));
app.get('/paypal/cancel', (req, res) => { store.log(req.query.deal, 'paypal.cancel', 'Brand cancelled PayPal approval'); res.redirect(`/#/deal/${req.query.deal}`); });

app.post('/api/deals/:id/submit', upload.single('video'), wrap(async (req, res) => {
  const d = dealOr404(req, res); if (!d) return;
  let file = req.file?.path;
  if (!file && req.body?.sample) { // demo helper: use a bundled sample clip
    const name = path.basename(String(req.body.sample));
    const src = path.join(ROOT, 'samples', name);
    if (!fs.existsSync(src)) throw new Error('Unknown sample');
    file = path.join(config.dataDir, 'uploads', `${d.id}-${Date.now()}-${name}`);
    fs.copyFileSync(src, file);
  }
  if (!file) throw new Error('Attach a video file');
  res.json(await submitDelivery(d, file, { name: req.file?.originalname || req.body.sample }));
}));
app.post('/api/deals/:id/release', wrap(async (req, res) => { const d = dealOr404(req, res); if (d) res.json(await release(d, 'brand')); }));
app.post('/api/deals/:id/void', wrap(async (req, res) => { const d = dealOr404(req, res); if (d) res.json(await voidDeal(d)); }));
app.post('/api/deals/:id/sync', wrap(async (req, res) => { const d = dealOr404(req, res); if (d) res.json(await syncPayouts(d)); }));

app.get('/api/payouts', (req, res) => res.json(store.listDeals().flatMap((d) => (d.payouts || []).map((p) => ({ dealId: d.id, deal: d.title, currency: d.currency, ...p })))));
app.get('/api/events', (req, res) => res.json(store.events().slice(0, 300)));

app.post('/api/grid-query', wrap(async (req, res) => res.json(await gridQuery(String(req.body.question || ''), req.body.columns || []))));

app.post('/api/webhooks/paypal', wrap(async (req, res) => {
  const ok = await paypal.verifyWebhook(req.headers, req.body);
  if (!ok) return res.status(400).json({ error: 'Signature verification failed' });
  await handleWebhook(req.body);
  res.json({ received: true });
}));

app.use('/media', express.static(config.dataDir, { index: false }));
app.use('/samples', express.static(path.join(ROOT, 'samples')));
app.use('/vendor/ag-grid', express.static(path.join(ROOT, 'node_modules/ag-grid-community/dist')));
app.use('/vendor/ag-charts', express.static(path.join(ROOT, 'node_modules/ag-charts-community/dist/umd')));
app.use(express.static(path.join(ROOT, 'public')));

// Recover verifications interrupted by a restart.
for (const d of store.listDeals()) {
  const sub = d.submissions?.[0];
  if (d.status === 'IN_REVIEW' && sub?.status === 'VERIFYING') { sub.status = 'ERROR'; sub.error = 'Interrupted by server restart — please resubmit'; d.status = d.submissions.length > 1 ? 'NEEDS_REVISION' : 'FUNDED'; store.saveDeal(d); }
}

// Background agent loop: keep payout statuses fresh (webhooks do this too when configured).
setInterval(() => {
  for (const d of store.listDeals()) if (d.status === 'RELEASED' && d.paypal?.payoutBatchId) syncPayouts(d).catch(() => {});
}, 5000).unref();

app.listen(config.port, () => {
  console.log(`Wasl running on ${config.publicUrl}  (PayPal: ${config.paypal.env}, AI: ${config.ai.model} @ ${config.ai.baseUrl})`);
});
