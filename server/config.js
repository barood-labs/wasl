import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const hasCreds = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

export const config = {
  port,
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  paypal: {
    // "sandbox" when credentials are present, otherwise a local, API-compatible simulator.
    env: process.env.PAYPAL_ENV || (hasCreds ? 'sandbox' : 'mock'),
    clientId: process.env.PAYPAL_CLIENT_ID || 'mock-client-id',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || 'mock-client-secret',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    platformEmail: process.env.PLATFORM_PAYPAL_EMAIL || 'platform@wasl.example',
  },
  ai: {
    baseUrl: (process.env.AI_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY || 'ollama',
    model: process.env.AI_MODEL || 'qwen2.5:3b',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 240000),
  },
  whisperModel: process.env.WHISPER_MODEL || 'small',
  python: process.env.PYTHON || 'python3',
  autoRelease: (process.env.AUTO_RELEASE || 'true') !== 'false',
  pauseOnRisk: process.env.PAUSE_ON_RISK === 'true',
};

config.paypal.baseUrl =
  config.paypal.env === 'live' ? 'https://api-m.paypal.com'
  : config.paypal.env === 'sandbox' ? 'https://api-m.sandbox.paypal.com'
  : `http://127.0.0.1:${port}/mock-paypal`;
