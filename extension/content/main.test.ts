import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BANNER_HOST_SELECTOR } from './banner';
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

type Sent = { type: string; [key: string]: unknown };

function installChrome() {
  const listeners: ((message: unknown) => void)[] = [];
  let replay: unknown;

  const sendMessage = vi.fn(async (message: Sent): Promise<unknown> =>
    message.type === 'LIEF_REQUEST_VERDICT' ? replay : undefined,
  );

  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-ext-id',
      getURL: (path: string) => `chrome-extension://test-ext-id/${path}`,
      sendMessage,
      onMessage: {
        addListener: (fn: (message: unknown) => void) => {
          listeners.push(fn);
        },
      },
    },
  });

  return {
    sendMessage,
    sentTypes: () => sendMessage.mock.calls.map(([message]) => message.type),
    sentOf: (type: string) =>
      sendMessage.mock.calls.map(([message]) => message).filter((m) => m.type === type),
    /** Background pushes a verdict at the content script. */
    push: (message: unknown) => {
      for (const fn of listeners) fn(message);
    },
    /** Background has a verdict waiting for the replay request. */
    setReplay: (value: unknown) => {
      replay = value;
    },
  };
}

function shadow(): ShadowRoot | null {
  return document.querySelector(BANNER_HOST_SELECTOR)?.shadowRoot ?? null;
}

function banners(): number {
  return document.querySelectorAll(BANNER_HOST_SELECTOR).length;
}

let loaded: typeof import('./main') | null = null;

async function load() {
  loaded = await import('./main');
  return loaded;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  // Before resetModules cuts the reference: this instance's observer is attached to
  // the shared jsdom document and would keep reporting into the next test's stub.
  loaded?.resetForTests();
  loaded = null;
  vi.unstubAllGlobals();
  document.querySelectorAll(BANNER_HOST_SELECTOR).forEach((node) => {
    node.remove();
  });
  document.body.replaceChildren();
});

describe('the load-order race', () => {
  it('asks the background for a verdict the moment it starts', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();

    expect(harness.sentTypes()).toContain('LIEF_REQUEST_VERDICT');
  });

  it('slow page: nothing to replay, the pushed verdict renders the banner', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    await vi.waitFor(() => {
      expect(harness.sentTypes()).toContain('LIEF_REQUEST_VERDICT');
    });
    expect(banners()).toBe(0);

    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });

    expect(banners()).toBe(1);
    expect(shadow()?.querySelector('.found')?.textContent).toBe(LOOKALIKE.detail);
  });

  it('fast page: the verdict was already sent and lost, the replay renders it', async () => {
    const harness = installChrome();
    harness.setReplay({ type: 'LIEF_VERDICT', event: LOOKALIKE });
    const { start } = await load();

    start();

    await vi.waitFor(() => {
      expect(banners()).toBe(1);
    });
  });

  it('both arriving leaves exactly one banner', async () => {
    const harness = installChrome();
    harness.setReplay({ type: 'LIEF_VERDICT', event: LOOKALIKE });
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });
    await vi.waitFor(() => {
      expect(banners()).toBe(1);
    });

    expect(banners()).toBe(1);
  });

  it('accepts a bare RiskEvent replay, since Track A has not pinned the reply shape', async () => {
    const harness = installChrome();
    harness.setReplay(LOOKALIKE);
    const { start } = await load();

    start();

    await vi.waitFor(() => {
      expect(banners()).toBe(1);
    });
  });
});

describe('what the content script refuses to render', () => {
  it('a safe verdict', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: { ...LOOKALIKE, verdict: 'safe' } });

    expect(banners()).toBe(0);
  });

  it('a malformed event', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: { id: 7, verdict: 'dangerous' } });
    harness.push({ type: 'LIEF_VERDICT', event: { ...LOOKALIKE, lessonId: 'not-a-lesson' } });
    harness.push('nonsense');

    expect(banners()).toBe(0);
  });
});

describe('actions', () => {
  it('posts LIEF_ACTION for each one so the event stops reading null', async () => {
    const harness = installChrome();
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });

    shadow()?.querySelector<HTMLButtonElement>('button.btn-primary')?.click();
    shadow()?.querySelector<HTMLAnchorElement>('a.btn')?.click();
    shadow()?.querySelector<HTMLButtonElement>('.dismiss')?.click();

    expect(harness.sentOf('LIEF_ACTION')).toEqual([
      { type: 'LIEF_ACTION', eventId: 'evt-1', action: 'left' },
      { type: 'LIEF_ACTION', eventId: 'evt-1', action: 'learned' },
      { type: 'LIEF_ACTION', eventId: 'evt-1', action: 'dismissed' },
    ]);
  });

  it('leaves the banner up on "leave", because back() may be a no-op', async () => {
    const harness = installChrome();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });
    shadow()?.querySelector<HTMLButtonElement>('button.btn-primary')?.click();

    expect(back).toHaveBeenCalledOnce();
    expect(banners()).toBe(1);
  });

  it('keeps a dismissal sticky against a later severity upgrade', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: { ...LOOKALIKE, verdict: 'suspicious' } });
    shadow()?.querySelector<HTMLButtonElement>('.dismiss')?.click();
    expect(banners()).toBe(0);

    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });

    expect(banners()).toBe(0);
  });

  it('upgrades an open banner in place when Safe Browsing lands', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: { ...LOOKALIKE, verdict: 'suspicious' } });
    const host = document.querySelector(BANNER_HOST_SELECTOR);

    harness.push({
      type: 'LIEF_VERDICT',
      event: { ...LOOKALIKE, verdict: 'dangerous', source: 'safebrowsing' },
    });

    expect(banners()).toBe(1);
    expect(document.querySelector(BANNER_HOST_SELECTOR)).toBe(host);
    expect(shadow()?.querySelector('.banner')?.getAttribute('data-verdict')).toBe('dangerous');
  });

  it('deep-links "Show me why" through chrome.runtime.getURL', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    harness.push({ type: 'LIEF_VERDICT', event: LOOKALIKE });

    expect(shadow()?.querySelector('a.btn')?.getAttribute('href')).toBe(
      'chrome-extension://test-ext-id/pages/course/index.html#lookalike-domains',
    );
  });
});

describe('password-field observation', () => {
  it('reports a credential form so the background can decide H3', async () => {
    const harness = installChrome();
    const input = document.createElement('input');
    input.type = 'password';
    document.body.append(input);
    const { start } = await load();

    start();

    await vi.waitFor(() => {
      expect(harness.sentOf('LIEF_PASSWORD_FIELD')).toEqual([
        { type: 'LIEF_PASSWORD_FIELD', hasPassword: true },
      ]);
    });
  });

  it('reports the absence exactly once, not on every mutation', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    document.body.append(document.createElement('div'));
    document.body.append(document.createElement('span'));

    await vi.waitFor(() => {
      expect(harness.sentOf('LIEF_PASSWORD_FIELD')).toHaveLength(1);
    });
    expect(harness.sentOf('LIEF_PASSWORD_FIELD')).toEqual([
      { type: 'LIEF_PASSWORD_FIELD', hasPassword: false },
    ]);
  });

  it('catches a login form that mounts after document_idle', async () => {
    const harness = installChrome();
    const { start } = await load();

    start();
    await vi.waitFor(() => {
      expect(harness.sentOf('LIEF_PASSWORD_FIELD')).toHaveLength(1);
    });

    const input = document.createElement('input');
    input.type = 'password';
    document.body.append(input);

    await vi.waitFor(() => {
      expect(harness.sentOf('LIEF_PASSWORD_FIELD')).toHaveLength(2);
    });
    expect(harness.sentOf('LIEF_PASSWORD_FIELD')[1]).toEqual({
      type: 'LIEF_PASSWORD_FIELD',
      hasPassword: true,
    });
  });
});

describe('degradation', () => {
  it('survives a background that is not listening', async () => {
    const harness = installChrome();
    harness.sendMessage.mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    const { start } = await load();

    expect(() => {
      start();
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(harness.sentTypes()).toContain('LIEF_REQUEST_VERDICT');
    });
    expect(banners()).toBe(0);
  });

  it('does nothing at all outside an extension runtime', async () => {
    vi.stubGlobal('chrome', undefined);
    const { start } = await load();

    expect(() => {
      start();
    }).not.toThrow();
    expect(banners()).toBe(0);
  });
});
