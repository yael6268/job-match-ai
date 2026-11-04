import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { browser } from 'wxt/browser';
import type { fakeBrowser as FakeBrowserInstance } from 'wxt/testing/fake-browser';
import { db } from '@/db/schema';

// pdfjs-dist 6 uses Promise.try (Chrome 128+). Node 22 lacks it — test-only polyfill.
const P = Promise as unknown as { try?: unknown };
if (!P.try) {
  P.try = <T>(fn: (...a: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) =>
    new Promise<T>((resolve) => resolve(fn(...args)));
}
// Same for Uint8Array.prototype.toHex (Chrome 140+).
const U8 = Uint8Array.prototype as unknown as { toHex?: () => string };
if (!U8.toHex) {
  U8.toHex = function (this: Uint8Array) {
    return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
  };
}

/**
 * WXT's vitest plugin aliases `wxt/browser` to an in-memory fake. Importing `wxt/testing/fake-browser`
 * directly in tests can yield a second instance, so tests always go through this one.
 */
export const fake = browser as unknown as typeof FakeBrowserInstance;

beforeEach(async () => {
  fake.reset();
  await Promise.all(db.tables.map((t) => t.clear()));
});
