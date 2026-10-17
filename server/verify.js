// Delivery verification pipeline: video -> evidence -> per-deliverable verdicts.
// Hard requirements (duration, spoken brand mention, on-screen code, language) are checked
// deterministically with timestamped evidence, so money is never released on an LLM's say-so.
// The LLM judges only subjective "custom" requirements and writes bilingual feedback.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import { judgeDelivery } from './ai.js';
import { fuzzyFind, hasArabic, hasLatin, norm, fmtTime } from './text.js';

function run(cmd, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '', errOut = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (errOut += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${errOut.slice(-500)}`))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export async function probeDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim()) || 0;
}

export async function transcribe(file) {
  const out = await run(config.python, [path.join(ROOT, 'scripts/transcribe.py'), file, config.whisperModel]);
  return JSON.parse(out);
}

/** Sample one frame per second and OCR it (Tesseract, English + Arabic). */
export async function ocrFrames(file, duration) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-'));
  try {
    await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', "fps=1,scale='min(1280,iw)':-2", path.join(dir, 'f%04d.png')]);
    const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    // Skip frames identical to an already-read one (static shots are common) — big speed-up.
    const seen = new Map();
    const results = [];
    const jobs = frames.map((f, i) => async () => {
      const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(dir, f))).digest('hex');
      let text = seen.get(hash);
      if (text === undefined) {
        const p = run('tesseract', [path.join(dir, f), 'stdout', '-l', 'eng+ara', '--psm', '11'], { env: { OMP_THREAD_LIMIT: '1' } }).catch(() => '');
        seen.set(hash, p); text = p;
      }
      text = (await text).replace(/\s+/g, ' ').trim();
      if (text.length > 1) results.push({ t: i, text });
    });
    // small worker pool
    const pool = Array.from({ length: Math.max(2, Math.min(4, os.cpus().length - 2)) }, async () => { while (jobs.length) await jobs.shift()(); });
    await Promise.all(pool);
    return results.sort((a, b) => a.t - b.t).filter((r) => r.t <= Math.ceil(duration));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const THRESH = 0.8;

// Brand-safety guardrail: deterministic lexicon of risky claims (Arabic + English), reported with timestamps
// and handed to the AI judge as hints. Catches what a small model may miss.
const RISKY = [
  [/تخسر?\s*(ال)?وزن|تنحيف|يحرق\s*(ال)?دهون|weight\s*loss|lose\s*weight|burns?\s*fat/i, 'health claim: weight loss'],
  [/(ت|ي)قوي\s*(ال)?مناع|immunity|immune/i, 'health claim: immunity'],
  [/يعالج|بيعالج|علاج|cures?\b|treats?\b/i, 'health claim: cure/treatment'],
  [/مضمون\s*100|guaranteed|100%\s*(natural|safe)/i, 'absolute claim'],
];
export function riskScan(transcript) {
  const hits = [];
  for (const seg of transcript.segments) for (const [re, label] of RISKY) if (re.test(seg.text)) hits.push({ label, at: seg.start, text: seg.text });
  return hits;
}

export function deterministicChecks(deal, { duration, transcript, ocr }) {
  const checks = [];
  for (const d of deal.deliverables) {
    const terms = [d.phrase, ...(d.aliases || [])].filter(Boolean);
    if (d.kind === 'duration') {
      const okMin = d.min_seconds == null || duration >= d.min_seconds - 0.5;
      const okMax = d.max_seconds == null || duration <= d.max_seconds + 0.5;
      checks.push({ id: d.id, kind: d.kind, pass: okMin && okMax, confidence: 1, at_seconds: null,
        evidence: `Video is ${duration.toFixed(1)}s (required ${d.min_seconds ?? 0}–${d.max_seconds ?? '∞'}s)`,
        evidence_ar: `مدة الفيديو ${duration.toFixed(1)} ثانية (المطلوب ${d.min_seconds ?? 0}–${d.max_seconds ?? '∞'} ثانية)` });
    } else if (d.kind === 'spoken_mention') {
      let best = { sim: 0 };
      for (const s of transcript.segments) for (const term of terms) {
        const sim = fuzzyFind(s.text, term);
        if (sim > best.sim || (sim >= THRESH && best.sim >= THRESH && s.start < best.seg.start)) best = { sim, seg: s, term };
      }
      const firstHit = transcript.segments.find((s) => terms.some((t) => fuzzyFind(s.text, t) >= THRESH));
      const found = Boolean(firstHit);
      const inWindow = found && (d.within_first_seconds == null || firstHit.start <= d.within_first_seconds);
      checks.push({ id: d.id, kind: d.kind, pass: inWindow, confidence: found ? Math.max(best.sim, THRESH) : 1 - best.sim,
        at_seconds: firstHit?.start ?? null,
        evidence: found
          ? `Heard “${firstHit.text}” at ${fmtTime(firstHit.start)}${d.within_first_seconds != null ? (inWindow ? ` (within first ${d.within_first_seconds}s ✓)` : ` — too late, must be within first ${d.within_first_seconds}s`) : ''}`
          : `“${d.phrase}” was not heard anywhere in the audio`,
        evidence_ar: found
          ? `سُمع «${firstHit.text}» عند ${fmtTime(firstHit.start)}${d.within_first_seconds != null ? (inWindow ? ` (ضمن أول ${d.within_first_seconds} ثانية ✓)` : ` — متأخر، يجب أن يكون خلال أول ${d.within_first_seconds} ثانية`) : ''}`
          : `لم يُذكر «${d.phrase}» في الصوت إطلاقاً` });
    } else if (d.kind === 'on_screen_text') {
      let hit = null;
      for (const o of ocr) if (terms.some((t) => fuzzyFind(o.text, t) >= 0.85)) { hit = o; break; }
      const inWindow = hit && (d.within_first_seconds == null || hit.t <= d.within_first_seconds);
      const seconds = hit ? ocr.filter((o) => terms.some((t) => fuzzyFind(o.text, t) >= 0.85)).length : 0;
      checks.push({ id: d.id, kind: d.kind, pass: Boolean(inWindow), confidence: hit ? 0.95 : 0.9, at_seconds: hit?.t ?? null,
        evidence: hit ? `“${d.phrase}” visible on screen from ${fmtTime(hit.t)} (${seconds}s total)` : `“${d.phrase}” never appears on screen (checked ${Math.ceil(duration)} frames)`,
        evidence_ar: hit ? `«${d.phrase}» ظاهر على الشاشة من ${fmtTime(hit.t)} (${seconds} ثانية)` : `«${d.phrase}» لا يظهر على الشاشة أبداً (تم فحص ${Math.ceil(duration)} إطاراً)` });
    } else if (d.kind === 'language') {
      const all = transcript.segments.map((s) => s.text).join(' ');
      const need = (d.languages?.length ? d.languages : ['ar', 'en']).map((l) => l.slice(0, 2).toLowerCase());
      const spoken = { ar: hasArabic(all) || transcript.language === 'ar', en: hasLatin(all) || transcript.language === 'en' };
      const subs = { ar: ocr.some((o) => hasArabic(o.text)), en: ocr.some((o) => hasLatin(o.text) && norm(o.text).length > 8) };
      const ok = need.every((l) => spoken[l] || subs[l]);
      checks.push({ id: d.id, kind: d.kind, pass: ok, confidence: 0.85, at_seconds: null,
        evidence: `Speech: ${Object.entries(spoken).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join('+') || 'none'}; on-screen text: ${Object.entries(subs).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join('+') || 'none'}; required ${need.join('+').toUpperCase()}`,
        evidence_ar: `الكلام: ${spoken.ar ? 'عربي' : ''}${spoken.ar && spoken.en ? ' + ' : ''}${spoken.en ? 'إنجليزي' : ''}؛ النص على الشاشة: ${subs.ar ? 'عربي' : ''}${subs.ar && subs.en ? ' + ' : ''}${subs.en ? 'إنجليزي' : ''}` });
    }
  }
  return checks;
}

/** Full pipeline. `onStep` streams progress to the UI/event log. */
export async function verifyDelivery(deal, file, onStep = () => {}) {
  onStep('probe', 'Reading video');
  const duration = await probeDuration(file);
  onStep('transcribe', 'Transcribing Arabic/English speech (Whisper)');
  const [transcript, ocr] = await Promise.all([
    transcribe(file),
    (async () => { const r = await ocrFrames(file, duration); onStep('ocr', `Read on-screen text in ${Math.ceil(duration)} frames (Tesseract eng+ara)`); return r; })(),
  ]);
  onStep('checks', 'Checking hard requirements');
  const checks = deterministicChecks(deal, { duration, transcript, ocr });
  onStep('judge', 'AI auditor reviewing subjective requirements + writing feedback');
  const risks = riskScan(transcript);
  let judged = { custom: [], feedback_en: '', feedback_ar: '', risk_flags: [] };
  let aiError = null;
  try { judged = await judgeDelivery({ deal, transcript, ocr, checks, risks }); } catch (e) { aiError = e.message; }
  judged.risk_flags = [...new Set([...risks.map((r) => `${r.label} @ ${fmtTime(r.at)}`), ...(judged.risk_flags || []).filter((f) => !risks.some((r) => f.toLowerCase().includes(r.label.split(': ')[1] || '~')))])];
  const results = deal.deliverables.map((d) => {
    const c = checks.find((x) => x.id === d.id);
    if (c) return { ...c, description_en: d.description_en, description_ar: d.description_ar, method: 'deterministic' };
    const j = judged.custom.find((x) => x.id === d.id) || judged.custom[deal.deliverables.filter((x) => x.kind === 'custom').indexOf(d)];
    const aboutClaims = /claim|ادعاء/i.test(`${d.description_en} ${d.description_ar}`);
    if (aboutClaims && risks.length) {
      const r = risks[0];
      return { id: d.id, kind: d.kind, description_en: d.description_en, description_ar: d.description_ar, method: 'ai', pass: false, confidence: 0.95, at_seconds: r.at,
        evidence: `Risky ${r.label} at ${fmtTime(r.at)}: “${r.text}”`, evidence_ar: `ادعاء خطر عند ${fmtTime(r.at)}: «${r.text}»` };
    }
    return { id: d.id, kind: d.kind, description_en: d.description_en, description_ar: d.description_ar, method: 'ai',
      pass: Boolean(j?.pass), confidence: j?.confidence ?? 0, at_seconds: j?.at_seconds ?? null,
      evidence: j?.evidence || (aiError ? `AI auditor unavailable: ${aiError}` : 'No evidence found') };
  });
  const passed = results.every((r) => r.pass);
  const score = Math.round((results.filter((r) => r.pass).length / Math.max(1, results.length)) * 100);
  const clean = (x, ar) => {
    const v = String(x || '').trim();
    if (!v || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(v) || /\bd\d+\b/.test(v) || (ar && !/[\u0600-\u06FF]/.test(v))) return '';
    return v;
  };
  const fails = results.filter((r) => !r.pass);
  const coachEn = (passed && clean(judged.coach_en)) || (passed ? 'Everything the brand asked for is in the video. Great work!' : 'Almost there. Fix the items below and upload a new version; your payment is safely on hold.');
  const coachAr = (passed && clean(judged.coach_ar, true)) || (passed ? 'الفيديو فيه كل ما طلبته العلامة التجارية. عمل رائع!' : 'قربت! صلّح النقاط التالية وارفع نسخة جديدة، ودفعتك محجوزة بأمان.');
  judged.feedback_en = passed ? coachEn : `${coachEn}\n${fails.map((f) => `• ${f.description_en}: ${f.evidence}`).join('\n')}`;
  judged.feedback_ar = passed ? coachAr : `${coachAr}\n${fails.map((f) => `• ${f.description_ar || f.description_en}: ${f.evidence_ar || ''}`.replace(/: $/, '')).join('\n')}`;
  for (const r of results) if (r.method === 'ai') r.evidence = clean(r.evidence) || r.evidence.replace(/[\u3040-\u30ff\u3400-\u9fff]/g, '');
  return { passed, score, duration, transcript, ocr, results, feedback_en: judged.feedback_en, feedback_ar: judged.feedback_ar, risk_flags: judged.risk_flags || [], aiError };
}
