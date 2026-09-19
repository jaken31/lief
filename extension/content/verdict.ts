/**
 * Track B's trust boundary. TRD §1: the content script runs in a hostile document
 * and never trusts what it is handed — it validates before it renders.
 */
import type { RiskEvent } from '../lib/events';
import { isLessonId } from '../lib/lessons';

const VERDICTS: ReadonlySet<string> = new Set(['safe', 'suspicious', 'dangerous']);

/**
 * Normalises every shape the background actually sends:
 *
 *   { type: 'LIEF_VERDICT', event }  pushed verdict
 *   { event }                        LiefResponse — the replay and H3 replies
 *   RiskEvent                        bare, tolerated
 *
 * The middle one is the one that matters. It is the answer to
 * LIEF_REQUEST_VERDICT, so rejecting it means the banner never appears on a page
 * whose verdict was ready before the content script mounted — the cached-page half
 * of the load-order race, and an intermittent failure by nature.
 */
export function toRiskEvent(value: unknown): RiskEvent | null {
  if (typeof value !== 'object' || value === null) return null;

  const unwrapped = 'event' in value ? (value as { event: unknown }).event : value;
  if (typeof unwrapped !== 'object' || unwrapped === null) return null;

  const event = unwrapped as Partial<RiskEvent>;
  if (typeof event.id !== 'string') return null;
  if (typeof event.host !== 'string') return null;
  if (typeof event.detail !== 'string') return null;
  if (typeof event.verdict !== 'string' || !VERDICTS.has(event.verdict)) return null;
  if (typeof event.lessonId !== 'string' || !isLessonId(event.lessonId)) return null;

  return event as RiskEvent;
}
