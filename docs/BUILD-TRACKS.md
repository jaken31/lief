# Lief — P0 Parallel Build Tracks

**Timebox:** 2 hours · **Companion to:** [PRD.md](./PRD.md)

The failure mode for a build this size is not writing code too slowly. It is four people coding
against interfaces they each imagined, merging at T+1:40, and shipping nothing. This plan trades
ten minutes up front for that risk.

Two rules make it work:

1. **Contracts are frozen at T+0:10** and pushed before anyone writes a feature.
2. **Every track owns disjoint files.** No two people edit the same file. `manifest.json` has a
   single owner.

---

## Timeline

```
T+0:00 ─┬─ CONTRACT FREEZE (all hands, one driver at the keyboard)
        │  Everyone else: read the PRD, set up your editor, load the unpacked extension.
T+0:10 ─┤
        │  ██ PARALLEL BUILD — everyone codes against stubs ██
        │
T+0:50 ─┤  ◆ CHECKPOINT 1 — banner fires on a HARDCODED verdict.
        │    Proves the message-passing spine. Nothing real yet. This is the point of the plan.
        │
        │  ██ PARALLEL BUILD — real data replaces stubs ██
        │
T+1:20 ─┤  ◆ CHECKPOINT 2 — full loop runs: lesson → real detection → dashboard.
        │
T+1:20  │  Seed data, demo rehearsal, bug triage. NO NEW FEATURES.
T+1:40 ─┤  ◆ FREEZE. Rehearse the demo twice, start to finish.
T+2:00 ─┴─ Done.
```

If Checkpoint 1 slips past T+1:00, **cut Track D entirely** and demo with a single hardcoded
lesson page. The loop matters; five lessons do not.

---

## T+0:00 — Contract freeze (10 minutes, one driver)

One person writes these three files, commits, pushes. Everyone else pulls and builds against
them. Do not negotiate the shapes during the build — if something is wrong, work around it and
fix after the demo.

**`extension/lib/lessons.ts`**

```ts
export const LESSONS = {
  'url-anatomy':              { n: 1, title: 'Anatomy of a URL' },
  'lookalike-domains':        { n: 2, title: 'Lookalike Domains' },
  'phishing-pressure':        { n: 3, title: 'Phishing Pressure' },
  'https-is-not-safe':        { n: 4, title: 'HTTPS Is Not Safe' },
  'downloads-and-permissions':{ n: 5, title: 'Downloads & Permissions' },
} as const;

export type LessonId = keyof typeof LESSONS;
```

**`extension/lib/events.ts`** — the single write path to storage. Nobody calls
`chrome.storage` directly.

```ts
import type { LessonId } from './lessons';

export type Verdict = 'safe' | 'suspicious' | 'dangerous';

export type RiskEvent = {
  id: string;
  ts: number;
  host: string;                 // host ONLY — never the full URL
  verdict: Verdict;
  source: 'heuristic' | 'safebrowsing';
  lessonId: LessonId;           // required, never null
  detail: string;               // "paypa1.com vs paypal.com"
  referrerKind: 'email' | 'search' | 'social' | 'direct' | 'unknown';
  action: 'dismissed' | 'left' | 'learned' | null;
};

export async function logEvent(e: Omit<RiskEvent, 'id' | 'ts'>): Promise<RiskEvent>;
export async function getEvents(): Promise<RiskEvent[]>;
export async function clearEvents(): Promise<void>;
```

**`extension/lib/detect.ts`** — stubbed so Tracks B and C are never blocked.

```ts
export type Detection = { verdict: Verdict; lessonId: LessonId; detail: string } | null;

// Track A replaces both. Ship the stubs at T+0:10.
export function runHeuristics(url: URL): Detection {
  return { verdict: 'dangerous', lessonId: 'lookalike-domains',
           detail: 'STUB: paypa1.com vs paypal.com' };
}
export async function checkSafeBrowsing(url: string): Promise<Detection> { return null; }
```

**Message contract** (background ↔ content script):

```ts
// background → content, after a verdict
{ type: 'LIEF_VERDICT', event: RiskEvent }
// content → background, on script load (handles the load-order race)
{ type: 'LIEF_REQUEST_VERDICT' }
```

**Start this at T+0:00, not later —** the Google Safe Browsing key is a hidden serial dependency.
Someone must create a Google Cloud project, enable the Safe Browsing API, and mint a key. That is
~10 minutes of clicking with no code involved. Hand it to whoever is *not* driving the contract
freeze.

---

## Tracks

### Track A — Detection engine + extension shell
**Owns:** `manifest.json`, `background/**`, `lib/detect.ts`
**Give this to your strongest extension person.** Everything else depends on it.

- MV3 manifest. Permissions: `webNavigation`, `storage`, `tabs`. Host permissions `<all_urls>`.
- Service worker with a `chrome.webNavigation.onCommitted` listener.
- Five heuristics, each returning a `lessonId`: homoglyph/typosquat distance against a ~20-brand
  list, punycode (`xn--`) hosts, password field on a non-allowlisted origin, raw-IP hosts, risky
  download extensions.
- Safe Browsing v4 Lookup client with an in-memory cache.
- On verdict: `logEvent(...)` then `chrome.tabs.sendMessage(tabId, { type: 'LIEF_VERDICT', event })`.

**Order matters: heuristics before Safe Browsing.** Heuristics need no key, no network, and no
approval, so they cannot block you. Render them synchronously and let the async API *upgrade* the
verdict when it arrives. The banner must never wait on the network.

### Track B — Warning banner
**Owns:** `content/**`
Unblocked instantly by the stub — the stub always returns a dangerous verdict, so you can build
the real UI from minute one.

- Content script injects a shadow-DOM banner (shadow DOM so host page CSS cannot wreck it).
- Listens for `LIEF_VERDICT`; also fires `LIEF_REQUEST_VERDICT` on load to handle the race where
  the script mounts after the verdict was already sent.
- Three lines, in this order: what was found → which concept, named → two actions.
- Actions: **Leave this page** (`history.back()`) and **Show me why**
  (`chrome.runtime.getURL('pages/course/index.html#' + lessonId)`). Both write back an `action`
  onto the event.
- Advisory banner, not a blocking interstitial.

### Track C — Review dashboard
**Owns:** `pages/review/**`, `lib/seed.ts`

**Write the seed fixture first — it is your own unblocker and it is P0 for the demo.** ~12 events
spread across 7 days, weighted toward `lookalike-domains` so the recommendation has an obvious
answer. A dashboard rendering an empty state on stage kills the narrative.

- Timeline of incidents over 7 days.
- Concept breakdown grouped by `lessonId`, not by date.
- Exactly one recommendation: most frequent `lessonId` → "do this lesson next."
- Visible one-click wipe. Not buried in a settings submenu.

### Track D — Course
**Owns:** `pages/course/**`
Zero dependencies on anyone. Content can be written by whoever is least comfortable with the
extension APIs, or by a non-coder in parallel.

- Five lessons as a static JSON array, ~150 words each. Concrete examples, no theory.
- Renderer reads `location.hash` as the `lessonId` so Track B's deep link lands correctly.
- Plain prose and a worked example per lesson. No quiz, no progress bar, no animation.

---

## Staffing

| Team | Split |
|---|---|
| **4 people** | A · B · C · D, one each. Driver of the contract freeze takes A. |
| **3 people** | A · B+D (both are UI against stubs) · C |
| **2 people** | A+B (the whole extension) · C+D (both full pages) |

---

## House rules

From the project's standing conventions — worth stating because they bite hardest under time
pressure:

- **Functional components only.** No class components.
- **Every async call wrapped in try/catch** with typed error handling. A service worker that
  throws on an unhandled rejection dies silently and takes your demo with it.
- **`npx tsc --noEmit` after every change.** The contract types are the only thing preventing a
  bad integration at T+1:20.
- **Commit straight to `main`, `git pull --rebase` often.** File ownership is disjoint, so
  conflicts should be near zero. Branches and PRs cost more than they return at this timebox.
- Commit prefixes: `feat:` `fix:` `docs:` `refactor:` `chore:`.

---

## Known traps

**MV3 service workers unload after ~30 seconds idle.** Module-level variables vanish with them.
Any state that must survive goes in `chrome.storage`. This single issue derails more hackathon
extension builds than everything else combined.

**The build config is a rabbit hole.** If `@crxjs/vite-plugin` fights you for more than ten
minutes, abandon it: ship the service worker and content script as plain compiled JS with no
bundler, and use React only on the two full pages. Judges do not inspect your build pipeline.

**Never test against a live malicious site.** Use Google's official test URLs at
`testsafebrowsing.appspot.com` plus a local lookalike page you serve yourself.

**The API key ships in the bundle and is extractable.** Accepted for the hackathon — rate-limit
it and rotate it afterward. A thin proxy is the production path. Do not spend demo time on this.

---

## If you finish your track early

In priority order: help Track A tune heuristics against false positives (a warning on Gmail is
worse than a missed detection) → write the entry-point analysis in Review → rehearse the demo →
write the README. Do not start a popup. Do not start settings.
