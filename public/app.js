import { t, getLang, setLang } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtMoney = (v, cur = 'USD') => new Intl.NumberFormat(getLang() === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 }).format(Number(v) || 0);
const fmtT = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
};
const toast = (m, ms = 3500) => { const el = $('#toast'); el.textContent = m; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms); };

const theme = agGrid.themeQuartz.withParams({
  accentColor: '#2446b3', headerBackgroundColor: '#f3f5fb', headerTextColor: '#5d6785', borderColor: '#e3e7f1',
  fontFamily: getLang() === 'ar' ? 'IBM Plex Sans Arabic' : 'Inter', fontSize: 13, rowHeight: 44, headerHeight: 40, wrapperBorderRadius: 12,
  oddRowBackgroundColor: '#fbfcff',
});
const grids = [];
function grid(el, opts) {
  const g = agGrid.createGrid(el, { theme, enableRtl: getLang() === 'ar', animateRows: true, suppressCellFocus: true, ...opts });
  el.classList.add('ag-theme-wasl'); grids.push(g); return g;
}
const STATUS = {
  AWAITING_FUNDS: ['Awaiting funds', 'بانتظار التمويل'], FUNDED: ['Funds held', 'المبلغ محجوز'], IN_REVIEW: ['AI reviewing', 'قيد التحقق'],
  NEEDS_REVISION: ['Needs revision', 'يحتاج تعديل'], VERIFIED: ['Verified', 'تم التحقق'], RELEASED: ['Released', 'تم التحرير'],
  PAID_OUT: ['Paid out', 'تم الدفع'], VOIDED: ['Voided', 'ملغى'], SUCCESS: ['Paid', 'مدفوع'], PENDING: ['Pending', 'معلّق'], PROCESSING: ['Processing', 'قيد المعالجة'],
};
const statusLabel = (s) => (STATUS[s] ? STATUS[s][getLang() === 'ar' ? 1 : 0] : s);
const statusPill = (p) => (p.value ? `<span class="st ${esc(p.value)}">${esc(statusLabel(p.value))}</span>` : '');
const scoreBar = (p) => (p.value == null ? '<span class="ai-note">—</span>' : `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar ${p.value === 100 ? 'ok' : ''}"><i style="width:${p.value}%"></i></div><b>${p.value}</b></div>`);

let poll = null;
async function route() {
  clearInterval(poll); grids.splice(0).forEach((g) => g.destroy());
  const h = location.hash || '#/';
  document.documentElement.lang = getLang(); document.documentElement.dir = getLang() === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.dataset.en ||= el.textContent; el.textContent = getLang() === 'ar' ? t(el.dataset.i18n) : el.dataset.en; });
  $('#langBtn').textContent = getLang() === 'ar' ? 'English' : 'عربي';
  if (h.startsWith('#/new')) return newDeal();
  if (h.startsWith('#/deal/')) return dealPage(h.split('/')[2]);
  return dashboard();
}
window.addEventListener('hashchange', route);
$('#langBtn').onclick = () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); location.reload(); };

api('/api/health').then((h) => {
  $('#envPill').innerHTML = `● PayPal ${h.paypalEnv === 'sandbox' ? 'Sandbox' : h.paypalEnv === 'mock' ? 'Simulator' : h.paypalEnv} · AI ${esc(h.ai.model)} ${h.ai.ok ? '' : '(offline)'}`;
}).catch(() => {});

// ------------------------------------------------------------------ Dashboard
async function dashboard() {
  app.innerHTML = `
  <div class="hero"><div><h1>${t('Sponsorship escrow, verified by AI')}</h1>
  <p class="sub" style="max-width:820px">${t('Brands fund a PayPal hold. Creators upload the video. Wasl checks every requirement with timestamped evidence, then releases and splits the money automatically.')}</p></div>
  <a class="btn primary" href="#/new">${t('nav.new')}</a></div>
  <div class="grid g4" id="kpis"></div>
  <div class="grid g32" style="margin-top:18px">
    <div class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">${t('Deals')}</h2><span class="spacer"></span>
      <div class="ask"><input id="ask" type="text" placeholder="${esc(t('Ask your deals… e.g. “which deals need revisions over $500?”'))}"><button class="btn blue sm" id="askBtn">✦ ${t('Ask AI')}</button></div>
      <button class="btn sm" id="clearBtn">${t('Clear')}</button><button class="btn sm" id="csvBtn">${t('Export CSV')}</button></div>
      <div id="askNote" class="ai-note" style="margin:-4px 0 8px"></div>
      <div id="dealsGrid" class="agbox"></div></div>
    <div class="card"><h2>${t('Money by status')}</h2><div id="chart" style="height:200px"></div><h2 style="margin-top:14px">${t('Agent activity')}</h2><div class="feed" id="feed" style="max-height:150px"></div></div>
  </div>
  <div class="card" style="margin-top:18px"><h2>${t('Payouts ledger')}</h2><div id="payoutGrid" class="agbox sm"></div></div>`;

  const cols = [
    { field: 'title', headerName: t('Title'), flex: 2, minWidth: 200, filter: 'agTextColumnFilter', cellRenderer: (p) => `<b>${esc(p.value)}</b>` },
    { field: 'brand', headerName: t('Brand'), flex: 1, filter: 'agTextColumnFilter' },
    { field: 'creator', headerName: t('Creator'), flex: 1, filter: 'agTextColumnFilter' },
    { field: 'amount', headerName: t('Amount'), width: 120, filter: 'agNumberColumnFilter', type: 'rightAligned', valueFormatter: (p) => fmtMoney(p.value, p.data?.currency) },
    { field: 'status', headerName: t('Status'), width: 150, filter: 'agTextColumnFilter', cellRenderer: statusPill },
    { field: 'score', headerName: t('Score'), width: 130, filter: 'agNumberColumnFilter', cellRenderer: scoreBar },
    { field: 'versions', headerName: t('Versions'), width: 95, filter: 'agNumberColumnFilter' },
    { field: 'deadline', headerName: t('Deadline'), width: 120, filter: 'agDateColumnFilter', filterParams: { comparator: (f, v) => (v ? new Date(v) - f : -1) } },
    { field: 'language', headerName: t('Lang'), width: 90 },
  ];
  const dealsGrid = grid($('#dealsGrid'), {
    columnDefs: cols, defaultColDef: { sortable: true, resizable: true, floatingFilter: false },
    onRowClicked: (e) => { if (e.data?.id) location.hash = `#/deal/${e.data.id}`; },
    getRowId: (p) => p.data.id || 'total',
    overlayNoRowsTemplate: `<div class="empty">No deals yet — <a href="#/new">create your first sponsorship deal</a></div>`,
  });
  const payoutGrid = grid($('#payoutGrid'), {
    columnDefs: [
      { field: 'deal', headerName: t('Deal'), flex: 2, filter: true },
      { field: 'role', headerName: t('Role'), width: 120, filter: true },
      { field: 'name', headerName: t('Name'), flex: 1 },
      { field: 'email', headerName: t('Email'), flex: 1.4 },
      { field: 'percent', headerName: t('Share %'), width: 100, valueFormatter: (p) => `${p.value}%` },
      { field: 'amount', headerName: t('Payout'), width: 120, type: 'rightAligned', valueFormatter: (p) => fmtMoney(p.value, p.data?.currency) },
      { field: 'status', headerName: t('Status'), width: 120, cellRenderer: statusPill },
      { field: 'transactionId', headerName: 'PayPal txn', flex: 1, cellClass: 'mono' },
    ],
    defaultColDef: { sortable: true, resizable: true },
    overlayNoRowsTemplate: '<div class="empty">Payouts appear here the moment a delivery is verified.</div>',
  });

  async function refresh() {
    const [deals, payouts, events] = await Promise.all([api('/api/deals'), api('/api/payouts'), api('/api/events')]);
    dealsGrid.setGridOption('rowData', deals);
    const sum = (k) => deals.reduce((a, d) => a + (d[k] || 0), 0);
    dealsGrid.setGridOption('pinnedBottomRowData', deals.length ? [{ title: `${deals.length} deals`, amount: sum('amount'), currency: 'USD' }] : []);
    payoutGrid.setGridOption('rowData', payouts);
    const paid = payouts.filter((p) => p.status === 'SUCCESS').reduce((a, p) => a + p.amount, 0);
    const scored = deals.filter((d) => d.score != null);
    $('#kpis').innerHTML = [
      ['gold', t('Held in escrow'), fmtMoney(sum('held')), `${deals.filter((d) => d.held).length} deals on PayPal hold`],
      ['', t('Released'), fmtMoney(sum('released')), `${deals.filter((d) => d.released).length} verified deliveries`],
      ['', t('Paid to collaborators'), fmtMoney(paid), `${payouts.filter((p) => p.status === 'SUCCESS').length} PayPal payouts`],
      ['', t('Avg. verification score'), scored.length ? `${Math.round(scored.reduce((a, d) => a + d.score, 0) / scored.length)}` : '—', `${deals.reduce((a, d) => a + d.versions, 0)} videos checked`],
    ].map(([c, l, v, d]) => `<div class="card kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
    const by = {};
    for (const d of deals) by[d.status] = (by[d.status] || 0) + d.amount;
    const data = Object.entries(by).map(([s, v]) => ({ status: statusLabel(s), amount: v }));
    $('#chart').innerHTML = '';
    if (data.length) agCharts.AgCharts.create({ container: $('#chart'), data, background: { visible: false }, padding: { top: 6, bottom: 0 },
      series: [{ type: 'bar', direction: 'horizontal', xKey: 'status', yKey: 'amount', fill: '#2446b3', cornerRadius: 6, label: { formatter: ({ value }) => fmtMoney(value), color: '#fff' } }],
      axes: [{ type: 'category', position: 'left' }, { type: 'number', position: 'bottom', label: { formatter: ({ value }) => `$${value}` } }] });
    $('#feed').innerHTML = events.slice(0, 25).map((e) => `<div><time>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.message)}</span></div>`).join('') || '<div class="ai-note">No activity yet</div>';
  }
  await refresh();
  poll = setInterval(refresh, 4000);

  const ask = async () => {
    const q = $('#ask').value.trim(); if (!q) return;
    $('#askBtn').innerHTML = '<span class="loader"></span>'; $('#askNote').textContent = '';
    try {
      const columns = cols.map((c) => ({ colId: c.field, header: c.headerName, type: c.filter?.includes('Number') ? 'number' : c.filter?.includes('Date') ? 'date' : 'text', ...(c.field === 'status' ? { values: Object.keys(STATUS).slice(0, 8) } : {}) }));
      const r = await api('/api/grid-query', { method: 'POST', body: { question: q, columns } });
      dealsGrid.setFilterModel(r.filterModel || {});
      if (r.sort?.length) dealsGrid.applyColumnState({ state: r.sort, defaultState: { sort: null } });
      $('#askNote').innerHTML = `✦ ${esc(r.explanation || '')} <span class="mono">${esc(JSON.stringify(r.filterModel))}</span>`;
    } catch (e) { toast(e.message); } finally { $('#askBtn').innerHTML = `✦ ${t('Ask AI')}`; }
  };
  $('#askBtn').onclick = ask; $('#ask').onkeydown = (e) => e.key === 'Enter' && ask();
  $('#clearBtn').onclick = () => { dealsGrid.setFilterModel(null); dealsGrid.applyColumnState({ defaultState: { sort: null } }); $('#askNote').textContent = ''; $('#ask').value = ''; };
  $('#csvBtn').onclick = () => dealsGrid.exportDataAsCsv({ fileName: 'wasl-deals.csv' });
}

// ------------------------------------------------------------------ New deal
async function newDeal() {
  app.innerHTML = `
  <h1>${t('New sponsorship deal')}</h1><p class="sub">${t('Paste the WhatsApp / Instagram chat with the brand — Arabic, English or both.')}</p>
  <div class="grid g23">
    <div class="card"><textarea id="chat" dir="auto" placeholder="…"></textarea>
      <div class="row" style="margin-top:12px"><button class="btn" id="sampleBtn">${t('Load sample chat')}</button><span class="spacer"></span>
      <button class="btn blue" id="extractBtn">✦ ${t('Structure with AI')}</button></div>
      <p class="ai-note" id="aiNote">The AI turns a messy bilingual chat into a machine-checkable contract: every requirement becomes something Wasl can verify in the video.</p></div>
    <div class="card" id="contract"><div class="empty">✦ ${t('Contract')} — paste a chat and press “${t('Structure with AI')}”.</div></div>
  </div>`;
  $('#sampleBtn').onclick = async () => { $('#chat').value = await (await fetch('/samples/chat_noor.txt')).text(); };
  $('#extractBtn').onclick = async () => {
    const btn = $('#extractBtn'); btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Reading the chat…';
    const t0 = Date.now(); const tick = setInterval(() => { $('#aiNote').textContent = `AI is structuring the deal… ${Math.round((Date.now() - t0) / 1000)}s`; }, 500);
    try {
      const r = await api('/api/extract', { method: 'POST', body: { chat: $('#chat').value } });
      $('#aiNote').textContent = `Structured by ${r.model} in ${(r.ms / 1000).toFixed(1)}s. Review and edit anything before creating the deal.`;
      renderContract(r.deal);
    } catch (e) { toast(e.message); $('#aiNote').textContent = e.message; } finally { clearInterval(tick); btn.disabled = false; btn.innerHTML = `✦ ${t('Structure with AI')}`; }
  };
}

function renderContract(deal) {
  const el = $('#contract');
  el.innerHTML = `
    <div class="row"><h2 style="margin:0">${t('Contract')}</h2><span class="spacer"></span><span class="chip">${esc(deal.brand?.name)} → ${esc(deal.creator?.name)}</span></div>
    <div class="row" style="margin:12px 0"><input type="text" id="title" value="${esc(deal.title)}" style="flex:2">
      <input type="text" id="amount" value="${esc(deal.amount)}" style="width:110px"><input type="text" id="currency" value="${esc(deal.currency)}" style="width:70px">
      <input type="text" id="deadline" value="${esc(deal.deadline)}" style="width:130px" placeholder="YYYY-MM-DD"></div>
    <div class="summary card" style="background:#f8f9fd;margin-bottom:12px"><div>${esc(deal.summary_en)}</div><div class="ar" style="margin-top:6px">${esc(deal.summary_ar)}</div></div>
    ${deal.grounding ? `<div class="ai-note" style="margin:-4px 0 12px">🛡 Cross-checked against the chat: ${deal.grounding.verifiedFacts} money facts verified${deal.grounding.corrections.length ? `, ${deal.grounding.corrections.length} AI output(s) corrected` : ''}.${deal.grounding.corrections.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
    <h3>${t('Deliverables (editable)')}</h3><div id="delivGrid" class="agbox xs"></div>
    <h3 style="margin-top:14px">${t('Money split (editable)')} <span id="splitTotal"></span></h3><div id="splitGrid" class="agbox xs" style="height:180px"></div>
    <div class="row" style="margin-top:14px"><span class="ai-note">Brand: ${esc(deal.brand?.email || '—')} · Platform fee 5%</span><span class="spacer"></span><button class="btn primary" id="createBtn">${t('Create deal')} →</button></div>`;
  const kinds = ['spoken_mention', 'on_screen_text', 'duration', 'language', 'custom'];
  const dg = grid($('#delivGrid'), {
    rowData: deal.deliverables, singleClickEdit: true, stopEditingWhenCellsLoseFocus: true,
    columnDefs: [
      { field: 'kind', headerName: t('Kind'), width: 150, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: kinds }, cellRenderer: (p) => `<span class="chip">${esc(p.value)}</span>` },
      { field: getLang() === 'ar' ? 'description_ar' : 'description_en', headerName: t('Description'), flex: 2, editable: true, wrapText: true, autoHeight: true },
      { field: 'phrase', headerName: t('Must say / show'), flex: 1, editable: true },
      { headerName: 'Rule', flex: 1, valueGetter: (p) => p.data.kind === 'duration' ? `${p.data.min_seconds ?? 0}–${p.data.max_seconds ?? '∞'}s` : p.data.within_first_seconds ? `first ${p.data.within_first_seconds}s` : (p.data.languages || []).join('+') },
    ],
  });
  const sg = grid($('#splitGrid'), {
    rowData: deal.splits, singleClickEdit: true, stopEditingWhenCellsLoseFocus: true,
    columnDefs: [
      { field: 'role', headerName: t('Role'), width: 120, editable: true }, { field: 'name', headerName: t('Name'), flex: 1, editable: true },
      { field: 'email', headerName: t('Email'), flex: 1.5, editable: true },
      { field: 'percent', headerName: t('Share %'), width: 100, editable: true, cellEditor: 'agNumberCellEditor', valueParser: (p) => Number(p.newValue) },
      { headerName: t('Payout'), width: 120, type: 'rightAligned', valueGetter: (p) => fmtMoney(((Number($('#amount').value) || 0) * 0.95 * p.data.percent) / 100, $('#currency').value) },
    ],
    onCellValueChanged: () => { total(); sg.refreshCells({ force: true }); },
  });
  const total = () => { const s = deal.splits.reduce((a, x) => a + Number(x.percent || 0), 0); $('#splitTotal').innerHTML = `<span class="st ${s === 100 ? 'SUCCESS' : 'NEEDS_REVISION'}">${s}%</span>`; };
  total();
  $('#createBtn').onclick = async () => {
    dg.stopEditing(); sg.stopEditing();
    const body = { ...deal, title: $('#title').value, amount: Number($('#amount').value), currency: $('#currency').value, deadline: $('#deadline').value };
    try { const d = await api('/api/deals', { method: 'POST', body: { deal: body, chat: $('#chat').value } }); location.hash = `#/deal/${d.id}`; } catch (e) { toast(e.message); }
  };
}

// ------------------------------------------------------------------ Deal page
async function dealPage(id) {
  let deal = await api(`/api/deals/${id}`).catch(() => null);
  if (!deal) { app.innerHTML = '<div class="empty">Deal not found</div>'; return; }
  app.innerHTML = `
  <div class="row"><a href="#/">← ${t('nav.dashboard')}</a></div>
  <div class="row" style="margin:6px 0 0"><h1 id="dTitle"></h1><span id="dStatus"></span><span class="spacer"></span><span class="chip" id="dParties"></span></div>
  <div class="steps" id="steps"></div>
  <div class="grid g23" style="margin-top:14px">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>${t('Funds')}</h3><div class="money" id="money"></div><div id="moneyNote" class="ai-note"></div><div class="row" id="actions" style="margin-top:14px"></div><div class="kv" id="ids"></div></div>
      <div class="card"><h3>${t('Money split (editable)').replace(' (editable)', '').replace(' (قابل للتعديل)', '')}</h3><div id="splitGrid" class="agbox xs" style="height:190px"></div></div>
      <div class="card"><h3>${t('Timeline')}</h3><div class="feed" id="feed"></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="row"><h2 style="margin:0">${t('Delivery')}</h2><span class="spacer"></span><span id="ver" class="ai-note"></span></div>
        <div id="upload" style="margin-top:12px"></div>
        <div class="grid g2" style="margin-top:12px;align-items:start"><div><video id="player" controls preload="metadata"></video></div><div id="progress" class="progress"></div></div></div>
      <div class="card"><div class="row"><h2 style="margin:0">${t('Evidence')}</h2><span class="spacer"></span><span id="scoreBox" style="width:180px"></span></div><div id="evGrid" class="agbox sm" style="margin-top:10px"></div><div id="feedback" style="margin-top:12px"></div></div>
      <div class="card"><h2>${t('Transcript')}</h2><div id="trGrid" class="agbox xs"></div></div>
    </div>
  </div>`;
  const seek = (s) => { const v = $('#player'); if (s != null && v.src) { v.currentTime = Math.max(0, s - 0.3); v.play(); } };
  const splitG = grid($('#splitGrid'), { columnDefs: [
    { field: 'role', headerName: t('Role'), width: 105 }, { field: 'email', headerName: t('Email'), flex: 1 },
    { field: 'percent', headerName: '%', width: 70 }, { field: 'amount', headerName: t('Payout'), width: 105, valueFormatter: (p) => fmtMoney(p.value, deal.currency) },
    { field: 'status', headerName: t('Status'), width: 100, cellRenderer: statusPill }] });
  const evG = grid($('#evGrid'), {
    columnDefs: [
      { field: 'pass', headerName: t('Result'), width: 80, cellRenderer: (p) => (p.value ? '<span class="st PAID_OUT">✓ PASS</span>' : '<span class="st NEEDS_REVISION">✗ FIX</span>') },
      { field: getLang() === 'ar' ? 'description_ar' : 'description_en', headerName: t('Requirement'), flex: 1.3, wrapText: true, autoHeight: true },
      { field: getLang() === 'ar' ? 'evidence_ar' : 'evidence', valueGetter: (p) => (getLang() === 'ar' && p.data.evidence_ar) || p.data.evidence, headerName: t('Evidence'), flex: 1.8, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.45', paddingTop: '8px', paddingBottom: '8px' } },
      { field: 'at_seconds', headerName: t('At'), width: 75, cellRenderer: (p) => (p.value == null ? '—' : `<span class="ts">▶ ${fmtT(p.value)}</span>`) },
      { field: 'method', headerName: t('Method'), width: 115, cellRenderer: (p) => `<span class="chip">${p.value === 'ai' ? '✦ AI judge' : '⚙ Verified'}</span>` },
    ],
    onCellClicked: (e) => e.colDef.field === 'at_seconds' && seek(e.value),
    overlayNoRowsTemplate: '<div class="empty">Evidence appears here after the creator uploads the video.</div>',
  });
  const trG = grid($('#trGrid'), {
    columnDefs: [{ field: 'start', headerName: t('At'), width: 80, cellRenderer: (p) => `<span class="ts">▶ ${fmtT(p.value)}</span>` }, { field: 'text', headerName: t('Transcript'), flex: 1, wrapText: true, autoHeight: true, cellStyle: { direction: 'auto', unicodeBidi: 'plaintext' } }],
    onRowClicked: (e) => seek(e.data.start), overlayNoRowsTemplate: '<div class="empty">—</div>',
  });

  let lastSubKey = '';
  function render() {
    const d = deal;
    $('#dTitle').textContent = d.title; $('#dStatus').innerHTML = statusPill({ value: d.status });
    $('#dParties').textContent = `${d.brand?.name || 'Brand'} → ${d.creator?.name || 'Creator'}`;
    const order = ['FUNDED', 'IN_REVIEW', 'VERIFIED', 'RELEASED', 'PAID_OUT'];
    const idx = { AWAITING_FUNDS: -1, FUNDED: 0, IN_REVIEW: 1, NEEDS_REVISION: 1, VERIFIED: 2, RELEASED: 3, PAID_OUT: 4, VOIDED: -1 }[d.status];
    $('#steps').innerHTML = [t('Funded'), t('Delivered'), t('Verified'), t('Released '), t('Paid out')].map((l, i) => `<div class="stp ${i < idx || (i === idx && i === 4) ? 'done' : i === idx ? 'now' : ''}">${l}</div>`).join('');
    void order;
    $('#money').textContent = fmtMoney(d.amount, d.currency);
    $('#moneyNote').textContent = { AWAITING_FUNDS: 'Not funded yet — the brand approves a PayPal hold. Nothing is charged until the video passes.', FUNDED: 'Held on the brand’s PayPal (authorization). Not captured yet.', IN_REVIEW: 'Held. AI is verifying the delivery…', NEEDS_REVISION: 'Still held. The creator got a bilingual fix list.', VERIFIED: 'Verified — waiting for release.', RELEASED: 'Captured and split. PayPal payouts in flight…', PAID_OUT: 'Captured and paid out to every collaborator.', VOIDED: 'Hold voided — brand funds returned.' }[d.status] || '';
    const A = [];
    if (d.status === 'AWAITING_FUNDS') A.push(`<button class="btn pp" id="fundBtn">${t('Fund with PayPal')}</button>`);
    if (['FUNDED', 'NEEDS_REVISION', 'VERIFIED'].includes(d.status)) A.push(`<button class="btn sm ok" id="relBtn">${t('Release now')}</button>`, `<button class="btn sm bad" id="voidBtn">${t('Void hold')}</button>`);
    $('#actions').innerHTML = A.join('');
    const p = d.paypal || {};
    $('#ids').innerHTML = [['Order', p.orderId], ['Authorization', p.authorizationId], ['Hold expires', p.holdExpiresAt?.slice(0, 10)], ['Capture', p.captureId], ['Payout batch', p.payoutBatchId], ['Platform fee', d.platformFee != null ? fmtMoney(d.platformFee, d.currency) : null]]
      .filter(([, v]) => v).map(([k, v]) => `<span>${k}</span><span class="mono">${esc(v)}</span>`).join('');
    $('#fundBtn') && ($('#fundBtn').onclick = async () => { try { const r = await api(`/api/deals/${d.id}/fund`, { method: 'POST' }); location.href = r.approveUrl; } catch (e) { toast(e.message); } });
    $('#relBtn') && ($('#relBtn').onclick = async () => { if (confirm('Release the held funds now?')) try { await api(`/api/deals/${d.id}/release`, { method: 'POST' }); load(); } catch (e) { toast(e.message); } });
    $('#voidBtn') && ($('#voidBtn').onclick = async () => { if (confirm('Void the hold and return funds to the brand?')) try { await api(`/api/deals/${d.id}/void`, { method: 'POST' }); load(); } catch (e) { toast(e.message); } });
    splitG.setGridOption('rowData', d.payouts?.length ? d.payouts : d.split.items);

    const canUpload = ['FUNDED', 'NEEDS_REVISION'].includes(d.status);
    $('#upload').innerHTML = canUpload ? `<div class="row"><label class="btn blue">⬆ ${t('Upload video')}<input type="file" id="file" accept="video/*" hidden></label>
      <span class="ai-note">or demo clips:</span><button class="btn sm" data-s="noor_v1.mp4">v1.mp4</button><button class="btn sm" data-s="noor_v2.mp4">v2.mp4</button></div>`
      : d.status === 'AWAITING_FUNDS' ? '<div class="ai-note">The creator can upload once the brand has funded the hold — so creators never work for free.</div>' : '';
    $('#file') && ($('#file').onchange = async (e) => { const fd = new FormData(); fd.append('video', e.target.files[0]); await submit(fd); });
    document.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => submit(JSON.stringify({ sample: b.dataset.s }), true)));

    const sub = d.submissions?.[0];
    $('#ver').textContent = sub ? `Version ${d.submissions.length} · ${sub.name}` : '';
    if (sub) {
      const src = `/media${sub.file}`;
      if (!$('#player').src.endsWith(src)) $('#player').src = src;
      const live = sub.status === 'VERIFYING';
      $('#progress').innerHTML = sub.steps.map((s, i) => `<div class="${live && i === sub.steps.length - 1 ? 'live' : ''}">${esc(s.msg)}</div>`).join('') + (sub.status === 'ERROR' ? `<div style="color:var(--bad)">${esc(sub.error)}</div>` : '');
      const key = `${sub.id}:${sub.status}`;
      if (key !== lastSubKey) {
        lastSubKey = key;
        const r = sub.result;
        evG.setGridOption('rowData', r?.results || []);
        trG.setGridOption('rowData', r?.transcript?.segments || []);
        $('#scoreBox').innerHTML = r ? scoreBar({ value: r.score }) : '';
        $('#feedback').innerHTML = r ? `<div class="fb ${r.passed ? 'ok' : 'bad'}"><b>${r.passed ? '✓ Delivery verified — payment released automatically' : '✗ Revision requested — funds stay on hold'}</b><div style="margin-top:6px;white-space:pre-line">${esc(r.feedback_en)}</div><div class="ar" style="white-space:pre-line">${esc(r.feedback_ar)}</div>${r.risk_flags?.length ? `<div style="margin-top:6px">⚠ ${r.risk_flags.map(esc).join(' · ')}</div>` : ''}</div>` : '';
      }
    }
    $('#feed').innerHTML = d.events.map((e) => `<div><time>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>${esc(e.message)}</span></div>`).join('');
  }
  async function submit(body, json) {
    try { await api(`/api/deals/${deal.id}/submit`, json ? { method: 'POST', body: JSON.parse(body) } : { method: 'POST', body }); load(); } catch (e) { toast(e.message); }
  }
  async function load() { deal = await api(`/api/deals/${id}`); render(); }
  render();
  poll = setInterval(load, 1500);
}

route();
