// Company list: stored in chrome.storage.local under "companies", seeded once from data/companies.json.
import { z } from 'zod';
import { browser } from 'wxt/browser';
import seed from '@/data/companies.json';
import suggested from '@/data/suggested-companies.json';
import { renameCompanyJobs } from '@/db/repo';
import type { Company } from './types';
import { NOT_IN_EXTENSION_MSG } from './storage';

const KEY = 'companies';

export const companySchema = z.object({
  name: z.string().trim().min(1, 'חסר שם חברה'),
  source: z.enum(['greenhouse', 'lever', 'comeet', 'smartrecruiters']),
  boardId: z.string().trim().min(1, 'חסר מזהה לוח').regex(/^[^\s/?#]+$/, 'מזהה הלוח לא יכול להכיל רווחים או /'),
  token: z.string().trim().optional(),
  country: z.string().trim().toLowerCase().regex(/^([a-z]{2})?$/, 'קוד מדינה הוא שתי אותיות, למשל il').optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  enabled: z.boolean(),
  example: z.boolean().optional(),
});

/** Stable identity of a company inside runs (companiesDone) and the UI. */
export function companyKey(c: Pick<Company, 'source' | 'boardId'>): string {
  return `${c.source}:${c.boardId.trim().toLowerCase()}`;
}

/** Validates and normalizes one company; throws an Error with a Hebrew message. */
export function parseCompany(input: unknown): Company {
  const r = companySchema.safeParse(input);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'פרטי חברה לא תקינים');
  const c = r.data;
  const aliases = c.aliases?.filter(Boolean);
  return {
    ...c,
    token: c.token || undefined,
    country: c.country || undefined,
    aliases: aliases?.length ? aliases : undefined,
  };
}

/**
 * Pure. Without `replaceKey`: add (rejects a duplicate source+board).
 * With `replaceKey`: replace that entry (rejects changing it into another existing entry).
 */
export function upsertInList(list: Company[], company: Company, replaceKey?: string): Company[] {
  const dupe = list.findIndex((c) => companyKey(c) === companyKey(company));
  if (replaceKey === undefined) {
    if (dupe !== -1) throw new Error('חברה עם אותו מקור ומזהה כבר קיימת ברשימה');
    return [...list, company];
  }
  const i = list.findIndex((c) => companyKey(c) === replaceKey);
  if (i === -1) throw new Error('החברה לא נמצאה ברשימה');
  if (dupe !== -1 && dupe !== i) throw new Error('חברה עם אותו מקור ומזהה כבר קיימת ברשימה');
  const next = [...list];
  // Editing a seeded example makes it the user's own entry.
  next[i] = { ...company, example: undefined };
  return next;
}

function local() {
  const area = browser?.storage?.local;
  if (!area) throw new Error(NOT_IN_EXTENSION_MSG);
  return area;
}

export function seedCompanies(): Company[] {
  return (seed as unknown[]).map(parseCompany);
}

export async function getCompanies(): Promise<Company[]> {
  const res = await local().get(KEY);
  const stored = res[KEY];
  if (!Array.isArray(stored)) {
    const seeded = seedCompanies();
    await local().set({ [KEY]: seeded });
    return seeded;
  }
  const out: Company[] = [];
  for (const c of stored) {
    try {
      out.push(parseCompany(c));
    } catch {
      /* drop a corrupt entry rather than failing the whole list */
    }
  }
  return out;
}

export async function saveCompanies(list: Company[]): Promise<void> {
  await local().set({ [KEY]: list.map(parseCompany) });
}

export async function saveCompany(company: Company, replaceKey?: string): Promise<Company[]> {
  const current = await getCompanies();
  const parsed = parseCompany(company);
  const next = upsertInList(current, parsed, replaceKey);
  await saveCompanies(next);
  // A rename (same source) carries the company's stored jobs over to the new name.
  const before = replaceKey === undefined ? undefined : current.find((c) => companyKey(c) === replaceKey);
  if (before && before.source === parsed.source && before.name !== parsed.name) {
    await renameCompanyJobs(parsed.source, before.name, parsed.name);
  }
  return next;
}

/**
 * Suggested real companies (public Greenhouse/Lever boards with tech jobs in Israel, checked
 * 2026-11-04). Offered from the Companies screen; never added automatically.
 */
export function suggestedCompanies(): Company[] {
  return (suggested as unknown[]).map(parseCompany);
}

/** Pure: the suggestions that are not in the list yet (by source + board). */
export function missingSuggestions(list: Company[], suggestions: Company[] = suggestedCompanies()): Company[] {
  const have = new Set(list.map(companyKey));
  return suggestions.filter((c) => !have.has(companyKey(c)));
}

/** Adds every suggested company that is not in the list yet. Returns the new list and how many were added. */
export async function addSuggestedCompanies(): Promise<{ list: Company[]; added: number }> {
  const current = await getCompanies();
  const toAdd = missingSuggestions(current);
  const list = [...current, ...toAdd];
  await saveCompanies(list);
  return { list, added: toAdd.length };
}

export async function deleteCompany(key: string): Promise<Company[]> {
  const next = (await getCompanies()).filter((c) => companyKey(c) !== key);
  await saveCompanies(next);
  return next;
}
