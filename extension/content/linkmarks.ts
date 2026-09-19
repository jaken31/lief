/**
 * linkmarks.ts — mark risky links in the page, before they are clicked.
 *
 * OWNERSHIP: this sits in content/, which is Track B's. It is additive — it
 * exports one function that main.ts calls once from start() and otherwise
 * touches nothing in this directory.
 *
 * Two hostile-document problems, same answer as the banner (TRD §6.1):
 *
 *   1. Page CSS wins by default. `a { text-decoration: none !important }` is
 *      common, so the underline is applied through an attribute selector with
 *      !important, from a style element we inject.
 *   2. Page CSS could also erase a tooltip appended inline, so the tooltip
 *      lives in a shadow root where the page cannot reach it.
 *
 * And one rule that outranks both: hostnames are page-controlled strings. They
 * go in with textContent, never innerHTML. A phishing page will put markup in
 * its own hostname precisely because it expects you to render it.
 */

import { lessonTitle } from '../lib/lessons';
import { classifyLink } from '../lib/linkscan';
import type { Detection } from '../lib/types';

const MARK_ATTR = 'data-lief-risk';
const STYLE_ID = 'lief-linkmark-style';

/** A page with 5,000 anchors is a search results page, not something to decorate. */
const MAX_LINKS = 800;
const DEBOUNCE_MS = 150;

let tooltipHost: HTMLElement | null = null;
let tooltipBody: HTMLElement | null = null;
let cache = new Map<string, Detection | null>();
let teardown: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  // A wavy underline rather than a solid one: it reads as "something is off
  // here" instead of "this is a link", which every underline already means.
  style.textContent = `
    a[${MARK_ATTR}="dangerous"] {
      text-decoration: underline wavy #dc2626 !important;
      text-decoration-thickness: 2px !important;
      text-underline-offset: 3px !important;
      cursor: help !important;
    }
    a[${MARK_ATTR}="suspicious"] {
      text-decoration: underline wavy #d97706 !important;
      text-decoration-thickness: 2px !important;
      text-underline-offset: 3px !important;
      cursor: help !important;
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
  teardown.push(() => style.remove());
}

// ---------------------------------------------------------------------------
// Tooltip — one shared element, moved around
// ---------------------------------------------------------------------------

function ensureTooltip(): HTMLElement | null {
  if (tooltipBody) return tooltipBody;

  tooltipHost = document.createElement('div');
  tooltipHost.style.cssText = 'all:initial;position:absolute;top:0;left:0;z-index:2147483647;';
  const root = tooltipHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .tip {
      position:absolute; max-width:320px; padding:10px 12px; border-radius:8px;
      background:#16181d; color:#f8f8f8; font:13px/1.45 -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow:0 4px 20px rgba(0,0,0,.3);
      pointer-events:none; opacity:0; transition:opacity .08s ease;
    }
    .tip[data-show="1"] { opacity:1; }
    .tip .head { font-weight:700; font-size:11px; letter-spacing:.06em;
                 text-transform:uppercase; margin-bottom:5px; }
    .tip[data-level="dangerous"] .head { color:#fca5a5; }
    .tip[data-level="suspicious"] .head { color:#fcd34d; }
    .tip .lesson { margin-top:7px; padding-top:7px; border-top:1px solid #33363d;
                   color:#9ca3af; font-size:12px; }
  `;

  const tip = document.createElement('div');
  tip.className = 'tip';
  // Structure only — every page-controlled string below goes in via textContent.
  for (const cls of ['head', 'detail', 'lesson']) {
    const part = document.createElement('div');
    part.className = cls;
    tip.appendChild(part);
  }

  root.append(style, tip);
  (document.body ?? document.documentElement).appendChild(tooltipHost);

  teardown.push(() => {
    tooltipHost?.remove();
    tooltipHost = null;
    tooltipBody = null;
  });

  tooltipBody = tip;
  return tip;
}

function showTooltip(anchor: HTMLAnchorElement, detection: Detection): void {
  const tip = ensureTooltip();
  if (!tip) return;
  tip.dataset.level = detection.verdict;

  const head = tip.querySelector('.head');
  const detail = tip.querySelector('.detail');
  const lesson = tip.querySelector('.lesson');
  if (!head || !detail || !lesson) return;

  // textContent throughout. detection.detail embeds the hostname, which the page
  // controls; innerHTML here would be a self-inflicted injection.
  head.textContent = detection.verdict === 'dangerous' ? 'Dangerous link' : 'Suspicious link';
  detail.textContent = detection.detail;
  lesson.textContent = `Lesson: ${lessonTitle(detection.lessonId)}`;

  const rect = anchor.getBoundingClientRect();
  tip.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  tip.style.top = `${rect.bottom + window.scrollY + 8}px`;
  tip.dataset.show = '1';
}

function hideTooltip(): void {
  if (tooltipBody) tooltipBody.dataset.show = '0';
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function scan(): void {
  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(
    0,
    MAX_LINKS,
  ) as HTMLAnchorElement[];

  for (const anchor of anchors) {
    // href on the element is already absolute, so linkscan never needs location.
    const href = anchor.href;
    if (!href) continue;

    let detection = cache.get(href);
    if (detection === undefined) {
      detection = classifyLink(href);
      cache.set(href, detection);
    }

    if (!detection) {
      if (anchor.hasAttribute(MARK_ATTR)) anchor.removeAttribute(MARK_ATTR);
      continue;
    }

    if (anchor.getAttribute(MARK_ATTR) === detection.verdict) continue;
    anchor.setAttribute(MARK_ATTR, detection.verdict);
  }
}

/**
 * Hover handlers are delegated from the document rather than bound per anchor:
 * one pair of listeners for the whole page, and links added later work with no
 * extra wiring.
 */
function watchHover(): void {
  const over = (event: Event) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.(`a[${MARK_ATTR}]`) as HTMLAnchorElement | null;
    if (!anchor) return;
    const detection = cache.get(anchor.href);
    if (detection) showTooltip(anchor, detection);
  };
  const out = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.(`a[${MARK_ATTR}]`)) hideTooltip();
  };

  document.addEventListener('mouseover', over, true);
  document.addEventListener('mouseout', out, true);
  document.addEventListener('scroll', hideTooltip, true);

  teardown.push(() => {
    document.removeEventListener('mouseover', over, true);
    document.removeEventListener('mouseout', out, true);
    document.removeEventListener('scroll', hideTooltip, true);
  });
}

function watchMutations(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(scan, DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  teardown.push(() => {
    observer.disconnect();
    if (debounce !== undefined) clearTimeout(debounce);
  });
}

// ---------------------------------------------------------------------------

/** Called once from start(). Safe on any page: it decorates, or it does nothing. */
export function markLinks(): void {
  if (!document.documentElement) return;
  injectStyle();
  scan();
  watchHover();
  watchMutations();
}

/** Test hook, mirroring resetForTests() in main.ts. */
export function resetLinkMarksForTests(): void {
  for (const dispose of teardown) dispose();
  teardown = [];
  cache = new Map();
  for (const el of Array.from(document.querySelectorAll(`[${MARK_ATTR}]`))) {
    el.removeAttribute(MARK_ATTR);
  }
}
