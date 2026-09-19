# Track E1 — Extension Detection Engine

**Owner:** E1 · **Timebox:** 2 hours · **Branch:** `main`, shared with E2/E3/E4
**Companions:** [PRD.md](./PRD.md) · [TRD.md](./TRD.md) · [BUILD-TRACKS.md](./BUILD-TRACKS.md)

This is the expanded brief for BUILD-TRACKS Track A. It supersedes that section where the two
disagree, on three decisions taken after it was written:

1. **No AI model of any kind for link checking.** Not local, not hosted. Setting up an on-device
   model is a 90-minute detour inside a 120-minute build, and it buys nothing that a static list
   and five pure functions do not already deliver. Detection is deterministic: heuristics plus a
   bundled link set.
2. **Synthetic data throughout.** The threat list, the demo pages, and the event log are all
   fixtures we author. Nothing in the demo path depends on a live malicious site, a live API, or
   a network at all.
3. **`lib/linkset.ts` replaces `background/safeBrowsing.ts`** as the P0 second detection layer.
   Same function signature, same verdict-merge seam, no API key, no network, no cache. Safe
   Browsing becomes optional Phase 3 if E3's key lands early.

Everything else in the TRD stands. Build to it literally.

---

## 1. What you own

Disjoint from E2/E3/E4. **Do not edit a file outside this list.**

| Path | Note |
|---|---|
| `.gitignore` | Already written and committed — see §2 |
| `extension/manifest.json` | Exclusive. TRD §2 |
| `extension/background/**` | Service worker, navigation listener, downloads listener |
| `extension/lib/detect.ts` | Heuristics. Pure functions |
| `extension/lib/linkset.ts` | The static link set — §4 |
| `extension/lib/lessons.ts` | Contract. Written in the freeze window, then frozen |
| `extension/lib/events.ts` | Contract. Written in the freeze window, then frozen |
| `extension/lib/allowlist.ts` | False-positive guard |

**You do not own** `content/**` (E2), `pages/review/**` and `lib/seed.ts` (E3),
`pages/course/**` and `lessons.json` (E4).

---

## 2. Version control — four people, one branch

Checked at the time of writing: branch `main`, tracking `origin/main`
(`git@github.com:jaken31/lief.git`), local and remote both at `b794378`, and **`main` is the only
branch on the remote**. So the plan really is four engineers pushing to `main`. That works only
because file ownership is disjoint. Three things make it hold.

### 2.1 `.gitignore` was missing — now fixed

There was no `.gitignore` in the repo, while TRD §11 and BUILD-TRACKS both assert that `.env` is
git-ignored. That assertion was false. The first `git add .` would have committed the Safe
Browsing API key to a GitHub repo, along with `node_modules/` and `dist/` — and a merge conflict
in generated bundle output is a twenty-minute hole with no upside.

One has been written at the repo root covering `.env*` (with `!.env.example`), `dist/`,
`node_modules/`, and editor noise. **Commit and push it as the very first thing you do**, before
the contracts. It is worthless after someone has already run `git add .`.

```bash
git add .gitignore && git commit -m "chore: add gitignore, protect .env and dist" && git push
```

If a key has already been committed by the time you read this: rotate it. Removing the commit
does not unpublish it.

### 2.2 Everyone sets rebase-pull before writing a line

`pull.rebase` is unset in this repo, so `git pull` produces a merge commit. Four people merging
into `main` every few minutes turns the history into a thicket and makes "what broke the build at
T+1:10" unanswerable. Have all four run:

```bash
git config pull.rebase true
git config rebase.autoStash true
```

### 2.3 Push cadence, and the one rule that matters

- **Push every green commit.** `npx tsc --noEmit` passes, then commit, then push. Aim for under
  ten minutes between pushes. Long-lived local work is what actually causes conflicts.
- **`git pull --rebase` before every push.** Not after a conflict — before every push.
- **Never `git add .`.** Add your own paths explicitly:
  `git add extension/background extension/lib`. This is the single habit that keeps
  four-on-one-branch survivable, and with contracts in play it also stops you committing someone
  else's half-finished file.
- **You push the contracts at T+0:10 regardless of state.** Three people are blocked. A stub that
  compiles beats a correct file that arrives at T+0:20.
- **Contracts are frozen after that push.** If `RiskEvent` is wrong, work around it and fix after
  the demo. Renaming a field at T+1:00 breaks three tracks at once.

---

## 3. The H1 spec bug — read this before writing `detect.ts`

TRD §3.2 specifies H1 as: normalize and fold confusables → Damerau-Levenshtein against the brand
list → flag when `0 < distance <= 2`.

**As written, that never fires on `paypa1.com`** — the demo case the entire pitch hangs on. The
fold (`1→l`) happens *before* the distance check, so `paypa1` becomes `paypal`, the distance to
the brand `paypal` is `0`, and `0 < distance` excludes it. The flagship homoglyph case is silently
filtered out by the very rule meant to prevent false positives on exact brand matches.

The fix is to compare twice — once raw, once folded — because they answer different questions:

```ts
// raw    = 'paypa1'   what the user actually sees in the address bar
// folded = 'paypal'   what it is pretending to be
for (const brand of BRANDS) {
  if (raw === brand) return null;                             // genuinely paypal.com → silent
  if (folded === brand) return homoglyph(raw, brand);          // dangerous — see §3.1
  const d = damerauLevenshtein(folded, brand);
  if (d > 0 && d <= maxDistance(brand)) return typosquat(raw, brand, d);
}
return null;
```

`folded === brand && raw !== brand` is the homoglyph case, and it is the strongest signal in the
whole engine — a domain that is character-for-character a disguised brand is not a coincidence.
Distance matching then catches the sloppier typosquats (`gooogle`, `amazn`).

### 3.1 Generating the `detail` string

PRD §4.2 and TRD §3.2 are both emphatic that the `detail` string *is* the product. `"Suspicious
domain"` is worthless; `"paypa1.com — the digit 1 where the letter l belongs"` is the teaching.

Do not diff the strings positionally. `rn→m` and `vv→w` change length, so positional diffing
breaks on `arnazon`. Carry the explanation on the fold rule itself and record which rules fired:

```ts
const FOLD_RULES = [
  { from: 'rn', to: 'm', note: 'the letters r and n side by side, which read as a single m at a glance' },
  { from: 'vv', to: 'w', note: 'two v characters standing in for a w' },
  { from: '0',  to: 'o', note: 'the digit 0 where the letter o belongs' },
  { from: '1',  to: 'l', note: 'the digit 1 where the letter l belongs' },
  { from: '5',  to: 's', note: 'the digit 5 where the letter s belongs' },
  { from: 'í',  to: 'i', note: 'an accented í in place of a plain i' },
  { from: 'á',  to: 'a', note: 'an accented á in place of a plain a' },
] as const;
```

Apply them in array order — multi-character rules first, or `rn` never matches. Push each rule
that fires onto a `fired[]`, then build:

> `` `${host} — ${fired.map(r => r.note).join(', and ')}. The real ${brand}.com does not.` ``

For the distance path, where no fold rule fired, fall back to naming the brand:
`"gooogle.com — one letter off from google.com."`

### 3.2 The false-positive class nobody catches until the demo

Short brands collide with real words. `apply.com` is distance 1 from `apple`; `chasing.com` is
distance 2 from `chase`. TRD §3.3 is right that a warning on a legitimate site is worse than a
missed detection, and this is exactly how that happens.

Three guards, all cheap:

```ts
const maxDistance = (brand: string) => (brand.length <= 6 ? 1 : 2);
const H1_EXEMPT = new Set(['apply','ample','maple','applet','chasing','chased','amazing','googol']);
```

plus the ~500-domain allowlist from TRD §3.3 running *before* any heuristic. `apply.com` is in the
negative control matrix in §4.2 — test it, do not assume it.

---

## 4. The link set

This replaces Safe Browsing as the P0 second layer. It is a bundled constant in
`extension/lib/linkset.ts`, checked synchronously after the heuristics and merged through the
existing TRD §3.5 rule — higher severity wins, ties keep the first result, so a heuristic's
explainable `detail` always survives a list entry's.

```ts
export type ListedThreat = {
  host: string;
  lessonId: LessonId;
  verdict: 'suspicious' | 'dangerous';
  detail: string;
};
```

**Matching:** lowercase the host, strip a leading `www.`, test for an exact entry, then test the
eTLD+1. Nothing else — no regex, no wildcards, no fuzzy matching. The heuristics already cover
fuzzy.

### 4.1 Tier 1 — Synthetic threat entries (the list itself)

Authored for this build. Every entry carries a `lessonId`, because PRD §6 makes that field
non-nullable and an entry that cannot name a lesson has no business on the list.

**`lookalike-domains`** — these overlap with H1 on purpose; the overlap is the tie-break test.

| Host | Verdict | `detail` |
|---|---|---|
| `paypa1.com` | dangerous | the digit 1 where the letter l belongs |
| `arnazon.com` | dangerous | r and n side by side, reading as a single m |
| `gooogle.com` | dangerous | one letter off from google.com |
| `micros0ft-login.com` | dangerous | the digit 0 where the letter o belongs |
| `xn--80ak6aa92e.com` | dangerous | punycode — renders as apple.com using Cyrillic characters |
| `netfl1x.com` | dangerous | the digit 1 where the letter i belongs |
| `wellsfargo-secure.com` | dangerous | a real brand name with a word bolted on; the registered domain is not wellsfargo.com |

**`phishing-pressure`**

| Host | Verdict | `detail` |
|---|---|---|
| `secure-paypa1-verify.com` | dangerous | asks you to "verify" an account you never reported a problem with |
| `chase-account-alert.net` | dangerous | manufactured urgency; banks do not route alerts through a new domain |
| `netflix-billing-update.co` | dangerous | payment-detail capture on a domain Netflix does not own |
| `appleid-locked-support.com` | dangerous | account-lockout pretext, credential capture |
| `office365-mail-quota.net` | dangerous | quota-expiry pretext, credential capture |
| `hr-payroll-reverify.com` | suspicious | internal-authority pretext aimed at employees |

**`downloads-and-permissions`**

| Host | Verdict | `detail` |
|---|---|---|
| `free-pdf-converter-now.com` | dangerous | bundles an installer with the file you asked for |
| `driver-update-tool.net` | dangerous | fake update prompt, ships an installer you did not request |
| `cdn-invoice-download.biz` | dangerous | serves an `.exe` behind an invoice-shaped filename |
| `flash-player-update.info` | suspicious | a product discontinued in 2020; any page offering it is lying |

**`url-anatomy`**

| Host | Verdict | `detail` |
|---|---|---|
| `login.google.com.secure-verify.ru` | dangerous | the real domain is secure-verify.ru — everything left of it is decoration |
| `paypal.com.account-check.net` | dangerous | the real domain is account-check.net; paypal.com is just a subdomain label |
| `192.0.2.77` | suspicious | a bare IP address — no domain name, nothing to verify |
| `198.51.100.23` | suspicious | a bare IP address — no domain name, nothing to verify |

The two IPs come from RFC 5737 (`TEST-NET-1`, `TEST-NET-2`), reserved for documentation and
guaranteed never routable, so nobody can reach a real host through them by accident.

**Safety note on Tier 1.** These are list entries — strings compared against a host. The demo
never navigates to any of them on the open internet; the hosts that appear on screen resolve to
`127.0.0.1` on the demo machine (§4.3). Do not visit them unmapped.

### 4.2 Tier 2 — Negative controls (must stay silent)

The more important half of the list. TRD §9 is right that negative cases matter more than positive
ones. Navigate to every one of these before the demo. **Any banner here is a P0 bug.**

| URL | Why it is on the list |
|---|---|
| `https://www.google.com` | brand-list exact match |
| `https://mail.google.com` | subdomain of an exact brand match |
| `https://www.paypal.com` | the `raw === brand` guard — the case most likely to regress |
| `https://www.amazon.com` | exact match, and `arnazon` must not have poisoned it |
| `https://chase.com` | short brand, exact match |
| `https://apply.com` | distance 1 from `apple` — the collision from §3.2 |
| `https://www.bbc.co.uk` | multi-part TLD; naive last-two-labels yields `co.uk` |
| `https://www.gov.uk` | second multi-part TLD path |
| `https://github.com` | not on the brand list at all; must be silent by default |
| `https://news.ycombinator.com` | ordinary site, no signal |
| `https://en.wikipedia.org/wiki/Phishing` | path carries threat vocabulary; you match on host only |
| `http://localhost:5173` | your own dev server must not flag itself |

### 4.3 Tier 3 — Locally served demo pages (the hero demo)

The address bar has to read `paypa1.com` on stage. Map the hosts to loopback and serve your own
page — no live typosquat, no network dependency, fully reproducible.

```bash
sudo tee -a /etc/hosts >/dev/null <<'HOSTS'
127.0.0.1 paypa1.com
127.0.0.1 secure-paypa1-verify.com
127.0.0.1 arnazon.com
127.0.0.1 login.google.com.secure-verify.ru
HOSTS
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder   # macOS
```

Serve a static folder on 8080 — a port in the URL does not affect host parsing:

```bash
python3 -m http.server 8080 --directory demo-server
```

Demo URLs. Type them in full, or Chrome will search instead of navigating:

- `http://paypa1.com:8080/login.html` — **the hero.** A plausible sign-in page. Fires H1 *and*
  the link set, so the merge tie-break must keep H1's `detail`.
- `http://secure-paypa1-verify.com:8080/verify.html` — carries a password field, so it also
  exercises H3 through E2's content-script scan.
- `http://arnazon.com:8080/order.html` — the `rn→m` fold, a different teaching sentence.
- `http://login.google.com.secure-verify.ru:8080/` — the `url-anatomy` lesson made visible.

Three cautions:

- **Never map a domain on Chrome's HSTS preload list** (`paypal.com`, `google.com`). The browser
  forces HTTPS, your plain-HTTP server fails, and you lose ten minutes to it. All four hosts above
  are safe to map.
- **`demo-server/` is git-ignored.** It is scratch — do not commit it, and do not let it collide
  with anyone else's.
- **Remove the `/etc/hosts` lines after the hackathon.**

### 4.4 Tier 4 — Google's test URLs (optional, and know the trap)

`https://testsafebrowsing.appspot.com/` is Google's official, safe-to-visit test site, and both
BUILD-TRACKS and TRD §9 point at it. With the API dropped it is no longer needed, and it carries a
real hazard:

**Chrome's own Safe Browsing interstitial preempts your banner.** Chrome red-screens the page
before the document loads, so the content script never mounts and Lief appears to do nothing. On
stage that reads as a broken product.

If you want it as a contrast beat — "here is what Chrome alone says, here is what Lief adds" —
open the index and take the paths from there rather than trusting a remembered URL; those paths
have changed before. Rehearse it or cut it. **It is not on the critical path.**

---

## 5. Build phases

Times are from the BUILD-TRACKS clock. Dropping the API frees roughly fifteen minutes out of
Phase 2. Spend all of it on §3.1 `detail` polish and the §4.2 negative controls — that is where
the demo is actually won or lost.

| Window | Work | Done means |
|---|---|---|
| **T+0:00–0:10** | Push `.gitignore`. Then contracts: `lessons.ts`, `events.ts`, `detect.ts` (stubbed dangerous `lookalike-domains`), `manifest.json` per TRD §2. **Push.** | Three engineers unblocked |
| **T+0:10–0:25** | Service worker, `webNavigation.onCommitted` filtered to `frameId === 0`, allowlist gate, `logEvent` + `sendMessage`, `tabId → RiskEvent` replay map in `storage.session` | A console log fires once per real navigation |
| **T+0:25–0:50** | H1 with the §3 fix, H2 punycode, H4 raw IP. Pure functions, no I/O | **Checkpoint 1.** E2's banner renders your real verdict |
| **T+0:50–1:05** | `linkset.ts` from §4.1, merged via TRD §3.5. H5 on `downloads.onCreated`. H3 consuming E2's `LIEF_PASSWORD_FIELD` | Every lesson has a live path to a banner |
| **T+1:05–1:20** | Walk the entire §4.2 negative control list. Tune toward silence | **Checkpoint 2.** Zero false positives |
| **T+1:20–1:40** | `/etc/hosts` and demo server, rehearse §4.3 four times, hand E3 real events | Demo runs clean twice in a row |
| **T+1:40** | Freeze. No new heuristics. | |

**Heuristics before the link set, always.** They need no list, no key, no approval — nothing can
block them, and H1 alone carries the demo.

---

## 6. Tests

Vitest, roughly fifteen minutes, and the only genuinely testable part of the system. TRD §9's
table plus the cases this document adds:

```
H1  paypa1.com          → dangerous, detail contains "digit 1"    ← the §3 bug. Write this first
H1  arnazon.com         → dangerous, detail mentions r and n
H1  gooogle.com         → dangerous
H1  netfl1x.com         → dangerous
H1  paypal.com          → null      ← exact brand, must never fire
H1  google.com          → null
H1  apply.com           → null      ← the §3.2 collision
H1  bbc.co.uk           → null      ← multi-part TLD
H2  xn--80ak6aa92e.com  → suspicious
H4  192.0.2.77          → suspicious
H4  192.168.1.1         → suspicious
H5  invoice.pdf.exe     → dangerous
H5  report.pdf          → null
LS  chase-account-alert.net → dangerous, lessonId phishing-pressure
LS  github.com             → null
merge  H1 + list both hit paypa1.com → H1's detail survives   ← TRD §3.5 tie-break
```

Write the `paypa1.com` assertion before the implementation. It fails under the TRD's literal spec,
which is how you will know the §3 fix actually landed.

---

## 7. Traps specific to this track

**MV3 service workers unload after ~30 seconds idle** and take every module-level variable with
them. The `tabId → RiskEvent` replay map lives in `chrome.storage.session`, never a `Map` in
module scope. Any handler may be the first code running in a fresh worker — never assume
initialisation ran. TRD §10 is not exaggerating; this derails more hackathon extension builds than
everything else combined.

**An unhandled rejection kills the worker silently.** No console error, no visible failure —
detection simply stops for the rest of the session. Every async call in try/catch returning
`Result<T>` per TRD §7.

**Get `web_accessible_resources` right on the first try.** Omit it and E2's "Show me why" link
fails silently — and it is E2 who will spend half an hour hunting a bug that lives in your file.

**Never `innerHTML` a hostname**, and tell E2 the same. A phishing page will inject markup into
its own hostname precisely because it expects you to render it.

**Filter to `frameId === 0`** or you fire on every ad iframe on the page.

---

## 8. If you finish early

In order: tune H1 against more real sites from §4.2 — a warning on Gmail is worse than ten missed
detections → extend the allowlist toward 500 entries → help E3 weight `lib/seed.ts` toward
`lookalike-domains` so the dashboard recommendation has an obvious answer → rehearse §4.3 again.

**Do not** add a sixth heuristic. **Do not** start the popup or the options page. **Do not**
revisit Safe Browsing unless E3's key is already in `.env` and Checkpoint 2 has passed.
