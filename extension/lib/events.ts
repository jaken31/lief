/**
 * events.ts — the ONLY module that touches chrome.storage.local.
 *
 * CONTRACT. Frozen at T+0:10. E3 reads through getEvents(), never directly.
 * One write path means one place to enforce the host-only rule (TRD §8) and
 * one place to fix a bug.
 *
 * (storage.session lives in sessionStore.ts — different lifetime, different
 * concern, and none of it is user data.)
 */

import type { LessonId } from './lessons';
import type { DetectionSource, Result, Verdict } from './types';
import { err, ok } from './types';

const K_EVENTS = 'lief:events';
const K_SETTINGS = 'lief:settings';

/** ~200 bytes/event → 500 events is ~100 KB against a 10 MB quota. The cap
 *  exists to stop unbounded growth during a long demo session, not to save space. */
const MAX_EVENTS = 500;

export type ReferrerKind = 'email' | 'search' | 'social' | 'direct' | 'unknown';

export type RiskEventAction = 'dismissed' | 'left' | 'learned' | null;

export type RiskEvent = {
  id: string;
  ts: number;
  /** Host only. Never a full URL. See logEvent() and TRD §8. */
  host: string;
  verdict: Verdict;
  source: DetectionSource;
  /** The seam. Non-nullable by design — PRD §6. */
  lessonId: LessonId;
  detail: string;
  referrerKind: ReferrerKind;
  action: RiskEventAction;
};

export type Settings = {
  userAllowlist: string[];
  seeded: boolean;
  installedAt: number;
};

const DEFAULT_SETTINGS: Settings = {
  userAllowlist: [],
  seeded: false,
  installedAt: 0,
};

// ---------------------------------------------------------------------------
// Host derivation — the privacy enforcement point
// ---------------------------------------------------------------------------

/**
 * Paths and query strings routinely carry session tokens and PII. A local log
 * of those would be an accidental credential store. logEvent() takes a URL,
 * derives the host here, and drops everything else before anything is written.
 * There is no code path that persists a path or a query string.
 */
export function hostFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Storage primitives
// ---------------------------------------------------------------------------

async function readEvents(): Promise<RiskEvent[]> {
  const bag = await chrome.storage.local.get(K_EVENTS);
  const raw = bag[K_EVENTS];
  return Array.isArray(raw) ? (raw as RiskEvent[]) : [];
}

async function writeEvents(events: RiskEvent[]): Promise<void> {
  const capped = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  await chrome.storage.local.set({ [K_EVENTS]: capped });
}

function newId(): string {
  // Available in MV3 service workers and Node 19+. Fallback keeps tests honest.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type LogEventInput = {
  /** Consumed to derive `host`, then discarded. Never stored. */
  url: string;
  verdict: Verdict;
  source: DetectionSource;
  lessonId: LessonId;
  detail: string;
  referrerKind?: ReferrerKind;
};

export async function logEvent(input: LogEventInput): Promise<Result<RiskEvent>> {
  try {
    const host = hostFromUrl(input.url);
    if (!host) return err({ kind: 'parse', raw: input.url });

    const event: RiskEvent = {
      id: newId(),
      ts: Date.now(),
      host,
      verdict: input.verdict,
      source: input.source,
      lessonId: input.lessonId,
      detail: input.detail,
      referrerKind: input.referrerKind ?? 'unknown',
      action: null,
    };

    const events = await readEvents();
    events.push(event);
    await writeEvents(events);
    return ok(event);
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

/**
 * Patch an existing event in place. Two callers: the verdict upgrade path
 * (a later layer found something worse) and LIEF_ACTION from the banner.
 * Without the latter every event reads action:null and E3's behavioural
 * insight is empty.
 */
export async function updateEvent(
  id: string,
  patch: Partial<Pick<RiskEvent, 'verdict' | 'source' | 'lessonId' | 'detail' | 'action'>>,
): Promise<Result<RiskEvent | null>> {
  try {
    const events = await readEvents();
    const i = events.findIndex((e) => e.id === id);
    if (i === -1) return ok(null);
    events[i] = { ...events[i], ...patch };
    await writeEvents(events);
    return ok(events[i]);
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

/** Newest last. E3: this is your only read path. */
export async function getEvents(): Promise<Result<RiskEvent[]>> {
  try {
    return ok(await readEvents());
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

/** One-click wipe, reachable from the dashboard main view. PRD §7. */
export async function clearEvents(): Promise<Result<void>> {
  try {
    await chrome.storage.local.remove(K_EVENTS);
    return ok(undefined);
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

/** Bulk write, for E3's seed fixture. Replaces the log wholesale. */
export async function replaceEvents(events: RiskEvent[]): Promise<Result<number>> {
  try {
    await writeEvents([...events].sort((a, b) => a.ts - b.ts));
    return ok(Math.min(events.length, MAX_EVENTS));
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

export async function getSettings(): Promise<Result<Settings>> {
  try {
    const bag = await chrome.storage.local.get(K_SETTINGS);
    const raw = bag[K_SETTINGS] as Partial<Settings> | undefined;
    return ok({ ...DEFAULT_SETTINGS, ...(raw ?? {}) });
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Result<Settings>> {
  try {
    const current = await getSettings();
    const base = current.ok ? current.value : DEFAULT_SETTINGS;
    const next: Settings = { ...base, ...patch };
    await chrome.storage.local.set({ [K_SETTINGS]: next });
    return ok(next);
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}
