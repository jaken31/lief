# Lief — Product Requirements Document

**Status:** Draft v1 · **Date:** 2026-09-19 · **Context:** Hackathon build, 2-hour timebox

---

## 1. Thesis

Security training fails at the moment it matters. People complete a phishing module, pass the
quiz, and click the link anyway three weeks later. The gap is not knowledge — it is
**recognition**: turning an abstract concept into something you spot in a half-second glance at a
real URL.

Recognition is built by practice on real stimuli at the moment of decision.

**Lief teaches at the point of exposure and reviews at the point of reflection.**

Three surfaces, one loop:

```
   ┌──────────────┐   concept    ┌──────────────┐   real instance   ┌──────────────┐
   │    COURSE    │ ───────────► │  EXTENSION   │ ────────────────► │    REVIEW    │
   │ teaches the  │              │ catches it   │                   │ shows your   │
   │   concept    │ ◄─────────── │ in your own  │ ◄──────────────── │   pattern    │
   └──────────────┘  "learn this │   browsing   │   "you keep       └──────────────┘
                      one next"  └──────────────┘    falling for this"
```

Any single surface is a commodity. A course is Coursera. A blocker is Safe Browsing, already
built into Chrome. A history view is `chrome://history`. **The loop is the product.** Every
requirement below exists to serve it.

### The mechanism that makes it one product

Every detector emits a `lessonId`. That single field is the seam:

- A warning says *"Lookalike domain — this is the same trick from Lesson 2"* instead of *"Danger"*
- The review dashboard groups your incidents by concept, not by date
- The course knows which lessons you have personally encountered in the wild and surfaces those first

Without that field, Lief is three demos in a trench coat. With it, it is an ecosystem.

---

## 2. Non-goals

Naming these protects the timebox.

- **Not an antivirus.** No file scanning, no binary analysis, no system-level hooks.
- **Not a replacement for Chrome's own protection.** Lief runs alongside it and explains it.
- **No accounts, no sync, no server-side user data.** See §7.
- **Not a certification.** No formal assessment, credential, or compliance claim.
- **Not enterprise tooling.** No admin console, no fleet policy, no SOC integration.

---

## 3. Users

**Primary — "the curious beginner."** Wants to be safer online, has no security background, has
bounced off dry training content. Measures success by feeling less anxious and more capable, not
by a score.

**Secondary — "the career switcher."** Actively learning cybersecurity, wants concrete artifacts
and vocabulary. Values the review dashboard as evidence of pattern recognition developing.

Both are consumer users on desktop Chrome, learning alone.

---

## 4. Surfaces

### 4.1 Course

Short, concrete lessons. Each lesson is ~3 minutes and maps 1:1 to a detector in the extension —
this mapping is a hard requirement, not a nice-to-have.

| # | `lessonId` | Lesson | Paired detector |
|---|-----------|--------|-----------------|
| 1 | `url-anatomy` | Anatomy of a URL — where the real domain actually lives | Host parsing, shown in every warning |
| 2 | `lookalike-domains` | Homoglyphs, typosquats, punycode | Levenshtein + confusable-character check against a known-brand list |
| 3 | `phishing-pressure` | Urgency, authority, fear — and the ask is always credentials or payment | Credential-form-on-unknown-origin heuristic |
| 4 | `https-is-not-safe` | What the padlock actually proves (transport, not trustworthiness) | HTTPS present + domain untrusted → teachable moment |
| 5 | `downloads-and-permissions` | Double extensions, permission prompts, sideloading | Download interception on risky file types |

Lessons are static content, deep-linkable by `lessonId` so a warning can jump straight to the
relevant one.

### 4.2 Extension — real-time detection

Runs on navigation. Two layers, deliberately:

**Layer 1 — Hosted threat intel (Google Safe Browsing Lookup API).** Authoritative verdicts on
known-bad URLs. Cheap to integrate, high credibility.

**Layer 2 — Local heuristics.** Small, fast, fully offline. This layer exists for two reasons
that matter more than coverage:

1. Safe Browsing will not flag a phishing domain registered this morning. Heuristics will.
2. **Heuristics are explainable.** Safe Browsing returns `SOCIAL_ENGINEERING` — a label. A
   heuristic returns *"the domain is `paypa1.com`, note the digit 1 where the letter l belongs."*
   That sentence is the teaching. The API cannot produce it.

Heuristic set for v1: homoglyph/typosquat distance against a top-brand list, punycode (`xn--`)
hosts, password field on a non-allowlisted origin, raw-IP hosts, risky download extensions.

**Warning UI.** On a hit, an in-page banner (not a blocking interstitial — the user stays in
control) that states three things in order:

1. What was found, in plain language
2. Which concept it is, with the lesson name
3. Two actions: *Leave this page* / *Show me why*

### 4.3 Review — activity insight

Reads the local event log and answers questions `chrome://history` cannot:

- **Risk timeline** — incidents over the last 7 days
- **Concept breakdown** — which `lessonId` categories you actually encounter
- **Entry-point analysis** — where risky clicks originate (email, search, social, direct)
- **One recommendation** — a single next lesson, chosen from your most frequent concept

Deliberately one recommendation, not a list. A list is a backlog and backlogs get ignored.

---

## 5. Scope — the 2-hour cut

Assumes a team of 2–4 working in parallel. **Build the extension first**; it is both the riskiest
component and the hero of the demo.

| Priority | Item | Owner track | Est. |
|---|---|---|---|
| **P0** | MV3 scaffold, service worker, content script, popup | Extension | 20m |
| **P0** | Heuristic layer (5 rules) + Safe Browsing lookup | Extension | 30m |
| **P0** | Warning banner naming the concept + lesson link | Extension | 20m |
| **P0** | Event log to `chrome.storage.local` | Shared | 10m |
| **P0** | Review dashboard: timeline + concept breakdown | Review | 30m |
| **P1** | 5 lessons as static content + renderer | Course | 30m |
| **P1** | Deep link warning → lesson | Shared | 10m |
| **P2** | Entry-point analysis | Review | — |
| **P2** | Quiz, streaks, progress tracking | Course | — |
| **P2** | Options page, allowlist management | Extension | — |

**Cut without hesitation if time runs short:** quizzes, progress persistence, onboarding, settings,
any animation, the popup itself if the dashboard covers it.

**Never cut:** the `lessonId` link between warning and lesson. That is the demo.

### Post-hackathon

Firefox/Safari builds · community-reported domain feed · LLM-generated per-incident explanations ·
spaced repetition driven by real encounters · optional encrypted sync.

---

## 6. Technical design

**Stack.** Chrome MV3 extension · Vite + React + TypeScript · Tailwind · `chrome.storage.local`.

**Course hosting — bundle it inside the extension for the demo.** Not a separate deployed site.
Rationale: zero deploy step, zero CORS, and the warning→lesson deep link becomes a one-line
`chrome.runtime.getURL(...)` instead of a cross-origin dance. Extracting the course to a static
S3 site later is a build-target change, not a rewrite. This also satisfies the project rule of
static export with no SSR — there is no server anywhere in v1.

```
lief/
├── extension/
│   ├── manifest.json          # MV3, permissions: webNavigation, storage, downloads
│   ├── background/
│   │   ├── index.ts           # service worker, navigation listener
│   │   ├── safeBrowsing.ts    # hosted API client + response cache
│   │   └── heuristics/        # one file per rule, each exports a lessonId
│   ├── content/
│   │   └── banner.tsx         # in-page warning UI
│   ├── pages/
│   │   ├── review/            # activity dashboard
│   │   └── course/            # lessons (static JSON + renderer)
│   └── lib/
│       ├── events.ts          # single write path to the event log
│       └── lessons.ts         # lessonId registry — the shared vocabulary
└── docs/PRD.md
```

**Detection flow.**

```
navigation ──► heuristics (sync, ~1ms) ──┐
                                          ├──► verdict ──► log event ──► banner if risk > threshold
           ──► Safe Browsing (async, cached) ──┘
```

Heuristics render immediately; the API result arrives later and upgrades the verdict if it is
worse. The banner never waits on the network.

**Data model.** One record type. Everything in Review is a query over this.

```ts
type RiskEvent = {
  id: string;
  ts: number;
  host: string;            // host only — never the full URL, see §7
  verdict: 'safe' | 'suspicious' | 'dangerous';
  source: 'heuristic' | 'safebrowsing';
  lessonId: LessonId;      // the seam — required, never null
  detail: string;          // human-readable: "paypa1.com vs paypal.com"
  referrerKind: 'email' | 'search' | 'social' | 'direct' | 'unknown';
  action: 'dismissed' | 'left' | 'learned' | null;
};
```

`lessonId` being non-nullable is enforced by the type. A detector that cannot name a lesson is
not a detector — it is a guess, and it has no place in a teaching product.

---

## 7. Privacy

Non-negotiable, and a positioning asset: a security product that surveils its users is a
contradiction, and judges will ask.

- **All activity data stays in `chrome.storage.local`.** No server receives browsing history.
- **Host only, never full URLs.** Paths and query strings carry session tokens and PII.
- **Safe Browsing receives URLs by necessity** — this is disclosed in-product, not buried.
- **One-click wipe** in the dashboard. Visible, not in a settings submenu.
- **No analytics, no telemetry, no third-party scripts** in v1.

---

## 8. Demo script (3 minutes)

The rehearsal matters as much as the build. Sequence:

1. **Open a lesson** — "Lookalike domains." 20 seconds of content. Establish the vocabulary.
2. **Navigate to a lookalike domain** — banner fires: *"Lookalike domain — the same trick from
   Lesson 2."* This is the moment. The vocabulary from step 1 reappears unprompted.
3. **Click "Show me why"** — lands in the lesson, now with personal stakes.
4. **Open the dashboard** — pre-seeded with a week of events. *"You have hit this concept four
   times. Here is the one lesson to do next."*

**Demo reliability is a P0 engineering concern, not a presentation concern.** Two hard
requirements:

- **Pre-seed the event log.** A dashboard rendering an empty state on stage kills the narrative.
  Ship a seed fixture behind a dev flag.
- **Use Google's official Safe Browsing test URLs** (`testsafebrowsing.appspot.com`) plus a
  locally-served lookalike page you control. Never rely on finding a live malicious site during a
  demo — you will not, and if you do, you should not be visiting it.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Safe Browsing API key ships in the extension bundle | Key is extractable | Accepted for hackathon. Rate-limit the key, rotate after. Production path is a thin proxy. |
| No test URL triggers a real verdict on stage | Demo dies | Official test URLs + a controlled local lookalike page. Rehearse the exact click path. |
| Heuristics false-positive on legitimate sites | Erodes trust instantly | Allowlist the top ~500 domains. Tune toward silence — a missed detection is survivable, a warning on Gmail is not. |
| 2 hours is not enough for three surfaces | Nothing finishes | Strict P0 order. Course is static content and can be written by a non-coder in parallel. |
| Judges see "another URL blocker" | Loses on novelty | Lead the pitch with the loop, not the detection. Step 2 of the demo script is the whole argument. |

---

## 10. Success criteria

**Hackathon.** A single unbroken path works live: lesson → real detection naming that lesson →
dashboard showing the pattern. If that path runs without a stumble, the build succeeded, regardless
of what else is missing.

**Product.** The honest metric is not lessons completed or threats blocked — both are vanity.
It is **whether a user's risky-click rate falls over the weeks they use Lief.** The dashboard
already computes the data needed to measure it. That is the number worth building toward.

---

## 11. Open questions

1. Should the banner ever hard-block, or always stay advisory? Advisory respects the user but may
   under-protect the exact beginner Lief targets.
2. How is lesson→detector mapping maintained as detectors grow? A registry file works at 5; at 50
   it needs structure.
3. Is the "one recommendation" model right, or does it feel thin to the career-switcher persona
   who wants a curriculum?
