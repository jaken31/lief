/**
 * detect.ts — the heuristic layer. Layer 1 of detection.
 *
 * Every rule here is a PURE FUNCTION: URL or host in, `Detection | null` out.
 * No I/O, no storage, no async, no network, and no model. That is what makes
 * this the only trivially unit-testable part of the system (see detect.test.ts)
 * and what makes it impossible for this layer to be blocked by a missing key,
 * a rate limit, or a flaky network on stage.
 *
 * It also makes it EXPLAINABLE, which is the actual point. A hosted API returns
 * `SOCIAL_ENGINEERING` — a label. These rules return "the domain is paypa1.com,
 * note the digit 1 where the letter l belongs." That sentence is the teaching.
 */

import type { LessonId } from './lessons';
import type { Detection } from './types';
import { SEVERITY } from './types';

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * No Public Suffix List at this timebox — we take the last two labels, with a
 * hardcoded exception list for the multi-part TLDs we actually care about.
 * This misparses uncommon suffixes; ship `psl` post-hackathon (TRD §13.1).
 */
export const MULTI_PART_TLDS: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.nz', 'co.in', 'co.za', 'co.kr', 'co.il', 'co.id', 'co.th',
  'com.mx', 'com.ar', 'com.sg', 'com.hk', 'com.tw', 'com.tr', 'com.cn',
  'com.pl', 'com.es', 'com.pt', 'com.my', 'com.ph', 'com.vn', 'com.ua',
]);

export function toHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** IPv4 dotted quad, or a bracketed IPv6 literal as `new URL().hostname` reports it. */
export function isIpHost(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.split('.').every((octet) => Number(octet) <= 255);
}

/** eTLD+1. `bbc.co.uk` → `bbc.co.uk`. `login.google.com.secure-verify.ru` → `secure-verify.ru`. */
export function registrableDomain(host: string): string {
  if (isIpHost(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** The brandable label. `bbc.co.uk` → `bbc`. `paypa1.com` → `paypa1`. */
export function secondLevelLabel(host: string): string {
  return registrableDomain(host).split('.')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Confusable folding
// ---------------------------------------------------------------------------

type FoldRule = { readonly from: string; readonly to: string; readonly note: string };

/**
 * Hand-rolled. Unicode TR39 confusables data is the correct source and is far
 * too large to inline at this timebox (TRD §13.2).
 *
 * The `note` is not decoration — it IS the detail string the banner shows, and
 * carrying it on the rule is why we can explain `arnazon` correctly. Positional
 * string diffing cannot: `rn→m` and `vv→w` change the length, so the characters
 * no longer line up.
 *
 * Multi-character rules must come first, or the single-character rules run on a
 * string whose pairs have already been broken up.
 */
export const FOLD_RULES: readonly FoldRule[] = [
  { from: 'rn', to: 'm', note: 'the letters r and n side by side, which read as a single m at a glance' },
  { from: 'vv', to: 'w', note: 'two v characters standing in for a w' },
  { from: 'cl', to: 'd', note: 'the letters c and l pushed together to imitate a d' },
  { from: '0', to: 'o', note: 'the digit 0 where the letter o belongs' },
  { from: '1', to: 'l', note: 'the digit 1 where the letter l belongs' },
  { from: '1', to: 'i', note: 'the digit 1 where the letter i belongs' },
  { from: '5', to: 's', note: 'the digit 5 where the letter s belongs' },
  { from: '3', to: 'e', note: 'the digit 3 where the letter e belongs' },
  { from: '4', to: 'a', note: 'the digit 4 where the letter a belongs' },
];

/** Cyrillic letters that are visually identical to Latin ones in most fonts. */
const CYRILLIC_MAP: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y',
  і: 'i', ѕ: 's', ԁ: 'd', ӏ: 'l', ј: 'j', ԛ: 'q', ԝ: 'w', ь: 'b',
};

const CYRILLIC_NOTE = 'Cyrillic characters that look identical to Latin ones';
const ACCENT_NOTE = 'accented characters standing in for plain ones';

export type FoldCandidate = { value: string; notes: readonly string[] };

function replaceAll(haystack: string, from: string, to: string): string {
  return haystack.split(from).join(to);
}

/**
 * Produces every plausible reading of a label, keeping the un-folded form too
 * so distance matching still works on ordinary typosquats.
 *
 * `1` is deliberately ambiguous — it imitates both `l` and `i` — so branching
 * rather than picking one is what lets `paypa1` and `netfl1x` both resolve.
 */
export function foldCandidates(label: string): FoldCandidate[] {
  const base = label.normalize('NFKC').toLowerCase();

  let candidates: FoldCandidate[] = [{ value: base, notes: [] }];

  // Cyrillic homoglyphs
  const deCyrillic = [...base].map((ch) => CYRILLIC_MAP[ch] ?? ch).join('');
  if (deCyrillic !== base) candidates.push({ value: deCyrillic, notes: [CYRILLIC_NOTE] });

  // Diacritics — one pass covers í ì î á à â ö ü and the rest.
  for (const candidate of [...candidates]) {
    const stripped = candidate.value.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (stripped !== candidate.value) {
      candidates.push({ value: stripped, notes: [...candidate.notes, ACCENT_NOTE] });
    }
  }

  for (const rule of FOLD_RULES) {
    const next: FoldCandidate[] = [];
    for (const candidate of candidates) {
      next.push(candidate); // always keep the un-applied form
      if (candidate.value.includes(rule.from)) {
        next.push({
          value: replaceAll(candidate.value, rule.from, rule.to),
          notes: [...candidate.notes, rule.note],
        });
      }
    }
    // Hard cap. Nine rules would otherwise reach 512 variants; 128 comparisons
    // of short strings is already far inside the <5ms budget.
    candidates = next.length > 128 ? next.slice(0, 128) : next;
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Edit distance
// ---------------------------------------------------------------------------

/** Damerau-Levenshtein (optimal string alignment). Adjacent transpositions cost 1. */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

// ---------------------------------------------------------------------------
// H1 — Lookalike / typosquat domain
// ---------------------------------------------------------------------------

export const BRANDS: readonly string[] = [
  'google', 'paypal', 'amazon', 'apple', 'microsoft', 'netflix', 'facebook',
  'instagram', 'linkedin', 'whatsapp', 'chase', 'wellsfargo', 'bankofamerica',
  'citibank', 'coinbase', 'binance', 'dropbox', 'outlook', 'adobe', 'github',
];

/**
 * Real words that sit within edit distance of a short brand. Without these the
 * engine warns on apply.com (distance 1 from `apple`) and finance.com
 * (distance 1 from `binance`) — and a warning on a legitimate site is worse
 * than ten missed detections. TRD §3.3.
 */
export const H1_EXEMPT: ReadonlySet<string> = new Set([
  'apply', 'apples', 'applet', 'ample', 'maple', 'appl',
  'chased', 'chaser', 'chases', 'chasing', 'phase', 'cease',
  'amazing', 'amazons', 'amaze',
  'googol', 'googles', 'goole', 'goggle', 'doodle',
  'finance', 'finances', 'binaries',
  'outlooks', 'lookout', 'adobo', 'abode',
  'gitlab', 'gitea',
]);

/**
 * TRD §3.2 says `distance <= 2` flat. Flat is wrong for short brands: at 2,
 * most five-letter English words collide with `apple` or `chase`.
 */
function maxDistance(brand: string): number {
  return brand.length <= 6 ? 1 : 2;
}

function hit(
  lessonId: LessonId,
  detail: string,
  rule: string,
  verdict: Detection['verdict'] = 'dangerous',
): Detection {
  return { verdict, lessonId, detail, source: 'heuristic', rule };
}

/**
 * H1 — the highest-value rule, and the one the demo hangs on.
 *
 * NOTE ON THE TRD: §3.2 specifies fold-then-distance with `0 < distance <= 2`.
 * As written that NEVER fires on paypa1.com, the flagship case: folding turns
 * `paypa1` into `paypal`, distance becomes 0, and the `0 <` guard — which is
 * there to stop the real paypal.com firing — silently eats it.
 *
 * So we compare twice, because raw and folded answer different questions:
 *
 *   raw    'paypa1'   what the user actually sees in the address bar
 *   folded 'paypal'   what it is pretending to be
 *
 *   raw === brand                     → the genuine article, stay silent
 *   folded === brand && raw !== brand → homoglyph. The strongest signal here:
 *                                       a character-for-character disguised
 *                                       brand is not a coincidence.
 *   0 < distance(folded, brand) <= max → ordinary typosquat (gooogle, amazn)
 */
export function h1LookalikeDomain(host: string): Detection | null {
  if (isIpHost(host)) return null;

  const label = secondLevelLabel(host);
  if (!label) return null;

  const raw = label.normalize('NFKC').toLowerCase();

  // The genuine brand, and anything we have decided is a real word. Both must
  // short-circuit before any fuzzy comparison runs.
  if (BRANDS.includes(raw)) return null;
  if (H1_EXEMPT.has(raw)) return null;

  const candidates = foldCandidates(label);

  // Pass 1 — exact match after folding. Homoglyph. Highest confidence.
  for (const candidate of candidates) {
    if (candidate.value === raw) continue; // nothing was folded
    for (const brand of BRANDS) {
      if (candidate.value !== brand) continue;
      const why = candidate.notes.length
        ? candidate.notes.join(', and ')
        : `characters chosen to imitate ${brand}`;
      return hit('lookalike-domains', `${host} — ${why}. The real ${brand}.com does not.`, 'H1');
    }
  }

  // Pass 2 — a brand with a reassuring word bolted on: wellsfargo-secure,
  // micros0ft-login. Dangerous if a fold also fired (that combination is
  // intent); merely suspicious if not, since it could be a partner site.
  for (const candidate of candidates) {
    for (const brand of BRANDS) {
      if (!candidate.value.startsWith(`${brand}-`)) continue;
      const folded = candidate.notes.length > 0;
      const why = folded
        ? `${candidate.notes.join(', and ')}, and a word bolted on to look official`
        : 'a real brand name with a word bolted on to look official';
      return hit(
        'lookalike-domains',
        `${host} — ${why}. The registered domain is not ${brand}.com.`,
        'H1',
        folded ? 'dangerous' : 'suspicious',
      );
    }
  }

  // Pass 3 — ordinary typosquat by edit distance.
  let best: { brand: string; distance: number } | null = null;
  for (const candidate of candidates) {
    for (const brand of BRANDS) {
      const distance = damerauLevenshtein(candidate.value, brand);
      if (distance === 0 || distance > maxDistance(brand)) continue;
      if (!best || distance < best.distance) best = { brand, distance };
    }
  }
  if (best) {
    const amount = best.distance === 1 ? 'one letter' : `${best.distance} letters`;
    return hit(
      'lookalike-domains',
      `${host} — ${amount} off from ${best.brand}.com. Read the domain again, slowly.`,
      'H1',
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// H2 — Punycode host
// ---------------------------------------------------------------------------

export function h2Punycode(host: string): Detection | null {
  const labels = host.split('.');
  if (!labels.some((label) => label.startsWith('xn--'))) return null;
  return hit(
    'lookalike-domains',
    `${host} uses punycode — an encoding that lets a domain display characters from other alphabets. The letters you see may not be the letters your browser sends.`,
    'H2',
    'suspicious',
  );
}

// ---------------------------------------------------------------------------
// H3 — Credential form on an untrusted origin
// ---------------------------------------------------------------------------

/**
 * The content script reports only the observation ("a password field exists").
 * This function decides. The content script runs in a hostile document and is
 * never trusted to produce a verdict — TRD §1, trust boundary.
 *
 * The caller guarantees the origin is not allowlisted; the allowlist gate runs
 * before any heuristic.
 */
export function h3CredentialForm(host: string, hasPasswordField: boolean): Detection | null {
  if (!hasPasswordField) return null;
  return hit(
    'phishing-pressure',
    `${host} is asking for a password, and it is not a site Lief recognises. Check the domain in the address bar before you type anything.`,
    'H3',
    'suspicious',
  );
}

// ---------------------------------------------------------------------------
// H4 — Raw IP address as host
// ---------------------------------------------------------------------------

export function h4RawIp(host: string): Detection | null {
  if (!isIpHost(host)) return null;
  return hit(
    'url-anatomy',
    `${host} is a bare IP address, not a domain name. There is no name to check and nobody named to hold responsible. Legitimate services put a name in front of their servers.`,
    'H4',
    'suspicious',
  );
}

// ---------------------------------------------------------------------------
// H5 — Risky download
// ---------------------------------------------------------------------------

const RISKY_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'scr', 'bat', 'cmd', 'com', 'msi', 'js', 'vbs', 'jar',
  'apk', 'dmg', 'pkg', 'ps1', 'hta', 'lnk', 'reg', 'iso',
]);

/** A harmless-looking extension followed by the real one: invoice.pdf.exe */
const DOUBLE_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|csv|zip|rtf)\.([a-z0-9]{2,4})$/i;

export function h5Download(filename: string): Detection | null {
  const name = filename.toLowerCase().split(/[\\/]/).pop() ?? '';
  if (!name) return null;

  const double = DOUBLE_EXTENSION.exec(name);
  if (double) {
    return hit(
      'downloads-and-permissions',
      `${name} has two extensions. It looks like a .${double[1]} file, but the one that actually runs is .${double[2]} — and that is the one your computer obeys.`,
      'H5',
    );
  }

  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (RISKY_EXTENSIONS.has(ext)) {
    return hit(
      'downloads-and-permissions',
      `${name} is a .${ext} file — a program, not a document. Opening it runs code on your machine with your permissions.`,
      'H5',
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Merge + orchestration
// ---------------------------------------------------------------------------

/**
 * TRD §3.5. Higher severity wins. Ties keep the FIRST argument — so when a
 * heuristic and the link set agree, the heuristic's human-readable explanation
 * survives instead of being overwritten by a canned one.
 */
export function mergeDetections(a: Detection | null, b: Detection | null): Detection | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b.verdict] > SEVERITY[a.verdict] ? b : a;
}

export type HeuristicContext = {
  hasPasswordField?: boolean;
};

/**
 * Synchronous, pure, target <5ms. The banner never waits on anything.
 *
 * Rule order sets the tie-break: H1 first, because its detail string is the
 * most specific thing the product can say.
 */
export function runHeuristics(url: string, ctx: HeuristicContext = {}): Detection | null {
  const host = toHost(url);
  if (!host) return null;

  const findings = [
    h1LookalikeDomain(host),
    h2Punycode(host),
    h4RawIp(host),
    h3CredentialForm(host, ctx.hasPasswordField ?? false),
  ];

  return findings.reduce<Detection | null>((acc, next) => mergeDetections(acc, next), null);
}

// ---------------------------------------------------------------------------
// https-is-not-safe — a secondary lesson, never a detector of its own
// ---------------------------------------------------------------------------

/**
 * An honest deviation from the PRD's 1:1 lesson↔detector claim. "This page uses
 * HTTPS" is not by itself a risk, so no standalone rule maps to it. It is
 * emitted as a secondary note whenever something else already fired on an
 * HTTPS page — which is exactly the moment the concept lands.
 */
export function httpsNote(url: string, verdict: Detection['verdict'] | 'safe'): string | null {
  if (verdict === 'safe') return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return 'The padlock is present. It proves the connection is encrypted, not that the site is honest.';
}

export const HTTPS_NOTE_LESSON: LessonId = 'https-is-not-safe';
