import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BannerAction, BannerHandle } from './banner';
import { LESSON_IDS, lessonTitle } from '../lib/lessons';
import { BANNER_HOST_SELECTOR, mountBanner, neutraliseDeceptiveText } from './banner';
import type { RiskEvent } from '../lib/events';

const LOOKALIKE: RiskEvent = {
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

function mount(event: RiskEvent = LOOKALIKE, overrides: Partial<Parameters<typeof mountBanner>[1]> = {}) {
  const onAction = vi.fn<(action: BannerAction, event: RiskEvent) => void>();
  const handle = mountBanner(event, {
    protocol: 'https:',
    lessonUrl: (lessonId) => `chrome-extension://abc/pages/course/index.html#${lessonId}`,
    onAction,
    ...overrides,
  });
  return { handle, onAction, root: handle.root };
}

function text(root: ShadowRoot, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

let mounted: BannerHandle | null = null;

afterEach(() => {
  mounted?.remove();
  mounted = null;
  document.querySelectorAll(BANNER_HOST_SELECTOR).forEach((node) => {
    node.remove();
  });
});

describe('neutraliseDeceptiveText', () => {
  it.each([
    ['bidi override', 'paypal.com\u202Emoc.esuba', 'paypal.com\uFFFDmoc.esuba'],
    ['isolates', 'a\u2066b\u2069c', 'a\uFFFDb\uFFFDc'],
    ['zero-width space', 'goo\u200Bgle.com', 'goo\uFFFDgle.com'],
    ['soft hyphen', 'pay\u00ADpal.com', 'pay\uFFFDpal.com'],
    ['byte order mark', '\uFEFFpaypal.com', '\uFFFDpaypal.com'],
    ['control character', 'pay\u0007pal.com', 'pay\uFFFDpal.com'],
  ])('replaces %s with a visible marker', (_label, input, expected) => {
    expect(neutraliseDeceptiveText(input)).toBe(expected);
  });

  it.each([
    'paypa1.com — digit 1 where the letter l belongs',
    'münchen.de',
    'xn--80ak6aa92e.com',
    'line one\nline two\ttabbed',
  ])('leaves legitimate text untouched: %j', (input) => {
    expect(neutraliseDeceptiveText(input)).toBe(input);
  });
});

describe('mountBanner', () => {
  it('attaches an open shadow root to document.documentElement', () => {
    const { handle } = mount();
    mounted = handle;

    expect(handle.host.tagName.toLowerCase()).toBe('div');
    expect(handle.host.matches(BANNER_HOST_SELECTOR)).toBe(true);
    expect(handle.host.parentElement).toBe(document.documentElement);
    expect(handle.host.shadowRoot).toBe(handle.root);
    expect(handle.root.mode).toBe('open');
  });

  it('uses a div, which a page cannot upgrade into its own custom element', () => {
    const { handle } = mount();
    mounted = handle;

    // A hyphenated tag is a custom element name. Define it first and the page's
    // connectedCallback runs on our host and can remove the warning outright.
    expect(handle.host.tagName.toLowerCase()).toBe('div');
    expect(handle.host.tagName).not.toContain('-');
    expect(handle.host.hasAttribute('is')).toBe(false);
  });

  it('pins its geometry with inline !important so page CSS cannot hide it', () => {
    const { handle } = mount();
    mounted = handle;

    for (const property of ['position', 'z-index', 'display', 'visibility', 'opacity']) {
      expect(handle.host.style.getPropertyPriority(property)).toBe('important');
    }
    expect(handle.host.style.getPropertyValue('position')).toBe('fixed');
    expect(handle.host.style.getPropertyValue('z-index')).toBe('2147483647');
  });

  it('pins typography inline too, because font inherits across the shadow boundary', () => {
    const { handle } = mount();
    mounted = handle;

    // `* { font-family: Georgia !important }` on the host page beats a :host rule and
    // then inherits into every line of the warning. Only inline !important stops it.
    expect(handle.host.style.getPropertyPriority('font-family')).toBe('important');
    expect(handle.host.style.getPropertyValue('font-family')).toContain('ui-sans-serif');
    expect(handle.host.style.getPropertyPriority('font-size')).toBe('important');
    expect(handle.host.style.getPropertyPriority('line-height')).toBe('important');

    // `all: initial` does not reset these two — the spec excludes them.
    expect(handle.host.style.getPropertyValue('direction')).toBe('ltr');
    expect(handle.host.style.getPropertyPriority('direction')).toBe('important');
    expect(handle.host.style.getPropertyPriority('unicode-bidi')).toBe('important');
  });

  it('renders the three regions in the order the TRD fixes', () => {
    const { handle, root } = mount();
    mounted = handle;

    const banner = root.querySelector('.banner');
    const regions = [...(banner?.children ?? [])].map((node) => node.className);
    expect(regions).toEqual(['chip', 'body', 'actions', 'dismiss']);

    const body = [...(root.querySelector('.body')?.children ?? [])].map((node) => node.className);
    expect(body).toEqual(['found', 'concept', 'padlock']);
  });

  it('leads with the detail string, which is the teaching payload', () => {
    const { handle, root } = mount();
    mounted = handle;

    expect(text(root, '.found')).toBe('paypa1.com — digit 1 where the letter l belongs');
  });

  it('names the concept and its lesson number', () => {
    const { handle, root } = mount();
    mounted = handle;

    expect(text(root, '.concept')).toBe('This is Lesson 2 — Lookalike domains');
  });

  it('takes the name and number straight from the shared registry', () => {
    // The seam. If the banner and the course ever disagree on what Lesson 2 is
    // called, the demo's whole argument — the vocabulary reappearing unprompted —
    // stops working.
    const { handle, root } = mount({ ...LOOKALIKE, lessonId: 'url-anatomy' });
    mounted = handle;

    expect(text(root, '.concept')).toBe(
      `This is Lesson ${LESSON_IDS.indexOf('url-anatomy') + 1} — ${lessonTitle('url-anatomy')}`,
    );
  });

  it('deep-links "Show me why" to the lesson', () => {
    const { handle, root } = mount();
    mounted = handle;

    const link = root.querySelector<HTMLAnchorElement>('a.btn');
    expect(link?.getAttribute('href')).toBe(
      'chrome-extension://abc/pages/course/index.html#lookalike-domains',
    );
    expect(link?.target).toBe('_blank');
  });

  it('degrades "Show me why" to a plain control when no deep link is available', () => {
    const { handle, root, onAction } = mount(LOOKALIKE, { lessonUrl: () => null });
    mounted = handle;

    const link = root.querySelector<HTMLAnchorElement>('a.btn');
    expect(link?.hasAttribute('href')).toBe(false);

    link?.click();
    expect(onAction).toHaveBeenCalledWith('learned', LOOKALIKE);
  });

  it('reports every action so the event can record it', () => {
    const { handle, root, onAction } = mount();
    mounted = handle;

    root.querySelector<HTMLButtonElement>('button.btn-primary')?.click();
    root.querySelector<HTMLAnchorElement>('a.btn')?.click();
    root.querySelector<HTMLButtonElement>('.dismiss')?.click();

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'left',
      'learned',
      'dismissed',
    ]);
  });

  it('is announced to assistive tech and dismissible by keyboard', () => {
    const { handle, root } = mount();
    mounted = handle;

    expect(root.querySelector('.banner')?.getAttribute('role')).toBe('alert');
    expect(root.querySelector('.dismiss')?.getAttribute('aria-label')).toBe(
      'Dismiss this warning',
    );
  });

  describe('the padlock line', () => {
    it('appears on a flagged HTTPS page', () => {
      const { handle, root } = mount();
      mounted = handle;

      const padlock = root.querySelector<HTMLElement>('.padlock');
      expect(padlock?.hidden).toBe(false);
      expect(padlock?.textContent).toContain('encrypted, not that the site is honest');
    });

    it('stays hidden on HTTP, where there is no padlock to explain', () => {
      const { handle, root } = mount(LOOKALIKE, { protocol: 'http:' });
      mounted = handle;

      expect(root.querySelector<HTMLElement>('.padlock')?.hidden).toBe(true);
    });

    it('stays hidden on a safe verdict', () => {
      const { handle, root } = mount({ ...LOOKALIKE, verdict: 'safe' });
      mounted = handle;

      expect(root.querySelector<HTMLElement>('.padlock')?.hidden).toBe(true);
    });
  });

  describe('update', () => {
    it('upgrades severity in place rather than remounting', () => {
      const { handle, root } = mount({ ...LOOKALIKE, verdict: 'suspicious' });
      mounted = handle;

      const before = handle.host;
      expect(root.querySelector('.banner')?.getAttribute('data-verdict')).toBe('suspicious');
      expect(text(root, '.chip')).toBe('Suspicious');

      handle.update({
        ...LOOKALIKE,
        verdict: 'dangerous',
        source: 'safebrowsing',
        detail: 'Google Safe Browsing flagged this page as social engineering',
      });

      expect(handle.host).toBe(before);
      expect(document.querySelectorAll(BANNER_HOST_SELECTOR)).toHaveLength(1);
      expect(root.querySelector('.banner')?.getAttribute('data-verdict')).toBe('dangerous');
      expect(text(root, '.chip')).toBe('Dangerous');
      expect(text(root, '.found')).toBe(
        'Google Safe Browsing flagged this page as social engineering',
      );
    });

    it('reports actions against the updated event, not the one it mounted with', () => {
      const { handle, root, onAction } = mount({ ...LOOKALIKE, verdict: 'suspicious' });
      mounted = handle;

      const upgraded: RiskEvent = { ...LOOKALIKE, id: 'evt-2', verdict: 'dangerous' };
      handle.update(upgraded);
      root.querySelector<HTMLButtonElement>('.dismiss')?.click();

      expect(onAction).toHaveBeenCalledWith('dismissed', upgraded);
    });
  });

  it('renders a hostile hostname as text, never as markup', () => {
    const hostile = '<img src=x onerror="alert(1)"> paypa1.com';
    const { handle, root } = mount({ ...LOOKALIKE, detail: hostile });
    mounted = handle;

    const found = root.querySelector('.found');
    expect(found?.querySelector('img')).toBeNull();
    expect(found?.children).toHaveLength(0);
    expect(found?.textContent).toBe(hostile);
  });

  it('neutralises a bidi override in the detail string', () => {
    const { handle, root } = mount({ ...LOOKALIKE, detail: 'paypal.com\u202Emoc.esuba' });
    mounted = handle;

    expect(text(root, '.found')).toBe('paypal.com\uFFFDmoc.esuba');
  });

  it('detaches on remove', () => {
    const { handle } = mount();
    handle.remove();

    expect(document.querySelectorAll(BANNER_HOST_SELECTOR)).toHaveLength(0);
  });
});
