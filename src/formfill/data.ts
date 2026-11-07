// Background side of the form filler: what to fill on a given form page, and "mark as applied".
import { db } from '@/db/schema';
import { addApplication, getMatch, listCvs } from '@/db/repo';
import { applicationDomain } from '@/pipeline/prefilter';
import { getProfile } from '@/shared/storage';
import type { Job, JobStatus, Profile } from '@/shared/types';
import { blobToBase64 } from '@/shared/utils';
import { jobRefFromUrl, type JobRef } from './fields';

export interface FillData {
  profile: Profile;
  /** The job this form belongs to, if it is in the DB. */
  job: { id: string; title: string; company: string; status: JobStatus } | null;
  /** CV to attach: the recommended one for this job, else the first CV. File as base64 (messages are JSON). */
  cv: { id: string; name: string; fileName: string; type: string; base64: string } | null;
}

export async function findJobByRef(ref: JobRef): Promise<Job | undefined> {
  return db.jobs
    .where('source')
    .equals(ref.source)
    .filter((j) =>
      ref.sourceJobId !== undefined
        ? j.sourceJobId === ref.sourceJobId
        : !!ref.applyUrlKey && (j.applyUrl ?? '').toLowerCase().includes(ref.applyUrlKey))
    .first();
}

export async function getFillData(url: string): Promise<FillData> {
  const ref = jobRefFromUrl(url);
  const [profile, cvs, job] = await Promise.all([getProfile(), listCvs(), ref ? findJobByRef(ref) : undefined]);
  const match = job ? await getMatch(job.id) : undefined;
  const cv = cvs.find((c) => c.id === match?.bestCvId) ?? cvs[0];
  return {
    profile,
    job: job ? { id: job.id, title: job.title, company: job.company, status: job.status } : null,
    cv: cv
      ? { id: cv.id, name: cv.name, fileName: cv.fileName, type: cv.fileBlob.type || 'application/octet-stream', base64: await blobToBase64(cv.fileBlob) }
      : null,
  };
}

/** The banner's "סמני כהוגשה": records the application with the CV that was attached. */
export async function markAppliedFromForm(jobId: string, cvId: string): Promise<void> {
  const job = await db.jobs.get(jobId);
  if (!job) throw new Error('המשרה לא נמצאה במאגר');
  const cv = cvId ? await db.cvs.get(cvId) : undefined;
  await addApplication({
    jobId,
    cvId,
    appliedAt: new Date().toISOString(),
    domain: applicationDomain(job.title, cv?.domains ?? []),
    viaReferral: false,
  });
}
