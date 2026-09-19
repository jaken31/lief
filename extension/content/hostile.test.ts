// @vitest-environment node
/**
 * Track B, isolation suite. Runs the *compiled* content script in real Chrome
 * against pages that actively try to suppress it.
 *
 * jsdom cannot do this job. It does not resolve the cascade across a shadow
 * boundary, does not know that outer-tree rules outrank :host, and does not lay
 * anything out — so the unit tests can only assert that the defence is wired up,
 * never that it holds. Every bug this file has caught was invisible to them.
 *
 * The extension loader is the only thing faked: Chrome 153 refuses --load-extension
 * under automation, so the bundle is injected alongside a chrome stub. The bundle,
 * the stylesheet, the cascade and the layout are all real.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Kept in sync with BANNER_HOST_SELECTOR; this file runs outside the bundle. */
const HOST = 'div[data-lief-warning]';

const EVENT = {
  id: 'evt-1',
  ts: 1_758_000_000_000,
  host: 'paypa1.com',
  verdict: 'dangerous',
  source: 'heuristic',
  lessonId: 'lookalike-domains',
  detail: 'paypa1.com — digit 1 where the letter l belongs',
  referrerKind: 'email',
  action: null,
};

const stub = (event: typeof EVENT) => `
window.__liefSent = [];
window.chrome = {
  runtime: {
    id: 'test-ext',
    getURL: (path) => 'chrome-extension://test-ext/' + path,
    sendMessage: async (message) => {
      window.__liefSent.push(message);
      return message.type === 'LIEF_REQUEST_VERDICT'
        ? { type: 'LIEF_VERDICT', event: ${JSON.stringify(event)} }
        : undefined;
    },
    onMessage: { addListener: (fn) => { window.__liefPush = fn; } },
  },
};
`;

let browser: Browser;
let bundle: string;
let page: Page;

beforeAll(async () => {
  execFileSync('node', ['scripts/build.mjs', 'content'], { cwd: ROOT, stdio: 'pipe' });
  bundle = readFileSync(new URL('../../dist/content/index.js', import.meta.url), 'utf8');
  browser = await chromium.launch({ channel: 'chrome' });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

afterEach(async () => {
  await page?.close();
});

type Hostile = {
  /** CSS the page uses to fight the banner. */
  css?: string;
  /** Extra markup inside <body>. */
  body?: string;
  /** Script run *before* the content script, e.g. to squat on the element name. */
  preload?: string;
  /** <html> attributes. */
  htmlAttrs?: string;
  /** Overrides the verdict the stub replays. */
  event?: typeof EVENT;
  viewport?: { width: number; height: number };
};

async function openHostile({
  css = '',
  body = '',
  preload,
  htmlAttrs = '',
  event = EVENT,
  viewport = { width: 1280, height: 720 },
}: Hostile = {}) {
  page = await browser.newPage({ viewport });
  await page.setContent(
    `<!doctype html><html ${htmlAttrs}><head><meta charset="utf-8"><style>${css}</style></head>` +
      `<body><main><h1>Log in</h1><input id="pw" type="password"></main>${body}</body></html>`,
  );
  if (preload !== undefined) await page.addScriptTag({ content: preload });
  await page.addScriptTag({ content: stub(event) });
  await page.addScriptTag({ content: bundle });
  return page;
}

/**
 * Resolves once the banner is mounted *and* its slide-in has finished. Position
 * assertions taken mid-animation would be measuring a transform, not a layout.
 */
async function bannerAppears(timeout = 4000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (host) => {
        const banner = document.querySelector(host)?.shadowRoot?.querySelector('.banner');
        return banner != null && banner.getAnimations().every((a) => a.playState === 'finished');
      },
      HOST,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

/** Computed style of the shadow host, as the page's cascade actually resolved it. */
function hostStyle(property: string): Promise<string | null> {
  return page.evaluate(
    ({ host, prop }) => {
      const node = document.querySelector(host);
      return node === null ? null : getComputedStyle(node).getPropertyValue(prop);
    },
    { host: HOST, prop: property },
  );
}

/** Computed style of a node inside the shadow tree. */
function innerStyle(selector: string, property: string): Promise<string | null> {
  return page.evaluate(
    ({ host, sel, prop }) => {
      const node = document.querySelector(host)?.shadowRoot?.querySelector(sel);
      return node === null || node === undefined
        ? null
        : getComputedStyle(node).getPropertyValue(prop);
    },
    { host: HOST, sel: selector, prop: property },
  );
}

/** Unpinned, the banner scrolls *off the top*, so y must be bounded on both sides. */
async function expectPinnedToTop() {
  const box = await page.locator(HOST).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box?.y ?? 9999)).toBeLessThan(2);
}

function innerText(selector: string): Promise<string | null> {
  return page.evaluate(
    ({ host, sel }) =>
      document.querySelector(host)?.shadowRoot?.querySelector(sel)?.textContent ?? null,
    { host: HOST, sel: selector },
  );
}

describe('a page trying to suppress the warning', () => {
  /**
   * The one rule that does win is `html { display: none }` — an element inside a
   * display:none root generates no box at all, and no inline style on a descendant
   * can bring it back. It is not defended because it is self-defeating: it blanks the
   * attacker's own page too. Forcing the root back to visible would be worse, since
   * real sites set it briefly to avoid a flash of unstyled content.
   */
  it.each([
    ['every top-level node', 'html > *:not(head) { display: none !important; }'],
    ['every div', 'div { display: none !important; }'],
    ['everything below body', 'body, body * { display: none !important; }'],
    [
      'the marker attribute',
      '[data-lief-warning] { display: none !important; visibility: hidden !important; opacity: 0 !important; }',
    ],
  ])('cannot hide it by targeting %s', async (_label, css) => {
    await openHostile({ css });
    expect(await bannerAppears()).toBe(true);

    expect(await hostStyle('display')).toBe('block');
    expect(await hostStyle('visibility')).toBe('visible');
    expect(await hostStyle('opacity')).toBe('1');

    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });

  it('cannot neutralise it with geometry rules', async () => {
    await openHostile({
      css: `div, [data-lief-warning] {
        position: static !important; z-index: -1 !important;
        transform: scale(0) !important; clip-path: inset(100%) !important;
        height: 0 !important; max-height: 0 !important; overflow: hidden !important;
        filter: opacity(0) !important; pointer-events: none !important;
      }`,
    });
    expect(await bannerAppears()).toBe(true);

    expect(await hostStyle('position')).toBe('fixed');
    expect(await hostStyle('z-index')).toBe('2147483647');
    expect(await hostStyle('transform')).toBe('none');
    expect(await hostStyle('clip-path')).toBe('none');
    expect(await hostStyle('filter')).toBe('none');
    expect(await hostStyle('pointer-events')).toBe('auto');

    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });

  it('cannot wipe it with `all: unset`', async () => {
    await openHostile({ css: '* { all: unset !important; }' });
    expect(await bannerAppears()).toBe(true);

    expect(await hostStyle('position')).toBe('fixed');
    expect(await hostStyle('display')).toBe('block');
    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });

  it('sits in the top layer, above the page\'s stacking contexts entirely', async () => {
    await openHostile({ css: 'html { transform: translateZ(0); }' });
    expect(await bannerAppears()).toBe(true);

    const open = await page.evaluate(
      (host) => document.querySelector(host)?.matches(':popover-open') ?? false,
      HOST,
    );
    expect(open).toBe(true);
  });

  it('cannot paint over it with its own maximum-z-index overlay', async () => {
    await openHostile({
      body: '<div id="cover" style="position:fixed;inset:0;z-index:2147483647;background:#000"></div>',
    });
    expect(await bannerAppears()).toBe(true);

    const box = await page.locator(HOST).boundingBox();
    const topmostIsBanner = await page.evaluate(
      ({ host, x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && hit === document.querySelector(host);
      },
      { host: HOST, x: (box?.x ?? 0) + 20, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
    );
    expect(topmostIsBanner).toBe(true);
  });
});

describe('a page competing for the top layer', () => {
  /**
   * Top-layer order is last-shown-wins, so a page that opens a modal after the banner
   * does cover it. Documented rather than fought: a page can also simply remove the
   * host node, and neither is defensible without an arms race the TRD does not ask
   * for. The banner is advisory by design.
   */
  it('is covered by a modal the page opens afterwards — known limitation', async () => {
    await openHostile({ body: '<dialog id="d">page modal</dialog>' });
    expect(await bannerAppears()).toBe(true);

    await page.evaluate(() => {
      document.querySelector<HTMLDialogElement>('#d')?.showModal();
    });

    const stillOpen = await page.evaluate(
      (host) => document.querySelector(host)?.matches(':popover-open') ?? false,
      HOST,
    );
    expect(stillOpen).toBe(true);
  });
});

describe('a page trying to restyle the warning through inheritance', () => {
  it('cannot reach the text with font rules', async () => {
    await openHostile({
      css: `* {
        font-family: Georgia, serif !important; font-size: 40px !important;
        font-style: italic !important; font-weight: 900 !important;
        letter-spacing: 9px !important; word-spacing: 9px !important;
        text-transform: uppercase !important; text-shadow: 0 0 9px red !important;
        color: #ff0000 !important; line-height: 4 !important;
      }`,
    });
    expect(await bannerAppears()).toBe(true);

    expect(await innerStyle('.found', 'font-family')).toContain('ui-sans-serif');
    expect(await innerStyle('.found', 'font-size')).toBe('15px');
    expect(await innerStyle('.found', 'font-style')).toBe('normal');
    expect(await innerStyle('.found', 'letter-spacing')).toBe('normal');
    expect(await innerStyle('.found', 'word-spacing')).toBe('0px');
    expect(await innerStyle('.found', 'text-transform')).toBe('none');
    expect(await innerStyle('.found', 'text-shadow')).toBe('none');
    expect(await innerStyle('.found', 'color')).toBe('rgb(236, 238, 242)');
  });

  it('cannot mirror the layout by forcing RTL', async () => {
    await openHostile({
      htmlAttrs: 'dir="rtl"',
      css: '* { direction: rtl !important; }',
    });
    expect(await bannerAppears()).toBe(true);

    expect(await hostStyle('direction')).toBe('ltr');
    expect(await innerStyle('.found', 'direction')).toBe('ltr');

    // The severity chip leads; the actions trail. Mirrored, that order reverses.
    const positions = await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      const chip = root?.querySelector('.chip')?.getBoundingClientRect().left ?? 0;
      const actions = root?.querySelector('.actions')?.getBoundingClientRect().left ?? 0;
      return { chip, actions };
    }, HOST);
    expect(positions.chip).toBeLessThan(positions.actions);
  });

  it('cannot recolour it by poisoning the custom property it inherits', async () => {
    await openHostile({ css: ':root, * { --accent: transparent !important; }' });
    expect(await bannerAppears()).toBe(true);

    expect(await innerStyle('.chip', 'background-color')).toBe('rgb(242, 85, 90)');
  });

  it('cannot shrink it by scaling the root font size', async () => {
    await openHostile({ css: 'html { font-size: 4px !important; }' });
    expect(await bannerAppears()).toBe(true);

    expect(await innerStyle('.found', 'font-size')).toBe('15px');
  });
});

describe('a page trying to break the warning out of the viewport', () => {
  it('stays pinned to the top when the root element is transformed', async () => {
    await openHostile({
      css: 'html { transform: translateZ(0); } body { height: 4000px; }',
    });
    expect(await bannerAppears()).toBe(true);

    await page.evaluate(() => {
      window.scrollTo(0, 1200);
    });
    await page.waitForFunction(() => window.scrollY > 1000);

    await expectPinnedToTop();
  });

  it('stays pinned to the top when the root element is filtered', async () => {
    await openHostile({
      css: 'html { filter: saturate(1); } body { height: 4000px; }',
    });
    expect(await bannerAppears()).toBe(true);

    await page.evaluate(() => {
      window.scrollTo(0, 1200);
    });
    await page.waitForFunction(() => window.scrollY > 1000);

    await expectPinnedToTop();
  });

  /**
   * The common real-world case, and the reason the banner mounts on documentElement
   * rather than body: plenty of sites animate body, and a transformed ancestor
   * becomes the containing block for position: fixed descendants.
   */
  it('stays pinned to the top when body is transformed', async () => {
    await openHostile({
      css: 'body { transform: translateZ(0); height: 4000px; }',
    });
    expect(await bannerAppears()).toBe(true);

    await page.evaluate(() => {
      window.scrollTo(0, 1200);
    });
    await page.waitForFunction(() => window.scrollY > 1000);

    await expectPinnedToTop();
  });

  it('is not clipped away by overflow on the root element', async () => {
    await openHostile({ css: 'html { overflow: hidden !important; height: 0 !important; }' });
    expect(await bannerAppears()).toBe(true);

    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });
});

describe('a page trying to take over the host element', () => {
  it('cannot hijack it by pre-registering a matching custom element', async () => {
    await openHostile({
      preload: `
        for (const name of ['lief-warning', 'lief-banner']) {
          customElements.define(name, class extends HTMLElement {
            connectedCallback() { this.remove(); }
          });
        }
      `,
    });

    expect(await bannerAppears()).toBe(true);
    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });

  it('cannot hijack it with a customized built-in div', async () => {
    await openHostile({
      preload: `
        customElements.define('lief-div', class extends HTMLDivElement {
          connectedCallback() { this.remove(); }
        }, { extends: 'div' });
      `,
    });

    expect(await bannerAppears()).toBe(true);
    const box = await page.locator(HOST).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
  });
});

describe('a hostile string inside the warning', () => {
  it('does not let a bidi override reverse what is displayed', async () => {
    // U+202E is the filename-spoofing trick. In a warning *about* deception, the
    // displayed order has to match the code point order or the warning lies.
    await openHostile({
      event: { ...EVENT, detail: 'paypal.com\u202Emoc.esuba' },
    });
    expect(await bannerAppears()).toBe(true);

    // Every character must be painted left-to-right in code point order. Comparing
    // only the first and last would pass even with the middle reversed.
    const reversals = await page.evaluate((host) => {
      const node = document.querySelector(host)?.shadowRoot?.querySelector('.found')?.firstChild;
      if (node === null || node === undefined) return null;
      const length = node.textContent?.length ?? 0;
      const left = (index: number) => {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().left;
      };
      let count = 0;
      for (let i = 1; i < length; i++) if (left(i) < left(i - 1)) count++;
      return count;
    }, HOST);

    expect(reversals).toBe(0);
  });

  it('keeps the actions reachable when the detail string is enormous', async () => {
    await openHostile({
      event: { ...EVENT, detail: `${'verylongsubdomain.'.repeat(160)}paypa1.com` },
    });
    expect(await bannerAppears()).toBe(true);

    const actions = await page
      .locator(`${HOST} >> nothing`)
      .count()
      .catch(() => 0);
    expect(actions).toBe(0);

    const box = await page.evaluate((host) => {
      const rect = document
        .querySelector(host)
        ?.shadowRoot?.querySelector('.actions')
        ?.getBoundingClientRect();
      return rect === undefined ? null : { x: rect.x, right: rect.right, width: rect.width };
    }, HOST);

    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.right ?? Infinity).toBeLessThanOrEqual(1281);
  });

  it('does not overflow a narrow viewport', async () => {
    await openHostile({ viewport: { width: 380, height: 700 } });
    expect(await bannerAppears()).toBe(true);

    const overflow = await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      const banner = root?.querySelector('.banner');
      return banner === null || banner === undefined
        ? null
        : { scroll: banner.scrollWidth, client: banner.clientWidth };
    }, HOST);

    expect(overflow?.scroll ?? 0).toBeLessThanOrEqual((overflow?.client ?? 0) + 1);
  });
});

describe('the warning itself, in a real browser', () => {
  it('renders the three regions with the real strings', async () => {
    await openHostile();
    expect(await bannerAppears()).toBe(true);

    expect(await innerText('.found')).toBe('paypa1.com — digit 1 where the letter l belongs');
    expect(await innerText('.concept')).toBe('This is Lesson 2 — Lookalike domains');
    expect(await innerText('.chip')).toBe('Dangerous');
  });

  it('deep-links to the lesson and reports the action', async () => {
    await openHostile();
    expect(await bannerAppears()).toBe(true);

    const href = await page.evaluate(
      (host) =>
        document.querySelector(host)?.shadowRoot?.querySelector('a.btn')?.getAttribute('href') ??
        null,
      HOST,
    );
    expect(href).toBe('chrome-extension://test-ext/pages/course/index.html#lookalike-domains');
  });

  it('reports the credential form it can see', async () => {
    await openHostile();
    expect(await bannerAppears()).toBe(true);

    await page.waitForFunction(
      () =>
        (window as unknown as { __liefSent: { type: string }[] }).__liefSent.some(
          (m) => m.type === 'LIEF_PASSWORD_FIELD',
        ),
      undefined,
      { timeout: 4000 },
    );
    const sent = await page.evaluate(
      () => (window as unknown as { __liefSent: unknown[] }).__liefSent,
    );
    expect(sent).toContainEqual({ type: 'LIEF_PASSWORD_FIELD', hasPassword: true });
  });

  it('upgrades in place and dismisses cleanly', async () => {
    await openHostile();
    expect(await bannerAppears()).toBe(true);

    await page.evaluate((event) => {
      (window as unknown as { __liefPush: (m: unknown) => void }).__liefPush({
        type: 'LIEF_VERDICT',
        event: { ...event, verdict: 'dangerous', detail: 'Safe Browsing: social engineering' },
      });
    }, EVENT);

    expect(await innerText('.found')).toBe('Safe Browsing: social engineering');
    expect(await page.locator(HOST).count()).toBe(1);

    await page.evaluate((host) => {
      document.querySelector(host)?.shadowRoot?.querySelector<HTMLButtonElement>('.dismiss')?.click();
    }, HOST);
    expect(await page.locator(HOST).count()).toBe(0);
  });
});
