# Lief — P0 Build Tracks (4 Engineers)

**Timebox:** 2 hours · **Team:** 4 engineers
**Companions:** [PRD.md](./PRD.md) (what and why) · [TRD.md](./TRD.md) (how)

The failure mode for a build this size is not writing code too slowly. It is four people coding
against interfaces they each imagined, merging at T+1:40, and shipping nothing. This plan trades
ten minutes up front for that risk.

Three rules make it work:

1. **Contracts are frozen at T+0:10** and pushed before anyone writes a feature.
2. **Every engineer owns disjoint files.** No two people edit the same file, ever.
3. **Nobody is idle during the freeze.** The three serial blockers — build scaffold, API key,
   lesson copy — are cleared in that same ten minutes by the three engineers who aren't typing
   contracts.

---

## Roster

| | Engineer | Freeze task (T+0:00–0:10) | Main track (T+0:10→) | Owns |
|---|---|---|---|---|
| **E1** | Strongest extension dev | Write + push the contracts | **A — Detection engine** | `manifest.json`, `background/**`, `lib/detect.ts` |
| **E2** | Strongest build/tooling dev | Vite + TS + Tailwind scaffold, verify Load Unpacked | **B — Warning banner** | `content/**`, build config |
| **E3** | Any | Google Cloud project + Safe Browsing key | **C — Review dashboard** | `pages/review/**`, `lib/seed.ts` |
| **E4** | Least extension-familiar | Draft all 5 lessons as prose | **D — Course** | `pages/course/**`, `lessons.json` |

Each freeze task either feeds that engineer's own track or removes a blocker for someone else.
Nobody waits.

---

## Timeline

```
T+0:00 ─┬─ FREEZE WINDOW — four parallel tasks, see Roster
        │  E1 contracts │ E2 scaffold │ E3 API key │ E4 lesson copy
T+0:10 ─┤  ◆ HANDOFF — E1 pushes contracts, E2 confirms build runs, E3 hands key to E1
        │
        │  ██ BUILD PHASE 1 — everyone codes against STUBS ██
        │  E1 heuristics │ E2 banner UI │ E3 seed + dashboard │ E4 renderer
        │
T+0:50 ─┤  ◆ CHECKPOINT 1 — banner fires on a HARDCODED verdict.
        │    Proves the message-passing spine. Nothing real yet.
        │    THIS IS THE POINT OF THE PLAN. Do not slip it.
        │
        │  ██ BUILD PHASE 2 — real data replaces stubs ██
        │  E1 Safe Browsing │ E2 deep link + actions │ E3 real events │ E4 content in
        │
T+1:20 ─┤  ◆ CHECKPOINT 2 — full loop: lesson → real detection → dashboard.
        │
        │  Seed data, demo rehearsal, bug triage. NO NEW FEATURES.
T+1:40 ─┤  ◆ FREEZE. Rehearse the demo twice, start to finish.
T+2:00 ─┴─ Done.
```

**Slip rule.** If Checkpoint 1 has not passed by T+1:00, E4 stops Track D and the demo uses a
single hardcoded lesson page. E4 moves to helping E3 with the dashboard. The loop matters; five
lessons do not.

---

## The freeze window (T+0:00 – T+0:10)

### E1 — Contracts

Write, commit, push. Full type definitions are in [TRD.md](./TRD.md) §5 and the PRD §6 — copy them
literally, do not improvise the shapes.

- `extension/lib/lessons.ts` — the five `lessonId`s and titles
- `extension/lib/events.ts` — `RiskEvent`, `logEvent`, `getEvents`, `clearEvents`
- `extension/lib/detect.ts` — **stubbed**, returning a hardcoded dangerous `lookalike-domains`
  detection so E2/E3/E4 are never blocked
- `extension/manifest.json` — per TRD §2, including `web_accessible_resources`

**Push at T+0:10 even if imperfect.** Three people are blocked on this file set. Do not negotiate
shapes during the build; work around problems and fix after the demo.

### E2 — Build scaffold

Vite + React + TypeScript + Tailwind, output to `dist/`, loaded via `chrome://extensions` → Load
Unpacked. Success criterion: a trivial content script logs to the console on a real page.

**Timebox this to ten minutes.** If `@crxjs/vite-plugin` fights you, drop it — ship the service
worker and content script as plain compiled JS with no bundler, React on the two pages only. A
bundler rabbit hole at T+0:30 is fatal and judges never inspect build pipelines.

### E3 — Safe Browsing key

Create a Google Cloud project, enable the Safe Browsing API, mint a key. **This is ~10 minutes of
pure clicking with no code**, which is exactly why it runs now instead of being discovered as a
blocker at T+0:40.

Add `VITE_SAFE_BROWSING_KEY` to `.env.example`, hand the real key to E1 out-of-band. **`.env` is
git-ignored and never committed.**

### E4 — Lesson copy

Five lessons, ~150 words each, plain prose in a scratch file. No code, no JSON structure yet —
just the writing, which is the part that cannot be parallelised later. Concrete examples, zero
theory. Titles and IDs are fixed in PRD §4.1.

---

## Tracks (T+0:10 onward)

### E1 · Track A — Detection engine
**Owns:** `manifest.json`, `background/**`, `lib/detect.ts` · **Spec:** TRD §3

Phase 1 (→T+0:50): service worker, `webNavigation.onCommitted` on `frameId === 0`, all five
heuristics as pure functions, `logEvent` + `sendMessage` on hit.

Phase 2 (→T+1:20): Safe Browsing client, `storage.session` cache, verdict merge.

**Heuristics before Safe Browsing, always.** They need no key, no network, no approval — so
nothing can block you. H1 (lookalike domains) is the rule the demo hangs on; its `detail` string
is the entire teaching payload. `"paypa1.com — digit 1 where the letter l belongs"` is the
product. `"Suspicious domain"` is worthless. Spend your polish budget there.

### E2 · Track B — Warning banner
**Owns:** `content/**` · **Spec:** TRD §4, §6.1

Unblocked instantly by E1's stub, which always returns a dangerous verdict — build the real UI
from minute one.

Phase 1 (→T+0:50): shadow-DOM banner, three regions in fixed order (what was found → which
concept, named → two actions). **You own Checkpoint 1.**

Phase 2 (→T+1:20): deep link via `chrome.runtime.getURL`, `LIEF_ACTION` write-back, password-field
scan feeding H3.

Implement **both** directions of the load-order race (TRD §4) — listener *and* immediate
`LIEF_REQUEST_VERDICT`. Skip it and the banner intermittently fails on cached pages, which is the
hardest class of bug to debug live on stage.

### E3 · Track C — Review dashboard
**Owns:** `pages/review/**`, `lib/seed.ts` · **Spec:** TRD §6.2

**Write `lib/seed.ts` first.** It is your own unblocker and it is P0 for the demo — ~12 events
across 7 days, weighted toward `lookalike-domains` so the recommendation has an obvious answer. A
dashboard rendering an empty state on stage kills the narrative.

Phase 1 (→T+0:50): seed fixture, timeline over 7 days, concept breakdown grouped by `lessonId`.

Phase 2 (→T+1:20): read real events via `getEvents()`, single recommendation, one-click wipe.

Must render correctly at 0, 1, and 500 events.

### E4 · Track D — Course
**Owns:** `pages/course/**`, `lessons.json` · **Spec:** TRD §6.3

Zero dependencies on anyone. Copy is already drafted from the freeze window.

Phase 1 (→T+0:50): `lessons.json`, renderer routing on `location.hash` as the `lessonId`, unknown
hash → index.

Phase 2 (→T+1:20): final copy in, verify E2's deep link lands on the right lesson.

No quiz, no progress bar, no animation.

---

## House rules

- **Commit straight to `main`, `git pull --rebase` often.** File ownership is disjoint so
  conflicts should be near zero. Branches and PRs cost more than they return at this timebox.
- **`npx tsc --noEmit` after every change.** The contract types are the only thing preventing a
  bad integration at T+1:20.
- **Functional components only.** No class components.
- **Every async call in try/catch with typed errors.** An unhandled rejection kills an MV3 service
  worker *silently* — detection just stops for the rest of the session. See TRD §7.
- Commit prefixes: `feat:` `fix:` `docs:` `refactor:` `chore:`.

---

## Known traps

Full detail in TRD §10 and §12. The three that cost hours:

**MV3 service workers unload after ~30s idle** and take module-level variables with them. Caches
and the tab→event replay map go in `chrome.storage.session`. This derails more hackathon extension
builds than everything else combined.

**A clean Safe Browsing response is `{}`**, not `{ matches: [] }`. Code reading
`response.matches.length` throws on every safe page.

**Never test against a live malicious site.** Use `testsafebrowsing.appspot.com` plus a local
lookalike page you serve yourself.

---

## If you finish your track early

In priority order: help E1 tune heuristics against false positives (a warning on Gmail is worse
than a missed detection) → write the entry-point analysis in Review → rehearse the demo → write
the README. **Do not start a popup. Do not start settings.**
