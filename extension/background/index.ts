/**
 * background/index.ts — the service worker. All verdict logic lives here.
 *
 * TRUST BOUNDARY (TRD §1): the content script runs in a hostile document. It
 * reports observations — "a password field exists" — and renders what we send
 * it. It never produces a verdict.
 *
 * LIFECYCLE: this worker unloads after ~30s idle and takes every module-level
 * variable with it. There is no module-scope mutable state in this file, on
 * purpose. Anything that must survive goes through sessionStore.ts. Any handler
 * below may be the first code executing in a brand-new worker — none of them
 * assume initialisation ran.
 *
 * ERRORS: an unhandled rejection kills this worker silently and detection just
 * stops for the rest of the session. Every handler body is wrapped.
 */

import { isAllowlisted } from '../lib/allowlist';
import {
  h5Download,
  httpsNote,
  mergeDetections,
  registrableDomain,
  runHeuristics,
  toHost,
} from '../lib/detect';
import {
  getSettings,
  logEvent,
  updateEvent,
  updateSettings,
  type ReferrerKind,
  type RiskEvent,
} from '../lib/events';
import { checkLinkSet } from '../lib/linkset';
import {
  clearTabVerdict,
  forgetTab,
  getTabPrevHost,
  getTabVerdict,
  setTabPassword,
  setTabPrevHost,
  setTabVerdict,
} from '../lib/sessionStore';
import type { Detection, LiefMessage, LiefResponse } from '../lib/types';
import { SEVERITY } from '../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pages we have no business inspecting, and which would throw on parse anyway. */
function isInspectable(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Entry-point analysis (PRD §4.3) without ever storing a referrer URL. We keep
 * only the previous host per tab in session storage and classify it into one of
 * five buckets — the bucket is what the dashboard needs, the URL is not.
 */
const EMAIL_HOSTS = [
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'mail.yahoo.com', 'mail.proton.me', 'mail.zoho.com',
];
const SEARCH_DOMAINS = [
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org',
  'startpage.com', 'perplexity.ai', 'brave.com',
];
const SOCIAL_DOMAINS = [
  'twitter.com', 'x.com', 't.co', 'facebook.com', 'instagram.com', 'linkedin.com',
  'reddit.com', 'tiktok.com', 'discord.com', 'threads.net', 'bsky.app',
];

function classifyReferrer(prevHost: string | null): ReferrerKind {
  if (!prevHost) return 'direct';
  if (EMAIL_HOSTS.includes(prevHost)) return 'email';
  const rd = registrableDomain(prevHost);
  if (SEARCH_DOMAINS.includes(rd)) return 'search';
  if (SOCIAL_DOMAINS.includes(rd)) return 'social';
  return 'unknown';
}

/**
 * The tab may have no listener yet — a fast page commits before the content
 * script mounts. That is expected, not an error: the script asks us for the
 * verdict when it comes up (LIEF_REQUEST_VERDICT) and we replay it from session
 * storage. Swallowing here is correct; see TRD §4.
 */
async function tellTab(tabId: number, message: LiefMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    /* no listener yet — the replay path covers it */
  }
}

async function userAllowlist(): Promise<string[]> {
  const settings = await getSettings();
  return settings.ok ? settings.value.userAllowlist : [];
}

// ---------------------------------------------------------------------------
// The detection pass
// ---------------------------------------------------------------------------

/**
 * Layer 1 (heuristics) then Layer 2 (the bundled link set), merged by severity.
 *
 * Both layers are synchronous and offline. Nothing here waits on a network, a
 * key, a quota, or a model — which is precisely why the banner renders inside
 * the <50ms budget and why nothing on this path can fail on stage.
 */
function detect(url: string, ctx: { hasPasswordField: boolean }): Detection | null {
  const heuristic = runHeuristics(url, ctx);

  const host = toHost(url);
  const listed = host ? checkLinkSet(host, registrableDomain(host)) : null;

  // Heuristic first: on a severity tie its explainable detail survives (TRD §3.5).
  return mergeDetections(heuristic, listed);
}

async function publish(
  tabId: number,
  url: string,
  detection: Detection,
  referrerKind: ReferrerKind,
): Promise<RiskEvent | null> {
  const logged = await logEvent({
    url,
    verdict: detection.verdict,
    source: detection.source,
    lessonId: detection.lessonId,
    detail: detection.detail,
    referrerKind,
  });
  if (!logged.ok) {
    console.warn('[lief] could not log event', logged.error);
    return null;
  }

  await setTabVerdict(tabId, logged.value);
  await tellTab(tabId, { type: 'LIEF_VERDICT', event: logged.value });
  return logged.value;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

chrome.webNavigation.onCommitted.addListener(async (details) => {
  try {
    // Main frame only. Without this we fire on every ad iframe on the page.
    if (details.frameId !== 0) return;
    if (!isInspectable(details.url)) return;

    const { tabId, url } = details;

    const host = toHost(url);
    if (!host) return;
    const rd = registrableDomain(host);

    // New document: the previous page's password observation is meaningless now.
    await setTabPassword(tabId, false);

    const prevHost = await getTabPrevHost(tabId);
    const referrerKind = classifyReferrer(prevHost);
    await setTabPrevHost(tabId, host);

    // The allowlist gate runs before any rule. Tune toward silence: a warning
    // on Gmail costs more trust than a missed detection ever saves. TRD §3.3.
    if (isAllowlisted(host, rd, await userAllowlist())) {
      await clearTabVerdict(tabId);
      return;
    }

    const detection = detect(url, { hasPasswordField: false });
    if (!detection) {
      await clearTabVerdict(tabId);
      return;
    }

    await publish(tabId, url, detection, referrerKind);
  } catch (e) {
    // Never let this reject. A rejected promise here kills the worker and
    // detection stops silently for the rest of the session.
    console.warn('[lief] onCommitted failed', e);
  }
});

// ---------------------------------------------------------------------------
// Messages from the content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: LiefMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  void (async () => {
    try {
      switch (message.type) {
        // The content script just mounted. If the verdict was ready before it
        // existed our sendMessage was lost — replay it now. This is the other
        // half of the load-order race (TRD §4); omit it and the banner
        // intermittently fails on cached pages.
        case 'LIEF_REQUEST_VERDICT': {
          if (tabId === undefined) {
            sendResponse({ event: null } satisfies LiefResponse);
            return;
          }
          const event = await getTabVerdict(tabId);
          sendResponse({ event } satisfies LiefResponse);
          return;
        }

        // An observation, not a verdict. We decide here.
        case 'LIEF_PASSWORD_FIELD': {
          if (tabId === undefined || !message.hasPassword) {
            sendResponse({ event: null } satisfies LiefResponse);
            return;
          }
          await setTabPassword(tabId, true);

          const tab = await chrome.tabs.get(tabId);
          const url = tab.url;
          if (!url || !isInspectable(url)) {
            sendResponse({ event: null } satisfies LiefResponse);
            return;
          }

          const host = toHost(url);
          if (!host || isAllowlisted(host, registrableDomain(host), await userAllowlist())) {
            sendResponse({ event: null } satisfies LiefResponse);
            return;
          }

          const detection = detect(url, { hasPasswordField: true });
          if (!detection) {
            sendResponse({ event: null } satisfies LiefResponse);
            return;
          }

          const existing = await getTabVerdict(tabId);

          // Only ever upgrade. A later layer may find something worse; it may
          // never talk the banner down from what the user already read.
          if (existing && SEVERITY[existing.verdict] >= SEVERITY[detection.verdict]) {
            sendResponse({ event: existing } satisfies LiefResponse);
            return;
          }

          if (existing) {
            const updated = await updateEvent(existing.id, {
              verdict: detection.verdict,
              source: detection.source,
              lessonId: detection.lessonId,
              detail: detection.detail,
            });
            if (updated.ok && updated.value) {
              await setTabVerdict(tabId, updated.value);
              await tellTab(tabId, { type: 'LIEF_VERDICT', event: updated.value });
              sendResponse({ event: updated.value } satisfies LiefResponse);
              return;
            }
            sendResponse({ event: existing } satisfies LiefResponse);
            return;
          }

          const prevHost = await getTabPrevHost(tabId);
          const event = await publish(tabId, url, detection, classifyReferrer(prevHost));
          sendResponse({ event } satisfies LiefResponse);
          return;
        }

        // Populates RiskEvent.action. Without this every event reads null and
        // E3's behavioural insight is empty.
        case 'LIEF_ACTION': {
          await updateEvent(message.eventId, { action: message.action });
          if (message.action === 'left' && tabId !== undefined) await clearTabVerdict(tabId);
          sendResponse({ event: null } satisfies LiefResponse);
          return;
        }

        default:
          sendResponse({ event: null } satisfies LiefResponse);
      }
    } catch (e) {
      console.warn('[lief] message handler failed', e);
      sendResponse({ event: null } satisfies LiefResponse);
    }
  })();

  return true; // keep the channel open for the async reply
});

// ---------------------------------------------------------------------------
// H5 — downloads
// ---------------------------------------------------------------------------

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const name = item.filename || item.url || '';
    const detection = h5Download(name);
    if (!detection) return;

    const source = item.referrer || item.url;
    if (!source || !isInspectable(source)) return;

    const logged = await logEvent({
      url: source,
      verdict: detection.verdict,
      source: detection.source,
      lessonId: detection.lessonId,
      detail: detection.detail,
      referrerKind: classifyReferrer(toHost(source)),
    });
    if (!logged.ok) return;

    // A download has no tab of its own, so surfacing it on the active tab is
    // best-effort by design.
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== undefined) {
      await setTabVerdict(active.id, logged.value);
      await tellTab(active.id, { type: 'LIEF_VERDICT', event: logged.value });
    }
  } catch (e) {
    console.warn('[lief] onCreated failed', e);
  }
});

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * The toolbar icon opens the dashboard.
 *
 * The manifest declares an `action` with no `default_popup`, which means that
 * without this listener clicking the icon does nothing and the review page is
 * reachable only by typing a chrome-extension:// URL by hand. PRD §7 puts the
 * one-click wipe on that page, so "reachable in one click" has to start here.
 */
chrome.action.onClicked.addListener(() => {
  void (async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('pages/review/index.html') });
    } catch (e) {
      console.warn('[lief] could not open the dashboard', e);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const settings = await getSettings();
    if (settings.ok && settings.value.installedAt === 0) {
      await updateSettings({ installedAt: Date.now() });
    }
  } catch (e) {
    console.warn('[lief] onInstalled failed', e);
  }
});

// Re-exported so E2 can render the secondary padlock line without reimplementing
// the rule.
export { httpsNote };
