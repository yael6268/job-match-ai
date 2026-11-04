import { describe, expect, it } from 'vitest';
import {
  DOMAIN_KEYWORDS, isExcludedTitle, matchesLocation, prefilterJob, titleDomains, type PrefilterContext,
} from '@/pipeline/prefilter';
import { DEFAULT_SETTINGS } from '@/shared/storage';
import { DOMAINS } from '@/shared/types';

const ctx = (cvDomains: string[], over: Partial<PrefilterContext['settings']> = {}): PrefilterContext => ({
  settings: { ...DEFAULT_SETTINGS, ...over },
  cvDomains,
});

describe('matchesLocation', () => {
  it('matches case-insensitive substrings, Hebrew and English', () => {
    const allowed = DEFAULT_SETTINGS.locations;
    expect(matchesLocation('Tel Aviv-Yafo, Gush Dan, Israel', allowed)).toBe(true);
    expect(matchesLocation('תל אביב', allowed)).toBe(true);
    expect(matchesLocation('Remote · Israel', allowed)).toBe(true);
    expect(matchesLocation('New York, NY', allowed)).toBe(false);
    expect(matchesLocation('', allowed)).toBe(false);
  });

  it('an empty allow-list allows everything', () => {
    expect(matchesLocation('Berlin', [])).toBe(true);
    expect(matchesLocation('Berlin', ['  '])).toBe(true);
  });
});

describe('titleDomains', () => {
  it('maps real titles to the CV domains', () => {
    expect(titleDomains('QA Automation Engineer', ['QA', 'Backend'])).toEqual(['QA']);
    expect(titleDomains('Senior Backend Engineer (Java)', ['QA', 'Backend'])).toEqual(['Backend']);
    expect(titleDomains('Software Tester', ['QA'])).toEqual(['QA']);
    expect(titleDomains('Node.js Developer', ['Backend'])).toEqual(['Backend']);
    expect(titleDomains('.NET Developer', ['Backend'])).toEqual(['Backend']);
    expect(titleDomains('Go Developer', ['Backend'])).toEqual(['Backend']);
    expect(titleDomains('בודק/ת תוכנה', ['QA'])).toEqual(['QA']);
    expect(titleDomains('מפתח/ת צד שרת', ['Backend'])).toEqual(['Backend']);
  });

  it('respects word starts and whole-word keywords', () => {
    expect(titleDomains('Contest Manager', ['QA'])).toEqual([]); // "test" not at a word start
    expect(titleDomains('Google Ads Specialist', ['Backend'])).toEqual([]); // "go " is whole-word
    expect(titleDomains('Account Executive', ['QA', 'Backend', 'Frontend'])).toEqual([]);
  });

  it('only looks at the domains it is given', () => {
    expect(titleDomains('Backend Engineer', ['QA'])).toEqual([]);
  });

  it('every DOMAINS entry has keywords', () => {
    for (const d of DOMAINS) expect(DOMAIN_KEYWORDS[d].length).toBeGreaterThan(0);
  });
});

describe('isExcludedTitle', () => {
  const words = DEFAULT_SETTINGS.excludedTitleWords;
  it.each([
    ['Staff Software Engineer', true],
    ['Principal QA Engineer', true],
    ['VP R&D', true],
    ['Head of QA', true],
    ['Senior Director, Engineering', true],
    ['Staffing Coordinator', false],
    ['Senior QA Engineer', false],
    ['Headless CMS Developer', false],
  ])('%s -> %s', (title, expected) => {
    expect(isExcludedTitle(title, words)).toBe(expected);
  });
});

describe('prefilterJob', () => {
  const ok = { title: 'QA Engineer', location: 'Tel Aviv, Israel' };

  it('passes a matching job and keeps requiredYears', () => {
    expect(prefilterJob({ ...ok, requiredYears: 3 }, ctx(['QA']))).toEqual({ passed: true, requiredYears: 3 });
  });

  it('reports the first failing rule', () => {
    expect(prefilterJob({ ...ok, location: 'London' }, ctx(['QA'])).reason).toBe('location');
    expect(prefilterJob({ ...ok, title: 'Staff QA Engineer' }, ctx(['QA'])).reason).toBe('excluded');
    expect(prefilterJob({ ...ok, title: 'Sales Manager' }, ctx(['QA'])).reason).toBe('title');
    expect(prefilterJob({ ...ok, requiredYears: 7 }, ctx(['QA'])).reason).toBe('experience');
  });

  it('max years is configurable and unknown years pass', () => {
    expect(prefilterJob({ ...ok, requiredYears: 7 }, ctx(['QA'], { maxRequiredYears: 8 })).passed).toBe(true);
    expect(prefilterJob(ok, ctx(['QA'], { maxRequiredYears: 0 })).passed).toBe(true);
  });

  it('no CV domains means no title can match', () => {
    expect(prefilterJob(ok, ctx([])).reason).toBe('title');
  });
});
