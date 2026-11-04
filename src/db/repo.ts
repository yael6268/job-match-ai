import { z } from 'zod';
import { db } from './schema';
import type {
  Application, Contact, CV, Job, JobStatus, Match, RunState, SourceJob, SourceName,
} from '@/shared/types';
import { base64ToBlob, blobToBase64, jobIdFromUrl, sha256, uuid, weekStart } from '@/shared/utils';
import { redactCvText } from '@/cv/redact';

// ---------- jobs ----------

export interface UpsertResult {
  /** Ids that did not exist before this call — the "new" jobs for this run. */
  newIds: string[];
  /** Every id present in the input (new + existing). Feed to markClosed. */
  seenIds: string[];
}

/**
 * Insert jobs that don't exist yet (status 'new', firstSeenAt = now) and refresh the source fields
 * and lastSeenAt of existing ones. Never overwrites an existing status, except that a job that was
 * 'closed' and is listed again goes back to 'new' (it was re-opened by the company).
 */
export async function upsertJobsFromSource(
  incoming: SourceJob[],
  now: string = new Date().toISOString(),
): Promise<UpsertResult> {
  const withIds = await Promise.all(
    incoming.map(async (j) => ({ ...j, id: await jobIdFromUrl(j.url) })),
  );
  // Same URL twice in one response: keep the first.
  const byId = new Map<string, SourceJob & { id: string }>();
  for (const j of withIds) if (!byId.has(j.id)) byId.set(j.id, j);

  return db.transaction('rw', db.jobs, async () => {
    const existing = await db.jobs.bulkGet([...byId.keys()]);
    const newIds: string[] = [];
    const rows: Job[] = [];
    for (const [i, id] of [...byId.keys()].entries()) {
      const src = byId.get(id)!;
      const prev = existing[i];
      if (!prev) {
        newIds.push(id);
        rows.push({ ...src, firstSeenAt: now, lastSeenAt: now, status: 'new', viewed: false });
      } else {
        rows.push({
          ...prev,
          ...src,
          // Keep fields computed by the pipeline unless the source supplied a value.
          requiredYears: src.requiredYears ?? prev.requiredYears,
          prefilterPassed: prev.prefilterPassed,
          overlapScore: prev.overlapScore,
          firstSeenAt: prev.firstSeenAt,
          lastSeenAt: now,
          status: prev.status === 'closed' ? 'new' : prev.status,
          viewed: prev.viewed,
        });
      }
    }
    await db.jobs.bulkPut(rows);
    return { newIds, seenIds: [...byId.keys()] };
  });
}

/**
 * After a successful fetch of one company: jobs of that company that were 'new' or 'saved'
 * and are no longer listed become 'closed'. Returns how many were closed.
 */
export async function markClosed(
  source: SourceName,
  company: string,
  seenIds: Iterable<string>,
): Promise<number> {
  const seen = new Set(seenIds);
  return db.jobs
    .where('company')
    .equals(company)
    .filter((j) => j.source === source && (j.status === 'new' || j.status === 'saved') && !seen.has(j.id))
    .modify({ status: 'closed' });
}

export interface JobWithMatch {
  job: Job;
  match: Match;
}

/** Jobs for the Today screen: status 'new', analyzed, score >= minScore, best first. */
export async function getJobsForToday(minScore: number): Promise<JobWithMatch[]> {
  const jobs = await db.jobs.where('status').equals('new').toArray();
  const matches = await db.matches.bulkGet(jobs.map((j) => j.id));
  const out: JobWithMatch[] = [];
  jobs.forEach((job, i) => {
    const match = matches[i];
    if (match && match.score >= minScore) out.push({ job, match });
  });
  return out.sort((a, b) => b.match.score - a.match.score);
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  return db.jobs.get(jobId);
}

export async function setStatus(jobId: string, status: JobStatus): Promise<void> {
  const n = await db.jobs.update(jobId, { status });
  if (n === 0) throw new Error(`Job not found: ${jobId}`);
}

export async function markViewed(jobIds: string[]): Promise<void> {
  await db.transaction('rw', db.jobs, async () => {
    for (const id of jobIds) await db.jobs.update(id, { viewed: true });
  });
}

// ---------- matches ----------

export async function saveMatch(match: Match): Promise<void> {
  await db.matches.put(match);
}

export async function getMatch(jobId: string): Promise<Match | undefined> {
  return db.matches.get(jobId);
}

// ---------- CVs ----------

export interface CvInput {
  id?: string; // omit to create
  name: string;
  domains: string[];
  fileName: string;
  fileBlob: Blob;
  text: string;
}

/**
 * Creates or replaces a CV. Redacted text and versionHash are always recomputed from `text`,
 * so a changed file changes the hash (which later invalidates cached AI matches).
 */
export async function saveCv(input: CvInput, now: string = new Date().toISOString()): Promise<CV> {
  const name = input.name.trim();
  if (!name) throw new Error('יש לתת שם לגרסת קורות החיים');
  const redactedText = redactCvText(input.text);
  const cv: CV = {
    id: input.id ?? uuid(),
    name,
    domains: [...new Set(input.domains)],
    fileName: input.fileName,
    fileBlob: input.fileBlob,
    text: input.text,
    redactedText,
    versionHash: await sha256(redactedText),
    updatedAt: now,
  };
  await db.cvs.put(cv);
  return cv;
}

/** Updates only name/domains (no file change, so the versionHash stays). */
export async function updateCvMeta(id: string, meta: { name: string; domains: string[] }): Promise<void> {
  const name = meta.name.trim();
  if (!name) throw new Error('יש לתת שם לגרסת קורות החיים');
  const n = await db.cvs.update(id, { name, domains: [...new Set(meta.domains)] });
  if (n === 0) throw new Error(`CV not found: ${id}`);
}

export async function listCvs(): Promise<CV[]> {
  const cvs = await db.cvs.toArray();
  return cvs.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function getCv(id: string): Promise<CV | undefined> {
  return db.cvs.get(id);
}

export async function deleteCv(id: string): Promise<void> {
  await db.cvs.delete(id);
}

// ---------- applications & stats ----------

/** Records an application and moves the job to 'applied' atomically. */
export async function addApplication(app: Application): Promise<void> {
  await db.transaction('rw', db.applications, db.jobs, async () => {
    await db.applications.put(app);
    await db.jobs.update(app.jobId, { status: 'applied' });
  });
}

export interface Stats {
  totalApplied: number;
  totalSaved: number;
  perDomain: Record<string, number>;
  /** keyed by CV id; the UI resolves names (a deleted CV keeps its id here). */
  perCv: Record<string, number>;
  /** keyed by week start (Sunday) YYYY-MM-DD, ascending. */
  perWeek: Record<string, number>;
}

export async function getStats(): Promise<Stats> {
  const apps = await db.applications.toArray();
  const totalSaved = await db.jobs.where('status').equals('saved').count();
  const perDomain: Record<string, number> = {};
  const perCv: Record<string, number> = {};
  const perWeekUnsorted: Record<string, number> = {};
  for (const a of apps) {
    perDomain[a.domain] = (perDomain[a.domain] ?? 0) + 1;
    perCv[a.cvId] = (perCv[a.cvId] ?? 0) + 1;
    const w = weekStart(a.appliedAt);
    perWeekUnsorted[w] = (perWeekUnsorted[w] ?? 0) + 1;
  }
  const perWeek = Object.fromEntries(
    Object.entries(perWeekUnsorted).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { totalApplied: apps.length, totalSaved, perDomain, perCv, perWeek };
}

// ---------- backup ----------

const BACKUP_FORMAT = 'jobmatch-backup';
const BACKUP_VERSION = 1;

type SerializedCv = Omit<CV, 'fileBlob'> & { fileBase64: string; fileType: string };

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  jobs: Job[];
  matches: Match[];
  cvs: SerializedCv[];
  applications: Application[];
  contacts: Contact[];
  runs: RunState[];
}

/** Everything in IndexedDB as a JSON-safe object (CV files become base64). */
export async function exportAll(): Promise<Backup> {
  const [jobs, matches, cvs, applications, contacts, runs] = await Promise.all([
    db.jobs.toArray(),
    db.matches.toArray(),
    db.cvs.toArray(),
    db.applications.toArray(),
    db.contacts.toArray(),
    db.runs.toArray(),
  ]);
  const serializedCvs = await Promise.all(
    cvs.map(async ({ fileBlob, ...rest }) => ({
      ...rest,
      fileBase64: await blobToBase64(fileBlob),
      fileType: fileBlob.type,
    })),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    jobs,
    matches,
    cvs: serializedCvs,
    applications,
    contacts,
    runs,
  };
}

// Envelope check only; rows are trusted as our own export format.
const backupEnvelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().max(BACKUP_VERSION),
  jobs: z.array(z.object({ id: z.string() }).passthrough()),
  matches: z.array(z.object({ jobId: z.string() }).passthrough()),
  cvs: z.array(z.object({ id: z.string(), fileBase64: z.string(), fileType: z.string() }).passthrough()),
  applications: z.array(z.object({ jobId: z.string() }).passthrough()),
  contacts: z.array(z.object({ id: z.string() }).passthrough()),
  runs: z.array(z.object({ runId: z.string() }).passthrough()),
});

/** Replaces all IndexedDB data with the backup. Throws (and changes nothing) if the JSON is invalid. */
export async function importAll(json: unknown): Promise<void> {
  const parsed = backupEnvelope.safeParse(typeof json === 'string' ? JSON.parse(json) : json);
  if (!parsed.success) throw new Error('קובץ הגיבוי אינו תקין');
  const b = parsed.data as unknown as Backup;
  const cvs: CV[] = b.cvs.map(({ fileBase64, fileType, ...rest }) => ({
    ...rest,
    fileBlob: base64ToBlob(fileBase64, fileType),
  }));
  await db.transaction('rw', [db.jobs, db.matches, db.cvs, db.applications, db.contacts, db.runs], async () => {
    await Promise.all([
      db.jobs.clear(), db.matches.clear(), db.cvs.clear(),
      db.applications.clear(), db.contacts.clear(), db.runs.clear(),
    ]);
    await db.jobs.bulkPut(b.jobs);
    await db.matches.bulkPut(b.matches);
    await db.cvs.bulkPut(cvs);
    await db.applications.bulkPut(b.applications);
    await db.contacts.bulkPut(b.contacts);
    await db.runs.bulkPut(b.runs);
  });
}

/** Deletes every row in every table ("reset all data"). */
export async function clearAll(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}
