import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { deleteContact, importContacts, listContacts, saveContact } from '@/db/repo';
import { cleanContact, contactsAt, normalizeCompany, parseContactsCsv, parseCsvRows } from '@/shared/contacts';
import type { Company, Contact } from '@/shared/types';

// Fictional people only.
const wix: Company = { name: 'Wix', source: 'greenhouse', boardId: 'wix', aliases: ['Wix.com'], enabled: true };
const people: Contact[] = [
  { id: '1', name: 'Dana Example', company: 'wix.com ltd.' },
  { id: '2', name: 'Noa Example', company: 'WIX' },
  { id: '3', name: 'Avi Example', company: 'Check Point Software' },
  { id: '4', name: 'Yoni Example', company: 'אקמה בע"מ' },
];

describe('company matching', () => {
  it('normalizes case, punctuation and legal suffixes', () => {
    expect(normalizeCompany('Wix.com Ltd.')).toBe('wixcom');
    expect(normalizeCompany('  WIX ')).toBe('wix');
    expect(normalizeCompany('Check-Point, Inc')).toBe('checkpoint');
    expect(normalizeCompany('אקמה בע"מ')).toBe('אקמה');
    expect(normalizeCompany('Co')).toBe('co'); // a lone suffix word is kept
  });

  it('finds contacts by company name or alias', () => {
    expect(contactsAt('Wix', people, [wix]).map((c) => c.id)).toEqual(['1', '2']);
    expect(contactsAt('wix.com', people, [wix]).map((c) => c.id)).toEqual(['1', '2']);
    expect(contactsAt('Check Point Software', people, []).map((c) => c.id)).toEqual(['3']);
    expect(contactsAt('אקמה', people, []).map((c) => c.id)).toEqual(['4']);
    expect(contactsAt('Riskified', people, [wix])).toEqual([]);
  });
});

describe('cleanContact', () => {
  it('trims, drops empty optionals, validates', () => {
    expect(cleanContact({ name: ' Dana ', company: ' Wix ', email: '', notes: ' ' }, 'x')).toEqual({ id: 'x', name: 'Dana', company: 'Wix', email: undefined, referralLink: undefined, notes: undefined });
    expect(() => cleanContact({ name: '', company: 'Wix' }, 'x')).toThrow('חסר שם');
    expect(() => cleanContact({ name: 'D', company: 'Wix', email: 'nope' }, 'x')).toThrow('לא תקינה');
    expect(() => cleanContact({ name: 'D', company: 'Wix', referralLink: 'wix.com/ref' }, 'x')).toThrow('https://');
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, commas/newlines in quotes, CRLF and BOM', () => {
    const rows = parseCsvRows('﻿a,"b, c","say ""hi"""\r\n"multi\nline",x,\r\n\r\n');
    expect(rows).toEqual([['a', 'b, c', 'say "hi"'], ['multi\nline', 'x', '']]);
  });

  it('imports name,company,email,referralLink,notes with or without a header', () => {
    const withHeader = 'name,company,email,referralLink,notes\nDana Example,Wix,dana@example.com,https://wix.example/ref/1,"met at meetup, 2025"';
    const r = parseContactsCsv(withHeader);
    expect(r.errors).toEqual([]);
    expect(r.contacts).toEqual([{ name: 'Dana Example', company: 'Wix', email: 'dana@example.com', referralLink: 'https://wix.example/ref/1', notes: 'met at meetup, 2025' }]);
    expect(parseContactsCsv('Noa Example,Acme').contacts).toEqual([{ name: 'Noa Example', company: 'Acme', email: undefined, referralLink: undefined, notes: undefined }]);
  });

  it('accepts a header in any order, in Hebrew', () => {
    const r = parseContactsCsv('חברה,שם,מייל\nאקמה,יוני דוגמה,yoni@example.com');
    expect(r.contacts[0]).toMatchObject({ name: 'יוני דוגמה', company: 'אקמה', email: 'yoni@example.com' });
  });

  it('reports bad lines with their line number and keeps the good ones', () => {
    const r = parseContactsCsv('name,company,email\nDana,Wix,dana@example.com\n,Wix,\nNoa,Acme,not-an-email');
    expect(r.contacts).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});

describe('contacts repo', () => {
  it('CRUD', async () => {
    const c = await saveContact({ name: 'Dana Example', company: 'Wix' });
    await saveContact({ ...c, email: 'dana@example.com' });
    expect(await listContacts()).toEqual([{ ...c, email: 'dana@example.com' }]);
    await deleteContact(c.id);
    expect(await db.contacts.count()).toBe(0);
  });

  it('import updates the same person at the same company instead of duplicating', async () => {
    await saveContact({ name: 'Dana Example', company: 'Wix', notes: 'keep me' });
    const r = await importContacts([
      { name: 'dana example', company: 'WIX Ltd', email: 'dana@example.com' },
      { name: 'Noa Example', company: 'Acme' },
    ]);
    expect(r).toEqual({ added: 1, updated: 1 });
    const all = await listContacts();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.company === 'Wix' || c.company === 'WIX Ltd')).toMatchObject({ email: 'dana@example.com', notes: 'keep me' });
  });
});
