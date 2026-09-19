/**
 * linkscan.ts — classify a hyperlink BEFORE it is clicked.
 *
 * The banner teaches at the point of arrival. This teaches one step earlier, at
 * the point of exposure: the link is still on the page, the user has not
 * committed to anything, and the cost of being wrong is a glance rather than a
 * navigation. That is the earliest useful moment in the loop.
 *
 * Pure and synchronous, like everything else in the detection layer — href in,
 * `Detection | null` out. No I/O, no chrome API, no DOM. That is what lets the
 * content script call it directly on a few hundred anchors without a message
 * round-trip per link, and what keeps it testable under plain Node.
 *
 * NOTE ON THE TRUST BOUNDARY (TRD §1): the content script still does not get to
 * decide anything that is recorded. Nothing here writes an event or changes a
 * verdict — it only decorates. The authoritative verdict for the page you land
 * on is still produced in the background, from the committed URL.
 */

import { isAllowlisted } from './allowlist';
import { mergeDetections, registrableDomain, runHeuristics, toHost } from './detect';
import { checkLinkSet } from './linkset';
import type { Detection } from './types';

/** Anchors carry mailto:, tel:, javascript:, blob: and #fragments. None are navigations we judge. */
function isWebUrl(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Classify one absolute href.
 *
 * Pass an absolute URL — `HTMLAnchorElement.href` is always absolute, so the
 * caller gets this for free and this module never has to touch `location`.
 */
export function classifyLink(
  href: string,
  userAllowlist: readonly string[] = [],
): Detection | null {
  if (!isWebUrl(href)) return null;

  const host = toHost(href);
  if (!host) return null;

  const rd = registrableDomain(host);

  // Same gate, same order, same reasoning as the navigation path: a mark on a
  // legitimate link is worse than a missing one. A page full of false underlines
  // is noise, and noise is how a user learns to ignore the product.
  if (isAllowlisted(host, rd, userAllowlist)) return null;

  const heuristic = runHeuristics(href);
  const listed = checkLinkSet(host, rd);

  // Heuristic first so its explainable detail survives a severity tie (TRD §3.5).
  return mergeDetections(heuristic, listed);
}

/**
 * Batch helper with memoisation.
 *
 * A page can easily carry a few hundred anchors pointing at a handful of
 * distinct hosts, and a MutationObserver will ask again on every DOM change.
 * Classifying each href once per page keeps the repeat cost at a Map lookup.
 */
export function classifyLinks(
  hrefs: readonly string[],
  userAllowlist: readonly string[] = [],
  cache: Map<string, Detection | null> = new Map(),
): Map<string, Detection | null> {
  for (const href of hrefs) {
    if (cache.has(href)) continue;
    cache.set(href, classifyLink(href, userAllowlist));
  }
  return cache;
}
