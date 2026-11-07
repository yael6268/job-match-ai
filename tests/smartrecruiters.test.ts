import { afterEach, describe, expect, it, vi } from 'vitest';
import listFixture from './fixtures/smartrecruiters-checkpoint-list.json';
import detailFixture from './fixtures/smartrecruiters-checkpoint-detail.json';
import {
  mapSmartRecruiters, MAX_DETAILS, parseList, smartrecruiters, smartRecruitersDetailUrl, smartRecruitersListUrl,
} from '@/sources/smartrecruiters';
import { getAdapter, SUPPORTED_SOURCES } from '@/sources';
import { parseCompany } from '@/shared/companies';
import type { Company } from '@/shared/types';

const cp: Company = { name: 'Check Point', source: 'smartrecruiters', boardId: 'CheckPointSoftwareTechnologies2', country: 'il', enabled: true };

afterEach(() => vi.unstubAllGlobals());

/** Route fetch by URL: list pages by offset, details by posting id. */
function stubApi(opts: { pages: unknown[]; details: Record<string, unknown>; failDetail?: string }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.at(-1) === 'postings') {
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const page = opts.pages[Math.floor(offset / 100)] ?? { offset, limit: 100, totalFound: 0, content: [] };
      return new Response(JSON.stringify(page), { status: 200 });
    }
    const id = parts.at(-1)!;
    if (id === opts.failDetail) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(opts.details[id] ?? { id }), { status: 200 });
  }));
  return calls;
}

describe('smartrecruiters mapping (real trimmed response)', () => {
  const [first] = listFixture.content;

  it('merges list item and details into the common shape', () => {
    const job = mapSmartRecruiters(first!, detailFixture, cp)!;
    expect(job).toMatchObject({
      source: 'smartrecruiters',
      sourceJobId: '744000158968719',
      company: 'Check Point',
      title: 'Network Engineer',
      url: detailFixture.postingUrl,
      // The Easy-apply form, identified by the posting's publication uuid.
      applyUrl: `https://jobs.smartrecruiters.com/oneclick-ui/company/CheckPointSoftwareTechnologies2/publication/${detailFixture.uuid}`,
      location: 'Tel Aviv-Yafo, Tel Aviv District, Israel',
      postedAt: '2026-11-01T11:05:21.788Z',
    });
  });

  it('description = job sections as plain text, without the company blurb, entities decoded', () => {
    const { descriptionText } = mapSmartRecruiters(first!, detailFixture, cp)!;
    expect(descriptionText).toContain('Job Description');
    expect(descriptionText).toContain('Qualifications');
    expect(descriptionText).toContain('5 -7 years');
    expect(descriptionText).not.toContain('Company Description');
    expect(descriptionText).not.toMatch(/<[a-z]|&#x?[0-9a-f]+;/i);
  });

  it('without details: falls back to a public URL and an empty description', () => {
    const job = mapSmartRecruiters(first!, undefined, cp)!;
    expect(job.url).toBe('https://jobs.smartrecruiters.com/CheckPointSoftwareTechnologies2/744000158968719');
    expect(job.descriptionText).toBe('');
  });

  it('remote/hybrid flags are added to the location; broken items are skipped', () => {
    const j = mapSmartRecruiters({ id: '1', name: 'X', location: { fullLocation: 'Haifa, Israel', hybrid: true } }, undefined, cp)!;
    expect(j.location).toBe('Haifa, Israel · Hybrid');
    expect(mapSmartRecruiters({ name: 'no id' }, undefined, cp)).toBeNull();
  });

  it('parseList rejects an unexpected shape', () => {
    expect(() => parseList({ message: 'Company not found' })).toThrow('SmartRecruiters');
  });
});

describe('smartrecruiters adapter (fetch mocked)', () => {
  it('lists with the country filter, then fetches details per posting', async () => {
    const calls = stubApi({ pages: [listFixture], details: { [detailFixture.id]: detailFixture } });
    const jobs = await smartrecruiters.fetchJobs(cp);
    expect(jobs).toHaveLength(3);
    expect(calls[0]).toBe(smartRecruitersListUrl('CheckPointSoftwareTechnologies2', 0, 'il'));
    expect(calls[0]).toContain('country=il');
    expect(calls.slice(1).sort()).toEqual(listFixture.content.map((c) => smartRecruitersDetailUrl(cp.boardId, c.id)).sort());
    expect(jobs.find((j) => j.sourceJobId === detailFixture.id)!.descriptionText).toContain('Qualifications');
  });

  it('pages through the list with offset', async () => {
    const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), name: `Job ${from + i}` }));
    const calls = stubApi({
      pages: [
        { offset: 0, limit: 100, totalFound: 130, content: mk(0, 100) },
        { offset: 100, limit: 100, totalFound: 130, content: mk(100, 30) },
      ],
      details: {},
    });
    const jobs = await smartrecruiters.fetchJobs({ ...cp, country: undefined });
    expect(jobs).toHaveLength(130);
    const listCalls = calls.filter((c) => new URL(c).pathname.endsWith('/postings'));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1]).toContain('offset=100');
    expect(listCalls[0]).not.toContain('country=');
  });

  it(`fetches details for at most ${MAX_DETAILS} postings`, async () => {
    const content = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Job ${i}` }));
    stubApi({ pages: [0, 1, 2].map((p) => ({ offset: p * 100, limit: 100, totalFound: 300, content: content.map((c) => ({ ...c, id: `${p}-${c.id}` })) })), details: {} });
    const jobs = await smartrecruiters.fetchJobs(cp);
    expect(jobs).toHaveLength(MAX_DETAILS);
  });

  it('a failing detail call keeps the job (empty description) instead of failing the company', async () => {
    const failId = listFixture.content[1]!.id;
    stubApi({ pages: [listFixture], details: { [detailFixture.id]: detailFixture }, failDetail: failId });
    const jobs = await smartrecruiters.fetchJobs(cp);
    expect(jobs).toHaveLength(3);
    expect(jobs.find((j) => j.sourceJobId === failId)!.descriptionText).toBe('');
  });

  it('an unknown company is a readable 404 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(smartrecruiters.fetchJobs(cp)).rejects.toThrow('404');
  });
});

describe('registry and company settings', () => {
  it('all four sources are supported', () => {
    expect([...SUPPORTED_SOURCES].sort()).toEqual(['comeet', 'greenhouse', 'lever', 'smartrecruiters']);
    expect(getAdapter('smartrecruiters')).toBe(smartrecruiters);
  });

  it('country is a 2-letter code, lowercased; empty means all countries', () => {
    expect(parseCompany({ ...cp, country: 'IL' }).country).toBe('il');
    expect(parseCompany({ ...cp, country: '' }).country).toBeUndefined();
    expect(() => parseCompany({ ...cp, country: 'Israel' })).toThrow('שתי אותיות');
  });
});
