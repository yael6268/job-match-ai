import Dexie, { type EntityTable } from 'dexie';
import type { Application, Contact, CV, Job, Match, RunState } from '@/shared/types';

/** IndexedDB database — see SPEC.md section 5. */
export class JobMatchDb extends Dexie {
  jobs!: EntityTable<Job, 'id'>;
  matches!: EntityTable<Match, 'jobId'>;
  cvs!: EntityTable<CV, 'id'>;
  applications!: EntityTable<Application, 'jobId'>;
  contacts!: EntityTable<Contact, 'id'>;
  runs!: EntityTable<RunState, 'runId'>;

  constructor(name = 'jobmatch') {
    super(name);
    this.version(1).stores({
      jobs: 'id, source, company, status, firstSeenAt, lastSeenAt, viewed',
      matches: 'jobId, score, bestCvId, analyzedAt',
      cvs: 'id, name, updatedAt',
      applications: 'jobId, appliedAt, domain, cvId',
      contacts: 'id, company',
      runs: 'runId, startedAt',
    });
  }
}

export const db = new JobMatchDb();
