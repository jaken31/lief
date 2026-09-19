/**
 * Demo seed fixture (Track C).
 *
 * Pure data. This module deliberately does NOT touch chrome.storage — `lib/events.ts`
 * is the only write path (TRD §5). The dashboard renders these events directly when
 * the sample flag is on, so seeding can never corrupt a real event log.
 *
 * Weighting is intentional: `lookalike-domains` appears exactly 4 times so the
 * recommendation has one obvious answer and matches the demo line in PRD §8 —
 * "you have hit this concept four times".
 */

import type { LessonId } from './lessons';
import type { RiskEvent } from './events';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Offsets are relative to "now" so the 7-day timeline always has shape, whenever it runs. */
type SeedSpec = {
  daysAgo: number;
  hour: number;
  host: string;
  verdict: RiskEvent['verdict'];
  source: RiskEvent['source'];
  lessonId: LessonId;
  detail: string;
  referrerKind: RiskEvent['referrerKind'];
  action: RiskEvent['action'];
};

const SPECS: SeedSpec[] = [
  // --- lookalike-domains ×4 — the recommendation the demo hangs on -------------
  {
    daysAgo: 0,
    hour: 9,
    host: 'paypa1.com',
    verdict: 'dangerous',
    source: 'heuristic',
    lessonId: 'lookalike-domains',
    detail: 'paypa1.com — digit 1 where the letter l belongs',
    referrerKind: 'email',
    action: 'left',
  },
  {
    daysAgo: 2,
    hour: 14,
    host: 'arnazon.com',
    verdict: 'dangerous',
    source: 'heuristic',
    lessonId: 'lookalike-domains',
    detail: 'arnazon.com — the pair r n reads as an m at a glance',
    referrerKind: 'social',
    action: 'left',
  },
  {
    daysAgo: 4,
    hour: 20,
    host: 'gooogle.com',
    verdict: 'dangerous',
    source: 'heuristic',
    lessonId: 'lookalike-domains',
    detail: 'gooogle.com — one extra o in google',
    referrerKind: 'search',
    action: 'dismissed',
  },
  {
    daysAgo: 6,
    hour: 11,
    host: 'xn--pypal-4ve.com',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'lookalike-domains',
    detail: 'xn--pypal-4ve.com — punycode host that displays as paypal.com using a Cyrillic а',
    referrerKind: 'email',
    action: 'learned',
  },

  // --- phishing-pressure ×3 ----------------------------------------------------
  {
    daysAgo: 1,
    hour: 8,
    host: 'account-verify-now.net',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'phishing-pressure',
    detail: 'Password field on an origin you have never signed in to before',
    referrerKind: 'email',
    action: 'left',
  },
  {
    daysAgo: 3,
    hour: 17,
    host: 'secure-chase-alerts.com',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'phishing-pressure',
    detail: 'Password field next to a 24-hour account-closure warning',
    referrerKind: 'email',
    action: 'dismissed',
  },
  {
    daysAgo: 5,
    hour: 13,
    host: 'testsafebrowsing.appspot.com',
    verdict: 'dangerous',
    source: 'safebrowsing',
    lessonId: 'phishing-pressure',
    detail: 'Google Safe Browsing: SOCIAL_ENGINEERING',
    referrerKind: 'search',
    action: 'left',
  },

  // --- downloads-and-permissions ×2 -------------------------------------------
  {
    daysAgo: 1,
    hour: 21,
    host: 'free-pdf-tools.xyz',
    verdict: 'dangerous',
    source: 'heuristic',
    lessonId: 'downloads-and-permissions',
    detail: 'invoice.pdf.exe — a double extension; the file is really an .exe',
    referrerKind: 'search',
    action: 'left',
  },
  {
    daysAgo: 5,
    hour: 10,
    host: 'cdn-update-host.co',
    verdict: 'dangerous',
    source: 'safebrowsing',
    lessonId: 'downloads-and-permissions',
    detail: 'Google Safe Browsing: MALWARE',
    referrerKind: 'direct',
    action: 'dismissed',
  },

  // --- url-anatomy ×2 ----------------------------------------------------------
  {
    daysAgo: 2,
    hour: 16,
    host: 'login.secure.apple.com.verify-id.co',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'url-anatomy',
    detail: 'The real domain is verify-id.co — everything before it is just a subdomain',
    referrerKind: 'email',
    action: 'learned',
  },
  {
    daysAgo: 6,
    hour: 19,
    host: '192.168.4.21',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'url-anatomy',
    detail: 'The host is a raw IP address, so there is no domain name to check',
    referrerKind: 'direct',
    action: 'dismissed',
  },

  // --- https-is-not-safe ×1 ----------------------------------------------------
  {
    daysAgo: 3,
    hour: 12,
    host: 'secure-login-portal.top',
    verdict: 'suspicious',
    source: 'heuristic',
    lessonId: 'https-is-not-safe',
    detail: 'Valid padlock on a domain registered this week — encryption is not endorsement',
    referrerKind: 'social',
    action: 'dismissed',
  },
];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Builds the fixture relative to `now`, oldest first — same ordering as the real
 * log (TRD §5: "newest last"), so the dashboard cannot accidentally depend on
 * sample-only ordering.
 */
export function buildSeedEvents(now: number = Date.now()): RiskEvent[] {
  const today = startOfDay(now);
  return SPECS
    .map((spec, i) => ({
      id: `seed-${String(i + 1).padStart(2, '0')}`,
      ts: today - spec.daysAgo * DAY_MS + spec.hour * HOUR_MS,
      host: spec.host,
      verdict: spec.verdict,
      source: spec.source,
      lessonId: spec.lessonId,
      detail: spec.detail,
      referrerKind: spec.referrerKind,
      action: spec.action,
    }))
    .sort((a, b) => a.ts - b.ts);
}

/** Count of events in the fixture, for copy like "load a sample week (12 events)". */
export const SEED_EVENT_COUNT = SPECS.length;
