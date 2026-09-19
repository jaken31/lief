/**
 * Track B — content script logic. TRD §4, §6.1.
 *
 * Owns the extension plumbing the banner deliberately does not know about:
 * message passing, the load-order race, the deep link, and the password-field
 * observation that feeds H3.
 *
 * Trust boundary, TRD §1: this code runs in a hostile document. It reports
 * observations and renders what the service worker tells it. It never decides a
 * verdict, and it validates everything it is handed.
 */
import type { BannerAction, BannerHandle } from './banner';
import { mountBanner } from './banner';
import type { LessonId, LiefMessage, Result, RiskEvent } from './contracts';
import { toRiskEvent } from './contracts';

/** Login forms on SPAs mount well after document_idle. Watch briefly, then stop. */
const PASSWORD_WATCH_MS = 10_000;
const PASSWORD_DEBOUNCE_MS = 250;

let banner: BannerHandle | null = null;
let dismissed = false;

function debug(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug('[lief]', ...args);
}

function hasRuntime(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string';
}

/**
 * Every failure here is expected and silent: the service worker may not have a
 * listener yet, and an extension reload invalidates the context mid-page. An
 * unhandled rejection would be worse than useless — it tells the user nothing and
 * pollutes the page console.
 */
async function send(message: LiefMessage): Promise<Result<unknown>> {
  if (!hasRuntime()) {
    return { ok: false, error: { kind: 'config', detail: 'no extension runtime' } };
  }
  try {
    const value: unknown = await chrome.runtime.sendMessage(message);
    return { ok: true, value };
  } catch (cause) {
    debug('sendMessage failed', message.type, cause);
    return { ok: false, error: { kind: 'network' } };
  }
}

function lessonUrl(lessonId: LessonId): string | null {
  if (!hasRuntime()) return null;
  try {
    return chrome.runtime.getURL(`pages/course/index.html#${lessonId}`);
  } catch (cause) {
    debug('getURL failed', cause);
    return null;
  }
}

function handleAction(action: BannerAction, event: RiskEvent): void {
  // Populates RiskEvent.action. Skip it and every event in the dashboard reads null,
  // which is the whole behavioural insight. TRD §6.1.
  void send({ type: 'LIEF_ACTION', eventId: event.id, action });

  if (action === 'dismissed') {
    dismissed = true;
    banner?.remove();
    banner = null;
    return;
  }

  if (action === 'left') {
    // The banner deliberately stays up. With no history entry back() is a no-op, and
    // tearing the warning down would leave the user on the page with nothing.
    history.back();
  }

  // 'learned' — the anchor's href opens the lesson. Nothing to do here.
}

export function render(event: RiskEvent): void {
  if (event.verdict === 'safe') return;
  // Advisory means advisory. Once dismissed, a later severity upgrade does not
  // reopen the banner on this page.
  if (dismissed) return;

  if (banner !== null) {
    banner.update(event);
    return;
  }
  banner = mountBanner(event, { lessonUrl, onAction: handleAction });
}

/**
 * H3's observation half. The content script reports that a password field exists;
 * the background combines it with origin state and decides. TRD §3.2.
 */
function watchPasswordFields(): void {
  let reported: boolean | null = null;
  let queued = false;

  const report = (): void => {
    const hasPassword = document.querySelector('input[type="password"]') !== null;
    if (hasPassword === reported) return;
    reported = hasPassword;
    void send({ type: 'LIEF_PASSWORD_FIELD', hasPassword });
  };

  report();

  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      report();
    }, PASSWORD_DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    observer.disconnect();
  }, PASSWORD_WATCH_MS);
}

export function start(): void {
  if (!hasRuntime()) {
    debug('no extension runtime — content script idle');
    return;
  }

  // Both directions of the load-order race, TRD §4.
  //
  //   fast page: the verdict is sent before this listener exists and is lost,
  //              so the request below makes the background replay it
  //   slow page: the request finds nothing, so this listener catches the push
  //
  // Implement one and the banner intermittently fails on cached pages.
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const event = toRiskEvent(message);
    if (event !== null) render(event);
  });

  void send({ type: 'LIEF_REQUEST_VERDICT' }).then((result) => {
    if (!result.ok) return;
    const event = toRiskEvent(result.value);
    if (event !== null) render(event);
  });

  watchPasswordFields();
}

/** Test hook — the module is a singleton and tests need a clean slate. */
export function resetForTests(): void {
  banner?.remove();
  banner = null;
  dismissed = false;
}
