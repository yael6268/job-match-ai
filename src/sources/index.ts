import type { SourceName } from '@/shared/types';
import type { SourceAdapter } from './types';
import { greenhouse } from './greenhouse';
import { lever } from './lever';

/** Registry: source name -> adapter. Comeet and SmartRecruiters arrive in M7. */
export const ADAPTERS: Partial<Record<SourceName, SourceAdapter>> = {
  greenhouse,
  lever,
};

export const SUPPORTED_SOURCES = Object.keys(ADAPTERS) as SourceName[];

export function getAdapter(source: SourceName): SourceAdapter {
  const a = ADAPTERS[source];
  if (!a) throw new Error(`המקור "${source}" עדיין לא נתמך`);
  return a;
}

export type { SourceAdapter } from './types';
