import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BannerAction, BannerHandle } from './banner';
import { BANNER_TAG, mountBanner } from './banner';
import type { RiskEvent } from './contracts';

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
  document.querySelectorAll(BANNER_TAG).forEach((node) => {
    node.remove();
  });
});

describe('mountBanner', () => {
  it('attaches an open shadow root to document.documentElement', () => {
    const { handle } = mount();
    mounted = handle;

    expect(handle.host.tagName.toLowerCase()).toBe(BANNER_TAG);
    expect(handle.host.parentElement).toBe(document.documentElement);
    expect(handle.host.shadowRoot).toBe(handle.root);
    expect(handle.root.mode).toBe('open');
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

    expect(text(root, '.concept')).toBe('This is Lesson 2 — Homoglyphs, typosquats, punycode');
  });

  it('trims the em-dash gloss off registry titles so the line reads once', () => {
    const { handle, root } = mount({ ...LOOKALIKE, lessonId: 'url-anatomy' });
    mounted = handle;

    expect(text(root, '.concept')).toBe('This is Lesson 1 — Anatomy of a URL');
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
      expect(document.querySelectorAll(BANNER_TAG)).toHaveLength(1);
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

  it('detaches on remove', () => {
    const { handle } = mount();
    handle.remove();

    expect(document.querySelectorAll(BANNER_TAG)).toHaveLength(0);
  });
});
