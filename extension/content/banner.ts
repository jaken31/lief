/**
 * Track B — the in-page warning banner. TRD §6.1.
 *
 * Pure DOM. This module never touches chrome.*, which is what makes it testable in
 * jsdom and what keeps the extension plumbing in index.ts.
 *
 * Three regions, in this fixed order:
 *   1. what was found, in plain language   (the heuristic's `detail` — the teaching payload)
 *   2. which concept it is, named          ("Lesson 2 — Homoglyphs, typosquats, punycode")
 *   3. two actions                         (Leave this page / Show me why)
 *
 * Advisory, never blocking, always dismissible. That is a product commitment from the
 * PRD, not a UI preference.
 */
import bannerCss from './banner.css?inline';
import type { RiskEvent } from '../lib/events';
import type { LessonId } from '../lib/lessons';
import { LESSON_IDS, lessonTitle } from '../lib/lessons';

/**
 * A plain <div>, not a custom element.
 *
 * A hyphenated tag name is a custom element name, and a page that defines it first
 * gets its own class installed on our host — its connectedCallback runs and can
 * simply remove the warning. A div cannot be upgraded: `customElements.define`
 * requires a hyphen, and the customized-built-in form only applies to elements
 * carrying an `is` attribute, which this one does not. div is also on the short
 * list of built-ins that accept attachShadow.
 *
 * Page CSS matching `div` is not a concern — the inline styles below outrank it.
 */
export const BANNER_HOST_ATTR = 'data-lief-warning';
export const BANNER_HOST_SELECTOR = `div[${BANNER_HOST_ATTR}]`;

/**
 * The host element is the one part of the banner the page can still style: for the
 * host, outer-tree rules beat :host rules, so the shadow stylesheet cannot defend it.
 * Inline !important can — it is the only thing above author !important in the cascade.
 *
 * `all: initial` leads, wiping whatever the page forced on, and the declarations after
 * it put back what we need. Everything else stays at its initial value, which is
 * already safe. Order matters: later declarations in an inline block win.
 *
 * Typography is here rather than in :host for the same reason. Font properties are
 * inherited, so a page rule as ordinary as `* { font-family: Georgia !important }`
 * reaches the host and then flows across the shadow boundary into every line of the
 * warning.
 */
const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],

  ['position', 'fixed'],
  ['inset', '0 0 auto 0'],
  ['width', 'auto'],
  ['height', 'auto'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['z-index', '2147483647'],
  ['display', 'block'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['clip-path', 'none'],
  ['pointer-events', 'auto'],
  ['contain', 'none'],

  [
    'font-family',
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  ],
  ['font-size', '14px'],
  ['line-height', '1.45'],
  ['color-scheme', 'dark'],

  // `all` deliberately excludes direction and unicode-bidi, so these two are the one
  // pair of inherited properties the reset above does not cover. Left out, an RTL page
  // mirrors the whole warning.
  ['direction', 'ltr'],
  ['unicode-bidi', 'isolate'],
  ['text-align', 'left'],
];

/** TRD §3.2 — the secondary lesson, emitted only in context. */
const PADLOCK_LINE =
  'The padlock is present. It proves the connection is encrypted, not that the site is honest.';

/**
 * Bidi controls, zero-width characters and C0/C1 controls.
 *
 * U+202E and friends reorder how text *displays* without changing what it says, which
 * is the same class of attack as markup injection: the attacker controls what the
 * warning appears to say. textContent already blocks the markup half. CSS does not
 * help here — `unicode-bidi: isolate-override` still honours explicit override
 * characters embedded in the run, so the string has to be neutered before it is shown.
 *
 * A warning about deception cannot itself be made to lie. Tab and newline are
 * deliberately left in; they are harmless in textContent.
 */
// eslint-disable-next-line no-control-regex
const DECEPTIVE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Replaces anything invisible or reordering with a visible marker. */
export function neutraliseDeceptiveText(text: string): string {
  return text.replace(DECEPTIVE, '\uFFFD');
}

const VERDICT_LABEL: Record<RiskEvent['verdict'], string> = {
  safe: 'Checked',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
};

export type BannerAction = NonNullable<RiskEvent['action']>;

/** 1-based, so the banner can say "Lesson 2" the way the demo script does. */
const lessonNumber = (id: LessonId): number => LESSON_IDS.indexOf(id) + 1;

export type BannerOptions = {
  /** Defaults to document.documentElement — it outlives a body swap. */
  container?: Element;
  /** Defaults to location.protocol. Drives the padlock line. */
  protocol?: string;
  /** Deep link for "Show me why". Returning null renders it as a plain button. */
  lessonUrl?: (lessonId: LessonId) => string | null;
  onAction: (action: BannerAction, event: RiskEvent) => void;
};

export type BannerHandle = {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Safe Browsing can upgrade severity after the heuristic already rendered. */
  update: (event: RiskEvent) => void;
  remove: () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

export function mountBanner(event: RiskEvent, options: BannerOptions): BannerHandle {
  const container = options.container ?? document.documentElement;
  const protocol = options.protocol ?? location.protocol;

  const host = document.createElement('div');
  host.setAttribute(BANNER_HOST_ATTR, '');
  for (const [property, value] of HOST_STYLE) {
    host.style.setProperty(property, value, 'important');
  }

  const root = host.attachShadow({ mode: 'open' });

  const style = el('style');
  style.textContent = bannerCss;

  const banner = el('div', 'banner');
  banner.setAttribute('role', 'alert');

  // Region 1 — what was found.
  const chip = el('span', 'chip');
  const body = el('div', 'body');
  const found = el('p', 'found');

  // Region 2 — which concept.
  const concept = el('p', 'concept');
  const conceptLead = document.createTextNode('This is ');
  const conceptName = el('strong');
  concept.append(conceptLead, conceptName);

  const padlock = el('p', 'padlock');
  padlock.textContent = PADLOCK_LINE;

  body.append(found, concept, padlock);

  // Region 3 — two actions, in TRD order.
  const actions = el('div', 'actions');
  const leave = el('button', 'btn btn-primary');
  leave.type = 'button';
  leave.textContent = 'Leave this page';

  const learn = el('a', 'btn');
  learn.textContent = 'Show me why';
  learn.target = '_blank';
  learn.rel = 'noreferrer';

  actions.append(leave, learn);

  const dismiss = el('button', 'dismiss');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss this warning');

  banner.append(chip, body, actions, dismiss);
  root.append(style, banner);

  let currentEvent = event;

  const handle: BannerHandle = {
    host,
    root,
    update(next: RiskEvent) {
      currentEvent = next;

      banner.dataset['verdict'] = next.verdict;
      chip.textContent = VERDICT_LABEL[next.verdict];

      // `detail` is built from the page's own hostname and is therefore hostile.
      // textContent blocks markup; neutraliseDeceptiveText blocks reordering. TRD §12.
      found.textContent = neutraliseDeceptiveText(next.detail);
      conceptName.textContent = `Lesson ${String(lessonNumber(next.lessonId))} — ${lessonTitle(next.lessonId)}`;

      padlock.hidden = !(next.verdict !== 'safe' && protocol === 'https:');

      const href = options.lessonUrl?.(next.lessonId) ?? null;
      if (href === null) learn.removeAttribute('href');
      else learn.href = href;
    },
    remove() {
      host.remove();
    },
  };

  const fire = (action: BannerAction) => options.onAction(action, currentEvent);

  leave.addEventListener('click', () => {
    fire('left');
  });
  learn.addEventListener('click', (clickEvent) => {
    if (!learn.hasAttribute('href')) clickEvent.preventDefault();
    fire('learned');
  });
  dismiss.addEventListener('click', () => {
    fire('dismissed');
  });

  handle.update(event);
  container.append(host);
  raiseToTopLayer(host);

  return handle;
}

/**
 * The top layer is the only defence against a transform on <html>. A transformed
 * ancestor becomes the containing block for position: fixed descendants, so the
 * banner stops tracking the viewport and scrolls away with the document — inline
 * !important cannot help, because nothing about the banner's own style is wrong.
 * Top-layer elements skip the containing block chain entirely, and paint above any
 * z-index the page can reach for.
 *
 * Must run after the host is connected; showPopover() throws otherwise. If it is
 * unavailable the inline `position: fixed` still renders the banner — the UA's
 * `[popover]:not(:popover-open) { display: none }` loses to our inline !important.
 */
function raiseToTopLayer(host: HTMLElement): void {
  try {
    host.popover = 'manual';
    host.showPopover();
  } catch {
    // Pre-Chrome-114, or a detached host. Fixed positioning is the fallback.
  }
}
