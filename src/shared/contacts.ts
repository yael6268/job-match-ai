// Contacts (SPEC.md sections 9.6 and M8): validation, CSV import parsing and company matching. Pure.
import type { Company, Contact } from './types';

/** Legal-form words that do not identify a company ("Acme Ltd" = "Acme"). */
const SUFFIXES = new Set(['ltd', 'inc', 'llc', 'corp', 'co', 'gmbh', 'plc', 'בעמ']);

/**
 * Company name for matching: case- and punctuation-insensitive, legal suffixes dropped.
 * "Wix.com Ltd." -> "wixcom", "Check Point Software" -> "checkpointsoftware", "אקמה בע"מ" -> "אקמה".
 */
export function normalizeCompany(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/["'״׳]/g, '')
    .split(/[^a-z0-9א-ת]+/)
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join('');
}

/** Every normalized name a job's company goes by: its display name plus the aliases in the companies list. */
export function companyNames(jobCompany: string, companies: Company[]): Set<string> {
  const names = new Set([normalizeCompany(jobCompany)]);
  for (const c of companies) {
    const all = [c.name, ...(c.aliases ?? [])].map(normalizeCompany);
    if (all.includes(normalizeCompany(jobCompany))) all.forEach((n) => names.add(n));
  }
  names.delete('');
  return names;
}

/** Contacts who work at the job's company (by name or alias, case/punctuation-insensitive). */
export function contactsAt(jobCompany: string, contacts: Contact[], companies: Company[]): Contact[] {
  const names = companyNames(jobCompany, companies);
  return contacts.filter((c) => names.has(normalizeCompany(c.company)));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims fields, drops empty optionals, validates. Throws a Hebrew Error. */
export function cleanContact(input: Omit<Contact, 'id'> & { id?: string }, id: string): Contact {
  const name = input.name.trim();
  const company = input.company.trim();
  if (!name) throw new Error('חסר שם איש הקשר');
  if (!company) throw new Error('חסרה חברה');
  const email = input.email?.trim() || undefined;
  if (email && !EMAIL.test(email)) throw new Error(`כתובת המייל "${email}" לא תקינה`);
  const referralLink = input.referralLink?.trim() || undefined;
  if (referralLink && !/^https?:\/\//i.test(referralLink)) throw new Error('קישור ההפניה צריך להתחיל ב-https://');
  return { id: input.id ?? id, name, company, email, referralLink, notes: input.notes?.trim() || undefined };
}

/** Same person at the same company (for de-duplicating imports). */
export function contactKey(c: Pick<Contact, 'name' | 'company'>): string {
  return `${c.name.trim().toLowerCase()}|${normalizeCompany(c.company)}`;
}

// ---------- CSV ----------

/** RFC 4180-ish: quoted fields, "" escapes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export const CSV_COLUMNS = ['name', 'company', 'email', 'referralLink', 'notes'] as const;

export interface CsvImport {
  contacts: Omit<Contact, 'id'>[];
  errors: { line: number; message: string }[];
}

/**
 * Contacts from CSV with columns name,company,email,referralLink,notes. A header row is optional
 * and may list the columns in any order (Hebrew headers שם/חברה/מייל/קישור/הערות work too).
 */
export function parseContactsCsv(text: string): CsvImport {
  const rows = parseCsvRows(text);
  const out: CsvImport = { contacts: [], errors: [] };
  if (!rows.length) return out;

  const HEADER: Record<string, (typeof CSV_COLUMNS)[number]> = {
    name: 'name', 'שם': 'name', company: 'company', 'חברה': 'company', email: 'email', 'מייל': 'email',
    'דואל': 'email', referrallink: 'referralLink', referral: 'referralLink', link: 'referralLink', 'קישור': 'referralLink',
    notes: 'notes', 'הערות': 'notes',
  };
  const headerKey = (f: string) => HEADER[f.trim().toLowerCase().replace(/["'״׳\s_-]/g, '')];
  const first = rows[0]!;
  const hasHeader = first.some((f) => headerKey(f) === 'name') && first.some((f) => headerKey(f) === 'company');
  const columns = hasHeader ? first.map(headerKey) : [...CSV_COLUMNS];

  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const rec: Record<string, string> = {};
    columns.forEach((col, k) => { if (col) rec[col] = r[k] ?? ''; });
    try {
      const { id: _id, ...c } = cleanContact({ name: rec.name ?? '', company: rec.company ?? '', email: rec.email, referralLink: rec.referralLink, notes: rec.notes }, '');
      out.contacts.push(c);
    } catch (e) {
      out.errors.push({ line, message: (e as Error).message });
    }
  });
  return out;
}
