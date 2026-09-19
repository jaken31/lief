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
import type { LessonId, RiskEvent } from './contracts';
import { lessonNumber, lessonTitle } from './contracts';

export const BANNER_TAG = 'lief-warning';

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
];

/** TRD §3.2 — the secondary lesson, emitted only in context. */
const PADLOCK_LINE =
  'The padlock is present. It proves the connection is encrypted, not that the site is honest.';

const VERDICT_LABEL: Record<RiskEvent['verdict'], string> = {
  safe: 'Checked',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
};

export type BannerAction = NonNullable<RiskEvent['action']>;

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

  const host = document.createElement(BANNER_TAG);
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

      // Every string below is page-derived and therefore hostile. textContent only —
      // never innerHTML. TRD §12.
      found.textContent = next.detail;
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

  return handle;
}
