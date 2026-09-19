# Lief

**Learn to spot threats on the pages you actually visit.**

Security training fails at the moment it matters. People finish a phishing module, pass the quiz,
and click the link anyway three weeks later. The gap is not knowledge — it is *recognition*:
turning an abstract concept into something you spot in a half-second glance at a real URL.

Lief teaches at the point of exposure and reviews at the point of reflection.

```
   ┌──────────────┐   concept    ┌──────────────┐   real instance   ┌──────────────┐
   │    COURSE    │ ───────────► │  EXTENSION   │ ────────────────► │    REVIEW    │
   │ teaches the  │              │ catches it   │                   │ shows your   │
   │   concept    │ ◄─────────── │ in your own  │ ◄──────────────── │   pattern    │
   └──────────────┘  "learn this │   browsing   │   "you keep       └──────────────┘
                      one next"  └──────────────┘    falling for this"
```

Any single surface is a commodity. A course is Coursera. A blocker is Safe Browsing, already in
Chrome. A history view is `chrome://history`. **The loop is the product.**

## The seam

Every detector emits a `lessonId`. That one field is what makes three surfaces into one product:

| `lessonId` | Lesson | Paired detector |
|---|---|---|
| `url-anatomy` | Anatomy of a URL | Raw-IP hosts; host parsing shown in every warning |
| `lookalike-domains` | Homoglyphs, typosquats, punycode | Edit distance + confusable folding against a brand list |
| `phishing-pressure` | Urgency, authority, and the ask | Password field on an unknown origin |
| `https-is-not-safe` | What the padlock actually proves | Emitted alongside any warning on an HTTPS page |
| `downloads-and-permissions` | Double extensions and permissions | Risky download extensions |

So a warning reads *"Lookalike domain — the same trick from Lesson 2"* rather than *"Danger"*, the
dashboard groups incidents by concept instead of by date, and the course knows which lessons you
have personally run into.

## Privacy

Enforced in code, not stated as policy:

- All activity data stays in `chrome.storage.local`. No server receives browsing history.
- **Host only, never full URLs.** `logEvent()` derives the host itself and has no parameter for a
  full URL, so a caller cannot persist a path or query string that might carry a session token.
- Google Safe Browsing receives full URLs by necessity. Disclosed in-product.
- No analytics, no telemetry, no third-party scripts.
- One-click wipe on the dashboard, not buried in a settings submenu.

## Running it

Chrome MV3 extension, Vite + React + TypeScript. No server anywhere in v1.

```
npm install
npm run build          # outputs to dist/
```

Then `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.

The Safe Browsing key goes in `.env` as `VITE_SAFE_BROWSING_KEY`; `.env` is git-ignored and never
committed. Detection degrades to local heuristics without it — the heuristics need no key, no
network, and no approval.

**Never test against a live malicious site.** Use `testsafebrowsing.appspot.com` and a lookalike
page you serve yourself.

## Layout

```
extension/
├── manifest.json
├── background/        # service worker, navigation listener, heuristics, Safe Browsing
├── content/           # in-page shadow-DOM warning banner
├── pages/
│   ├── course/        # five lessons: static JSON + hash-routed renderer
│   └── review/        # activity dashboard
└── lib/
    ├── events.ts      # the only module that touches chrome.storage
    └── lessons.ts     # lessonId registry — the shared vocabulary
docs/
├── PRD.md             # what and why
├── TRD.md             # how
└── BUILD-TRACKS.md    # who and when
```

## Conventions

- Commit straight to `main` with `git pull --rebase`; engineers own disjoint file sets.
- `npx tsc --noEmit` after every change — the contract types are what prevent a bad integration.
- Functional components only.
- Every async call in `lib/` returns a `Result<T>`; no exceptions cross a module boundary. An
  unhandled rejection kills an MV3 service worker *silently*, and detection just stops.
- Commit prefixes: `feat:` `fix:` `docs:` `refactor:` `chore:`.

## Status

Hackathon build, two-hour timebox. See [docs/BUILD-TRACKS.md](docs/BUILD-TRACKS.md) for ownership.

Landed: the Vite scaffold and the warning banner (Track B), the review dashboard and demo seed
fixture (Track C), and the course — five lessons and a hash-routed renderer (Track D).

Outstanding: Track A — the detection engine, the manifest, and the shared contracts in
`extension/lib/`. Until `lib/events.ts` and `lib/lessons.ts` exist, `npm run typecheck` reports
missing-module errors for every file importing them and the pages build fails, so `dist/` has no
course or review page yet. `npm run build` still emits the content script and prints which passes
it skipped, and loading `dist/` unpacked uses a dev manifest with no service worker.
