import { describe, expect, it } from 'vitest';
import { deleteCv, getCv, listCvs, saveCv, updateCvMeta } from '@/db/repo';
import { db } from '@/db/schema';

const file = (s: string) => new Blob([s], { type: 'application/pdf' });
const TEXT = 'Sample User\ntest@example.com | 050-0000000\nQA Engineer, Selenium, Python';

describe('CV repo', () => {
  it('creates a CV with redacted text and a hash of it', async () => {
    const cv = await saveCv({ name: ' QA ', domains: ['QA', 'Automation', 'QA'], fileName: 'qa.pdf', fileBlob: file('a'), text: TEXT });
    expect(cv.id).toMatch(/[0-9a-f-]{36}/);
    expect(cv.name).toBe('QA');
    expect(cv.domains).toEqual(['QA', 'Automation']);
    expect(cv.text).toBe(TEXT);
    expect(cv.redactedText).not.toContain('@');
    expect(cv.redactedText).not.toContain('050');
    expect(cv.redactedText).toContain('Selenium');
    expect(cv.versionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores multiple versions and lists them by name', async () => {
    await saveCv({ name: 'QA', domains: ['QA'], fileName: 'a.pdf', fileBlob: file('a'), text: 'QA text with enough content' });
    await saveCv({ name: 'Backend', domains: ['Backend'], fileName: 'b.docx', fileBlob: file('b'), text: 'Backend text, Java and Go' });
    expect((await listCvs()).map((c) => c.name)).toEqual(['Backend', 'QA']);
  });

  it('replacing the file keeps the id and changes the hash; same text keeps the hash', async () => {
    const a = await saveCv({ name: 'QA', domains: [], fileName: 'a.pdf', fileBlob: file('a'), text: 'version one of the CV' });
    const same = await saveCv({ ...a, fileBlob: file('a2'), text: 'version one of the CV' });
    expect(same.versionHash).toBe(a.versionHash);
    const b = await saveCv({ ...a, fileName: 'b.pdf', fileBlob: file('b'), text: 'version two of the CV' });
    expect(b.id).toBe(a.id);
    expect(b.versionHash).not.toBe(a.versionHash);
    expect(await db.cvs.count()).toBe(1);
  });

  it('a contact-only change does not change the hash (only redacted text matters)', async () => {
    const a = await saveCv({ name: 'QA', domains: [], fileName: 'a.pdf', fileBlob: file('a'), text: 'QA Engineer\nold@example.com' });
    const b = await saveCv({ ...a, text: 'QA Engineer\nnew@example.com' });
    expect(b.versionHash).toBe(a.versionHash);
  });

  it('updateCvMeta changes name/domains without touching the hash', async () => {
    const a = await saveCv({ name: 'QA', domains: ['QA'], fileName: 'a.pdf', fileBlob: file('a'), text: 'QA text here' });
    await updateCvMeta(a.id, { name: 'QA Manual', domains: ['QA', 'Support'] });
    const got = (await getCv(a.id))!;
    expect(got.name).toBe('QA Manual');
    expect(got.domains).toEqual(['QA', 'Support']);
    expect(got.versionHash).toBe(a.versionHash);
  });

  it('keeps the file blob', async () => {
    const a = await saveCv({ name: 'QA', domains: [], fileName: 'a.pdf', fileBlob: file('%PDF-1.4'), text: 'QA text here' });
    const got = (await getCv(a.id))!;
    expect(await got.fileBlob.text()).toBe('%PDF-1.4');
    expect(got.fileBlob.type).toBe('application/pdf');
  });

  it('requires a name', async () => {
    await expect(saveCv({ name: '  ', domains: [], fileName: 'a.pdf', fileBlob: file('a'), text: 'x' })).rejects.toThrow('שם');
  });

  it('deletes', async () => {
    const a = await saveCv({ name: 'QA', domains: [], fileName: 'a.pdf', fileBlob: file('a'), text: 'QA text here' });
    await deleteCv(a.id);
    expect(await getCv(a.id)).toBeUndefined();
  });
});
