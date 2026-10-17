// Records the end-to-end demo with Chrome DevTools screencast (high quality JPEG frames + timestamps).
// Usage: node demo/record.mjs http://localhost:8795 demo/build/frames
// Requires playwright-core (PLAYWRIGHT_CORE path) and Google Chrome. For the real PayPal sandbox set
// SANDBOX_BUYER_EMAIL / SANDBOX_BUYER_PASSWORD (env, or the gitignored .env.sandbox) so the script can log in on the PayPal sandbox page.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sandboxCreds } from './sandbox-creds.mjs';
const BUYER = process.env.SANDBOX_BUYER_EMAIL ? { SANDBOX_BUYER_EMAIL: process.env.SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD: process.env.SANDBOX_BUYER_PASSWORD } : sandboxCreds();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/workspace/bounty/tools/node_modules/playwright-core');

const BASE = process.argv[2] || 'http://localhost:8795';
const OUT = path.resolve(process.argv[3] || 'demo/build/frames');
fs.mkdirSync(OUT, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.2, locale: 'en-US' });
const page = await ctx.newPage();
// Never show the sandbox buyer's login on camera: blur the login inputs and any text containing an email on paypal.com.
await ctx.addInitScript(() => {
  if (!/paypal\.com$/.test(location.hostname)) return;
  const css = '#email,#password,.profileDisplayEmail,.notYouLink,[data-testid*="email"],.wasl-redact{filter:blur(8px)!important}';
  const run = () => {
    if (!document.getElementById('wasl-redact')) { const st = document.createElement('style'); st.id = 'wasl-redact'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
    const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) if (/@/.test(t.nodeValue) && t.parentElement) t.parentElement.classList.add('wasl-redact');
  };
  new MutationObserver(run).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', run);
});
const cdp = await ctx.newCDPSession(page);
const t0 = Date.now();
const frames = []; const marks = [];
let n = 0;
cdp.on('Page.screencastFrame', async (f) => {
  const file = path.join(OUT, `f${String(n++).padStart(6, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file: path.basename(file), t: (Date.now() - t0) / 1000 });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
// During slow AI steps the screencast is paused after a few seconds (the edit compresses these waits anyway),
// so a slow box doesn't produce tens of thousands of identical frames.
const LONG = 120 * 60e3;
const longWait = async (fn) => { await wait(3000); await cdp.send('Page.stopScreencast').catch(() => {}); try { return await fn(); } finally { await startCast(); await wait(400); } };
const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`); };
const wait = (ms) => page.waitForTimeout(ms);
const save = () => fs.writeFileSync(path.join(OUT, '..', `timeline_${path.basename(OUT)}.json`), JSON.stringify({ frames, marks }, null, 1));
// keep a frame flowing even when nothing changes (screencast only emits on paint)
const keepAlive = setInterval(() => page.evaluate(() => {
  let k = document.getElementById('__k'); if (!k) { k = document.createElement('div'); k.id = '__k'; k.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;z-index:99999;pointer-events:none'; document.body.appendChild(k); }
  k.style.background = k.style.background === 'rgb(245, 247, 252)' ? 'rgb(244, 246, 251)' : 'rgb(245, 247, 252)';
}).catch(() => {}), 150);

async function cursorClick(locator) {
  const el = page.locator(locator).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.evaluate(([x, y]) => {
    let c = document.getElementById('__cur');
    if (!c) { c = document.createElement('div'); c.id = '__cur'; c.style.cssText = 'position:fixed;z-index:99999;width:26px;height:26px;border-radius:50%;background:rgba(242,193,78,.55);border:2px solid #f2c14e;pointer-events:none;transition:all .45s ease;transform:translate(-50%,-50%)'; document.body.appendChild(c); }
    c.style.left = x + 'px'; c.style.top = y + 'px';
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  await wait(550);
  await el.click();
}

async function dashboardPart() {
  await wait(2500); mark('dashboard2');
  await page.locator('#payoutGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(1000);
  await cursorClick('#ask'); const q = 'deals over $800 that are not paid out yet, biggest first'; for (let i = 1; i <= q.length; i++) { await page.fill('#ask', q.slice(0, i)); await wait(30); }
  await wait(600); mark('ask_start'); await cursorClick('#askBtn');
  await longWait(() => page.waitForFunction(() => document.querySelector('#askNote')?.textContent.length > 3, null, { timeout: LONG })).catch(() => console.log('ask timeout'));
  mark('ask_done'); await wait(5000);
  await cursorClick('#langBtn'); await page.waitForLoadState(); await wait(4500); mark('arabic');
  const firstPaid = await page.evaluate(async () => (await (await fetch('/api/deals')).json()).find((d) => d.status === 'PAID_OUT')?.id);
  if (firstPaid) { await page.goto(`${BASE}/#/deal/${firstPaid}`); await wait(5000); mark('arabic_deal'); }
  mark('end');
}

try {
  await page.goto(`${BASE}/#/`); await startCast(); await wait(800);
  if (process.env.PART === 'dashboard') { await wait(1500); await dashboardPart(); throw 'done'; }
  mark('dashboard'); await wait(4000);
  await cursorClick('a.btn.primary.sm'); await wait(1200); mark('new');
  await cursorClick('#sampleBtn'); await wait(2500);
  await page.locator('#chat').evaluate((e) => { e.scrollTop = 0; });
  mark('extract_start'); await cursorClick('#extractBtn');
  await longWait(() => page.waitForSelector('#createBtn', { timeout: LONG })); mark('extract_done'); await wait(5000);
  await page.locator('#splitGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await cursorClick('#createBtn'); await page.waitForSelector('#fundBtn'); await wait(2500); mark('deal_created');
  await cursorClick('#fundBtn'); await page.waitForLoadState(); mark('paypal');
  if (BUYER.SANDBOX_BUYER_EMAIL) { // real PayPal sandbox login + consent
    await page.waitForSelector('#email', { timeout: 60e3 }); await wait(1200); await page.fill('#email', BUYER.SANDBOX_BUYER_EMAIL);
    if (await page.locator('#btnNext').isVisible()) await page.click('#btnNext');
    await page.waitForSelector('#password:visible', { timeout: 30e3 }); await page.fill('#password', BUYER.SANDBOX_BUYER_PASSWORD); await wait(600); await page.click('#btnLogin');
    await page.waitForSelector('[data-testid="submit-button-initial"], #payment-submit-btn, button:has-text("Continue"), button:has-text("Agree")', { timeout: 120e3 });
    await wait(2500); await page.locator('[data-testid="submit-button-initial"], #payment-submit-btn, button:has-text("Continue"), button:has-text("Agree")').first().click();
  } else { await wait(2500); await cursorClick('#approve'); }
  await page.waitForURL(/#\/deal\//, { timeout: 120e3 }); await page.waitForSelector('[data-s="noor_v1.mp4"]', { timeout: 60e3 }); mark('funded'); await wait(4000);
  mark('v1_start'); await cursorClick('[data-s="noor_v1.mp4"]');
  await longWait(() => page.waitForSelector('.fb.bad', { timeout: LONG })); mark('v1_done'); await wait(1500);
  await page.locator('#evGrid').scrollIntoViewIfNeeded(); await wait(4000);
  const ts = page.locator('#evGrid .ts').first(); if (await ts.count()) { await cursorClick('#evGrid .ts'); mark('replay'); await wait(4500); }
  await page.locator('#feedback').scrollIntoViewIfNeeded(); await wait(6000); mark('feedback');
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(1200);
  mark('v2_start'); await cursorClick('[data-s="noor_v2.mp4"]');
  await longWait(() => page.waitForSelector('.fb.ok', { timeout: LONG })); mark('v2_done'); await wait(1500);
  await page.waitForFunction(() => document.querySelector('#dStatus')?.textContent.includes('Paid out'), null, { timeout: 120e3 }); mark('paid_out');
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(3500);
  await page.locator('#evGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(2500);
  await cursorClick('nav a[href="#/"]'); await wait(1000);
  await dashboardPart();
  mark('end');
} catch (e) { if (e !== 'done') { console.error('RECORDING ERROR', e); mark('error'); } }
finally { clearInterval(keepAlive); await cdp.send('Page.stopScreencast').catch(() => {}); save(); await browser.close(); }
