/**
 * detect.test.ts — Vitest. Runs under plain Node: nothing imported here touches
 * a chrome.* API at module scope.
 *
 * The NEGATIVE cases matter more than the positive ones. They are the
 * false-positive guard from TRD §3.3, and a false positive costs more trust
 * than a missed detection ever saves.
 */

import { describe, expect, it } from 'vitest';

import { isAllowlisted } from './allowlist';
import {
  damerauLevenshtein,
  h1LookalikeDomain,
  h2Punycode,
  h3CredentialForm,
  h4RawIp,
  h5Download,
  httpsNote,
  isIpHost,
  mergeDetections,
  registrableDomain,
  runHeuristics,
  secondLevelLabel,
  toHost,
} from './detect';
import { checkLinkSet } from './linkset';

describe('URL parsing', () => {
  it('strips www and lowercases', () => {
    expect(toHost('https://WWW.Example.com/path?q=1')).toBe('example.com');
  });

  it('returns null on garbage rather than throwing', () => {
    expect(toHost('not a url')).toBeNull();
  });

  it('handles multi-part TLDs', () => {
    expect(registrableDomain('bbc.co.uk')).toBe('bbc.co.uk');
    expect(secondLevelLabel('news.bbc.co.uk')).toBe('bbc');
  });

  it('finds the real domain behind a decorated host', () => {
    expect(registrableDomain('login.google.com.secure-verify.ru')).toBe('secure-verify.ru');
  });

  it('recognises IP hosts', () => {
    expect(isIpHost('192.0.2.77')).toBe(true);
    expect(isIpHost('999.1.1.1')).toBe(false);
    expect(isIpHost('example.com')).toBe(false);
  });
});

describe('damerauLevenshtein', () => {
  it('counts substitutions, insertions and adjacent transpositions', () => {
    expect(damerauLevenshtein('google', 'google')).toBe(0);
    expect(damerauLevenshtein('gooogle', 'google')).toBe(1);
    expect(damerauLevenshtein('gogole', 'google')).toBe(1); // transposition
    expect(damerauLevenshtein('', 'abc')).toBe(3);
  });
});

describe('H1 — lookalike domains (positive)', () => {
  // THE regression test. Under the TRD's literal spec (fold, then require
  // distance > 0) this case silently returns null, because folding turns
  // paypa1 into paypal and the distance becomes 0. If this ever goes red
  // again, the two-comparison fix in h1LookalikeDomain has been reverted.
  it('fires on paypa1.com and names the substitution', () => {
    const d = h1LookalikeDomain('paypa1.com');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.lessonId).toBe('lookalike-domains');
    expect(d?.detail).toContain('digit 1');
    expect(d?.detail).toContain('paypal.com');
  });

  it('fires on arnazon.com and explains the rn/m pair', () => {
    const d = h1LookalikeDomain('arnazon.com');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.detail).toMatch(/r and n/);
  });

  it('fires on netfl1x.com, reading 1 as i rather than l', () => {
    const d = h1LookalikeDomain('netfl1x.com');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.detail).toContain('netflix.com');
  });

  it('fires on gooogle.com by edit distance', () => {
    const d = h1LookalikeDomain('gooogle.com');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.detail).toContain('google.com');
  });

  it('fires on micros0ft-login.com — fold plus bolted-on word', () => {
    const d = h1LookalikeDomain('micros0ft-login.com');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.detail).toContain('microsoft.com');
  });

  it('flags a bare brand-plus-word domain as suspicious, not dangerous', () => {
    const d = h1LookalikeDomain('wellsfargo-secure.com');
    expect(d?.verdict).toBe('suspicious');
    expect(d?.detail).toContain('wellsfargo.com');
  });

  it('looks past subdomains to the registrable domain', () => {
    expect(h1LookalikeDomain('login.paypa1.com')?.verdict).toBe('dangerous');
  });
});

describe('H1 — the false-positive guard (negative)', () => {
  it.each([
    ['paypal.com', 'the genuine brand must never fire'],
    ['google.com', 'the genuine brand must never fire'],
    ['amazon.com', 'arnazon must not have poisoned the real one'],
    ['chase.com', 'short brand, exact match'],
    ['apply.com', 'distance 1 from apple — the classic collision'],
    ['ample.com', 'distance 1 from apple'],
    ['maple.com', 'distance 1 from apple'],
    ['finance.com', 'distance 1 from binance'],
    ['github.com', 'on the brand list, exact match'],
    ['gitlab.com', 'near github but a real product'],
    ['bbc.co.uk', 'multi-part TLD — the label is bbc, not co'],
    ['gov.uk', 'two labels only'],
    ['news.ycombinator.com', 'ordinary site, no brand signal'],
    ['en.wikipedia.org', 'ordinary site'],
    ['localhost', 'our own dev server'],
  ])('stays silent on %s (%s)', (host) => {
    expect(h1LookalikeDomain(host)).toBeNull();
  });
});

describe('H2 — punycode', () => {
  it('flags an xn-- host as suspicious', () => {
    const d = h2Punycode('xn--80ak6aa92e.com');
    expect(d?.verdict).toBe('suspicious');
    expect(d?.lessonId).toBe('lookalike-domains');
  });

  it('ignores ordinary hosts', () => {
    expect(h2Punycode('example.com')).toBeNull();
  });
});

describe('H3 — credential form', () => {
  it('fires only when a password field was observed', () => {
    expect(h3CredentialForm('unknown-site.com', false)).toBeNull();
    const d = h3CredentialForm('unknown-site.com', true);
    expect(d?.verdict).toBe('suspicious');
    expect(d?.lessonId).toBe('phishing-pressure');
  });
});

describe('H4 — raw IP host', () => {
  it('flags dotted quads', () => {
    expect(h4RawIp('192.0.2.77')?.verdict).toBe('suspicious');
    expect(h4RawIp('192.168.1.1')?.verdict).toBe('suspicious');
    expect(h4RawIp('192.0.2.77')?.lessonId).toBe('url-anatomy');
  });

  it('ignores names', () => {
    expect(h4RawIp('example.com')).toBeNull();
  });
});

describe('H5 — downloads', () => {
  it('flags a double extension and names both halves', () => {
    const d = h5Download('invoice.pdf.exe');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.detail).toContain('.pdf');
    expect(d?.detail).toContain('.exe');
  });

  it('flags a bare executable', () => {
    expect(h5Download('setup.msi')?.verdict).toBe('dangerous');
    expect(h5Download('/Users/someone/Downloads/tool.dmg')?.verdict).toBe('dangerous');
  });

  it('ignores ordinary documents', () => {
    expect(h5Download('report.pdf')).toBeNull();
    expect(h5Download('photo.jpg')).toBeNull();
    expect(h5Download('notes.txt')).toBeNull();
  });
});

describe('link set', () => {
  it('matches a synthetic phishing host and names its lesson', () => {
    const d = checkLinkSet('chase-account-alert.net', 'chase-account-alert.net');
    expect(d?.verdict).toBe('dangerous');
    expect(d?.lessonId).toBe('phishing-pressure');
    expect(d?.source).toBe('linkset');
  });

  it('matches through a subdomain via the registrable domain', () => {
    expect(checkLinkSet('login.paypa1.com', 'paypa1.com')?.verdict).toBe('dangerous');
  });

  it('stays silent on anything not listed', () => {
    expect(checkLinkSet('github.com', 'github.com')).toBeNull();
  });
});

describe('verdict merge (TRD §3.5)', () => {
  it('prefers higher severity', () => {
    const suspicious = h4RawIp('192.0.2.77');
    const dangerous = h1LookalikeDomain('paypa1.com');
    expect(mergeDetections(suspicious, dangerous)?.verdict).toBe('dangerous');
  });

  it('keeps the FIRST result on a tie, so the heuristic detail survives', () => {
    const heuristic = h1LookalikeDomain('paypa1.com');
    const listed = checkLinkSet('paypa1.com', 'paypa1.com');
    expect(heuristic?.verdict).toBe(listed?.verdict); // both dangerous
    const merged = mergeDetections(heuristic, listed);
    expect(merged?.source).toBe('heuristic');
    expect(merged).toBe(heuristic);
  });

  it('handles nulls on either side', () => {
    const d = h4RawIp('192.0.2.77');
    expect(mergeDetections(null, d)).toBe(d);
    expect(mergeDetections(d, null)).toBe(d);
    expect(mergeDetections(null, null)).toBeNull();
  });
});

describe('runHeuristics', () => {
  it('returns the most severe finding for a URL', () => {
    const d = runHeuristics('http://paypa1.com:8080/login.html');
    expect(d?.rule).toBe('H1');
    expect(d?.verdict).toBe('dangerous');
  });

  it('is silent on an ordinary URL', () => {
    expect(runHeuristics('https://example.com/about')).toBeNull();
  });

  it('survives a malformed URL', () => {
    expect(runHeuristics('::::')).toBeNull();
  });
});

describe('https-is-not-safe secondary note', () => {
  it('appears only on an HTTPS page that already has a finding', () => {
    expect(httpsNote('https://paypa1.com/', 'dangerous')).toContain('padlock');
    expect(httpsNote('http://paypa1.com/', 'dangerous')).toBeNull();
    expect(httpsNote('https://example.com/', 'safe')).toBeNull();
  });
});

describe('allowlist gate', () => {
  it('covers subdomains through the registrable domain', () => {
    expect(isAllowlisted('mail.google.com', 'google.com')).toBe(true);
    expect(isAllowlisted('paypal.com', 'paypal.com')).toBe(true);
  });

  it('honours the user additions', () => {
    expect(isAllowlisted('intranet.local', 'intranet.local')).toBe(false);
    expect(isAllowlisted('intranet.local', 'intranet.local', ['intranet.local'])).toBe(true);
  });

  it('does not cover an unknown host', () => {
    expect(isAllowlisted('paypa1.com', 'paypa1.com')).toBe(false);
  });
});
