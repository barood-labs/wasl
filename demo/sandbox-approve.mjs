// Approves a PayPal sandbox checkout headlessly with the sandbox buyer test account (from env or the gitignored
// .env.sandbox). Demo/seed tooling only; needs playwright-core + Google Chrome. Never logs credentials.
import { createRequire } from 'node:module';
import { sandboxCreds } from './sandbox-creds.mjs';
const require = createRequire(import.meta.url);
export async function approveSandbox(url, { returnPattern = /localhost|127\.0\.0\.1/ } = {}) {
  const c = process.env.SANDBOX_BUYER_EMAIL ? process.env : sandboxCreds();
  if (!c.SANDBOX_BUYER_EMAIL || !c.SANDBOX_BUYER_PASSWORD) throw new Error('No sandbox buyer credentials');
  const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/workspace/bounty/tools/node_modules/playwright-core');
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
    await p.goto(url); await p.waitForSelector('#email', { timeout: 60e3 });
    await p.fill('#email', c.SANDBOX_BUYER_EMAIL);
    if (await p.locator('#btnNext').isVisible()) await p.click('#btnNext');
    await p.waitForSelector('#password:visible', { timeout: 30e3 }); await p.fill('#password', c.SANDBOX_BUYER_PASSWORD); await p.click('#btnLogin');
    const btn = p.locator('[data-testid="submit-button-initial"], #payment-submit-btn, button:has-text("Continue to Review Order"), button:has-text("Agree & Continue")').first();
    await btn.waitFor({ timeout: 120e3 }); await p.waitForTimeout(1500); await btn.click();
    await p.waitForURL(returnPattern, { timeout: 120e3 }); await p.waitForTimeout(2000);
  } finally { await b.close(); }
}
