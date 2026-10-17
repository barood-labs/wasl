// Reads SANDBOX_BUYER_EMAIL / SANDBOX_BUYER_PASSWORD from .env.sandbox (gitignored) without shell-sourcing it.
import fs from 'node:fs';
import path from 'node:path';
export function sandboxCreds(file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env.sandbox')) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('='); let v = line.slice(i + 1).trim();
    if (v.length >= 2 && v[0] === v[v.length - 1] && `"'`.includes(v[0])) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}
