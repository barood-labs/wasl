// Seeds a few extra (fictional) deals so the dashboard has something to show.
// In simulator mode it also funds/voids some of them through the same PayPal flow the UI uses.
const BASE = process.env.WASL_URL || 'http://localhost:8787';
const j = async (p, o = {}) => { const r = await fetch(BASE + p, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }); if (!r.ok) throw new Error(`${p}: ${await r.text()}`); return r.json(); };
const health = await j('/api/health');
const mk = (title, brand, creator, amount, deadline, extra = []) => ({
  title, brand: { name: brand, email: '' }, creator: { name: creator, email: `${creator.toLowerCase()}@example.com` }, currency: 'USD', amount, deadline,
  deliverables: [
    { kind: 'spoken_mention', description_en: `Say “${brand}” in the first 10 seconds`, description_ar: `ذكر «${brand}» خلال أول 10 ثوانٍ`, phrase: brand, within_first_seconds: 10 },
    { kind: 'duration', description_en: 'Video length 45–120 seconds', description_ar: 'مدة الفيديو بين 45 و120 ثانية', min_seconds: 45, max_seconds: 120 },
    ...extra],
  splits: [{ role: 'creator', name: creator, email: `${creator.toLowerCase()}@example.com`, percent: 85 }, { role: 'editor', name: 'Omar', email: 'omar.cuts@example.com', percent: 15 }],
  summary_en: `${brand} sponsors a video by ${creator}.`, summary_ar: `${brand} ترعى فيديو من ${creator}.`,
});
const deals = [
  [mk('Ramadan recipe series', 'Dates & Co', 'Huda', 2400, '2026-11-20'), 'await'],
  [mk('Headset unboxing', 'Saqr Gear', 'Yousef', 650, '2026-11-02', [{ kind: 'on_screen_text', description_en: 'Code SAQR10 on screen', description_ar: 'كود SAQR10 على الشاشة', phrase: 'SAQR10' }]), 'fund'],
  [mk('Petra travel vlog', 'Petra Stays', 'Maya', 1800, '2026-10-25'), 'void'],
  [mk('Skincare routine (AR/EN)', 'Ward Beauty', 'Nour', 900, '2026-11-08'), 'fund'],
];
for (const [deal, action] of deals) {
  const d = await j('/api/deals', { method: 'POST', body: { deal } });
  if (action !== 'await' && health.paypalEnv === 'mock') {
    const o = await j(`/api/deals/${d.id}/fund`, { method: 'POST' });
    const r = await fetch(`${BASE}/mock-paypal/approve`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${o.orderId}` });
    await fetch(r.headers.get('location'), { redirect: 'manual' });
    if (action === 'void') await j(`/api/deals/${d.id}/void`, { method: 'POST' });
  }
  console.log(`${d.id}  ${deal.title}  → ${action}`);
}
