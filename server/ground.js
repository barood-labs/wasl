// Grounding: cross-check the LLM's contract against facts parsed straight from the chat.
// Money facts (amount, emails, split percentages) must literally appear in the conversation;
// anything the model invented or mixed up is corrected and reported to the user.
import { fuzzyFind, norm, skeleton, levenshtein } from './text.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function parseChat(chat) {
  const msgs = [];
  for (const raw of chat.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:\[[^\]]*\]\s*)?([^:：]{1,40}?)\s*(?:\(([^)]+)\))?\s*[:：]\s*(.+)$/);
    if (m && !/@/.test(m[1])) msgs.push({ speaker: m[1].trim(), org: (m[2] || '').trim(), text: m[3] });
    else if (msgs.length) msgs[msgs.length - 1].text += ` ${raw}`;
  }
  const speakers = [...new Set(msgs.map((m) => m.speaker))];
  const orgOf = Object.fromEntries(msgs.filter((m) => m.org).map((m) => [m.speaker, m.org]));

  // emails, labelled by "name: email" or attributed to the speaker
  const emails = [];
  for (const m of msgs) {
    const found = [...m.text.matchAll(EMAIL)];
    found.forEach((f, i) => {
      const before = m.text.slice(found[i - 1] ? found[i - 1].index + found[i - 1][0].length : 0, f.index);
      const label = before.match(/([\p{L}][\p{L} ]{1,24})\s*[:：]\s*$/u)?.[1]?.trim();
      emails.push({ email: f[0], name: label || m.speaker, speaker: m.speaker, labelled: Boolean(label) });
    });
  }
  // percentages: look at the clause before each "N%" for a known person (email label) and a role word
  const percents = [];
  const labelled = () => emails.filter((e) => e.labelled).map((e) => e.name);
  for (const m of msgs) {
    let last = 0;
    for (const p of m.text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*[%٪]/g)) {
      const win = m.text.slice(last, p.index); last = p.index + p[0].length;
      const words = win.split(/[\s،,.؛]+/).filter(Boolean);
      const person = labelled().find((n) => win.includes(n)) || words.reverse().find((w) => /^[A-Z][a-z]+$/.test(w)) || null;
      const role = /مونت|edit/i.test(win) ? 'editor' : /ترجم|subtit|translat/i.test(win) ? 'translator' : /manag|مدير/i.test(win) ? 'manager' : 'collaborator';
      if (/off|خصم|discount/i.test(win.slice(-25))) continue; // "20% off" is a promo, not a split
      percents.push({ name: person || role, role, percent: Number(p[1]), speaker: m.speaker });
    }
  }
  // money amounts
  const amounts = [];
  for (const m of msgs) for (const a of m.text.matchAll(/(?:\$|USD\s?|US\$)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:\$|USD|دولار|dollars?)/gi)) {
    amounts.push({ value: Number((a[1] || a[2]).replace(/,/g, '')), speaker: m.speaker, agreed: /deal|✅|agreed|تمام|اتفقنا|ok/i.test(m.text) });
  }
  return { msgs, speakers, orgOf, emails, percents, amounts };
}

const sameName = (a, b) => {
  if (!a || !b) return false;
  const A = norm(a), B = norm(b);
  if (A.includes(B) || B.includes(A)) return true;
  const sa = skeleton(a), sb = skeleton(b);
  return sa && sb && 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length) >= 0.6;
};

export function groundDeal(deal, chat) {
  const f = parseChat(chat);
  const notes = [];
  const brandSpeaker = f.speakers.find((s) => f.orgOf[s]) || f.speakers.find((s) => sameName(s, deal.brand?.name));
  const creatorSpeaker = f.speakers.find((s) => s !== brandSpeaker);

  // Brand & creator identities
  if (brandSpeaker && f.orgOf[brandSpeaker] && !sameName(deal.brand?.name, f.orgOf[brandSpeaker])) {
    notes.push(`Brand set to “${f.orgOf[brandSpeaker]}” (from the chat)`); deal.brand = { ...deal.brand, name: f.orgOf[brandSpeaker] };
  }
  const brandEmail = f.emails.find((e) => e.speaker === brandSpeaker && !e.labelled)?.email;
  if (brandEmail && deal.brand?.email !== brandEmail) { notes.push(`Brand email corrected to ${brandEmail}`); deal.brand.email = brandEmail; }
  if (creatorSpeaker) {
    if (!deal.creator?.name || sameName(deal.creator.name, brandSpeaker) || !sameName(deal.creator.name, creatorSpeaker)) {
      notes.push(`Creator set to ${creatorSpeaker} (they negotiated the deal)`); deal.creator = { ...deal.creator, name: creatorSpeaker };
    }
    const ce = f.emails.find((e) => e.speaker === creatorSpeaker && !e.labelled)?.email;
    if (ce && deal.creator.email !== ce) { notes.push(`Creator email corrected to ${ce}`); deal.creator.email = ce; }
  }

  // Amount must appear in the chat; prefer the one that was agreed
  if (f.amounts.length && !f.amounts.some((a) => a.value === Number(deal.amount))) {
    const pick = [...f.amounts].reverse().find((a) => a.agreed) || f.amounts[f.amounts.length - 1];
    notes.push(`Amount ${deal.amount} not found in chat → ${pick.value}`); deal.amount = pick.value;
  }

  // Splits: every collaborator % in the chat must be present, with the email the chat gives for them
  const emailFor = (name) => f.emails.find((e) => sameName(e.name, name))?.email || '';
  const splits = [];
  for (const p of f.percents.filter((x) => x.speaker === creatorSpeaker || !creatorSpeaker)) {
    const existing = (deal.splits || []).find((s) => s.role !== 'creator' && (sameName(s.name, p.name) || s.percent === p.percent));
    const email = emailFor(p.name) || existing?.email || '';
    const role = p.role !== 'collaborator' ? p.role : existing?.role && existing.role !== 'creator' ? existing.role : 'collaborator';
    splits.push({ role, name: existing && !/[\u0600-\u06FF]/.test(existing.name) ? existing.name : p.name, email, percent: p.percent });
    if (!existing) notes.push(`Added ${p.name} (${p.percent}%) from the chat`);
    else if (existing.email !== email && email) notes.push(`${existing.name}'s email corrected to ${email}`);
  }
  if (splits.length) {
    const rest = 100 - splits.reduce((a, s) => a + s.percent, 0);
    deal.splits = [{ role: 'creator', name: deal.creator.name, email: deal.creator.email, percent: rest }, ...splits];
  } else {
    for (const s of deal.splits || []) if (s.email && !chat.includes(s.email)) { notes.push(`Removed invented email ${s.email}`); s.email = ''; }
  }

  // Deliverables: codes/brand names are verified literally; claims & messages go to the AI judge
  for (const d of deal.deliverables || []) {
    if (d.kind === 'on_screen_text' && d.phrase && !norm(chat).includes(norm(d.phrase))) {
      const code = chat.match(/\b[A-Z]{2,}[0-9]{1,4}\b/)?.[0];
      if (code) { notes.push(`On-screen text corrected to ${code}`); d.phrase = code; }
    }
    if (d.kind === 'spoken_mention') {
      const isName = /^[A-Z0-9]/.test(d.phrase || '') && (fuzzyFind(d.phrase, deal.brand?.name?.split(' ')[0] || '') > 0.8 || /^[A-Z0-9]+$/.test(d.phrase));
      if (!isName) { d.kind = 'custom'; notes.push(`“${d.description_en}” is a claim, not a name → judged semantically by AI`); }
    }
    if (d.kind === 'language' && !d.languages?.length) d.languages = ['ar', 'en'];
  }
  // Deliverable facts the chat states explicitly (durations, time windows, codes, subtitles) override the model.
  const D = (deal.deliverables ||= []);
  const blank = { phrase: '', aliases: [], within_first_seconds: null, min_seconds: null, max_seconds: null, languages: [] };
  const dur = chat.match(/(?:بين|between|from)\s*(\d{1,3})\s*(?:و|and|-|–|to)\s*(\d{1,3})\s*(?:ثانية|ثواني|seconds|secs?|s\b)/i);
  if (dur) {
    const [mn, mx] = [Number(dur[1]), Number(dur[2])];
    let d = D.find((x) => x.kind === 'duration');
    if (!d) { D.push(d = { ...blank, kind: 'duration', description_en: `Video length ${mn}–${mx} seconds`, description_ar: `مدة الفيديو بين ${mn} و${mx} ثانية` }); notes.push(`Added duration ${mn}–${mx}s from the chat`); }
    if (d.min_seconds !== mn || d.max_seconds !== mx) { if (d.min_seconds != null) notes.push(`Duration corrected to ${mn}–${mx}s`); d.min_seconds = mn; d.max_seconds = mx; d.description_en = `Video length ${mn}–${mx} seconds`; d.description_ar = `مدة الفيديو بين ${mn} و${mx} ثانية`; }
  }
  const quoted = chat.match(/(?:تقول[يو]?|يقول|say|mention)[^"“«\n]{0,25}["“«]([^"”»\n]{2,40})["”»]/i)?.[1];
  const within = chat.match(/(?:أول|first)\s*(\d{1,3})\s*(?:ثانية|ثواني|seconds|secs?)/i);
  if (quoted) {
    let d = D.find((x) => x.kind === 'spoken_mention');
    if (!d) { D.unshift(d = { ...blank, kind: 'spoken_mention', phrase: quoted, description_en: `Say “${quoted}”`, description_ar: `ذكر «${quoted}»` }); notes.push(`Added spoken mention “${quoted}” from the chat`); }
    if (within && d.within_first_seconds !== Number(within[1])) { d.within_first_seconds = Number(within[1]); notes.push(`Mention window set to first ${within[1]}s`); }
    if (within) { d.description_en = `Say “${d.phrase}” within the first ${within[1]} seconds`; d.description_ar = `ذكر «${d.phrase}» خلال أول ${within[1]} ثانية`; }
  }
  const code = chat.match(/(?:code|كود)\s*["“«]?([A-Z][A-Z0-9]{2,15}\d)/)?.[1];
  if (code && /screen|شاشة|visible|يظهر/i.test(chat) && !D.some((x) => x.kind === 'on_screen_text')) {
    D.push({ ...blank, kind: 'on_screen_text', phrase: code, description_en: `Promo code ${code} visible on screen`, description_ar: `إظهار كود الخصم ${code} على الشاشة` }); notes.push(`Added on-screen code ${code} from the chat`);
  }
  if (/subtitle|ترجمة|مترجم/i.test(chat) && !D.some((x) => x.kind === 'language')) {
    D.push({ ...blank, kind: 'language', languages: ['ar', 'en'], description_en: 'Arabic voice with English subtitles', description_ar: 'صوت عربي مع ترجمة إنجليزية' }); notes.push('Added language requirement (Arabic + English subtitles)');
  }
  const show = chat.match(/show (?:the |our )?([a-z]+(?: [a-z]+)?) clearly(?: and say (?:it has )?([^—\-.,\n]+))?/i);
  if (show && !D.some((x) => x.kind === 'custom' && new RegExp(show[1].split(' ').pop(), 'i').test(x.description_en))) {
    const en = `Show the ${show[1]} clearly${show[2] ? ` and say it has ${show[2].trim()}` : ''}`;
    D.push({ ...blank, kind: 'custom', description_en: en, description_ar: show[2] ? 'إظهار المنتج بوضوح وذكر الميزة المطلوبة' : 'إظهار المنتج بوضوح' }); notes.push(`Added “${en}” from the chat`);
  }
  // A “no exaggerated health claims” style instruction is a brand-safety custom check
  if (/ادعاء|health claim|claims/i.test(chat) && !(deal.deliverables || []).some((d) => /claim|ادعاء/i.test(d.description_en + d.description_ar))) {
    deal.deliverables.push({ kind: 'custom', description_en: 'No exaggerated health claims', description_ar: 'بدون ادعاءات صحية مبالغ فيها', phrase: '', aliases: [], within_first_seconds: null, min_seconds: null, max_seconds: null, languages: [] });
    notes.push('Added brand-safety check: no exaggerated health claims');
  }
  // Models often guess the wrong year: chats rarely say it, so assume the next upcoming date.
  const dm = String(deal.deadline || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dm) {
    const now = new Date(); let y = now.getFullYear();
    if (new Date(`${y}-${dm[2]}-${dm[3]}`) < new Date(now.toDateString())) y += 1;
    if (Number(dm[1]) !== y) { notes.push(`Deadline year corrected to ${y}`); deal.deadline = `${y}-${dm[2]}-${dm[3]}`; }
  }
  deal.grounding = { verifiedFacts: f.emails.length + f.percents.length + (f.amounts.length ? 1 : 0), corrections: notes };
  return deal;
}
