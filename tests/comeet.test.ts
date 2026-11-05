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
