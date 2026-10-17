// AI layer. Talks to any OpenAI-compatible Chat Completions endpoint:
//   - Ollama (default, free & local):   AI_BASE_URL=http://localhost:11434/v1  AI_MODEL=qwen2.5:7b
//   - xAI / OpenAI / Groq / OpenRouter:  set AI_BASE_URL, AI_API_KEY, AI_MODEL
import { z } from 'zod';
import { config } from './config.js';

export async function chatJSON({ system, user, schema, temperature = 0, maxTokens = 1800 }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
    try {
      const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
        body: JSON.stringify({
          model: config.ai.model, temperature, max_tokens: maxTokens, seed: 7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: attempt ? `${user}\n\nYour previous answer was not valid for the schema (${lastErr?.message?.slice(0, 300)}). Return ONLY valid JSON matching the schema.` : user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = await res.json();
      const text = body.choices?.[0]?.message?.content || '';
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return schema ? schema.parse(json) : json;
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
  }
  throw lastErr;
}

export async function aiHealth() {
  try {
    const res = await fetch(`${config.ai.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.ai.apiKey}` }, signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, model: config.ai.model, baseUrl: config.ai.baseUrl };
  } catch (e) { return { ok: false, model: config.ai.model, baseUrl: config.ai.baseUrl, error: e.message }; }
}

// ---------- 1. Deal extraction: messy bilingual chat -> structured, checkable contract ----------
const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/[^\d.]/g, '')) || 0);
const optNum = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')) || null));
const str = z.union([z.string(), z.null()]).optional().transform((v) => v || '');

export const DealSchema = z.object({
  title: str,
  brand: z.object({ name: str, email: str }).default({}),
  creator: z.object({ name: str, email: str }).default({}),
  currency: str.transform((v) => (v || 'USD').toUpperCase().slice(0, 3)),
  amount: num,
  deadline: str,
  deliverables: z.array(z.object({
    kind: z.enum(['spoken_mention', 'on_screen_text', 'duration', 'language', 'custom']).catch('custom'),
    description_en: str,
    description_ar: str,
    phrase: str,
    aliases: z.array(z.string()).optional().default([]),
    within_first_seconds: optNum,
    min_seconds: optNum,
    max_seconds: optNum,
    languages: z.array(z.string()).optional().default([]),
  })).default([]),
  splits: z.array(z.object({ role: str, name: str, email: str, percent: num })).default([]),
  summary_en: str,
  summary_ar: str,
  grounding: z.any().optional(),
});

const EXTRACT_SYSTEM = `You are Wasl's deal-structuring agent. Creators in the Arab world and the diaspora negotiate brand sponsorships in WhatsApp/Instagram chats that mix Arabic dialects and English. Turn the conversation into a precise, machine-checkable contract.

Return JSON with exactly these keys:
{
 "title": short English deal title,
 "brand": {"name": "...", "email": "..."},
 "creator": {"name": "...", "email": "..."},
 "currency": ISO code like "USD",
 "amount": total fee as a number,
 "deadline": "YYYY-MM-DD" or "",
 "deliverables": [ one object per checkable requirement:
   {"kind": "spoken_mention" | "on_screen_text" | "duration" | "language" | "custom",
    "description_en": "...", "description_ar": "... (Modern Standard Arabic)",
    "phrase": the exact brand/product/code that must be said or shown (spoken_mention / on_screen_text),
    "aliases": other spellings incl. Arabic script (e.g. ["Noor","نور"]),
    "within_first_seconds": number (only if a time window is required),
    "min_seconds": number, "max_seconds": number (duration only),
    "languages": ["ar","en"] (language) }
 ],
 "splits": [ {"role": "creator"|"editor"|"translator"|..., "name": "...", "email": "...", "percent": number} ] — percentages of the creator side; the creator gets whatever is left so the total is 100,
 "summary_en": 2-3 sentence plain-English summary,
 "summary_ar": the same summary in Arabic
}
Rules: use spoken_mention ONLY for brand/product names and promo codes; product claims or messages (e.g. "say it has no added sugar") are kind "custom". Omit keys whose value would be null or empty. Split separate requirements into separate deliverables (e.g. "say the brand name in the first 15 seconds" is a spoken_mention with within_first_seconds 15; "promo code on screen" is on_screen_text; "60-90 seconds" is duration). Never invent emails; use "" if unknown. Output JSON only.`;

export async function extractDeal(chat) {
  const deal = await chatJSON({ system: EXTRACT_SYSTEM, user: `Conversation:\n"""\n${chat.slice(0, 12000)}\n"""`, schema: DealSchema, maxTokens: 2200 });
  return normalizeSplits(deal);
}

export function normalizeSplits(deal) {
  const creatorEmail = deal.creator?.email || '';
  let splits = (deal.splits || []).filter((s) => s.percent > 0 && s.role);
  let creator = splits.find((s) => /creator|influencer|صانع/i.test(s.role));
  const others = splits.filter((s) => s !== creator);
  const othersTotal = others.reduce((a, s) => a + s.percent, 0);
  if (othersTotal >= 100) others.forEach((s) => { s.percent = Math.round((s.percent / othersTotal) * 80); });
  const rest = 100 - others.reduce((a, s) => a + s.percent, 0);
  creator = { role: 'creator', name: creator?.name || deal.creator?.name || 'Creator', email: creator?.email || creatorEmail, percent: rest };
  deal.splits = [creator, ...others];
  return deal;
}

// ---------- 2. Delivery judge: subjective criteria + bilingual feedback, grounded in evidence ----------
export const JudgeSchema = z.object({
  custom: z.array(z.object({ id: str, pass: z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true'), confidence: num.optional(), evidence: str, at_seconds: optNum })).default([]),
  coach_en: str,
  coach_ar: str,
  risk_flags: z.array(z.string()).optional().default([]),
});

const JUDGE_SYSTEM = `You are Wasl's delivery auditor. A creator submitted a sponsored video. You get the contract deliverables, the timestamped transcript (Arabic/English), on-screen text found by OCR, and the results of deterministic checks that were already computed (these are authoritative — do NOT contradict them).
Tasks:
1) For each deliverable of kind "custom", decide pass/fail strictly from the evidence. "evidence" = one short English sentence explaining why, quoting the spoken words (translated to English) — never paste raw OCR. Give the second it happens.
2) coach_en: ONE or TWO warm, specific sentences to the creator about what to change (or congratulations if everything passed). Refer to requirements by what they are, never by id. coach_ar: the same in Arabic only (no other scripts).
3) risk_flags: short English labels for brand-safety issues you notice (e.g. "health claim: weight loss"), or [].
Return JSON: {"custom":[{"id":"...","pass":true|false,"confidence":0-1,"evidence":"...","at_seconds":number|null}],"coach_en":"...","coach_ar":"...","risk_flags":[]}`;

export async function judgeDelivery({ deal, transcript, ocr, checks, risks = [] }) {
  const lines = transcript.segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n').slice(0, 9000);
  const ocrLines = ocr.filter((o, i) => i === 0 || o.text !== ocr[i - 1].text).map((o) => `[${o.t}s] ${o.text}`).join('\n').slice(0, 2500);
  const user = `Deal: ${deal.title} — brand ${deal.brand?.name}.
Deliverables:\n${deal.deliverables.map((d) => `- id=${d.id} kind=${d.kind}: ${d.description_en}`).join('\n')}
Custom deliverables you must decide: ${deal.deliverables.filter((d) => d.kind === 'custom').map((d) => d.id).join(', ') || 'none'}
Deterministic results:\n${checks.map((c) => `- id=${c.id}: ${c.pass ? 'PASS' : 'FAIL'} — ${c.evidence}`).join('\n')}
Transcript (language: ${transcript.language}):\n${lines || '(no speech)'}
On-screen text (OCR):\n${ocrLines || '(none)'}
Guardrail hits (risky claims found by keyword scan): ${risks.length ? risks.map((r) => `[${r.at}s] ${r.label}: ${r.text}`).join('; ') : 'none'}

Now decide ONLY these custom requirements, judging each one on its own words (do not reuse the deterministic results as evidence):
${deal.deliverables.filter((d) => d.kind === 'custom').map((d) => `- id=${d.id}: ${d.description_en}`).join('\n') || '(none)'}`;
  return chatJSON({ system: JUDGE_SYSTEM, user, schema: JudgeSchema, maxTokens: 1400 });
}

// ---------- 3. Natural-language questions -> AG Grid filter/sort model ----------
export const GridQuerySchema = z.object({
  filterModel: z.record(z.any()).default({}),
  sort: z.array(z.object({ colId: z.string(), sort: z.enum(['asc', 'desc']) })).optional().default([]),
  explanation: str,
});

export async function gridQuery(question, columns) {
  const system = `You translate a user's question (English or Arabic) into an AG Grid Community filter model for a table of sponsorship deals.
Columns: ${JSON.stringify(columns)}
Filter model formats:
 text column: {"filterType":"text","type":"contains"|"equals"|"notEqual"|"startsWith","filter":"value"}
 number column: {"filterType":"number","type":"greaterThan"|"lessThan"|"equals"|"inRange","filter":n,"filterTo":n}
 date column: {"filterType":"date","type":"lessThan"|"greaterThan"|"inRange","dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD"}
 several conditions on one column: {"filterType":"text","operator":"OR","conditions":[{...},{...}]}
Return JSON: {"filterModel": {colId: filter, ...}, "sort": [{"colId":"...","sort":"asc"|"desc"}], "explanation": "one short sentence in the user's language"}. Only use listed colIds and allowed values. Today is ${new Date().toISOString().slice(0, 10)}.`;
  return chatJSON({ system, user: question, schema: GridQuerySchema, maxTokens: 500 });
}
