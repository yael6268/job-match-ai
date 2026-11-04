// Shared HTTP helper for job sources: timeout, readable errors, JSON parsing.

export const SOURCE_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

/** GET a URL and parse JSON. Throws HttpError (with status) or Error with a Hebrew message. */
export async function fetchJson(url: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`תם הזמן (${timeoutMs / 1000} שניות) בלי תשובה`);
    throw new Error('שגיאת רשת — אין חיבור או שהשרת לא זמין');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new HttpError('הלוח לא נמצא (404) — בדקי את מזהה החברה', 404);
  if (!res.ok) throw new HttpError(`השרת החזיר שגיאה ${res.status}`, res.status);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new Error('התשובה מהשרת אינה JSON תקין');
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
