/**
 * lessons.ts — the shared vocabulary.
 *
 * CONTRACT. Frozen at T+0:10. E2/E3/E4 import from here.
 * Every detector must name a lesson; see PRD §4.1 and the non-nullable
 * `lessonId` on RiskEvent. A detector that cannot name a lesson is a guess.
 *
 * Safe to import from Node (tests) — no chrome.* call happens at module scope.
 */

export const LESSONS = {
  'url-anatomy': 'Anatomy of a URL',
  'lookalike-domains': 'Lookalike domains',
  'phishing-pressure': 'Phishing pressure',
  'https-is-not-safe': 'HTTPS is not safety',
  'downloads-and-permissions': 'Downloads and permissions',
} as const;

export type LessonId = keyof typeof LESSONS;

export const LESSON_IDS = Object.keys(LESSONS) as LessonId[];

export function lessonTitle(id: LessonId): string {
  return LESSONS[id];
}

export function isLessonId(value: string): value is LessonId {
  return Object.prototype.hasOwnProperty.call(LESSONS, value);
}

/**
 * Deep link into the bundled course. Requires `web_accessible_resources`
 * in the manifest — without it this URL resolves but the load is blocked,
 * silently, and E2 spends half an hour looking in the wrong file.
 */
export function lessonUrl(id: LessonId): string {
  return chrome.runtime.getURL(`pages/course/index.html#${id}`);
}
