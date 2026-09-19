import type { RiskEvent } from '../../lib/events';
import { clearEvents, getEvents } from '../../lib/events';
import { buildSeedEvents, SEED_EVENT_COUNT } from '../../lib/seed';

/**
 * The single seam between Track C and Track A's contract.
 *
 * Everything the dashboard knows about `lib/events.ts` lives in this file, so a
 * late shape change on the other side of the contract is a one-file fix at
 * T+1:20 instead of a scatter of edits across the UI.
 *
 * TRD §7 says every exported async function in `lib/` returns `Result<T>`, but
 * the dashboard must not fall over if it receives a bare array instead. `unwrap`
 * accepts both.
 */

export { SEED_EVENT_COUNT };

type ResultLike<T> = T | { ok: true; value: T } | { ok: false; error: unknown };

type Unwrapped<T> = { ok: true; value: T } | { ok: false; message: string };

function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const kind = (error as { kind?: unknown }).kind;
    const detail = (error as { detail?: unknown }).detail;
    if (typeof kind === 'string') {
      return typeof detail === 'string' ? `${kind}: ${detail}` : `${kind} error`;
    }
  }
  return 'Unknown error';
}

function unwrap<T>(result: ResultLike<T>): Unwrapped<T> {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const tagged = result as { ok: boolean; value?: T; error?: unknown };
    return tagged.ok
      ? { ok: true, value: tagged.value as T }
      : { ok: false, message: describeError(tagged.error) };
  }
  return { ok: true, value: result as T };
}

type ChromeLike = { runtime?: { getURL?(path: string): string } };

const chromeApi = (globalThis as unknown as { chrome?: ChromeLike }).chrome;

/**
 * Deep link into Track D's course. Falls back to a relative path so the page is
 * still navigable when opened through the Vite dev server rather than
 * chrome-extension://.
 */
export function lessonUrl(lessonId: string): string {
  const hash = `#${lessonId}`;
  const getURL = chromeApi?.runtime?.getURL;
  if (getURL) return getURL('pages/course/index.html') + hash;
  return `../course/index.html${hash}`;
}

/** `?seed=1` loads the demo fixture. PRD §8: the fixture sits behind a flag, never on by default. */
export const SAMPLE_REQUESTED =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('seed') === '1';

export type Source = 'live' | 'sample';

export type LoadResult = {
  events: RiskEvent[];
  source: Source;
  /** Non-fatal: shown as a banner while the dashboard still renders what it has. */
  error: string | null;
};

export async function loadEvents(source: Source): Promise<LoadResult> {
  if (source === 'sample') {
    return { events: buildSeedEvents(), source: 'sample', error: null };
  }

  try {
    const result = unwrap<RiskEvent[]>(await getEvents());
    if (!result.ok) {
      return {
        events: [],
        source: 'live',
        error: `Could not read the event log — ${result.message}`,
      };
    }
    return {
      events: Array.isArray(result.value) ? result.value : [],
      source: 'live',
      error: null,
    };
  } catch (error) {
    // getEvents() is not supposed to throw, but an exception here would otherwise
    // leave the dashboard stuck on a spinner in front of an audience.
    return {
      events: [],
      source: 'live',
      error: `Could not read the event log — ${describeError(error)}`,
    };
  }
}

export async function wipeEvents(): Promise<{ ok: boolean; message: string | null }> {
  try {
    const result = unwrap<void>(await clearEvents());
    return result.ok ? { ok: true, message: null } : { ok: false, message: result.message };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}
