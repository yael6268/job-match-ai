import type { Company, SourceJob, SourceName } from '@/shared/types';

export interface SourceAdapter {
  name: SourceName;
  /** Fetch all currently open jobs for one company. Must throw a descriptive Error on failure. */
  fetchJobs(company: Company): Promise<SourceJob[]>;
  /** URL patterns of this source's application forms, used by the content script. */
  applyUrlPatterns: string[];
}
