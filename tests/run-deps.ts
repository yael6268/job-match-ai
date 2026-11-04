// Test helper: the matching-related RunDeps for runs that only exercise the fetch phase.
// No CVs means the run skips prefilter/overlap/ai and finishes right after fetching.
import type { RunDeps } from '@/pipeline/run';
import { DEFAULT_SETTINGS } from '@/shared/storage';

export const NO_MATCHING: Pick<RunDeps, 'settings' | 'cvs' | 'createMatcher'> = {
  settings: async () => DEFAULT_SETTINGS,
  cvs: async () => [],
  createMatcher: () => {
    throw new Error('no AI in this test');
  },
};
