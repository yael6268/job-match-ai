import { afterEach, describe, expect, it, vi } from 'vitest';
import ghFixture from './fixtures/greenhouse-riskified.json';
import leverFixture from './fixtures/lever-walkme.json';
import { greenhouse, greenhouseUrl, mapGreenhouse } from '@/sources/greenhouse';
import { lever, leverUrl, mapLever } from '@/sources/lever';
import { getAdapter } from '@/sources';
import { joinUnique, SOURCE_RETRY_DELAY_MS, SOURCE_TIMEOUT_MS, toIso } from '@/sources/http';
import type { Company } from '@/shared/types';

const ghCo: Company = { name: 'Riskified', source: 'greenhouse', boardId: 'riskified', enabled: true };
const lvCo: Company = { name: 'WalkMe', source: 'lever', boardId: 'walkme', enabled: true };

afterEach(() => vi.unstubAllGlobals());

function stubFetchSequence(...responses: { status: number; body: unknown }[]) {
  const calls: string[] = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  }));
  return calls;
}

/** A fetch that never answers until its AbortSignal fires (simulates a hung server). */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
}

/** Settle a promise that waits on timers (retry delay, timeouts) without real waiting. */
async function withFakeTimers<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const settled = start().then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  } finally {
    vi.useRealTimers();
  }
}

describe('greenhouse mapping (real trimmed response)', () => {
  const jobs = mapGreenhouse(ghFixture, ghCo);

  it('maps every job into the common shape', () => {
    expect(jobs).toHaveLength(3);
    for (const j of jobs) {
      expect(j.source).toBe('greenhouse');
      expect(j.company).toBe('Riskified');
      expect(j.url).toMatch(/^https:\/\//);
      expect(j.sourceJobId).toMatch(/^\d+$/);
      expect(j.title).toBe(j.title.trim());
      expect(j.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  });

  it('decodes the entity-encoded HTML content into plain text', () => {
    const d = jobs[0]!.descriptionText;
    expect(d.length).toBeGreaterThan(100);
    expect(d).not.toMatch(/&lt;|&gt;|<\/?[a-z]+[ >]/i);
    expect(d).toContain('Riskified');
  });

  it('merges location name with office location so the country is present', () => {
    const telAviv = jobs.find((j) => j.location.startsWith('Tel Aviv'))!;
    expect(telAviv.location).toContain('Israel');
  });

  it('takes the first department', () => {
    expect(jobs.every((j) => typeof j.department === 'string')).toBe(true);
  });

  it('skips a broken item without failing the rest', () => {
    const broken = { jobs: [...ghFixture.jobs, { id: 1 }, null, { title: 'x' }] };
    expect(mapGreenhouse(broken, ghCo)).toHaveLength(3);
  });

  it('throws on an unexpected shape', () => {
    expect(() => mapGreenhouse({ foo: 1 }, ghCo)).toThrow('Greenhouse');
  });

  it('builds the API URL safely', () => {
    expect(greenhouseUrl(' riskified ')).toBe('https://boards-api.greenhouse.io/v1/boards/riskified/jobs?content=true');
    expect(greenhouseUrl('a/b')).toContain('a%2Fb');
  });
});

describe('lever mapping (real trimmed response)', () => {
  const jobs = mapLever(leverFixture, lvCo);

  it('maps every posting into the common shape', () => {
    expect(jobs).toHaveLength(3);
    for (const j of jobs) {
      expect(j.source).toBe('lever');
      expect(j.url).toMatch(/^https:\/\/jobs\.lever\.co\/walkme\//);
      expect(j.applyUrl).toMatch(/\/apply$/);
      expect(j.postedAt).toMatch(/Z$/);
    }
  });

  it('builds location from allLocations, country and workplace type', () => {
    const ta = jobs.find((j) => j.location.includes('Tel Aviv'))!;
    expect(ta.location).toMatch(/IL/);
  });

  it('description includes descriptionPlain and the lists as text', () => {
    const j = jobs[0]!;
    const raw = leverFixture[0]!;
    expect(j.descriptionText).toContain(raw.descriptionPlain.slice(0, 40));
    expect(j.descriptionText).toContain(raw.lists[0]!.text);
    expect(j.descriptionText).toContain('•');
    expect(j.descriptionText).not.toMatch(/<li|<div/);
  });

  it('throws on a non-array', () => {
    expect(() => mapLever({ ok: false }, lvCo)).toThrow('Lever');
  });
});

describe('adapters over the network (fetch mocked)', () => {
  it('greenhouse fetches the right URL and maps it', async () => {
    const calls = stubFetchSequence({ status: 200, body: ghFixture });
    const jobs = await greenhouse.fetchJobs(ghCo);
    expect(calls).toEqual([greenhouseUrl('riskified')]);
    expect(jobs).toHaveLength(3);
  });

  it('greenhouse: empty board is zero jobs, unknown board is a readable 404 error', async () => {
    stubFetchSequence({ status: 200, body: { jobs: [], meta: { total: 0 } } });
    expect(await greenhouse.fetchJobs(ghCo)).toEqual([]);
    stubFetchSequence({ status: 404, body: { status: 404, error: 'Job not found' } });
    await expect(greenhouse.fetchJobs(ghCo)).rejects.toThrow('404');
  });

  it('lever falls back to the EU instance on 404', async () => {
    const calls = stubFetchSequence({ status: 404, body: { ok: false } }, { status: 200, body: leverFixture });
    const jobs = await lever.fetchJobs(lvCo);
    expect(calls).toEqual([leverUrl('walkme'), leverUrl('walkme', true)]);
    expect(calls[1]).toContain('api.eu.lever.co');
    expect(jobs).toHaveLength(3);
  });

  it('lever: 404 on both instances is an error; 500 is retried once on the same host, never EU', async () => {
    stubFetchSequence({ status: 404, body: {} }, { status: 404, body: {} });
    await expect(lever.fetchJobs(lvCo)).rejects.toThrow('404');
    const calls = stubFetchSequence({ status: 500, body: 'oops' });
    await expect(withFakeTimers(() => lever.fetchJobs(lvCo))).rejects.toThrow('500');
    expect(calls).toEqual([leverUrl('walkme'), leverUrl('walkme')]);
  });

  it('network failure (after a retry) and invalid JSON become readable errors', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(withFakeTimers(() => greenhouse.fetchJobs(ghCo))).rejects.toThrow('שגיאת רשת');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = stubFetchSequence({ status: 200, body: '<html>not json' });
    await expect(greenhouse.fetchJobs(ghCo)).rejects.toThrow('JSON');
    expect(calls).toHaveLength(1); // a broken body is not transient
  });

  it('times out on both attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_u: string, init?: RequestInit) => hangUntilAborted(init));
    vi.stubGlobal('fetch', fetchMock);
    const p = greenhouse.fetchJobs(ghCo);
    const assertion = expect(p).rejects.toThrow('תם הזמן');
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS + SOURCE_RETRY_DELAY_MS + SOURCE_TIMEOUT_MS);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('a timeout followed by a good response succeeds', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) =>
      n++ === 0 ? hangUntilAborted(init) : new Response(JSON.stringify(leverFixture), { status: 200 })));
    const jobs = await withFakeTimers(() => lever.fetchJobs(lvCo));
    expect(jobs).toHaveLength(3);
    expect(n).toBe(2);
  });

  it('a body that stalls after the headers is a timeout too, and is retried', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      if (n++ > 0) return new Response(JSON.stringify(ghFixture), { status: 200 });
      // Headers arrive, then the body never finishes until the request is aborted.
      return { ok: true, status: 200, json: () => hangUntilAborted(init) } as unknown as Response;
    }));
    const jobs = await withFakeTimers(() => greenhouse.fetchJobs(ghCo));
    expect(jobs).toHaveLength(3);
    expect(n).toBe(2);
  });

  it('a body that stalls on both attempts fails with the timeout message', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      ({ ok: true, status: 200, json: () => hangUntilAborted(init) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(withFakeTimers(() => greenhouse.fetchJobs(ghCo))).rejects.toThrow('תם הזמן');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 429 and 503, but not 404 or 403', async () => {
    let calls = stubFetchSequence({ status: 429, body: {} }, { status: 200, body: ghFixture });
    expect(await withFakeTimers(() => greenhouse.fetchJobs(ghCo))).toHaveLength(3);
    expect(calls).toHaveLength(2);
    calls = stubFetchSequence({ status: 503, body: {} }, { status: 200, body: ghFixture });
    expect(await withFakeTimers(() => greenhouse.fetchJobs(ghCo))).toHaveLength(3);
    expect(calls).toHaveLength(2);
    calls = stubFetchSequence({ status: 404, body: {} });
    await expect(greenhouse.fetchJobs(ghCo)).rejects.toThrow('404');
    expect(calls).toHaveLength(1);
    calls = stubFetchSequence({ status: 403, body: {} });
    await expect(greenhouse.fetchJobs(ghCo)).rejects.toThrow('403');
    expect(calls).toHaveLength(1);
  });
});

describe('registry and helpers', () => {
  it('returns adapters and rejects unsupported sources', () => {
    expect(getAdapter('greenhouse').name).toBe('greenhouse');
    expect(() => getAdapter('comeet')).toThrow('עדיין לא נתמך');
  });

  it('joinUnique drops empties and case-insensitive duplicates', () => {
    expect(joinUnique(['Tel Aviv', 'tel aviv', '', undefined, 'IL'])).toBe('Tel Aviv · IL');
  });

  it('toIso handles ms timestamps, offsets and garbage', () => {
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(toIso('2026-10-20T14:01:50-04:00')).toBe('2026-10-20T18:01:50.000Z');
    expect(toIso('nope')).toBeUndefined();
  });
});
