// Prompt builders (SPEC.md section 8.2). Only the CVs' redactedText is ever sent.
import type { CV, Job } from '@/shared/types';

/** Long texts are cut so one call stays well inside the model's limits and the free-tier quota. */
export const MAX_JOB_CHARS = 12_000;
export const MAX_CV_CHARS = 12_000;

export const MATCH_SYSTEM_INSTRUCTION = `You are a technical recruiter in Israel's tech industry.
You get one job posting and several versions of the same candidate's CV, each with an id.
Compare the job to every CV version and pick the single best one.

Rules:
- "score" (0-100) is the fit of the BEST CV to this job: skills, tech stack, seniority and domain.
  Be honest and calibrated: 85+ only for a strong match, below 50 when key requirements are missing.
- "bestCvId" must be one of the provided CV ids.
- "requiredYears": the minimum years of experience the job asks for, or null if it does not say.
- "reasons": 2-4 short sentences in Hebrew explaining the score.
- "tips": 3-5 concrete tips in Hebrew, specific to THIS job, on what to add, emphasize, reorder or remove
  in the chosen CV. Each tip quotes (in its original language) the job requirement it addresses.
- Never suggest adding experience, skills or tools that do not appear in the CV. You may suggest
  emphasizing or rephrasing what exists, and you may point out a gap honestly.
- Return JSON only.`;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated]`;
}

export function buildMatchPrompt(
  job: Pick<Job, 'title' | 'company' | 'location' | 'descriptionText'>,
  cvs: Pick<CV, 'id' | 'name' | 'domains' | 'redactedText'>[],
): string {
  const cvBlocks = cvs.map((cv) =>
    [
      `<cv id="${cv.id}">`,
      `Version name: ${cv.name}`,
      `Domains: ${cv.domains.join(', ') || '-'}`,
      clip(cv.redactedText, MAX_CV_CHARS),
      '</cv>',
    ].join('\n'),
  );
  return [
    '<job>',
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    '',
    clip(job.descriptionText, MAX_JOB_CHARS),
    '</job>',
    '',
    ...cvBlocks,
  ].join('\n');
}

// ---------- referral email (SPEC.md section 8.3) ----------

export interface ReferralInput {
  jobTitle: string;
  company: string;
  contactName: string;
  userFirstName: string;
  /** Short summary of the best CV — built from its redacted text only. */
  cvSummary: string;
}

export const REFERRAL_SYSTEM_INSTRUCTION = `You write short referral-request emails in Hebrew for a job seeker in Israel's tech industry.
The sender asks a contact who works at the company to refer them to a specific open position.

Rules:
- Hebrew, short and polite, 80-120 words in the body. Warm but professional; no flattery, no pressure.
- Address the contact by first name. Sign with the sender's first name.
- Mention the exact job title and company, and in one or two sentences why the sender fits, based only on
  the CV summary. Never invent experience, skills, employers or numbers that are not in it.
- Make it easy to say yes: offer to send the CV, and thank them either way.
- No placeholders like [name] or <link>; if something is unknown, leave it out.
- "subject" is a short Hebrew subject line that includes the job title.
- Return JSON only.`;

/** Name, domains and the start of the redacted CV text: enough for a one-line "why me". */
export function cvSummary(cv: { name: string; domains: string[]; redactedText: string }, maxChars = 900): string {
  const text = cv.redactedText.replace(/\s+/g, ' ').trim();
  return [`CV version: ${cv.name}`, `Domains: ${cv.domains.join(', ') || '-'}`, clip(text, maxChars)].join('\n');
}

export function buildReferralPrompt(i: ReferralInput): string {
  return [
    `Job title: ${i.jobTitle}`,
    `Company: ${i.company}`,
    `Contact name: ${i.contactName}`,
    `Sender first name: ${i.userFirstName || '(unknown — sign without a name)'}`,
    '',
    '<cv_summary>',
    i.cvSummary,
    '</cv_summary>',
  ].join('\n');
}
