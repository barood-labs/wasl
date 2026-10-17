// Records the end-to-end demo with Chrome DevTools screencast (high quality JPEG frames + timestamps).
// Usage: node demo/record.mjs http://localhost:8790 demo/build/frames
// Requires playwright-core (PLAYWRIGHT_CORE path) and Google Chrome. For the real PayPal sandbox set
// SANDBOX_BUYER_EMAIL / SANDBOX_BUYER_PASSWORD so the script can log in on the PayPal sandbox page.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/workspace/bounty/tools/node_modules/playwright-core');

const BASE = process.argv[2] || 'http://localhost:8790';
const OUT = path.resolve(process.argv[3] || 'demo/build/frames');
fs.mkdirSync(OUT, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.2, locale: 'en-US' });
const page = await ctx.newPage();
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
const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`); };
const wait = (ms) => page.waitForTimeout(ms);
const save = () => fs.writeFileSync(path.join(OUT, '..', 'timeline.json'), JSON.stringify({ frames, marks }, null, 1));
// keep a frame flowing even when nothing changes (screencast only emits on paint)
const keepAlive = setInterval(() => page.evaluate(() => { document.body.dataset.k = Date.now(); }).catch(() => {}), 200);

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

try {
  await page.goto(`${BASE}/#/`); await startCast(); await wait(800);
  mark('dashboard'); await wait(4000);
  await cursorClick('a.btn.primary.sm'); await wait(1200); mark('new');
  await cursorClick('#sampleBtn'); await wait(2500);
  await page.locator('#chat').evaluate((e) => { e.scrollTop = 0; });
  mark('extract_start'); await cursorClick('#extractBtn');
  await page.waitForSelector('#createBtn', { timeout: 20 * 60e3 }); mark('extract_done'); await wait(5000);
  await page.locator('#splitGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await cursorClick('#createBtn'); await page.waitForSelector('#fundBtn'); await wait(2500); mark('deal_created');
  await cursorClick('#fundBtn'); await page.waitForLoadState(); mark('paypal');
  if (process.env.SANDBOX_BUYER_EMAIL) { // real PayPal sandbox login + consent
    await page.waitForSelector('#email', { timeout: 60e3 }); await page.fill('#email', process.env.SANDBOX_BUYER_EMAIL);
    if (await page.locator('#btnNext').isVisible()) await page.click('#btnNext');
    await page.waitForSelector('#password'); await page.fill('#password', process.env.SANDBOX_BUYER_PASSWORD); await page.click('#btnLogin');
    await page.waitForSelector('[data-testid="submit-button-initial"], #payment-submit-btn, button:has-text("Continue"), button:has-text("Agree")', { timeout: 120e3 });
    await wait(2500); await page.locator('[data-testid="submit-button-initial"], #payment-submit-btn, button:has-text("Continue"), button:has-text("Agree")').first().click();
  } else { await wait(2500); await cursorClick('#approve'); }
  await page.waitForURL(/#\/deal\//, { timeout: 120e3 }); await page.waitForSelector('[data-s="noor_v1.mp4"]', { timeout: 60e3 }); mark('funded'); await wait(4000);
  mark('v1_start'); await cursorClick('[data-s="noor_v1.mp4"]');
  await page.waitForSelector('.fb.bad', { timeout: 25 * 60e3 }); mark('v1_done'); await wait(1500);
  await page.locator('#evGrid').scrollIntoViewIfNeeded(); await wait(4000);
  const ts = page.locator('#evGrid .ts').first(); if (await ts.count()) { await cursorClick('#evGrid .ts'); mark('replay'); await wait(4500); }
  await page.locator('#feedback').scrollIntoViewIfNeeded(); await wait(6000); mark('feedback');
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(1200);
  mark('v2_start'); await cursorClick('[data-s="noor_v2.mp4"]');
  await page.waitForSelector('.fb.ok', { timeout: 25 * 60e3 }); mark('v2_done'); await wait(1500);
  await page.waitForFunction(() => document.querySelector('#dStatus')?.textContent.includes('Paid out'), null, { timeout: 120e3 }); mark('paid_out');
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(3500);
  await page.locator('#evGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(2500);
  await cursorClick('nav a[href="#/"]'); await wait(3500); mark('dashboard2');
  await page.locator('#payoutGrid').scrollIntoViewIfNeeded(); await wait(3500);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(1000);
  await cursorClick('#ask'); await page.keyboard.type('deals over $800 that are not paid out yet, biggest first', { delay: 35 });
  mark('ask_start'); await cursorClick('#askBtn');
  await page.waitForFunction(() => document.querySelector('#askNote')?.textContent.length > 3, null, { timeout: 15 * 60e3 }); mark('ask_done'); await wait(5000);
  await cursorClick('#langBtn'); await page.waitForLoadState(); await wait(4500); mark('arabic');
  const firstPaid = await page.evaluate(async () => (await (await fetch('/api/deals')).json()).find((d) => d.status === 'PAID_OUT')?.id);
  if (firstPaid) { await page.goto(`${BASE}/#/deal/${firstPaid}`); await wait(5000); mark('arabic_deal'); }
  mark('end');
} catch (e) { console.error('RECORDING ERROR', e); mark('error'); }
finally { clearInterval(keepAlive); await cdp.send('Page.stopScreencast').catch(() => {}); save(); await browser.close(); }
