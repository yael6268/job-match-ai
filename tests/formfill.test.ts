import { describe, expect, it } from 'vitest';
import { classifyField, jobRefFromUrl, norm, pickResumeInput, profileValue, type FieldInfo } from '@/formfill/fields';
import { EMPTY_PROFILE } from '@/shared/storage';

const f = (over: Partial<FieldInfo>): FieldInfo => ({
  tag: 'input', type: 'text', name: '', id: '', autocomplete: '', ariaLabel: '', placeholder: '', label: '', ...over,
});

describe('classifyField — real forms', () => {
  it('Greenhouse embed form (ids + autocomplete + aria)', () => {
    expect(classifyField(f({ id: 'first_name', autocomplete: 'given-name', ariaLabel: 'First Name', label: 'First Name*' }))).toBe('firstName');
    expect(classifyField(f({ id: 'last_name', autocomplete: 'family-name', ariaLabel: 'Last Name' }))).toBe('lastName');
    expect(classifyField(f({ id: 'email', autocomplete: 'email', label: 'Email*' }))).toBe('email');
    expect(classifyField(f({ id: 'phone', type: 'tel', autocomplete: 'off', ariaLabel: 'Phone' }))).toBe('phone');
  });

  it('never fills "Preferred First Name" or other people\'s details', () => {
    expect(classifyField(f({ id: 'preferred_name', ariaLabel: 'Preferred First Name', label: 'Preferred First Name' }))).toBeNull();
    expect(classifyField(f({ name: 'org', label: 'Current company' }))).toBeNull();
    expect(classifyField(f({ label: 'Reference full name' }))).toBeNull();
    expect(classifyField(f({ label: "Recruiter's email" }))).toBeNull();
    expect(classifyField(f({ id: 'question_1', label: 'How did you first hear about this job?' }))).toBeNull();
  });

  it('Lever apply form (name attributes)', () => {
    expect(classifyField(f({ name: 'name' }))).toBe('fullName');
    expect(classifyField(f({ name: 'email', type: 'email' }))).toBe('email');
    expect(classifyField(f({ name: 'phone' }))).toBe('phone');
    expect(classifyField(f({ name: 'urls[LinkedIn]' }))).toBe('linkedin');
    expect(classifyField(f({ name: 'urls[GitHub]' }))).toBeNull();
  });

  it('Hebrew labels and placeholders', () => {
    expect(classifyField(f({ label: 'שם פרטי' }))).toBe('firstName');
    expect(classifyField(f({ placeholder: 'שם משפחה' }))).toBe('lastName');
    expect(classifyField(f({ label: 'שם מלא' }))).toBe('fullName');
    expect(classifyField(f({ label: 'דוא"ל' }))).toBe('email');
    expect(classifyField(f({ ariaLabel: 'מייל' }))).toBe('email');
    expect(classifyField(f({ label: 'טלפון נייד' }))).toBe('phone');
    expect(classifyField(f({ label: 'עיר מגורים' }))).toBe('city');
    expect(classifyField(f({ label: 'פרופיל לינקדאין' }))).toBe('linkedin');
  });

  it('falls back to the input type, and skips selects, checkboxes and files', () => {
    expect(classifyField(f({ type: 'email' }))).toBe('email');
    expect(classifyField(f({ type: 'tel' }))).toBe('phone');
    expect(classifyField(f({ tag: 'select', name: 'email' }))).toBeNull();
    expect(classifyField(f({ type: 'checkbox', name: 'email' }))).toBeNull();
    expect(classifyField(f({ type: 'file', name: 'resume' }))).toBeNull();
  });

  it('name/id win over a misleading label (attribute order from the spec)', () => {
    expect(classifyField(f({ id: 'email', label: 'Phone or email' }))).toBe('email');
  });

  it('norm splits separators', () => {
    expect(norm('urls[LinkedIn]')).toBe('urls linkedin');
    expect(norm('first_name')).toBe('first name');
  });
});

describe('profileValue', () => {
  const p = { ...EMPTY_PROFILE, firstName: 'Test', lastName: 'User', email: ' test@example.com ', phone: '050-0000000' };
  it('full name falls back to first + last; values are trimmed', () => {
    expect(profileValue(p, 'fullName')).toBe('Test User');
    expect(profileValue({ ...p, fullName: 'Test Q. User' }, 'fullName')).toBe('Test Q. User');
    expect(profileValue(p, 'email')).toBe('test@example.com');
    expect(profileValue(p, 'city')).toBe('');
  });
});

describe('pickResumeInput', () => {
  it('picks the resume, never the cover letter', () => {
    expect(pickResumeInput([{ name: '', id: 'resume', ariaLabel: '', label: 'Attach' }, { name: '', id: 'cover_letter', ariaLabel: '', label: 'Attach' }])).toBe(0);
    expect(pickResumeInput([{ name: '', id: 'cover_letter', ariaLabel: '', label: '' }, { name: 'resume', id: 'resume-upload-input', ariaLabel: '', label: '' }])).toBe(1);
    expect(pickResumeInput([{ name: '', id: 'x', ariaLabel: '', label: 'קורות חיים' }])).toBe(0);
  });

  it('a single unnamed file input is the CV; several unnamed ones are ambiguous', () => {
    expect(pickResumeInput([{ name: 'file', id: '', ariaLabel: '', label: '' }])).toBe(0);
    expect(pickResumeInput([{ name: 'a', id: '', ariaLabel: '', label: '' }, { name: 'b', id: '', ariaLabel: '', label: '' }])).toBe(-1);
    expect(pickResumeInput([{ name: 'cover', id: '', ariaLabel: '', label: '' }])).toBe(-1);
    expect(pickResumeInput([])).toBe(-1);
  });
});

describe('jobRefFromUrl', () => {
  it.each([
    ['https://job-boards.greenhouse.io/embed/job_app?for=taboola&token=8146220', 'greenhouse', '8146220'],
    ['https://boards.greenhouse.io/embed/job_app?for=taboola&token=8146220', 'greenhouse', '8146220'],
    ['https://job-boards.greenhouse.io/forter/jobs/8905280002?gh_src=x', 'greenhouse', '8905280002'],
    ['https://jobs.lever.co/walkme/ed7c7019-56c5-4b89-90fe-2ee6cb255f48/apply', 'lever', 'ed7c7019-56c5-4b89-90fe-2ee6cb255f48'],
    ['https://jobs.eu.lever.co/acme/ed7c7019-56c5-4b89-90fe-2ee6cb255f48', 'lever', 'ed7c7019-56c5-4b89-90fe-2ee6cb255f48'],
    ['https://www.comeet.com/jobs/upwind/49.004/ai-engineer/5C.375', 'comeet', '5C.375'],
    ['https://www.comeet.co/jobs/49.004/5c.375/apply?token=X&company-uid=49.004', 'comeet', '5C.375'],
  ])('%s', (url, source, id) => {
    expect(jobRefFromUrl(url)).toEqual({ source, sourceJobId: id });
  });

  it('pages that are not a specific job', () => {
    expect(jobRefFromUrl('https://job-boards.greenhouse.io/forter')).toBeUndefined();
    expect(jobRefFromUrl('https://jobs.lever.co/walkme')).toBeUndefined();
    expect(jobRefFromUrl('https://www.comeet.com/jobs/upwind/49.004')).toBeUndefined();
    expect(jobRefFromUrl('not a url')).toBeUndefined();
  });
});

// ---------- background side ----------
import { db } from '@/db/schema';
import { saveMatch, upsertJobsFromSource } from '@/db/repo';
import { getFillData, markAppliedFromForm } from '@/formfill/data';
import { greenhouseApplyUrl, mapGreenhouse } from '@/sources/greenhouse';
import { saveProfile } from '@/shared/storage';
import ghFixture from './fixtures/greenhouse-riskified.json';
import type { CV, SourceJob } from '@/shared/types';

function cvRow(id: string, name: string, domains: string[]): CV {
  return {
    id, name, domains, fileName: `${id}.pdf`, fileBlob: new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
    text: 't', redactedText: 't', versionHash: id, updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const ghJob: SourceJob = {
  source: 'greenhouse', sourceJobId: '8146220', company: 'Taboola', title: 'Senior Backend Engineer',
  url: 'https://www.taboola.com/careers/job/8146220?gh_jid=8146220', applyUrl: greenhouseApplyUrl('taboola', 8146220),
  location: 'Tel Aviv', descriptionText: '',
};

describe('greenhouse apply URL', () => {
  it('every job gets the hosted form address, recognised by the form filler', () => {
    const job = mapGreenhouse(ghFixture, { name: 'Riskified', source: 'greenhouse', boardId: 'riskified', enabled: true })[0]!;
    expect(job.applyUrl).toBe(`https://job-boards.greenhouse.io/embed/job_app?for=riskified&token=${job.sourceJobId}`);
    expect(jobRefFromUrl(job.applyUrl!)).toEqual({ source: 'greenhouse', sourceJobId: job.sourceJobId });
  });
});

describe('getFillData / markAppliedFromForm', () => {
  it('finds the job from the form URL and picks the recommended CV', async () => {
    await saveProfile({ ...EMPTY_PROFILE, firstName: 'Test', email: 'test@example.com' });
    const { newIds } = await upsertJobsFromSource([ghJob]);
    await db.cvs.bulkPut([cvRow('a', 'Full Stack', ['Full Stack']), cvRow('b', 'Backend', ['Backend'])]);
    await saveMatch({ jobId: newIds[0]!, score: 80, bestCvId: 'b', reasons: [], tips: [], cvVersionHashes: 'x', model: 'm', analyzedAt: '' });

    const d = await getFillData('https://job-boards.greenhouse.io/embed/job_app?for=taboola&token=8146220');
    expect(d.profile.firstName).toBe('Test');
    expect(d.job).toMatchObject({ id: newIds[0], title: 'Senior Backend Engineer', status: 'new' });
    expect(d.cv).toMatchObject({ id: 'b', name: 'Backend', fileName: 'b.pdf', type: 'application/pdf' });
    expect(atob(d.cv!.base64)).toBe('%PDF');
  });

  it('unknown job: no job, first CV; no CVs: no CV', async () => {
    await db.cvs.put(cvRow('a', 'Full Stack', ['Full Stack']));
    const d = await getFillData('https://jobs.lever.co/acme/ed7c7019-56c5-4b89-90fe-2ee6cb255f48/apply');
    expect(d.job).toBeNull();
    expect(d.cv!.id).toBe('a');
    await db.cvs.clear();
    expect((await getFillData('https://example.com')).cv).toBeNull();
  });

  it('marks the job applied with the attached CV and its domain', async () => {
    const { newIds } = await upsertJobsFromSource([ghJob]);
    await db.cvs.put(cvRow('b', 'Backend', ['Full Stack', 'Backend']));
    await markAppliedFromForm(newIds[0]!, 'b');
    expect((await db.jobs.get(newIds[0]!))!.status).toBe('applied');
    expect(await db.applications.get(newIds[0]!)).toMatchObject({ cvId: 'b', domain: 'Backend', viaReferral: false });
    await expect(markAppliedFromForm('missing', 'b')).rejects.toThrow('לא נמצאה');
  });
});

describe('SmartRecruiters forms', () => {
  it('recognises the Easy-apply form by publication uuid and the job page by posting id', () => {
    expect(jobRefFromUrl('https://jobs.smartrecruiters.com/oneclick-ui/company/CheckPointSoftwareTechnologies2/publication/690CBBAA-df0a-481b-933c-c97ac2bd9f62?dcr_ci=x'))
      .toEqual({ source: 'smartrecruiters', applyUrlKey: '690cbbaa-df0a-481b-933c-c97ac2bd9f62' });
    expect(jobRefFromUrl('https://jobs.smartrecruiters.com/CheckPointSoftwareTechnologies2/744000158968719-network-engineer'))
      .toEqual({ source: 'smartrecruiters', sourceJobId: '744000158968719' });
    expect(jobRefFromUrl('https://jobs.smartrecruiters.com/CheckPointSoftwareTechnologies2')).toBeUndefined();
  });

  it('finds the job whose stored apply link has that uuid', async () => {
    const uuid = '690cbbaa-df0a-481b-933c-c97ac2bd9f62';
    const { newIds } = await upsertJobsFromSource([{
      source: 'smartrecruiters', sourceJobId: '744000158968719', company: 'Check Point', title: 'Network Engineer',
      url: 'https://jobs.smartrecruiters.com/CheckPointSoftwareTechnologies2/744000158968719-network-engineer',
      applyUrl: `https://jobs.smartrecruiters.com/oneclick-ui/company/CheckPointSoftwareTechnologies2/publication/${uuid}`,
      location: 'Tel Aviv', descriptionText: '',
    }]);
    const d = await getFillData(`https://jobs.smartrecruiters.com/oneclick-ui/company/CheckPointSoftwareTechnologies2/publication/${uuid}?dcr_ci=x`);
    expect(d.job?.id).toBe(newIds[0]);
  });

  it('SmartRecruiters field attributes (inside spl-input) classify correctly', () => {
    expect(classifyField(f({ id: 'first-name-input', autocomplete: 'given-name', label: 'First name*' }))).toBe('firstName');
    expect(classifyField(f({ id: 'last-name-input', autocomplete: 'family-name', label: 'Last name*' }))).toBe('lastName');
    expect(classifyField(f({ id: 'email-input', type: 'email', autocomplete: 'email', label: 'Email*' }))).toBe('email');
    expect(classifyField(f({ id: 'confirm-email-input', type: 'email', autocomplete: 'email', label: 'Confirm your email*' }))).toBe('email');
    expect(pickResumeInput([{ name: '', id: 'spl-dropzone-file-input-2', ariaLabel: '', label: 'Choose a file or drop it here' }])).toBe(0);
  });
});
