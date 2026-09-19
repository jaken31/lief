import type { LessonId } from '../../lib/lessons';
import type { RiskEvent } from '../../lib/events';

/**
 * Display strings for Track C.
 *
 * These are kept here rather than imported as runtime values from `lib/lessons.ts`
 * (Track A's file) on purpose: the five titles are frozen in PRD §4.1, so a
 * type-only dependency means a rename on the other side of the contract cannot
 * break the dashboard mid-build. The `Record<LessonId, …>` annotations still fail
 * the typecheck the moment a lessonId is added, removed, or renamed.
 */
export const LESSON_TITLES: Record<LessonId, string> = {
  'url-anatomy': 'Anatomy of a URL',
  'lookalike-domains': 'Lookalike domains',
  'phishing-pressure': 'Phishing pressure',
  'https-is-not-safe': 'HTTPS is not safety',
  'downloads-and-permissions': 'Downloads and permissions',
};

/** One line of "why this lesson", used on the recommendation card. */
export const LESSON_BLURB: Record<LessonId, string> = {
  'url-anatomy': 'Where the real domain actually lives in a URL.',
  'lookalike-domains': 'Homoglyphs, typosquats and punycode — the near-miss domain.',
  'phishing-pressure': 'Urgency, authority, fear — and the ask is always credentials.',
  'https-is-not-safe': 'What the padlock proves, and what it does not.',
  'downloads-and-permissions': 'Double extensions, permission prompts, sideloading.',
};

/** PRD §4.1 order. Used as the deterministic tie-break when two concepts are level. */
export const LESSON_ORDER: LessonId[] = [
  'url-anatomy',
  'lookalike-domains',
  'phishing-pressure',
  'https-is-not-safe',
  'downloads-and-permissions',
];

export const REFERRER_LABELS: Record<RiskEvent['referrerKind'], string> = {
  email: 'Email',
  search: 'Search',
  social: 'Social',
  direct: 'Typed or bookmarked',
  unknown: 'Unknown',
};

export const ACTION_LABELS: Record<NonNullable<RiskEvent['action']>, string> = {
  left: 'Left the page',
  learned: 'Opened the lesson',
  dismissed: 'Dismissed the warning',
};
