import type { ReactNode } from 'react';
import type { RiskEvent } from '../../lib/events';
import type { ActionCounts, ConceptCount, DayBucket, EntryPointCount } from './aggregate';
import { ACTION_LABELS, LESSON_BLURB, LESSON_TITLES, REFERRER_LABELS } from './labels';
import { lessonUrl } from './data';

/** Presentational layer for the review dashboard. No data access lives here. */

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
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4">
      <p className="text-3xl font-semibold tabular-nums text-slate-50">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

export function VerdictPill({ verdict }: { verdict: RiskEvent['verdict'] }) {
  const tone =
    verdict === 'dangerous'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : 'border-amber-400/40 bg-amber-400/10 text-amber-300';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {verdict}
    </span>
  );
}

export function Timeline({ days, peak }: { days: DayBucket[]; peak: number }) {
  const scale = Math.max(peak, 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-2">
        {days.map((day) => (
          <div key={day.start} className="flex h-full flex-1 flex-col justify-end gap-0.5">
            {day.total === 0 ? (
              <div className="h-1 rounded-sm bg-slate-800" />
            ) : (
              <>
                {day.dangerous > 0 ? (
                  <div
                    className="rounded-t-sm bg-rose-500"
                    style={{ height: `${(day.dangerous / scale) * 100}%` }}
                    title={`${day.dangerous} dangerous`}
                  />
                ) : null}
                {day.suspicious > 0 ? (
                  <div
                    className="bg-amber-400"
                    style={{ height: `${(day.suspicious / scale) * 100}%` }}
                    title={`${day.suspicious} suspicious`}
                  />
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {days.map((day) => (
          <div key={day.start} className="flex-1 text-center">
            <p className="text-xs text-slate-400">{day.label}</p>
            <p className="text-xs tabular-nums text-slate-600">{day.total || '·'}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-500" /> Dangerous
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-amber-400" /> Suspicious
        </span>
      </div>
    </div>
  );
}

export function ConceptBreakdown({ concepts }: { concepts: ConceptCount[] }) {
  const peak = concepts.reduce((max, c) => Math.max(max, c.count), 1);
  return (
    <ul className="space-y-3">
      {concepts.map((concept) => (
        <li key={concept.lessonId}>
          <div className="flex items-baseline justify-between gap-3">
            <a
              className="text-sm font-medium text-slate-100 underline-offset-2 hover:underline"
              href={lessonUrl(concept.lessonId)}
              target="_blank"
              rel="noreferrer"
            >
              {LESSON_TITLES[concept.lessonId]}
            </a>
            <span className="text-sm tabular-nums text-slate-400">{concept.count}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-400"
              style={{ width: `${(concept.count / peak) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 truncate text-xs text-slate-500" title={concept.lastDetail}>
            {concept.lastDetail}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function Recommendation({ concept }: { concept: ConceptCount }) {
  return (
    <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-6">
      <p className="text-xs uppercase tracking-wide text-sky-300">Learn this one next</p>
      <h2 className="mt-2 text-2xl font-semibold text-slate-50">
        {LESSON_TITLES[concept.lessonId]}
      </h2>
      <p className="mt-1 text-sm text-slate-300">{LESSON_BLURB[concept.lessonId]}</p>
      <p className="mt-4 text-sm text-slate-400">
        You hit this concept <span className="font-semibold text-slate-100">{concept.count} times</span>{' '}
        in the last 7 days
        {concept.dangerous > 0 ? `, ${concept.dangerous} of them dangerous` : ''}. Most recently:{' '}
        <span className="text-slate-300">{concept.lastDetail}</span>
      </p>
      <a
        className="mt-5 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
        href={lessonUrl(concept.lessonId)}
        target="_blank"
        rel="noreferrer"
      >
        Start the lesson
      </a>
    </section>
  );
}

export function EntryPoints({
  entryPoints,
  total,
}: {
  entryPoints: EntryPointCount[];
  total: number;
}) {
  return (
    <ul className="space-y-2">
      {entryPoints.map((entry) => (
        <li key={entry.kind} className="flex items-center gap-3">
          <span className="w-40 shrink-0 text-sm text-slate-300">{REFERRER_LABELS[entry.kind]}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-violet-400"
              style={{ width: `${(entry.count / Math.max(total, 1)) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right text-sm tabular-nums text-slate-400">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function ActionSplit({ actions, total }: { actions: ActionCounts; total: number }) {
  const rows: Array<[keyof ActionCounts, string]> = [
    ['left', ACTION_LABELS.left],
    ['learned', ACTION_LABELS.learned],
    ['dismissed', ACTION_LABELS.dismissed],
    ['unanswered', 'No response'],
  ];
  return (
    <ul className="space-y-2">
      {rows.map(([key, label]) => (
        <li key={key} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-300">{label}</span>
          <span className="tabular-nums text-slate-400">
            {actions[key]}
            <span className="ml-1 text-slate-600">/ {total}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

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
      <ul className="divide-y divide-slate-800">
        {shown.map((event) => (
          <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm text-slate-100">{event.host}</p>
              <p className="mt-0.5 text-xs text-slate-400">{event.detail}</p>
              <p className="mt-1 text-[11px] text-slate-600">
                {LESSON_TITLES[event.lessonId]} · {event.source} ·{' '}
                {event.action ? ACTION_LABELS[event.action] : 'no response'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <VerdictPill verdict={event.verdict} />
              <span className="text-[11px] tabular-nums text-slate-600">
                {relativeTime(event.ts, now)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {events.length > RECENT_LIMIT ? (
        <p className="mt-3 text-xs text-slate-600">
          Showing {RECENT_LIMIT} of {events.length} events.
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  sampleCount,
  onLoadSample,
}: {
  sampleCount: number;
  onLoadSample: () => void;
}) {
  return (
    <section className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-slate-100">Nothing risky yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Lief has not flagged anything in the last 7 days. Keep browsing — when a warning fires, the
        concept behind it shows up here.
      </p>
      <button
        type="button"
        onClick={onLoadSample}
        className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 hover:text-white"
      >
        Load a sample week ({sampleCount} events)
      </button>
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const style =
    tone === 'warn'
      ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
      : 'border-slate-700 bg-slate-900/60 text-slate-300';
  return <div className={`rounded-lg border px-4 py-3 text-sm ${style}`}>{children}</div>;
}
