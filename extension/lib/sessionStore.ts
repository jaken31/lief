/**
 * sessionStore.ts — per-tab state that must survive a service worker restart.
 *
 * THE dominant runtime constraint in this build: an MV3 service worker unloads
 * after ~30s idle and takes every module-level variable with it. A `Map` at
 * module scope looks correct, passes every local test, and then silently
 * empties itself between two navigations on stage.
 *
 * So the tabId → RiskEvent replay map (TRD §4) lives here, in
 * chrome.storage.session. Nothing in this file is user data — it is cleared
 * when the browser closes and never written to storage.local.
 */

import type { RiskEvent } from './events';
import type { Result } from './types';
import { err, ok } from './types';

const K_VERDICT = 'lief:tabverdict';
const K_PREV = 'lief:tabprev';
const K_PASSWORD = 'lief:tabpw';

type Bag<T> = Record<string, T>;

async function read<T>(key: string): Promise<Bag<T>> {
  const bag = await chrome.storage.session.get(key);
  const raw = bag[key];
  return raw && typeof raw === 'object' ? (raw as Bag<T>) : {};
}

async function write<T>(key: string, value: Bag<T>): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

async function put<T>(key: string, tabId: number, value: T): Promise<Result<true>> {
  try {
    const bag = await read<T>(key);
    bag[String(tabId)] = value;
    await write(key, bag);
    return ok(true);
  } catch (e) {
    return err({ kind: 'storage', detail: String(e) });
  }
}

async function take<T>(key: string, tabId: number): Promise<T | null> {
  try {
    const bag = await read<T>(key);
    return bag[String(tabId)] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verdict replay map — answers LIEF_REQUEST_VERDICT
// ---------------------------------------------------------------------------

/**
 * The load-order race, both directions (TRD §4):
 *
 *   Fast page: verdict is ready before the content script mounts → the
 *              sendMessage is lost → the script asks, and we replay from here.
 *   Slow page: the script mounts first and asks → nothing here yet → the
 *              later sendMessage reaches a live listener.
 *
 * Omit this half and the banner intermittently fails on cached pages, which is
 * the hardest class of bug to debug live.
 */
export const setTabVerdict = (tabId: number, event: RiskEvent) =>
  put<RiskEvent>(K_VERDICT, tabId, event);

export const getTabVerdict = (tabId: number) => take<RiskEvent>(K_VERDICT, tabId);

export async function clearTabVerdict(tabId: number): Promise<void> {
  try {
    const bag = await read<RiskEvent>(K_VERDICT);
    delete bag[String(tabId)];
    await write(K_VERDICT, bag);
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Previous host per tab — powers referrerKind (entry-point analysis)
// ---------------------------------------------------------------------------

export const setTabPrevHost = (tabId: number, host: string) =>
  put<string>(K_PREV, tabId, host);

export const getTabPrevHost = (tabId: number) => take<string>(K_PREV, tabId);

// ---------------------------------------------------------------------------
// Password-field observation per tab — feeds H3
// ---------------------------------------------------------------------------

export const setTabPassword = (tabId: number, hasPassword: boolean) =>
  put<boolean>(K_PASSWORD, tabId, hasPassword);

export const getTabPassword = async (tabId: number) =>
  (await take<boolean>(K_PASSWORD, tabId)) ?? false;

// ---------------------------------------------------------------------------

/** Called on chrome.tabs.onRemoved so the bags do not grow for a whole session. */
export async function forgetTab(tabId: number): Promise<void> {
  const id = String(tabId);
  for (const key of [K_VERDICT, K_PREV, K_PASSWORD]) {
    try {
      const bag = await read<unknown>(key);
      delete bag[id];
      await write(key, bag);
    } catch {
      /* non-fatal */
    }
  }
}
