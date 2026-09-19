/**
 * types.ts — shared contracts.
 *
 * CONTRACT. Frozen at T+0:10. Types only, no runtime behaviour beyond
 * SEVERITY and the two Result constructors. Safe to import anywhere.
 */

import type { LessonId } from './lessons';
import type { RiskEvent } from './events';

export type Verdict = 'safe' | 'suspicious' | 'dangerous';

/**
 * Verdict merge ordering (TRD §3.5). Higher severity wins; ties keep the
 * FIRST result, so a heuristic's explainable `detail` survives rather than
 * being overwritten by an opaque list entry. That tie-break is deliberate:
 * when two layers agree on severity, the human-readable one is worth more.
 */
export const SEVERITY: Record<Verdict, number> = {
  safe: 0,
  suspicious: 1,
  dangerous: 2,
};

export type DetectionSource = 'heuristic' | 'linkset' | 'safebrowsing';

/** A positive finding. Detectors return `Detection | null` — never a 'safe' Detection. */
export type Detection = {
  verdict: Exclude<Verdict, 'safe'>;
  lessonId: LessonId;
  /**
   * The teaching payload, and the single highest-value string in the product.
   * "paypa1.com — the digit 1 where the letter l belongs" is the product.
   * "Suspicious domain" is worthless. See PRD §4.2.
   */
  detail: string;
  source: DetectionSource;
  /** Which rule fired: 'H1'…'H5', or 'LS' for the bundled link set. For debugging and tests. */
  rule: string;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An unhandled rejection kills an MV3 service worker *silently* — no console
 * error, no visible failure, detection just stops for the rest of the session.
 * Every exported async function returns Result<T>; no exception crosses a
 * module boundary. TRD §7.
 */
export type LiefError =
  | { kind: 'network'; status?: number }
  | { kind: 'storage'; detail?: string }
  | { kind: 'parse'; raw: string }
  | { kind: 'config'; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: LiefError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: LiefError): Result<T> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Messaging (TRD §4)
// ---------------------------------------------------------------------------

export type LiefMessage =
  /** background → content: render or upgrade the banner */
  | { type: 'LIEF_VERDICT'; event: RiskEvent }
  /** content → background: I just mounted, replay the current verdict if you have one */
  | { type: 'LIEF_REQUEST_VERDICT' }
  /** content → background: observation only. The content script never decides. */
  | { type: 'LIEF_PASSWORD_FIELD'; hasPassword: boolean }
  /** content → background: user chose an action, populate RiskEvent.action */
  | { type: 'LIEF_ACTION'; eventId: string; action: RiskEvent['action'] };

export type LiefResponse = { event: RiskEvent | null };
