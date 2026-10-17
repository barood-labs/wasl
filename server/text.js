// Arabic/English text normalization + fuzzy matching used by the deterministic verifiers.
const AR_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function norm(s = '') {
  return String(s)
    .normalize('NFKC')
    .replace(AR_DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Best fuzzy occurrence of `needle` inside `hay` (token-window based). Returns similarity 0..1. */
export function fuzzyFind(hay, needle) {
  const direct = fuzzyFindDirect(hay, needle);
  if (direct >= 0.8 || hasArabic(hay) === hasArabic(needle)) return direct;
  return Math.max(direct, phoneticFind(hay, needle) * 0.95);
}

function fuzzyFindDirect(hay, needle) {
  const H = norm(hay), N = norm(needle);
  if (!N) return 0;
  if (` ${H} `.includes(` ${N} `)) return 1;
  const ht = H.split(' '), nt = N.split(' ').length;
  let best = 0;
  for (let w = Math.max(1, nt - 1); w <= nt + 1; w++) {
    for (let i = 0; i + w <= ht.length; i++) {
      const win = ht.slice(i, i + w).join(' ');
      const sim = 1 - levenshtein(win, N) / Math.max(win.length, N.length);
      if (sim > best) best = sim;
    }
  }
  // also compare with spaces removed (OCR often merges/splits tokens, e.g. "NOOR 20" vs "NOOR20")
  const Hc = H.replace(/ /g, ''), Nc = N.replace(/ /g, '');
  if (/^[a-z0-9]+$/.test(Nc) && Nc.length >= 4 && Hc.includes(Nc)) best = Math.max(best, 0.97);
  return best;
}

export const hasArabic = (s) => /[\u0600-\u06FF]/.test(s || '');
export const hasLatin = (s) => /[A-Za-z]/.test(s || '');
export const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---- Cross-script phonetic skeleton, so "Noor Cold Brew" matches Whisper's Arabic-script "نور كولد برو".
const AR2LAT = { 'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': '', 'ة': '', 'و': '', 'ي': '', 'ى': '', 'ا': '', 'أ': '', 'إ': '', 'آ': '', 'ء': '', 'ئ': '', 'ؤ': '', 'پ': 'b', 'چ': 'j', 'ڤ': 'f', 'گ': 'g' };
export function skeleton(s = '') {
  return norm(s).split(' ').map((w) => {
    if (/[\u0600-\u06FF]/.test(w)) return [...w].map((c) => AR2LAT[c] ?? '').join('');
    return w.replace(/ph/g, 'f').replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/v/g, 'f').replace(/p/g, 'b').replace(/[aeiouwyh]/g, '').replace(/(.)\1+/g, '$1');
  }).filter(Boolean).join(' ');
}
export function phoneticFind(hay, needle) {
  const N = skeleton(needle);
  if (N.replace(/ /g, '').length < 3) return 0;
  const H = skeleton(hay).split(' ');
  const n = N.split(' ').length;
  let best = 0;
  for (let i = 0; i + n <= H.length; i++) {
    const win = H.slice(i, i + n).join(' ');
    const sim = 1 - levenshtein(win, N) / Math.max(win.length, N.length);
    if (sim > best) best = sim;
  }
  return best;
}
