import type { SourceName } from '@/shared/types';
import type { SourceAdapter } from './types';
import { greenhouse } from './greenhouse';
import { comeet } from './comeet';
import { lever } from './lever';
import { smartrecruiters } from './smartrecruiters';

/** Registry: source name -> adapter. */
export const ADAPTERS: Partial<Record<SourceName, SourceAdapter>> = {
  greenhouse,
  lever,
  comeet,
  smartrecruiters,
};

export const SUPPORTED_SOURCES = Object.keys(ADAPTERS) as SourceName[];

export function getAdapter(source: SourceName): SourceAdapter {
  const a = ADAPTERS[source];
  if (!a) throw new Error(`המקור "${source}" עדיין לא נתמך`);
  return a;
}

export type { SourceAdapter } from './types';
