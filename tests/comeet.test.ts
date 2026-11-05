import { describe, expect, it } from 'vitest';
import { comeetUidFromUrl, isComeetUid, parseComeetCareersPage } from '@/sources/comeet';

// Same structure as a real careers page's COMPANY_DATA (2026-11-04); the token here is fake.
const FAKE_TOKEN = '0123456789ABCDEF0123456789AB';
const page = `<script>var COMPANY_DATA = {"name": "Example", "referrals_reward": null, "is_reward": false,
  "careers_website_group_positions_by": 1, "company_uid": "49.004", "token": "${FAKE_TOKEN}", "slug": "example",
  "is_customs_terms": false};</script><script>var x = {"token": COMPANY_DATA.token};</script>`;

describe('comeet careers page', () => {
  it('reads the uid from a careers URL', () => {
    expect(comeetUidFromUrl('https://www.comeet.com/jobs/upwind/49.004')).toBe('49.004');
    expect(comeetUidFromUrl('https://www.comeet.com/jobs/classiq/f7.008?utm=x')).toBe('F7.008');
    expect(comeetUidFromUrl('https://www.comeet.com/jobs/drivenets/72.006/customer-support-network-engineer/FD.646')).toBe('72.006');
    expect(comeetUidFromUrl('https://www.comeet.com/jobs/upwind')).toBeUndefined();
    expect(comeetUidFromUrl('https://example.com/jobs/a/49.004')).toBeUndefined();
  });

  it('extracts uid and token from the page HTML', () => {
    expect(parseComeetCareersPage(page)).toEqual({ companyUid: '49.004', token: FAKE_TOKEN });
  });

  it('returns undefined when the page has no credentials', () => {
    expect(parseComeetCareersPage('<html>Not found</html>')).toBeUndefined();
    expect(parseComeetCareersPage('{"company_uid": "49.004", "slug": "x"}')).toBeUndefined();
  });

  it('validates uids', () => {
    expect(isComeetUid('49.004')).toBe(true);
    expect(isComeetUid(' F7.008 ')).toBe(true);
    expect(isComeetUid('upwind')).toBe(false);
  });
});

// ---------- positions adapter (real trimmed data: tests/fixtures/comeet-upwind.json) ----------
import { afterEach, vi } from 'vitest';
import fixture from './fixtures/comeet-upwind.json';
import { comeet, comeetPositionsUrl, mapComeet } from '@/sources/comeet';
import { matchesLocation } from '@/pipeline/prefilter';
import { DEFAULT_SETTINGS } from '@/shared/storage';
import { getAdapter } from '@/sources';
import type { Company } from '@/shared/types';

const upwind: Company = { name: 'Upwind', source: 'comeet', boardId: '49.004', token: FAKE_TOKEN, enabled: true };

describe('comeet mapping (real trimmed positions)', () => {
  const jobs = mapComeet(fixture, upwind);
  const ai = jobs.find((j) => j.sourceJobId === '5C.375')!;

  it('maps every position into the common shape', () => {
    expect(jobs).toHaveLength(3);
    expect(ai).toMatchObject({
      source: 'comeet',
      company: 'Upwind',
      title: 'AI Engineer',
      url: 'https://www.comeet.com/jobs/upwind/49.004/ai-engineer/5C.375',
      applyUrl: 'https://www.comeet.com/jobs/upwind/49.004/ai-engineer/5C.375',
      department: 'Research',
      postedAt: '2026-11-04T17:52:35.000Z',
    });
  });

  it('location has the country name and workplace type, so the Israel filter works', () => {
    expect(ai.location).toBe('Tel Aviv · Ramat Gan · Israel · Hybrid');
    expect(matchesLocation(ai.location, DEFAULT_SETTINGS.locations)).toBe(true);
    const brazil = jobs.find((j) => j.title.includes('Brazil'))!;
    expect(brazil.location).toContain('Brazil');
    expect(matchesLocation(brazil.location, DEFAULT_SETTINGS.locations)).toBe(false);
  });

  it('description = ordered detail sections as plain text', () => {
    expect(ai.descriptionText.startsWith('Description\n')).toBe(true);
    expect(ai.descriptionText).toContain('Requirements\n');
    expect(ai.descriptionText).toMatch(/3\+ years/);
    expect(ai.descriptionText).not.toMatch(/<[a-z]/i);
  });

  it('reads API-style top-level details too, and tolerates positions without details', () => {
    const [first] = fixture;
    const apiStyle = { ...first, custom_fields: { details: [] }, details: [{ name: 'About', value: '<p>Hi &amp; bye</p>', order: 1 }] };
    expect(mapComeet([apiStyle], upwind)[0]!.descriptionText).toBe('About\nHi & bye');
    expect(jobs.find((j) => j.sourceJobId === '4C.C69')!.descriptionText).toBe('');
  });

  it('skips broken items and rejects a non-array response', () => {
    expect(mapComeet([{ name: 'no uid' }, ...fixture], upwind)).toHaveLength(3);
    expect(() => mapComeet({ error: 'bad token' }, upwind)).toThrow('Comeet');
  });
});

describe('comeet adapter (fetch mocked)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the careers API with uid, token and details', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await comeet.fetchJobs(upwind)).toHaveLength(3);
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe(comeetPositionsUrl('49.004', FAKE_TOKEN));
    expect(url).toBe(`https://www.comeet.co/careers-api/2.0/company/49.004/positions?token=${FAKE_TOKEN}&details=true`);
  });

  it('explains a missing token or a bad uid without calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(comeet.fetchJobs({ ...upwind, token: undefined })).rejects.toThrow('חסר טוקן');
    await expect(comeet.fetchJobs({ ...upwind, boardId: 'upwind' })).rejects.toThrow('49.004');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is registered', () => {
    expect(getAdapter('comeet')).toBe(comeet);
  });
});
