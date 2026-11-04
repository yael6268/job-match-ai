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
