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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Review</h1>
          <p className="mt-1 text-sm text-slate-400">
            What Lief flagged in the last 7 days, grouped by the concept behind it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {source === 'sample' ? (
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
              Sample data
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh(source)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Refresh
          </button>
          {confirmingWipe ? (
            <span className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-sm">
              <span className="text-rose-200">Delete {summary.total} events?</span>
              <button
                type="button"
                onClick={() => void onWipe()}
                className="font-medium text-rose-300 hover:text-rose-200"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmingWipe(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingWipe(true)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-rose-500/60 hover:text-rose-200"
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
        <p className="py-16 text-center text-sm text-slate-500">Loading…</p>
      ) : summary.total === 0 ? (
        <EmptyState sampleCount={SEED_EVENT_COUNT} onLoadSample={() => void refresh('sample')} />
      ) : (
        <div className="space-y-6">
          {summary.recommendation ? <Recommendation concept={summary.recommendation} /> : null}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat value={summary.total} label="Incidents" />
            <Stat value={summary.dangerous} label="Dangerous" />
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
            <p className="text-xs text-slate-600">
              {summary.olderCount} older {summary.olderCount === 1 ? 'event is' : 'events are'} in
              the log but outside this 7-day window.
            </p>
          ) : null}

          <footer className="border-t border-slate-800 pt-5 text-xs text-slate-600">
            Everything here is stored locally in this browser, host names only — never full URLs.
            Nothing is sent to a server.
          </footer>
        </div>
      )}
    </main>
  );
}
