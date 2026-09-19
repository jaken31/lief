import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RiskEvent } from '../../lib/events';
import { summarize } from './aggregate';
import { loadEvents, SAMPLE_REQUESTED, SEED_EVENT_COUNT, wipeEvents, type Source } from './data';
import {
  ActionSplit,
  Card,
  ConceptBreakdown,
  EmptyState,
  EntryPoints,
  Notice,
  RecentEvents,
  Recommendation,
  Stat,
  Timeline,
} from './components';

export default function App() {
  const [source, setSource] = useState<Source>(SAMPLE_REQUESTED ? 'sample' : 'live');
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Pinned per load so relative timestamps do not shift between re-renders.
  const [now, setNow] = useState(() => Date.now());
  const [confirmingWipe, setConfirmingWipe] = useState(false);

  const refresh = useCallback(async (next: Source) => {
    setLoading(true);
    const result = await loadEvents(next);
    setEvents(result.events);
    setError(result.error);
    setSource(result.source);
    setNow(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(SAMPLE_REQUESTED ? 'sample' : 'live');
  }, [refresh]);

  const summary = useMemo(() => summarize(events, now), [events, now]);

  const onWipe = useCallback(async () => {
    setConfirmingWipe(false);
    // Sample data never reached storage, so "clear" just drops back to the real log.
    if (source === 'sample') {
      await refresh('live');
      return;
    }
    const result = await wipeEvents();
    if (!result.ok) {
      setError(`Could not clear the log — ${result.message}`);
      return;
    }
    await refresh('live');
  }, [source, refresh]);

  const leftRate = summary.total > 0 ? Math.round((summary.actions.left / summary.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-5 border-b border-[var(--gridline)] pb-7">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Lief
          </p>
          <h1 className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] text-[var(--ink)]">
            Review
          </h1>
          <p className="mt-2.5 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
            What Lief flagged in the last 7 days, grouped by the concept behind it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {source === 'sample' ? (
            <span className="rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-2)]">
              Sample data
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh(source)}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--ink-2)] hover:border-[var(--baseline)] hover:text-[var(--ink)]"
          >
            Refresh
          </button>
          {confirmingWipe ? (
            <span
              className="flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-[13px]"
              style={{ borderColor: 'rgb(208 59 59 / 35%)', background: 'rgb(208 59 59 / 6%)' }}
            >
              <span style={{ color: 'var(--critical)' }}>Delete {summary.total} events?</span>
              <button
                type="button"
                onClick={() => void onWipe()}
                className="font-semibold"
                style={{ color: 'var(--critical)' }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmingWipe(false)}
                className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingWipe(true)}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--ink-2)] hover:text-[var(--critical)]"
            >
              {source === 'sample' ? 'Clear sample' : 'Clear all data'}
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="mb-6">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}

      {loading ? (
        <p className="py-20 text-center text-[14px] text-[var(--ink-muted)]">Loading…</p>
      ) : summary.total === 0 ? (
        <EmptyState sampleCount={SEED_EVENT_COUNT} onLoadSample={() => void refresh('sample')} />
      ) : (
        <div className="space-y-7">
          {summary.recommendation ? <Recommendation concept={summary.recommendation} /> : null}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat value={summary.total} label="Incidents" />
            <Stat value={summary.dangerous} label="Dangerous" tone="critical" />
            <Stat value={summary.concepts.length} label="Concepts hit" />
            <Stat value={`${leftRate}%`} label="Left the page" />
          </div>

          <Card title="Risk timeline" hint="Last 7 days">
            <Timeline days={summary.days} peak={summary.peakDay} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Concept breakdown" hint="Most frequent first">
              <ConceptBreakdown concepts={summary.concepts} />
            </Card>
            <Card title="Where they came from" hint="Entry point">
              <EntryPoints entryPoints={summary.entryPoints} total={summary.total} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="What you did" hint="Your response to each warning">
              <ActionSplit actions={summary.actions} total={summary.total} />
            </Card>
            <Card title="Recent incidents">
              <RecentEvents events={summary.events} now={now} />
            </Card>
          </div>

          {summary.olderCount > 0 ? (
            <p className="text-[12px] text-[var(--ink-muted)]">
              {summary.olderCount} older {summary.olderCount === 1 ? 'event is' : 'events are'} in
              the log but outside this 7-day window.
            </p>
          ) : null}

          <footer className="border-t border-[var(--gridline)] pt-6 text-[12px] leading-relaxed text-[var(--ink-muted)]">
            Everything here is stored locally in this browser, host names only — never full URLs.
            Nothing is sent to a server.
          </footer>
        </div>
      )}
    </main>
  );
}
