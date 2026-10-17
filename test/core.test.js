import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuzzyFind, skeleton } from '../server/text.js';
import { parseChat, groundDeal } from '../server/ground.js';
import { deterministicChecks } from '../server/verify.js';

const chat = fs.readFileSync(new URL('../samples/chat_noor.txt', import.meta.url), 'utf8');

test('cross-script brand matching (Whisper writes English brands in Arabic script)', () => {
  assert.equal(skeleton('نور كولد برو'), skeleton('Noor Cold Brew'));
  assert.ok(fuzzyFind('وأهم شي نور كود برو الجديدة', 'Noor Cold Brew') >= 0.8);
  assert.ok(fuzzyFind('صباح الخير خلوني أحكيلكم', 'Noor Cold Brew') < 0.6);
  assert.ok(fuzzyFind('PROMO CODE NOOR 20', 'NOOR20') >= 0.85);
  assert.ok(fuzzyFind('منور', 'نور') < 1, 'no substring false positives inside words');
});

test('chat parser finds money facts', () => {
  const f = parseChat(chat);
  assert.deepEqual(f.speakers, ['Sara', 'Layla']);
  assert.equal(f.orgOf.Sara, 'Noor Coffee');
  assert.ok(f.amounts.some((a) => a.value === 1200));
  assert.deepEqual(f.percents.map((p) => [p.role, p.percent]), [['editor', 15], ['translator', 10]]);
});

test('grounding corrects a model that mixed up brand and creator', () => {
  const bad = { title: 'x', brand: { name: 'Noor Coffee', email: '' }, creator: { name: 'Sara', email: 'sara@noorcoffee.example' }, currency: 'USD', amount: 1500,
    deliverables: [{ kind: 'spoken_mention', phrase: 'No added sugar', description_en: 'say no added sugar' }], splits: [{ role: 'creator', name: 'Sara', email: 'sara@noorcoffee.example', percent: 100 }] };
  const d = groundDeal(bad, chat);
  assert.equal(d.creator.name, 'Layla');
  assert.equal(d.creator.email, 'layla.creates@example.com');
  assert.equal(d.brand.email, 'sara@noorcoffee.example');
  assert.equal(d.amount, 1200);
  assert.deepEqual(d.splits.map((s) => [s.role, s.percent, s.email]), [
    ['creator', 75, 'layla.creates@example.com'], ['editor', 15, 'karim.edits@example.com'], ['translator', 10, 'rana.subs@example.com']]);
  assert.equal(d.deliverables.find((x) => x.phrase === 'No added sugar').kind, 'custom');
  assert.equal(d.deliverables.find((x) => x.kind === 'spoken_mention').within_first_seconds, 15);
  assert.deepEqual(['min_seconds', 'max_seconds'].map((k) => d.deliverables.find((x) => x.kind === 'duration')[k]), [30, 90]);
});

test('deterministic checks catch a late brand mention and a missing code', () => {
  const deal = { deliverables: [
    { id: 'd1', kind: 'spoken_mention', phrase: 'Noor Cold Brew', aliases: [], within_first_seconds: 15 },
    { id: 'd2', kind: 'on_screen_text', phrase: 'NOOR20', aliases: [] },
    { id: 'd3', kind: 'duration', min_seconds: 30, max_seconds: 90 }] };
  const transcript = { language: 'ar', segments: [{ start: 0, end: 2, text: 'صباح الخير' }, { start: 18, end: 23, text: 'وأهم شي نور كود برو الجديدة' }] };
  const r = deterministicChecks(deal, { duration: 33.1, transcript, ocr: [{ t: 20, text: 'NOOR نور COLD BREW' }] });
  assert.deepEqual(r.map((x) => x.pass), [false, false, true]);
  assert.equal(r[0].at_seconds, 18);
  const ok = deterministicChecks(deal, { duration: 35, transcript: { language: 'ar', segments: [{ start: 0, end: 4, text: 'اليوم جربت نور كولد برو' }] }, ocr: [{ t: 23, text: 'PROMO CODE NOOR20' }] });
  assert.deepEqual(ok.map((x) => x.pass), [true, true, true]);
});

test('brand-safety guardrail flags Arabic health claims with timestamps', async () => {
  const { riskScan } = await import('../server/verify.js');
  const hits = riskScan({ segments: [{ start: 23, text: 'هي القهوة بتخليك تخسر وزن بسرعة وبتقوي المناعة' }, { start: 9, text: 'طعمها ناعم وبدون سكر مضاف' }] });
  assert.deepEqual(hits.map((h) => [h.label, h.at]), [['health claim: weight loss', 23], ['health claim: immunity', 23]]);
});
