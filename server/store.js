// Tiny JSON-file store. Good enough for a hackathon build and zero setup for judges.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
const FILE = path.join(config.dataDir, 'db.json');

let db = { deals: [], events: [] };
if (fs.existsSync(FILE)) {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* start fresh */ }
}
db.deals ||= []; db.events ||= [];

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(db, null, 2)), 50);
}

export const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

export const store = {
  listDeals: () => db.deals,
  getDeal: (dealId) => db.deals.find((d) => d.id === dealId),
  findDeal: (fn) => db.deals.find(fn),
  saveDeal(deal) {
    deal.updatedAt = new Date().toISOString();
    const i = db.deals.findIndex((d) => d.id === deal.id);
    if (i >= 0) db.deals[i] = deal; else db.deals.unshift(deal);
    persist();
    return deal;
  },
  log(dealId, type, message, data = {}) {
    const ev = { id: id('ev'), dealId, type, message, data, at: new Date().toISOString() };
    db.events.unshift(ev);
    if (db.events.length > 2000) db.events.length = 2000;
    persist();
    return ev;
  },
  events: (dealId) => (dealId ? db.events.filter((e) => e.dealId === dealId) : db.events),
  reset() { db = { deals: [], events: [] }; persist(); },
};
