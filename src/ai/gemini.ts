// Gemini REST client. M1: model listing + key test. The match call, retries, rate limit and
// daily cap are added in M4 (SPEC.md section 8.1).
// The API key is only ever sent in the x-goog-api-key header — never in URLs, never logged.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 20_000;

export interface GeminiModel {
  /** id without the "models/" prefix, e.g. "gemini-2.5-flash" */
  id: string;
  displayName: string;
  isFlash: boolean;
}

interface RawModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/** Keep models that support generateContent; flag Flash ones. Pure, for testing. */
export function parseModels(body: unknown): GeminiModel[] {
  const list = (body as { models?: RawModel[] } | null)?.models;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => {
      const id = m.name!.replace(/^models\//, '');
      return { id, displayName: m.displayName || id, isFlash: /flash/i.test(id) };
    })
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
}

/** Hebrew, user-facing explanation of a failed Gemini HTTP response. Pure, for testing. */
export function describeGeminiError(status: number, body: string): string {
  let apiMsg = '';
  try {
    apiMsg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* body was not JSON */
  }
  const detail = apiMsg ? ` (${apiMsg})` : '';
  if (status === 400 && /api key/i.test(apiMsg)) return `מפתח ה-API אינו תקין${detail}`;
  if (status === 400) return `הבקשה נדחתה${detail}`;
  if (status === 401 || status === 403) return `אין הרשאה — בדקי שהמפתח נכון ושה-API מופעל${detail}`;
  if (status === 404) return `המודל לא נמצא — בחרי מודל אחר מהרשימה${detail}`;
  if (status === 429) return `חרגת ממכסת הקריאות — נסי שוב מאוחר יותר${detail}`;
  if (status >= 500) return `שגיאת שרת בגוגל (${status}) — נסי שוב בעוד כמה דקות`;
  return `שגיאה ${status}${detail}`;
}

async function geminiFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<unknown> {
  if (!apiKey.trim()) throw new Error('לא הוזן מפתח API');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': apiKey.trim(), 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('הבקשה ל-Gemini לקחה יותר מדי זמן');
    throw new Error('אין חיבור לאינטרנט או ש-Gemini לא זמין');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(describeGeminiError(res.status, text));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('תשובה לא צפויה מ-Gemini');
  }
}

export async function listModels(apiKey: string): Promise<GeminiModel[]> {
  return parseModels(await geminiFetch('/models?pageSize=1000', apiKey));
}

/**
 * One tiny call to confirm the key works. With a model chosen it runs a real generateContent;
 * otherwise it only lists models (which also validates the key).
 */
export async function testKey(apiKey: string, model: string): Promise<string> {
  if (!model) {
    const models = await listModels(apiKey);
    return `המפתח תקין — נמצאו ${models.length} מודלים. בחרי מודל.`;
  }
  await geminiFetch(`/models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
      generationConfig: { maxOutputTokens: 16, temperature: 0 },
    }),
  });
  return `המפתח תקין והמודל ${model} עונה`;
}
