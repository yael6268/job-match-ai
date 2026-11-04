import { describe, expect, it } from 'vitest';
import {
  addSuggestedCompanies, companyKey, deleteCompany, getCompanies, missingSuggestions, parseCompany, saveCompany,
  seedCompanies, suggestedCompanies, upsertInList,
} from '@/shared/companies';
import type { Company } from '@/shared/types';
import { db } from '@/db/schema';
import { upsertJobsFromSource } from '@/db/repo';
import { fake } from './setup';

const acme: Company = { name: 'Acme', source: 'greenhouse', boardId: 'acme', enabled: true };

describe('parseCompany', () => {
  it('trims, drops empty optional fields', () => {
    expect(parseCompany({ ...acme, name: ' Acme ', boardId: ' acme ', token: '', aliases: [] }))
      .toEqual({ name: 'Acme', source: 'greenhouse', boardId: 'acme', enabled: true, token: undefined, aliases: undefined });
  });

  it.each([
    [{ ...acme, name: '' }, 'שם'],
    [{ ...acme, boardId: '' }, 'מזהה'],
    [{ ...acme, boardId: 'has space' }, 'רווחים'],
    [{ ...acme, boardId: 'https://x/y' }, 'רווחים'],
  ])('rejects %o', (input, msg) => {
    expect(() => parseCompany(input)).toThrow(msg);
  });

  it('rejects an unknown source', () => {
    expect(() => parseCompany({ ...acme, source: 'linkedin' })).toThrow();
  });
});

describe('seed', () => {
  it('companies.json is valid and every entry is marked as an example', () => {
    const seeded = seedCompanies();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((c) => c.example)).toBe(true);
  });
});

describe('upsertInList', () => {
  it('adds and rejects duplicates by source+board (case-insensitive)', () => {
    const list = upsertInList([], acme);
    expect(list).toHaveLength(1);
    expect(() => upsertInList(list, { ...acme, name: 'Other', boardId: 'ACME' })).toThrow('כבר קיימת');
    expect(upsertInList(list, { ...acme, source: 'lever' })).toHaveLength(2);
  });

  it('edits in place, clears the example flag, rejects editing into a duplicate', () => {
    const b: Company = { ...acme, boardId: 'beta', example: true };
    const list = [acme, b];
    const edited = upsertInList(list, { ...b, name: 'Beta Inc' }, companyKey(b));
    expect(edited[1]).toMatchObject({ name: 'Beta Inc', example: undefined });
    expect(() => upsertInList(list, { ...b, boardId: 'acme' }, companyKey(b))).toThrow('כבר קיימת');
    expect(() => upsertInList(list, acme, 'lever:nope')).toThrow('לא נמצאה');
  });
});

describe('storage', () => {
  it('seeds on first read and persists', async () => {
    const first = await getCompanies();
    expect(first).toEqual(seedCompanies());
    const raw = await fake.storage.local.get('companies');
    expect(raw.companies).toHaveLength(first.length);
  });

  it('save / delete round-trip and keeps an empty list empty (no reseed)', async () => {
    await getCompanies();
    const afterAdd = await saveCompany(acme);
    expect(afterAdd.some((c) => c.name === 'Acme')).toBe(true);
    for (const c of afterAdd) await deleteCompany(companyKey(c));
    expect(await getCompanies()).toEqual([]);
  });

  it('renaming a company moves its stored jobs to the new name; other edits leave them alone', async () => {
    await fake.storage.local.set({ companies: [acme] });
    await upsertJobsFromSource([{
      source: 'greenhouse', sourceJobId: '1', company: 'Acme', title: 'QA',
      url: 'https://boards.greenhouse.io/acme/jobs/1', location: 'Israel', descriptionText: '',
    }]);
    await saveCompany({ ...acme, enabled: false }, companyKey(acme));
    expect((await db.jobs.toArray())[0]!.company).toBe('Acme');
    await saveCompany({ ...acme, name: 'Acme Inc' }, companyKey(acme));
    expect((await db.jobs.toArray())[0]!.company).toBe('Acme Inc');
  });

  it('suggested companies are valid, unique, real (not examples) and added only once', async () => {
    const s = suggestedCompanies();
    expect(s.length).toBeGreaterThan(5);
    expect(new Set(s.map(companyKey)).size).toBe(s.length);
    expect(s.every((c) => c.enabled && !c.example)).toBe(true);

    await fake.storage.local.set({ companies: [acme, s[0]!] });
    expect(missingSuggestions(await getCompanies())).toHaveLength(s.length - 1);
    const first = await addSuggestedCompanies();
    expect(first.added).toBe(s.length - 1);
    expect(first.list).toHaveLength(s.length + 1);
    const again = await addSuggestedCompanies();
    expect(again.added).toBe(0);
    expect(await getCompanies()).toHaveLength(s.length + 1);
  });

  it('drops corrupt stored entries instead of failing', async () => {
    await fake.storage.local.set({ companies: [acme, { name: 'bad' }] });
    expect(await getCompanies()).toEqual([acme]);
  });
});
