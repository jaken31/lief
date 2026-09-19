import type { LessonId } from '../../lib/lessons';
import type { RiskEvent } from '../../lib/events';
import { LESSON_ORDER } from './labels';

/**
 * Every number on the dashboard comes from this one pass (TRD §6.2).
 *
 * Single O(n) walk so the 500-event budget in TRD §10 is met with room to spare.
 * The whole dashboard is scoped to one window — the last 7 days — rather than
 * mixing a 7-day timeline with all-time counts, which reads as a contradiction
 * on stage.
 */

export const WINDOW_DAYS = 7;

export type DayBucket = {
  start: number;
  label: string;
  dangerous: number;
  suspicious: number;
  total: number;
};

export type ConceptCount = {
  lessonId: LessonId;
  count: number;
  dangerous: number;
  lastTs: number;
  /** Most recent human-readable detail for this concept — the teaching payload. */
  lastDetail: string;
};

export type EntryPointCount = {
  kind: RiskEvent['referrerKind'];
  count: number;
};

export type ActionCounts = {
  left: number;
  learned: number;
  dismissed: number;
  unanswered: number;
};

export type Summary = {
  /** Risk events inside the window, newest first — ready to render. */
  events: RiskEvent[];
  total: number;
  dangerous: number;
  /** Risk events that fell outside the 7-day window. */
  olderCount: number;
  days: DayBucket[];
  peakDay: number;
  concepts: ConceptCount[];
  recommendation: ConceptCount | null;
  entryPoints: EntryPointCount[];
  actions: ActionCounts;
};

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-day arithmetic, not `+ 86400000` — the latter drifts across a DST boundary. */
function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(start: number, today: number): string {
  if (start === today) return 'Today';
  if (start === addDays(today, -1)) return 'Yest';
  return new Date(start).toLocaleDateString(undefined, { weekday: 'short' });
}

export function summarize(all: readonly RiskEvent[], now: number = Date.now()): Summary {
  const today = startOfDay(now);
  const days: DayBucket[] = [];
  const indexByDay = new Map<number, number>();

  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const start = addDays(today, i - (WINDOW_DAYS - 1));
    indexByDay.set(start, i);
    days.push({ start, label: dayLabel(start, today), dangerous: 0, suspicious: 0, total: 0 });
  }

  const windowStart = days[0].start;
  const events: RiskEvent[] = [];
  const conceptMap = new Map<LessonId, ConceptCount>();
  const entryMap = new Map<RiskEvent['referrerKind'], number>();
  const actions: ActionCounts = { left: 0, learned: 0, dismissed: 0, unanswered: 0 };

  let olderCount = 0;
  let dangerous = 0;

  for (const event of all) {
    // A 'safe' verdict is never a risk incident; counting it would make the bars lie.
    if (event.verdict === 'safe') continue;

    if (event.ts < windowStart) {
      olderCount += 1;
      continue;
    }

    events.push(event);
    if (event.verdict === 'dangerous') dangerous += 1;

    const dayIndex = indexByDay.get(startOfDay(event.ts));
    if (dayIndex !== undefined) {
      const bucket = days[dayIndex];
      bucket.total += 1;
      if (event.verdict === 'dangerous') bucket.dangerous += 1;
      else bucket.suspicious += 1;
    }

    const concept = conceptMap.get(event.lessonId);
    if (!concept) {
      conceptMap.set(event.lessonId, {
        lessonId: event.lessonId,
        count: 1,
        dangerous: event.verdict === 'dangerous' ? 1 : 0,
        lastTs: event.ts,
        lastDetail: event.detail,
      });
    } else {
      concept.count += 1;
      if (event.verdict === 'dangerous') concept.dangerous += 1;
      if (event.ts >= concept.lastTs) {
        concept.lastTs = event.ts;
        concept.lastDetail = event.detail;
      }
    }

    entryMap.set(event.referrerKind, (entryMap.get(event.referrerKind) ?? 0) + 1);

    if (event.action === null) actions.unanswered += 1;
    else actions[event.action] += 1;
  }

  // Count descending; ties resolve by PRD §4.1 lesson order so the recommendation
  // is stable across reloads rather than depending on Map insertion order.
  const concepts = [...conceptMap.values()].sort(
    (a, b) =>
      b.count - a.count || LESSON_ORDER.indexOf(a.lessonId) - LESSON_ORDER.indexOf(b.lessonId),
  );

  const entryPoints = [...entryMap.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  events.sort((a, b) => b.ts - a.ts);

  return {
    events,
    total: events.length,
    dangerous,
    olderCount,
    days,
    peakDay: days.reduce((max, day) => Math.max(max, day.total), 0),
    concepts,
    recommendation: concepts[0] ?? null,
    entryPoints,
    actions,
  };
}
