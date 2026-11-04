// Shared HTTP helper for job sources: timeout, one retry, readable errors, JSON parsing.
import { sleep } from '@/shared/utils';

export const SOURCE_TIMEOUT_MS = 20_000;
/** Extra attempts after a transient failure (timeout, network error, 429, 5xx). */
export const SOURCE_RETRIES = 1;
export const SOURCE_RETRY_DELAY_MS = 2_000;

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A failure that may succeed if tried again (slow or flaky server, dropped connection). */
class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

function isTransient(e: unknown): boolean {
  if (e instanceof TransientError) return true;
  return e instanceof HttpError && (e.status === 429 || e.status >= 500);
}

/** One attempt. The timeout covers the whole request, including reading the body. */
async function fetchJsonOnce(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const timedOut = () => new TransientError(`תם הזמן (${timeoutMs / 1000} שניות) בלי תשובה`);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) throw timedOut();
      throw new TransientError('שגיאת רשת — אין חיבור או שהשרת לא זמין');
    }
    if (res.status === 404) throw new HttpError('הלוח לא נמצא (404) — בדקי את מזהה החברה', 404);
    if (!res.ok) throw new HttpError(`השרת החזיר שגיאה ${res.status}`, res.status);
    try {
      return (await res.json()) as unknown;
    } catch {
      // A body cut off by our timeout is transient; a complete but broken body is not.
      if (ctrl.signal.aborted) throw timedOut();
      throw new Error('התשובה מהשרת אינה JSON תקין');
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a URL and parse JSON. Each attempt has its own timeout; transient failures are retried
 * `SOURCE_RETRIES` times after a short delay. Throws HttpError (with status) or Error with a Hebrew message.
 */
export async function fetchJson(url: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJsonOnce(url, timeoutMs);
    } catch (e) {
      if (attempt >= SOURCE_RETRIES || !isTransient(e)) throw e;
      console.warn(`[http] retrying after: ${(e as Error).message}`);
      await sleep(SOURCE_RETRY_DELAY_MS);
    }
  }
}

/** Map items one by one; a bad item is skipped and logged, never fails the whole company. */
export function mapSafely<T, R>(items: T[], map: (item: T) => R | null, label: string): R[] {
  const out: R[] = [];
  for (const item of items) {
    try {
      const r = map(item);
      if (r) out.push(r);
    } catch (e) {
      console.warn(`[${label}] skipped a job item`, e);
    }
  }
  return out;
}

export function toIso(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Join non-empty, de-duplicated parts (case-insensitive). */
export function joinUnique(parts: (string | undefined | null)[], sep = ' · '): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p?.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.join(sep);
}
