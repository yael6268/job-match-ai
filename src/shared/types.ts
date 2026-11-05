// Domain types — see SPEC.md section 4. Keep in sync with the spec.

export type SourceName = 'greenhouse' | 'lever' | 'comeet' | 'smartrecruiters';

export type JobStatus = 'new' | 'saved' | 'applied' | 'dismissed' | 'closed';

export interface Company {
  name: string; // display name, e.g. "Wix"
  source: SourceName;
  boardId: string; // greenhouse board token / lever company slug / comeet company uid
  token?: string; // comeet public token, if needed
  country?: string; // smartrecruiters: only postings in this ISO country (e.g. "il"); empty = all
  aliases?: string[]; // for matching contacts, e.g. ["Wix.com"]
  enabled: boolean;
  example?: boolean; // seeded sample entry from companies.json (shown with a badge)
}

export interface Job {
  id: string; // sha256(normalizedUrl) — stable, see utils.normalizeUrl
  source: SourceName;
  sourceJobId: string; // the id from the source API
  company: string;
  title: string;
  url: string; // public job page
  applyUrl?: string;
  location: string;
  department?: string;
  descriptionText: string; // plain text, HTML stripped
  postedAt?: string; // ISO
  firstSeenAt: string; // ISO, set once
  lastSeenAt: string; // ISO, updated each run while still listed
  requiredYears?: number; // from experience.ts
  status: JobStatus;
  prefilterPassed?: boolean;
  overlapScore?: number; // 0..1, best across CVs
  viewed: boolean; // for the badge count
}

/** A job as returned by a source adapter, before the repo assigns identity and lifecycle fields. */
export type SourceJob = Omit<Job, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'status' | 'viewed'>;

export interface CV {
  id: string; // uuid
  name: string; // "QA", "Backend"...
  domains: string[]; // user-chosen domains, see DOMAINS constant
  fileName: string;
  fileBlob: Blob; // original file, used for form upload
  text: string; // extracted full text (local only)
  redactedText: string; // text sent to AI (no phone/email/address)
  versionHash: string; // sha256(redactedText) — invalidates cached matches when CV changes
  updatedAt: string;
}

export interface Match {
  jobId: string;
  score: number; // 0..100
  bestCvId: string;
  reasons: string[]; // short Hebrew sentences
  tips: string[]; // concrete, job-specific Hebrew tips
  requiredYears?: number;
  cvVersionHashes: string; // joined versionHash of all CVs used, for cache invalidation
  model: string;
  analyzedAt: string;
}

export interface Application {
  jobId: string;
  cvId: string;
  appliedAt: string;
  domain: string; // category used for stats
  viaReferral: boolean;
  contactId?: string;
  notes?: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  email?: string;
  referralLink?: string;
  notes?: string;
}

export interface Profile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin?: string;
  city?: string;
}

export interface Settings {
  geminiApiKey: string;
  geminiModel: string; // chosen from the models list, not hardcoded
  minScoreToShow: number; // default 60
  minScoreToNotify: number; // default 75
  runHour: number; // 0..23, default 8
  dailyCallLimit: number; // default 200 — user should check current free-tier quota
  maxAiCandidatesPerRun: number; // default 40
  locations: string[]; // default ["Israel", "Tel Aviv", "Remote", "Hybrid", ...]
  maxRequiredYears: number; // prefilter: skip jobs that ask for more, default 5
  excludedTitleWords: string[]; // prefilter: skip titles with these words/phrases
  aiDelaySeconds: number; // minimum delay between Gemini calls, default 4
}

export interface RunError {
  source: string;
  company?: string;
  message: string;
  at: string;
}

export interface RunState {
  runId: string;
  kind: 'full' | 'daily';
  startedAt: string;
  phase: 'fetch' | 'prefilter' | 'overlap' | 'ai' | 'done' | 'error';
  companiesDone: string[]; // for resume
  /** Job ids that passed this run's prefilter; input of the overlap phase (optional for older rows). */
  prefilterPassedIds?: string[];
  aiQueue: string[]; // job ids waiting for AI
  aiDone: string[];
  callsToday: number;
  callsDate: string; // YYYY-MM-DD, reset counter when date changes
  errors: RunError[];
  finishedAt?: string;
  /** Counters for the progress UI (not in the original spec; optional for older rows). */
  progress?: RunProgress;
}

export interface RunProgress {
  companiesTotal: number;
  jobsSeen: number;
  jobsNew: number;
  jobsClosed: number;
  jobsPassedPrefilter?: number;
  /** Size of aiQueue after the overlap phase (carried-over + this run's candidates). */
  aiQueued?: number;
}

export const DOMAINS = [
  'QA', 'Automation', 'Backend', 'Frontend', 'Full Stack', 'DevOps',
  'Data', 'Mobile', 'Embedded', 'Security', 'Product', 'Support',
] as const;

export type Domain = (typeof DOMAINS)[number];
