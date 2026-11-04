import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiInvalidOutput, AiRetryLater, BACKOFF_MS, CallBudgetExhausted, createGeminiMatcher, type MatcherOptions,
} from '@/ai/gemini';
import { buildMatchPrompt, MATCH_SYSTEM_INSTRUCTION } from '@/ai/prompts';
import { extractJson, matchResponseSchema, parseMatchOutput } from '@/ai/schemas';

const FAKE_KEY = 'test-key-not-real';
const job = { title: 'QA Automation Engineer', company: 'Acme', location: 'Tel Aviv', descriptionText: 'Selenium, Python' };
const cvs = [
  { id: 'cv-qa', name: 'QA', domains: ['QA'], redactedText: 'REDACTED QA CV', text: 'SECRET PHONE 050-0000000' },
  { id: 'cv-be', name: 'Backend', domains: ['Backend'], redactedText: 'REDACTED BACKEND CV', text: 'SECRET' },
];
const good = { score: 82, bestCvId: 'cv-qa', requiredYears: 2, reasons: ['התאמה טובה'], tips: ['להדגיש Selenium'] };

afterEach(() => vi.unstubAllGlobals());

/** A generateContent response whose text part is `payload` (object -> JSON). */
function geminiResponse(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
}

function stubSequence(...responses: { status: number; body: unknown }[]) {
  let i = 0;
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function matcher(over: Partial<MatcherOptions> = {}) {
  const sleeps: number[] = [];
  let calls = 0;
  const m = createGeminiMatcher({
    apiKey: FAKE_KEY,
    model: 'example-flash-2',
    minDelayMs: 0,
    beforeCall: async () => { calls++; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...over,
  });
  return { m, sleeps, calls: () => calls };
}

describe('parseMatchOutput (zod)', () => {
  it('accepts valid output and rounds the score', () => {
    expect(parseMatchOutput({ ...good, score: 81.6 }, ['cv-qa']).score).toBe(82);
    expect(parseMatchOutput({ ...good, requiredYears: null }, ['cv-qa']).requiredYears).toBeNull();
  });

  it.each([
    ['missing tips', { ...good, tips: undefined }],
    ['empty reasons', { ...good, reasons: [] }],
    ['score out of range', { ...good, score: 140 }],
    ['score as text', { ...good, score: 'high' }],
    ['not an object', 'nope'],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseMatchOutput(raw, ['cv-qa'])).toThrow('invalid match output');
  });

  it('rejects a bestCvId that was not offered', () => {
    expect(() => parseMatchOutput({ ...good, bestCvId: 'cv-other' }, ['cv-qa'])).toThrow('unknown bestCvId');
  });
});

describe('extractJson', () => {
  it('parses the text part, tolerating a code fence', () => {
    expect(extractJson(geminiResponse(good))).toEqual(good);
    expect(extractJson(geminiResponse('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it('throws on blocked, empty and broken responses', () => {
    expect(() => extractJson({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('blocked');
    expect(() => extractJson({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toThrow('MAX_TOKENS');
    expect(() => extractJson(geminiResponse('{"score": 8'))).toThrow('valid JSON');
  });
});

describe('prompt', () => {
  it('contains the job and only the redacted CV text, with ids', () => {
    const p = buildMatchPrompt(job, cvs);
    expect(p).toContain('QA Automation Engineer');
    expect(p).toContain('<cv id="cv-qa">');
    expect(p).toContain('REDACTED BACKEND CV');
    expect(p).not.toContain('SECRET');
  });

  it('system instruction carries the honesty rule', () => {
    expect(MATCH_SYSTEM_INSTRUCTION).toMatch(/Never suggest adding experience, skills or tools/);
  });
});

describe('createGeminiMatcher', () => {
  it('sends structured-output config, the key only in the header, and no raw CV text', async () => {
    const fetchMock = stubSequence({ status: 200, body: geminiResponse(good) });
    const { m } = matcher();
    expect(await m.match(job, cvs)).toMatchObject({ score: 82, bestCvId: 'cv-qa' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/models\/example-flash-2:generateContent$/);
    expect(url).not.toContain(FAKE_KEY);
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    const body = JSON.parse(init!.body as string);
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: matchResponseSchema(['cv-qa', 'cv-be']),
    });
    expect(body.systemInstruction.parts[0].text).toBe(MATCH_SYSTEM_INSTRUCTION);
    expect(init!.body as string).not.toContain('SECRET');
  });

  it('retries once on invalid output, and counts both calls', async () => {
    const fetchMock = stubSequence(
      { status: 200, body: geminiResponse({ score: 'x' }) },
      { status: 200, body: geminiResponse(good) },
    );
    const { m, calls } = matcher();
    expect((await m.match(job, cvs)).score).toBe(82);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls()).toBe(2);
  });

  it('gives up after a second invalid output (ai_failed)', async () => {
    const fetchMock = stubSequence({ status: 200, body: geminiResponse({ ...good, bestCvId: 'nope' }) });
    const { m } = matcher();
    await expect(m.match(job, cvs)).rejects.toBeInstanceOf(AiInvalidOutput);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off 5s, 15s on 429/503 and then succeeds', async () => {
    const fetchMock = stubSequence(
      { status: 429, body: { error: { message: 'quota' } } },
      { status: 503, body: {} },
      { status: 200, body: geminiResponse(good) },
    );
    const { m, sleeps, calls } = matcher();
    expect((await m.match(job, cvs)).score).toBe(82);
    expect(sleeps).toEqual([5_000, 15_000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls()).toBe(3);
  });

  it('after all backoffs it leaves the job for later (AiRetryLater)', async () => {
    stubSequence({ status: 429, body: {} });
    const { m, sleeps } = matcher();
    await expect(m.match(job, cvs)).rejects.toBeInstanceOf(AiRetryLater);
    expect(sleeps).toEqual(BACKOFF_MS);
  });

  it('other HTTP errors are not retried', async () => {
    const fetchMock = stubSequence({ status: 400, body: { error: { message: 'API key not valid.' } } });
    const { m } = matcher();
    await expect(m.match(job, cvs)).rejects.toThrow('מפתח ה-API אינו תקין');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the minimum delay between calls', async () => {
    stubSequence({ status: 200, body: geminiResponse(good) });
    let t = 1_000_000;
    const { m, sleeps } = matcher({ minDelayMs: 4_000, now: () => t });
    await m.match(job, cvs);
    t += 1_500; // next call starts 1.5s later
    await m.match(job, cvs);
    expect(sleeps).toEqual([2_500]);
  });

  it('stops before sending when the daily budget is used up', async () => {
    const fetchMock = stubSequence({ status: 200, body: geminiResponse(good) });
    const { m } = matcher({ beforeCall: async () => { throw new CallBudgetExhausted(); } });
    await expect(m.match(job, cvs)).rejects.toBeInstanceOf(CallBudgetExhausted);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
