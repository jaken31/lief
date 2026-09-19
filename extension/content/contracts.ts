/**
 * TEMPORARY — local mirror of Track A's contracts.
 *
 * Track A owns extension/lib/{lessons,events,detect}.ts and extension/manifest.json.
 * Those files do not exist yet, so Track B mirrors only the shapes it needs, copied
 * literally from PRD §6 and TRD §4/§5.
 *
 * DELETE THIS FILE the moment extension/lib/ lands and repoint the two imports in
 * banner.ts and index.ts. Nothing here may be edited to "fix" an integration — if a
 * shape disagrees with Track A's, Track A wins.
 */

export type LessonId =
  | 'url-anatomy'
  | 'lookalike-domains'
  | 'phishing-pressure'
  | 'https-is-not-safe'
  | 'downloads-and-permissions';

/** PRD §4.1, in order. Array position + 1 is the lesson number the banner shows. */
export const LESSONS: readonly { readonly id: LessonId; readonly title: string }[] = [
  { id: 'url-anatomy', title: 'Anatomy of a URL — where the real domain actually lives' },
  { id: 'lookalike-domains', title: 'Homoglyphs, typosquats, punycode' },
  {
    id: 'phishing-pressure',
    title: 'Urgency, authority, fear — and the ask is always credentials or payment',
  },
  {
    id: 'https-is-not-safe',
    title: 'What the padlock actually proves (transport, not trustworthiness)',
  },
  { id: 'downloads-and-permissions', title: 'Double extensions, permission prompts, sideloading' },
];

export type RiskEvent = {
  id: string;
  ts: number;
  host: string;
  verdict: 'safe' | 'suspicious' | 'dangerous';
  source: 'heuristic' | 'safebrowsing';
  lessonId: LessonId;
  detail: string;
  referrerKind: 'email' | 'search' | 'social' | 'direct' | 'unknown';
  action: 'dismissed' | 'left' | 'learned' | null;
};

export type LiefMessage =
  | { type: 'LIEF_VERDICT'; event: RiskEvent }
  | { type: 'LIEF_REQUEST_VERDICT' }
  | { type: 'LIEF_PASSWORD_FIELD'; hasPassword: boolean }
  | { type: 'LIEF_ACTION'; eventId: string; action: RiskEvent['action'] };

/** TRD §7. */
export type LiefError =
  | { kind: 'network'; status?: number }
  | { kind: 'storage' }
  | { kind: 'parse'; raw: string }
  | { kind: 'config'; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: LiefError };

const LESSON_IDS: ReadonlySet<string> = new Set(LESSONS.map((lesson) => lesson.id));
const VERDICTS: ReadonlySet<string> = new Set(['safe', 'suspicious', 'dangerous']);

export function isLessonId(value: unknown): value is LessonId {
  return typeof value === 'string' && LESSON_IDS.has(value);
}

/** 1-based, so the banner can say "Lesson 2" the way the demo script does. */
export function lessonNumber(id: LessonId): number {
  return LESSONS.findIndex((lesson) => lesson.id === id) + 1;
}

/**
 * The registry titles carry an em-dash gloss. The banner already prefixes its own
 * em-dash, so display only the head of the title.
 */
export function lessonTitle(id: LessonId): string {
  const full = LESSONS.find((lesson) => lesson.id === id)?.title ?? id;
  return full.split(' — ')[0] ?? full;
}

/**
 * The content script runs in a hostile document and never trusts what it is handed.
 * Accepts either a bare RiskEvent or a LIEF_VERDICT envelope, because Track A's reply
 * shape for LIEF_REQUEST_VERDICT is not pinned down by the TRD.
 */
export function toRiskEvent(value: unknown): RiskEvent | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = 'type' in value && (value as { type: unknown }).type === 'LIEF_VERDICT'
    ? (value as { event?: unknown }).event
    : value;

  if (typeof candidate !== 'object' || candidate === null) return null;
  const event = candidate as Partial<RiskEvent>;

  if (typeof event.id !== 'string') return null;
  if (typeof event.host !== 'string') return null;
  if (typeof event.detail !== 'string') return null;
  if (typeof event.verdict !== 'string' || !VERDICTS.has(event.verdict)) return null;
  if (!isLessonId(event.lessonId)) return null;

  return event as RiskEvent;
}
