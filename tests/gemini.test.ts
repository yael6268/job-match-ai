import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeGeminiError, listModels, parseModels, testKey } from '@/ai/gemini';
import modelsFixture from './fixtures/gemini-models.json';

const FAKE_KEY = 'test-key-not-real';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('parseModels', () => {
  it('keeps generateContent models, strips prefix, flags flash', () => {
    const models = parseModels(modelsFixture);
    expect(models.map((m) => m.id)).not.toContain('embedding-model-x');
    const flash = models.filter((m) => m.isFlash).map((m) => m.id);
    expect(flash).toEqual(expect.arrayContaining(['example-flash-2', 'example-flash-1']));
    expect(models.every((m) => !m.id.startsWith('models/'))).toBe(true);
  });

  it('returns [] for unexpected shapes', () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({ models: 'x' })).toEqual([]);
  });
});

describe('describeGeminiError', () => {
  it('maps common statuses to Hebrew messages and includes the API detail', () => {
    const invalidKey = JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } });
    expect(describeGeminiError(400, invalidKey)).toContain('מפתח ה-API אינו תקין');
    expect(describeGeminiError(429, '')).toContain('מכסת');
    expect(describeGeminiError(404, '')).toContain('המודל לא נמצא');
    expect(describeGeminiError(503, 'oops')).toContain('503');
  });
});

describe('network calls (fetch mocked)', () => {
  it('sends the key only in the x-goog-api-key header, never in the URL', async () => {
    const fetchMock = stubFetch(200, modelsFixture);
    await listModels(FAKE_KEY);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain(FAKE_KEY);
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
  });

  it('testKey posts a tiny generateContent to the chosen model', async () => {
    const fetchMock = stubFetch(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    const msg = await testKey(FAKE_KEY, 'example-flash-2');
    expect(msg).toContain('example-flash-2');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/models\/example-flash-2:generateContent$/);
    expect(init!.method).toBe('POST');
  });

  it('testKey without a model validates by listing models', async () => {
    stubFetch(200, modelsFixture);
    expect(await testKey(FAKE_KEY, '')).toContain('המפתח תקין');
  });

  it('surfaces a readable error on a bad key', async () => {
    stubFetch(400, { error: { message: 'API key not valid.' } });
    await expect(testKey(FAKE_KEY, 'example-flash-2')).rejects.toThrow('מפתח ה-API אינו תקין');
  });

  it('reports offline errors instead of crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(listModels(FAKE_KEY)).rejects.toThrow('אין חיבור');
  });

  it('refuses to call without a key', async () => {
    const fetchMock = stubFetch(200, {});
    await expect(listModels('  ')).rejects.toThrow('לא הוזן מפתח');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
