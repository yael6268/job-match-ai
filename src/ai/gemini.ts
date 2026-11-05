// Gemini REST client (SPEC.md section 8.1): model listing, key test, and the match call with
// structured output, zod validation + one retry, a minimum delay between calls, backoff on 429/503,
// and a per-call hook the run uses for the daily cap.
// The API key is only ever sent in the x-goog-api-key header — never in URLs, never logged.
import type { CV, Job } from '@/shared/types';
import { sleep as realSleep } from '@/shared/utils';
import { buildMatchPrompt, buildReferralPrompt, MATCH_SYSTEM_INSTRUCTION, REFERRAL_SYSTEM_INSTRUCTION, type ReferralInput } from './prompts';
import {
  extractJson, matchResponseSchema, parseMatchOutput, parseReferralOutput, referralResponseSchema,
  type MatchOutput, type ReferralOutput,
} from './schemas';

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

/** A non-2xx Gemini response. `message` is the Hebrew explanation from describeGeminiError. */
export class GeminiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

async function geminiFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  if (!apiKey.trim()) throw new Error('לא הוזן מפתח API');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
  if (!res.ok) throw new GeminiHttpError(describeGeminiError(res.status, text), res.status);
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

// ---------- match call ----------

/** Generation can take a while for long prompts; listing/testing keeps the short timeout. */
const GENERATE_TIMEOUT_MS = 60_000;
/** Waits after HTTP 429/503 before trying again (SPEC.md 8.1). */
export const BACKOFF_MS = [5_000, 15_000, 45_000];

/** Thrown by the run's beforeCall hook when today's call limit is used up. */
export class CallBudgetExhausted extends Error {
  constructor() {
    super('הגעת למגבלת קריאות ה-AI היומית — המשרות שנותרו ינותחו בריצה הבאה');
    this.name = 'CallBudgetExhausted';
  }
}

/** 429/503 kept coming after every backoff: leave the job queued for a later run. */
export class AiRetryLater extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRetryLater';
  }
}

/** The model returned output that failed validation twice: skip this job ("ai_failed"). */
export class AiInvalidOutput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiInvalidOutput';
  }
}

export interface MatcherOptions {
  apiKey: string;
  model: string;
  /** Minimum time between the start of two calls. */
  minDelayMs: number;
  /** Called before every HTTP attempt; counts the call and throws CallBudgetExhausted at the cap. */
  beforeCall: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AiMatcher {
  readonly model: string;
  match(
    job: Pick<Job, 'title' | 'company' | 'location' | 'descriptionText'>,
    cvs: Pick<CV, 'id' | 'name' | 'domains' | 'redactedText'>[],
  ): Promise<MatchOutput>;
}

export function createGeminiMatcher(opts: MatcherOptions): AiMatcher {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  let lastCallAt: number | undefined;

  const rateLimit = async () => {
    if (lastCallAt !== undefined) {
      const wait = opts.minDelayMs - (now() - lastCallAt);
      if (wait > 0) await sleep(wait);
    }
    lastCallAt = now();
  };

  /** One logical request: rate limit, count, send; back off and resend on 429/503. */
  const generate = async (body: string): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      await opts.beforeCall();
      await rateLimit();
      try {
        return await geminiFetch(
          `/models/${encodeURIComponent(opts.model)}:generateContent`,
          opts.apiKey,
          { method: 'POST', body },
          GENERATE_TIMEOUT_MS,
        );
      } catch (e) {
        const transient = e instanceof GeminiHttpError && (e.status === 429 || e.status === 503);
        if (!transient) throw e;
        if (attempt >= BACKOFF_MS.length) throw new AiRetryLater(e.message);
        await sleep(BACKOFF_MS[attempt]!);
      }
    }
  };

  return {
    model: opts.model,
    async match(job, cvs) {
      const ids = cvs.map((c) => c.id);
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: MATCH_SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: buildMatchPrompt(job, cvs) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: matchResponseSchema(ids),
        },
      });
      let lastProblem = '';
      // Invalid output: retry once, then give up on this job.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await generate(body);
        try {
          return parseMatchOutput(extractJson(response), ids);
        } catch (e) {
          lastProblem = (e as Error).message;
        }
      }
      throw new AiInvalidOutput(lastProblem);
    },
  };
}

// ---------- referral email ----------

/**
 * One user-initiated call (a button on the job card): structured output, zod validation, one retry
 * on invalid output. Not part of a run, so it does not count against the run's daily cap.
 */
export async function generateReferralEmail(opts: { apiKey: string; model: string; input: ReferralInput }): Promise<ReferralOutput> {
  if (!opts.model) throw new Error('לא נבחר מודל Gemini (הגדרות ← Gemini)');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: REFERRAL_SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildReferralPrompt(opts.input) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: referralResponseSchema },
  });
  let problem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await geminiFetch(
      `/models/${encodeURIComponent(opts.model)}:generateContent`,
      opts.apiKey,
      { method: 'POST', body },
      GENERATE_TIMEOUT_MS,
    );
    try {
      return parseReferralOutput(extractJson(res));
    } catch (e) {
      problem = (e as Error).message;
    }
  }
  throw new Error(`Gemini לא החזיר טיוטה תקינה (${problem}) — נסי שוב`);
}
