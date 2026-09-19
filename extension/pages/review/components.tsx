import type { ReactNode } from 'react';
import type { RiskEvent } from '../../lib/events';
import type { ActionCounts, ConceptCount, DayBucket, EntryPointCount } from './aggregate';
import { ACTION_LABELS, LESSON_BLURB, LESSON_TITLES, REFERRER_LABELS } from './labels';
import { lessonUrl } from './data';

/*
 * Presentational layer for the review dashboard. No data access lives here.
 *
 * Colour follows the job, not taste:
 *   verdicts  → the reserved STATUS palette (critical / warning), always paired
 *               with a glyph and a word so meaning never rides on hue alone —
 *               which matters doubly here, since amber sits below 3:1 on a
 *               light surface by design.
 *   magnitude → a single sequential hue per chart. Concept breakdown takes
 *               blue; entry points, on screen at the same time, takes the next
 *               slot (orange). Neither is a categorical scale, so neither gets
 *               more than one colour.
 *
 * Marks are thin, rounded only at the data end, and anchored to a baseline.
 */

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(11,11,11,0.04)]">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-[0.02em] text-[var(--ink)]">{title}</h2>
        {hint ? <p className="text-[12px] text-[var(--ink-muted)]">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A legend is always present for two or more series, so identity is never colour-alone. */
function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--gridline)] pt-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-[12px] text-[var(--ink-2)]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tiles — a hero number is not a chart, so no plot and no hover layer   */
/* -------------------------------------------------------------------------- */

export function Stat({
  value,
  label,
  tone = 'neutral',
}: {
  value: string | number;
  label: string;
  tone?: 'neutral' | 'critical';
}) {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] px-5 py-4">
      {/* Proportional figures: tabular-nums is for columns that align, not display numbers. */}
      <p
        className="text-[32px] font-semibold leading-none tracking-[-0.02em]"
        style={{ color: tone === 'critical' ? 'var(--critical)' : 'var(--ink)' }}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px] text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Verdict — status colour + glyph + word                                     */
/* -------------------------------------------------------------------------- */

export function VerdictPill({ verdict }: { verdict: RiskEvent['verdict'] }) {
  const dangerous = verdict === 'dangerous';
  const color = dangerous ? 'var(--critical)' : 'var(--warning)';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold capitalize"
      style={{
        color: dangerous ? 'var(--critical)' : '#8a5a00',
        borderColor: dangerous ? 'rgb(208 59 59 / 35%)' : 'rgb(250 178 25 / 55%)',
        background: dangerous ? 'rgb(208 59 59 / 6%)' : 'rgb(250 178 25 / 12%)',
      }}
    >
      {/* The glyph is the non-colour channel. Amber alone is unreadable on this surface. */}
      <span aria-hidden style={{ color }}>
        {dangerous ? '●' : '▲'}
      </span>
      {verdict}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline — stacked status over 7 days                                      */
/* -------------------------------------------------------------------------- */

export function Timeline({ days, peak }: { days: DayBucket[]; peak: number }) {
  const scale = Math.max(peak, 1);

  return (
    <div>
      <div className="flex h-36 items-end gap-2.5 border-b border-[var(--baseline)] pb-px">
        {days.map((day) => (
          <div key={day.start} className="mark flex h-full flex-1 flex-col justify-end">
            {day.total === 0 ? (
              <div className="h-[3px] rounded-[2px]" style={{ background: 'var(--gridline)' }} />
            ) : (
              /* 2px surface gap between stacked segments keeps them legible without outlines. */
              <div className="flex flex-col justify-end gap-[2px]">
                {day.dangerous > 0 ? (
                  <div
                    className="rounded-t-[4px]"
                    style={{
                      height: `${(day.dangerous / scale) * 128}px`,
                      background: 'var(--critical)',
                    }}
                  />
                ) : null}
                {day.suspicious > 0 ? (
                  <div
                    style={{
                      height: `${(day.suspicious / scale) * 128}px`,
                      background: 'var(--warning)',
                      borderTopLeftRadius: day.dangerous > 0 ? 0 : 4,
                      borderTopRightRadius: day.dangerous > 0 ? 0 : 4,
                    }}
                  />
                ) : null}
              </div>
            )}
            <span className="tip">
              {day.label} · {day.dangerous} dangerous, {day.suspicious} suspicious
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex gap-2.5">
        {days.map((day) => (
          <div key={day.start} className="flex-1 text-center">
            <p className="text-[11px] tabular-nums text-[var(--ink-muted)]">{day.label}</p>
          </div>
        ))}
      </div>

      <Legend
        items={[
          { color: 'var(--critical)', label: 'Dangerous' },
          { color: 'var(--warning)', label: 'Suspicious' },
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Concept breakdown — single series, sequential blue                          */
/* -------------------------------------------------------------------------- */

export function ConceptBreakdown({ concepts }: { concepts: ConceptCount[] }) {
  const peak = concepts.reduce((max, c) => Math.max(max, c.count), 1);

  return (
    <ul className="space-y-4">
      {concepts.map((concept) => (
        <li key={concept.lessonId}>
          <div className="flex items-baseline justify-between gap-3">
            <a
              className="text-[14px] font-medium text-[var(--ink)] underline-offset-2 hover:underline"
              href={lessonUrl(concept.lessonId)}
              target="_blank"
              rel="noreferrer"
            >
              {LESSON_TITLES[concept.lessonId]}
            </a>
            {/* Direct label — selective, on the value that matters, not on every mark. */}
            <span className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
              {concept.count}
            </span>
          </div>

          <div
            className="mark mt-2 h-2 overflow-hidden rounded-full"
            style={{ background: 'var(--seq-blue-soft)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${(concept.count / peak) * 100}%`, background: 'var(--seq-blue)' }}
            />
            <span className="tip">
              {concept.count} {concept.count === 1 ? 'incident' : 'incidents'}
              {concept.dangerous > 0 ? ` · ${concept.dangerous} dangerous` : ''}
            </span>
          </div>

          <p
            className="mt-2 truncate text-[12px] text-[var(--ink-muted)]"
            title={concept.lastDetail}
          >
            {concept.lastDetail}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Entry points — the second concurrent magnitude chart, so: orange            */
/* -------------------------------------------------------------------------- */

export function EntryPoints({
  entryPoints,
  total,
}: {
  entryPoints: EntryPointCount[];
  total: number;
}) {
  return (
    <ul className="space-y-3">
      {entryPoints.map((entry) => {
        const pct = Math.round((entry.count / Math.max(total, 1)) * 100);
        return (
          <li key={entry.kind} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-[13px] text-[var(--ink-2)]">
              {REFERRER_LABELS[entry.kind]}
            </span>
            <div
              className="mark h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--seq-orange-soft)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--seq-orange)' }}
              />
              <span className="tip">
                {entry.count} of {total} · {pct}%
              </span>
            </div>
            <span className="w-7 text-right text-[13px] tabular-nums text-[var(--ink)]">
              {entry.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Recommendation — the one thing the page is actually for                     */
/* -------------------------------------------------------------------------- */

export function Recommendation({ concept }: { concept: ConceptCount }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface)]">
      <div className="h-1 w-full" style={{ background: 'var(--seq-blue)' }} />
      <div className="p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--seq-blue)]">
          Learn this one next
        </p>
        <h2 className="mt-2.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">
          {LESSON_TITLES[concept.lessonId]}
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-2)]">
          {LESSON_BLURB[concept.lessonId]}
        </p>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[var(--ink-2)]">
          You hit this concept{' '}
          <span className="font-semibold text-[var(--ink)]">
            {concept.count} {concept.count === 1 ? 'time' : 'times'}
          </span>{' '}
          in the last 7 days
          {concept.dangerous > 0 ? `, ${concept.dangerous} of them dangerous` : ''}. Most recently:{' '}
          <span className="text-[var(--ink)]">{concept.lastDetail}</span>
        </p>
        <a
          className="mt-6 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110"
          style={{ background: 'var(--seq-blue)' }}
          href={lessonUrl(concept.lessonId)}
          target="_blank"
          rel="noreferrer"
        >
          Start the lesson
          <span aria-hidden>→</span>
        </a>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Action split                                                                */
/* -------------------------------------------------------------------------- */

export function ActionSplit({ actions, total }: { actions: ActionCounts; total: number }) {
  const rows: Array<[keyof ActionCounts, string]> = [
    ['left', ACTION_LABELS.left],
    ['learned', ACTION_LABELS.learned],
    ['dismissed', ACTION_LABELS.dismissed],
    ['unanswered', 'No response'],
  ];
  const safe = Math.max(total, 1);

  return (
    <ul className="space-y-3">
      {rows.map(([key, label]) => {
        const pct = Math.round((actions[key] / safe) * 100);
        // "Left the page" is the one good outcome, so it is the one status colour here.
        const color = key === 'left' ? 'var(--good)' : 'var(--baseline)';
        return (
          <li key={key} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-[13px] text-[var(--ink-2)]">{label}</span>
            <div className="mark h-2 flex-1 overflow-hidden rounded-full bg-[var(--gridline)]">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              <span className="tip">
                {actions[key]} of {total} · {pct}%
              </span>
            </div>
            <span className="w-7 text-right text-[13px] tabular-nums text-[var(--ink)]">
              {actions[key]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Recent events                                                               */
/* -------------------------------------------------------------------------- */

function relativeTime(ts: number, now: number): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const RECENT_LIMIT = 8;

export function RecentEvents({ events, now }: { events: RiskEvent[]; now: number }) {
  const shown = events.slice(0, RECENT_LIMIT);
  return (
    <div>
      <ul className="divide-y divide-[var(--gridline)]">
        {shown.map((event) => (
          <li key={event.id} className="flex items-start gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] font-medium text-[var(--ink)]">
                {event.host}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-[var(--ink-2)]">{event.detail}</p>
              <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
                {LESSON_TITLES[event.lessonId]} · {event.source} ·{' '}
                {event.action ? ACTION_LABELS[event.action] : 'no response'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <VerdictPill verdict={event.verdict} />
              <span className="text-[11px] tabular-nums text-[var(--ink-muted)]">
                {relativeTime(event.ts, now)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {events.length > RECENT_LIMIT ? (
        <p className="mt-4 border-t border-[var(--gridline)] pt-3 text-[12px] text-[var(--ink-muted)]">
          Showing {RECENT_LIMIT} of {events.length} events.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  sampleCount,
  onLoadSample,
}: {
  sampleCount: number;
  onLoadSample: () => void;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-[var(--baseline)] bg-[var(--surface)] px-6 py-20 text-center">
      <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
        Nothing risky yet
      </h2>
      <p className="mx-auto mt-2.5 max-w-md text-[14px] leading-relaxed text-[var(--ink-2)]">
        Lief has not flagged anything in the last 7 days. Keep browsing — when a warning fires, the
        concept behind it shows up here.
      </p>
      <button
        type="button"
        onClick={onLoadSample}
        className="mt-7 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5 text-[14px] font-medium text-[var(--ink)] hover:border-[var(--baseline)] hover:bg-[var(--plane)]"
      >
        Load a sample week ({sampleCount} events)
      </button>
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const warn = tone === 'warn';
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-snug"
      style={{
        borderColor: warn ? 'rgb(250 178 25 / 55%)' : 'var(--hairline)',
        background: warn ? 'rgb(250 178 25 / 10%)' : 'var(--surface)',
        color: warn ? '#7a4f00' : 'var(--ink-2)',
      }}
    >
      <span aria-hidden style={{ color: warn ? 'var(--warning)' : 'var(--ink-muted)' }}>
        {warn ? '▲' : '•'}
      </span>
      <span>{children}</span>
    </div>
  );
}
