# Lief — Technical Requirements Document

**Status:** Draft v1 · **Date:** 2026-09-19
**Companions:** [PRD.md](./PRD.md) (what and why) · [BUILD-TRACKS.md](./BUILD-TRACKS.md) (who and when)

This document is the *how*. Where the PRD states an intent, this states the mechanism. Code blocks
here are specifications, not sketches — build to them literally.

---

## 1. System architecture

Everything runs inside a single Chrome MV3 extension. There is no server in v1.

```
┌─────────────────────── Chrome Extension ────────────────────────┐
│                                                                  │
│  ┌────────────────────┐        ┌──────────────────────────┐     │
│  │  Service Worker    │        │   Content Script          │     │
│  │  (background)      │───────►│   (per tab, all_urls)     │     │
│  │                    │ tabs.  │                           │     │
│  │  webNavigation ──┐ │ send   │   shadow-DOM banner       │     │
│  │  heuristics     ─┤ │ Message│   ▲                       │     │
│  │  safeBrowsing   ─┤ │        │   └── password-field scan │     │
│  │  verdict merge  ─┘ │◄───────│       (feeds H3)          │     │
│  └─────────┬──────────┘ runtime└──────────────────────────┘     │
│            │            .sendMessage                             │
│            ▼                                                     │
│  ┌────────────────────┐                                          │
│  │ chrome.storage     │◄─────── pages/review  (dashboard)        │
│  │ .local             │                                          │
│  │  lief:events       │         pages/course  (lessons)          │
│  │  lief:settings     │              ▲                           │
│  └────────────────────┘              └── deep-linked by lessonId │
└──────────────────────────────────────────────────────────────────┘
                    │
                    ▼  (only outbound network call)
        Google Safe Browsing v4 Lookup API
```

**Trust boundary:** the content script runs in a hostile document. It is never trusted to produce
a verdict — it reports observations (a password field exists) and renders what the service worker
tells it. All verdict logic lives in the background.

---

## 2. Manifest

`extension/manifest.json`. **Track A owns this file exclusively.**

```json
{
  "manifest_version": 3,
  "name": "Lief",
  "version": "0.1.0",
  "description": "Learn to spot threats on the pages you actually visit.",
  "permissions": ["webNavigation", "storage", "tabs", "downloads"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background/index.js", "type": "module" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/index.js"],
    "run_at": "document_idle"
  }],
  "action": { "default_title": "Lief" },
  "web_accessible_resources": [{
    "resources": ["pages/course/*", "pages/review/*"],
    "matches": ["<all_urls>"]
  }]
}
```

`web_accessible_resources` is required or the banner's "Show me why" link will fail silently.
This is a common half-hour bug — get it right the first time.

---

## 3. Detection engine

### 3.1 Navigation lifecycle

```
chrome.webNavigation.onCommitted (main frame only, frameId === 0)
   │
   ├─► runHeuristics(url)              synchronous, target <5ms
   │      └─► if detection: logEvent + sendMessage  ──► banner renders NOW
   │
   └─► checkSafeBrowsing(url)          async, cached, may take 200-800ms
          └─► if MORE severe than heuristic result:
                 update event + sendMessage again  ──► banner upgrades in place
```

**The banner never waits on the network.** Heuristics render immediately; the API result arrives
later and only ever *upgrades* severity. A slow or failed API call degrades to heuristics-only —
it never produces a blank screen or a hang.

Filter to `details.frameId === 0`. Without this you will fire on every ad iframe on the page.

### 3.2 Heuristic specifications

All heuristics are **pure functions** — URL in, `Detection | null` out. No I/O, no storage, no
async. This makes them the only trivially unit-testable part of the system (see §9).

| ID | Rule | `lessonId` | Verdict |
|----|------|-----------|---------|
| H1 | Lookalike / typosquat domain | `lookalike-domains` | `dangerous` |
| H2 | Punycode host (`xn--`) | `lookalike-domains` | `suspicious` |
| H3 | Password field on untrusted origin | `phishing-pressure` | `suspicious` |
| H4 | Raw IP address as host | `url-anatomy` | `suspicious` |
| H5 | Risky download extension | `downloads-and-permissions` | `dangerous` |

**H1 — Lookalike domains.** The highest-value rule; it is the one the demo hangs on.

1. Extract the registrable domain (eTLD+1). No Public Suffix List at this timebox — take the last
   two labels, with a hardcoded exception list for multi-part TLDs (`co.uk`, `com.au`, `co.jp`,
   `com.br`).
2. Normalize: NFKC, lowercase, then fold confusables —
   `0→o`, `1→l`, `5→s`, `rn→m`, `vv→w`, `í/ì/î→i`, `á/à/â→a`.
3. Damerau-Levenshtein against a ~20-entry brand list (`google`, `paypal`, `amazon`, `apple`,
   `microsoft`, `netflix`, `facebook`, `instagram`, `chase`, `wellsfargo`, …).
4. Flag when `0 < distance <= 2` **and** the host is not an exact brand match.
5. `detail` must name the specific substitution: `"paypa1.com — digit 1 where the letter l belongs"`.

That `detail` string is the entire teaching payload. A generic "suspicious domain" makes the
product worthless. Spend your polish budget here.

**H3 — Credential form.** The content script scans for `input[type="password"]` at
`document_idle` and posts `LIEF_PASSWORD_FIELD` to the background. The background decides,
combining it with origin allowlist state. The content script never decides.

**H4 — Raw IP.** `/^\d{1,3}(\.\d{1,3}){3}$/` or a bracketed IPv6 literal.

**H5 — Downloads.** `chrome.downloads.onCreated`. Flag extensions in
`{exe, scr, bat, cmd, com, msi, js, vbs, jar, apk, dmg, pkg}` or any double-extension pattern
matching `/\.(pdf|doc|jpg|png|txt)\.[a-z0-9]{2,4}$/i`.

**On `https-is-not-safe` — an honest deviation from the PRD's 1:1 claim.** No standalone detector
maps to it, because "this page uses HTTPS" is not by itself a risk. It is emitted as a *secondary*
lesson whenever `verdict !== 'safe' && url.protocol === 'https:'`, and the banner appends one
line: *"The padlock is present. It proves the connection is encrypted, not that the site is
honest."* This is the correct teaching moment for that concept and it only exists in context.

### 3.3 False-positive policy

**A warning on Gmail is worse than a missed detection.** A false positive destroys trust in every
subsequent warning; a miss is invisible. Tune toward silence.

Mechanisms: a ~500-entry allowlist of top domains checked before any heuristic runs; H1 requires
distance ≥ 1 so exact brand matches can never fire; the allowlist is user-extendable from the
banner ("this site is fine").

### 3.4 Safe Browsing integration

```
POST https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}
```

```jsonc
{
  "client": { "clientId": "lief", "clientVersion": "0.1.0" },
  "threatInfo": {
    "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING",
                    "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
    "platformTypes": ["ANY_PLATFORM"],
    "threatEntryTypes": ["URL"],
    "threatEntries": [{ "url": "https://example.com/path" }]
  }
}
```

A clean URL returns `{}` — an empty object, **not** an empty `matches` array. Code that reads
`response.matches.length` throws on every safe page. This is the single most common integration
bug with this API.

Threat type → lesson mapping:

| `threatType` | `lessonId` | Verdict |
|---|---|---|
| `SOCIAL_ENGINEERING` | `phishing-pressure` | `dangerous` |
| `MALWARE` | `downloads-and-permissions` | `dangerous` |
| `UNWANTED_SOFTWARE` | `downloads-and-permissions` | `suspicious` |
| `POTENTIALLY_HARMFUL_APPLICATION` | `downloads-and-permissions` | `suspicious` |

**Caching.** Keyed by full URL, 5-minute TTL. Hold it in `chrome.storage.session`, not a module
variable — see §10. Without a cache, an SPA that fires `onCommitted` repeatedly will exhaust your
quota inside the demo.

**Failure is non-fatal.** Network error, 4xx, 5xx, missing key → log and return `null`. Heuristics
already rendered. Never surface an API failure to the user.

### 3.5 Verdict merge

```ts
const SEVERITY = { safe: 0, suspicious: 1, dangerous: 2 } as const;
// Higher severity wins. Ties keep the FIRST result, so the heuristic's
// explainable `detail` survives rather than being overwritten by an opaque API label.
```

That tie-break is deliberate. When a heuristic and the API agree on severity, the heuristic's
human-readable explanation is the more valuable of the two.

---

## 4. Messaging protocol

```ts
type LiefMessage =
  | { type: 'LIEF_VERDICT'; event: RiskEvent }          // background → content
  | { type: 'LIEF_REQUEST_VERDICT' }                    // content → background
  | { type: 'LIEF_PASSWORD_FIELD'; hasPassword: boolean } // content → background
  | { type: 'LIEF_ACTION'; eventId: string; action: RiskEvent['action'] }; // content → background
```

**The load-order race, and why both directions exist:**

```
  Fast page:  onCommitted ──► verdict ──► sendMessage ──► ✗ no listener yet, message lost
              content script mounts ──► LIEF_REQUEST_VERDICT ──► background replays ──► ✓ banner

  Slow page:  content script mounts ──► LIEF_REQUEST_VERDICT ──► nothing yet
              onCommitted ──► verdict ──► sendMessage ──► ✓ banner
```

The content script must do **both**: register its listener *and* immediately request the current
verdict. The background keeps a `tabId → RiskEvent` map to answer replays. Omit this and the
banner will intermittently fail to appear on cached pages — the hardest class of bug to debug live
on stage.

---

## 5. Storage schema

| Key | Type | Notes |
|---|---|---|
| `lief:events` | `RiskEvent[]` | Newest last. FIFO-pruned at 500 entries. |
| `lief:settings` | `Settings` | Allowlist additions, seed flag. |
| `lief:sbcache` | `Record<string, CacheEntry>` | In `storage.session`, not `local`. |

```ts
type Settings = {
  userAllowlist: string[];
  seeded: boolean;          // demo fixture applied
  installedAt: number;
};
```

`lib/events.ts` is the **only** module that touches `chrome.storage`. Track C reads events through
`getEvents()`, never directly. One write path means one place to enforce the host-only rule (§8)
and one place to fix a bug.

Quota is 10 MB for `storage.local`. At ~200 bytes per event the 500-entry cap uses ~100 KB. Not a
concern, but the cap prevents unbounded growth during a long demo session.

---

## 6. UI behaviour specs

### 6.1 Banner (content script)

- Rendered into an **open shadow root**. Host page CSS is hostile; shadow DOM is the only reliable
  isolation. A page that styles `div { display: none }` will otherwise erase your warning.
- Fixed to viewport top, `z-index: 2147483647`, does not reflow page content.
- Three regions in fixed order: **what was found** (plain language) → **which concept** (lesson
  name) → **two actions**.
- Actions: *Leave this page* → `history.back()`; *Show me why* →
  `chrome.runtime.getURL('pages/course/index.html#' + lessonId)` opened in a new tab.
- Both actions post `LIEF_ACTION` so the `action` field on the event is populated. The dashboard's
  behavioural insight depends on this — without it every event reads `null`.
- **Advisory, never blocking.** Dismissible. The user stays in control; that is a product
  commitment from the PRD, not a UI preference.

### 6.2 Review dashboard

- Reads via `getEvents()`. Must render correctly at 0, 1, and 500 events.
- Timeline bucketed by day over 7 days.
- Concept breakdown grouped by `lessonId`, sorted by count descending.
- Recommendation = `lessonId` with the highest count, linked to the lesson.
- Wipe button calls `clearEvents()` with a confirm step, visible on the main view.

### 6.3 Course

- Lessons in a static `lessons.json`, read at load.
- Route on `location.hash` as the `lessonId`. Unknown or absent hash → lesson index.
- No quiz, no progress persistence, no animation in v1.

---

## 7. Error handling

Per project convention, every async call is wrapped with typed error handling. This matters more
than usual here: **an unhandled rejection in an MV3 service worker kills the worker silently.**
No console error in the page, no visible failure — detection simply stops working for the rest of
the session. On stage that looks like the product doing nothing.

```ts
type LiefError =
  | { kind: 'network'; status?: number }
  | { kind: 'storage' }
  | { kind: 'parse'; raw: string }
  | { kind: 'config'; detail: string };   // e.g. missing API key

type Result<T> = { ok: true; value: T } | { ok: false; error: LiefError };
```

Every exported async function in `lib/` returns `Result<T>`. No exceptions cross a module
boundary. Detection failures degrade to `null` and are logged; they are never surfaced to the user.

---

## 8. Privacy implementation

The PRD's privacy commitments are enforced in code, not documented as policy:

- **Host-only storage.** `logEvent()` derives `host` from the URL itself and has no parameter for
  a full URL. It is structurally impossible for a caller to persist a path or query string. This
  is the enforcement mechanism — paths and query strings routinely carry session tokens, and a
  local log of those would be an accidental credential store.
- **Safe Browsing receives full URLs by necessity.** Disclosed in-product on first run.
- **No analytics, no telemetry, no third-party scripts.** Zero network calls other than §3.4.
- **`clearEvents()`** wipes `lief:events` completely, reachable in one click from the dashboard.

---

## 9. Testing

Honest scope at two hours: heuristics are pure functions and cheap to test, so they get real
tests. Everything else is a manual matrix.

**Unit (Vitest), ~15 minutes, high value:**

```
H1  paypa1.com → dangerous          H1  paypal.com → null (exact match, must not fire)
H1  gooogle.com → dangerous         H1  google.com  → null
H2  xn--80ak6aa92e.com → suspicious H4  192.168.1.1 → suspicious
H5  invoice.pdf.exe → dangerous     H5  report.pdf  → null
```

The negative cases matter more than the positive ones — they are the false-positive guard from §3.3.

**Manual matrix before the demo:**

| Case | Expected |
|---|---|
| `testsafebrowsing.appspot.com/s/malware.html` | Dangerous banner, `downloads-and-permissions` |
| Local lookalike page | Dangerous banner, `lookalike-domains`, detail names the substitution |
| `google.com`, `github.com`, Gmail | Silent. No banner. |
| Banner → "Show me why" | Opens correct lesson via hash |
| Dashboard with seed data | Timeline, breakdown, one recommendation |
| Dashboard with 0 events | Clean empty state, no crash |
| Reload a flagged page 5× | Banner every time (proves the race fix in §4) |

Run `npx tsc --noEmit` after every change. The contract types are the only thing preventing a bad
integration at T+1:20.

---

## 10. Performance & runtime constraints

| Budget | Target |
|---|---|
| Heuristic pass | < 5 ms per navigation |
| Banner visible after `onCommitted` | < 50 ms |
| Dashboard render at 500 events | < 200 ms |
| Navigation blocked | **Never.** Detection is always observational. |

**MV3 service worker lifecycle is the dominant runtime constraint.** The worker unloads after
roughly 30 seconds idle and takes every module-level variable with it. Consequences:

- The Safe Browsing cache lives in `chrome.storage.session`, never a `Map` in module scope.
- The `tabId → RiskEvent` replay map (§4) must also survive — `storage.session`.
- Never assume initialisation ran. Any handler may be the first code executing in a fresh worker.

This single behaviour derails more hackathon extension builds than every other issue combined.

---

## 11. Build & tooling

- Vite + React + TypeScript + Tailwind. React only on the two full pages; the service worker and
  content script are plain TypeScript with no framework.
- Functional components only.
- Output to `dist/`, loaded via `chrome://extensions` → Load unpacked.
- API key from `.env` as `VITE_SAFE_BROWSING_KEY`. **`.env` is git-ignored and never committed.**

**Escape hatch:** if `@crxjs/vite-plugin` fights you for more than ten minutes, abandon it. Ship
the service worker and content script as plain compiled JS with no bundler and keep React on the
pages only. Judges do not inspect build pipelines, and a bundler rabbit hole at T+0:30 is fatal.

---

## 12. Security considerations

| Item | Position |
|---|---|
| API key ships in the bundle | Extractable. Accepted for the hackathon — rate-limit the key and rotate after. Production path is a thin proxy. |
| Content script in hostile documents | Never trusted for verdicts. Reports observations only. |
| Page-controlled strings in the banner | Always `textContent`, never `innerHTML`. A phishing page will happily inject markup into its own hostname. |
| `<all_urls>` permission | Broad by necessity. Justified in the store listing and on first run. |

---

## 13. Open technical questions

1. eTLD+1 extraction without a Public Suffix List will misparse uncommon multi-part TLDs. The
   hardcoded exception list covers the demo. Ship `psl` post-hackathon.
2. Confusable folding is hand-rolled. Unicode TR39 confusables data is the correct source and is
   too large to inline at this timebox.
3. Is a 5-minute Safe Browsing cache TTL right? Too short burns quota on SPAs; too long misses
   fast-moving threats.
4. H3 currently cannot distinguish a legitimate login on an unknown-but-fine site from a
   credential harvester. Domain age via RDAP would resolve this and is the clearest v2 upgrade.
