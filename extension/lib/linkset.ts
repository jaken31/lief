/**
 * linkset.ts — the bundled static threat list. Layer 2 of detection.
 *
 * This REPLACES background/safeBrowsing.ts as the P0 second layer: same
 * signature, same verdict-merge seam (TRD §3.5), but synchronous, offline,
 * no API key, no quota, no cache, nothing to set up. No AI model of any kind
 * is involved in classifying a link — this list and detect.ts are the whole
 * mechanism, and both are deterministic.
 *
 * Every entry is SYNTHETIC. These hosts are authored for this build. The demo
 * never navigates to any of them on the open internet; the ones that appear on
 * screen are mapped to 127.0.0.1 in /etc/hosts and served locally.
 *
 * Every entry carries a lessonId, because a detection that cannot name a
 * lesson has no place in a teaching product (PRD §6).
 */

import type { LessonId } from './lessons';
import type { Detection } from './types';

export type ListedThreat = {
  host: string;
  lessonId: LessonId;
  verdict: 'suspicious' | 'dangerous';
  /** Plain language, specific, and written to be read aloud. */
  detail: string;
};

export const LINK_SET: readonly ListedThreat[] = [
  // -------------------------------------------------------------------------
  // lookalike-domains — these overlap with H1 on purpose. The overlap is the
  // tie-break test: H1 runs first, so H1's detail must survive the merge.
  // -------------------------------------------------------------------------
  {
    host: 'paypa1.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail: 'paypa1.com — the digit 1 where the letter l belongs. The real paypal.com does not.',
  },
  {
    host: 'arnazon.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail: 'arnazon.com — the letters r and n side by side, which read as a single m at a glance.',
  },
  {
    host: 'gooogle.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail: 'gooogle.com — one letter off from google.com. Three o characters, not two.',
  },
  {
    host: 'micros0ft-login.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail: 'micros0ft-login.com — the digit 0 where the letter o belongs, and a word bolted on.',
  },
  {
    host: 'xn--80ak6aa92e.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail:
      'xn--80ak6aa92e.com — punycode. Your browser may render this as apple.com, but the letters are Cyrillic.',
  },
  {
    host: 'netfl1x.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail: 'netfl1x.com — the digit 1 where the letter i belongs.',
  },
  {
    host: 'wellsfargo-secure.com',
    lessonId: 'lookalike-domains',
    verdict: 'dangerous',
    detail:
      'wellsfargo-secure.com — a real brand name with a reassuring word bolted on. The registered domain is not wellsfargo.com.',
  },

  // -------------------------------------------------------------------------
  // phishing-pressure
  // -------------------------------------------------------------------------
  {
    host: 'secure-paypa1-verify.com',
    lessonId: 'phishing-pressure',
    verdict: 'dangerous',
    detail:
      'secure-paypa1-verify.com asks you to "verify" an account you never reported a problem with. That is the tell.',
  },
  {
    host: 'chase-account-alert.net',
    lessonId: 'phishing-pressure',
    verdict: 'dangerous',
    detail:
      'chase-account-alert.net — manufactured urgency. A bank does not route account alerts through a brand-new domain.',
  },
  {
    host: 'netflix-billing-update.co',
    lessonId: 'phishing-pressure',
    verdict: 'dangerous',
    detail: 'netflix-billing-update.co captures payment details on a domain Netflix does not own.',
  },
  {
    host: 'appleid-locked-support.com',
    lessonId: 'phishing-pressure',
    verdict: 'dangerous',
    detail:
      'appleid-locked-support.com — an account-lockout pretext. Fear first, credentials second.',
  },
  {
    host: 'office365-mail-quota.net',
    lessonId: 'phishing-pressure',
    verdict: 'dangerous',
    detail: 'office365-mail-quota.net — a quota-expiry pretext. The ask is always your password.',
  },
  {
    host: 'hr-payroll-reverify.com',
    lessonId: 'phishing-pressure',
    verdict: 'suspicious',
    detail:
      'hr-payroll-reverify.com — an internal-authority pretext. Real payroll changes do not arrive by cold link.',
  },

  // -------------------------------------------------------------------------
  // downloads-and-permissions
  // -------------------------------------------------------------------------
  {
    host: 'free-pdf-converter-now.com',
    lessonId: 'downloads-and-permissions',
    verdict: 'dangerous',
    detail: 'free-pdf-converter-now.com bundles an installer with the file you actually asked for.',
  },
  {
    host: 'driver-update-tool.net',
    lessonId: 'downloads-and-permissions',
    verdict: 'dangerous',
    detail:
      'driver-update-tool.net — a fake update prompt. Drivers come from your OS, never from a web page.',
  },
  {
    host: 'cdn-invoice-download.biz',
    lessonId: 'downloads-and-permissions',
    verdict: 'dangerous',
    detail: 'cdn-invoice-download.biz serves an executable behind an invoice-shaped filename.',
  },
  {
    host: 'flash-player-update.info',
    lessonId: 'downloads-and-permissions',
    verdict: 'suspicious',
    detail:
      'flash-player-update.info offers a product discontinued in 2020. Any page still offering it is lying about something.',
  },

  // -------------------------------------------------------------------------
  // url-anatomy — the real domain is the last two labels before the slash.
  // -------------------------------------------------------------------------
  {
    host: 'login.google.com.secure-verify.ru',
    lessonId: 'url-anatomy',
    verdict: 'dangerous',
    detail:
      'The real domain here is secure-verify.ru. Everything to the left of it — including "google.com" — is decoration the page chose for itself.',
  },
  {
    host: 'paypal.com.account-check.net',
    lessonId: 'url-anatomy',
    verdict: 'dangerous',
    detail:
      'The real domain here is account-check.net. "paypal.com" is just a subdomain label anyone can invent.',
  },
  {
    // RFC 5737 TEST-NET-1 — reserved for documentation, never routable.
    host: '192.0.2.77',
    lessonId: 'url-anatomy',
    verdict: 'suspicious',
    detail:
      '192.0.2.77 is a bare IP address. There is no domain name here, so there is nothing to check and nobody to hold responsible.',
  },
  {
    // RFC 5737 TEST-NET-2.
    host: '198.51.100.23',
    lessonId: 'url-anatomy',
    verdict: 'suspicious',
    detail:
      '198.51.100.23 is a bare IP address. Legitimate services put a name in front of their servers.',
  },
];

/** Built once at module load. ~20 entries, so the cost is irrelevant either way. */
const INDEX: ReadonlyMap<string, ListedThreat> = new Map(
  LINK_SET.map((entry) => [entry.host.toLowerCase(), entry]),
);

/**
 * Exact host match, then registrable domain. No regex, no wildcards, no fuzzy
 * matching — detect.ts already covers fuzzy, and two fuzzy layers would double
 * the false-positive surface for no extra coverage.
 */
export function checkLinkSet(host: string, registrableDomain: string): Detection | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  const hit = INDEX.get(h) ?? INDEX.get(registrableDomain.toLowerCase());
  if (!hit) return null;
  return {
    verdict: hit.verdict,
    lessonId: hit.lessonId,
    detail: hit.detail,
    source: 'linkset',
    rule: 'LS',
  };
}
