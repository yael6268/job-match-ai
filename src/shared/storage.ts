// Profile and Settings live in chrome.storage.local (SPEC.md section 5), not IndexedDB.
import { z } from 'zod';
import { browser } from 'wxt/browser';
import type { Profile, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: '',
  geminiModel: '',
  minScoreToShow: 60,
  minScoreToNotify: 75,
  runHour: 8,
  dailyCallLimit: 200,
  maxAiCandidatesPerRun: 40,
  locations: ['Israel', 'ישראל', 'Tel Aviv', 'תל אביב', 'Remote', 'Hybrid'],
  maxRequiredYears: 5,
  excludedTitleWords: ['senior director', 'vp', 'vice president', 'head of', 'principal', 'staff'],
  aiDelaySeconds: 4,
};

export const EMPTY_PROFILE: Profile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedin: '',
  city: '',
};

export const settingsSchema = z.object({
  geminiApiKey: z.string(),
  geminiModel: z.string(),
  minScoreToShow: z.number().int().min(0).max(100),
  minScoreToNotify: z.number().int().min(0).max(100),
  runHour: z.number().int().min(0).max(23),
  dailyCallLimit: z.number().int().min(1).max(100_000),
  maxAiCandidatesPerRun: z.number().int().min(1).max(1000),
  locations: z.array(z.string()),
  maxRequiredYears: z.number().int().min(0).max(30),
  excludedTitleWords: z.array(z.string()),
  aiDelaySeconds: z.number().min(0).max(120),
});

const KEYS = { settings: 'settings', profile: 'profile' } as const;

export const NOT_IN_EXTENSION_MSG =
  'השמירה זמינה רק כשהתוסף טעון בכרום (chrome://extensions ← Load unpacked). בתצוגה מקדימה רגילה אין גישה לאחסון.';

/** chrome.storage.local, or a clear Hebrew error when the page runs outside the extension (e.g. a static preview). */
function local() {
  const area = browser?.storage?.local;
  if (!area) throw new Error(NOT_IN_EXTENSION_MSG);
  return area;
}

/** Merge stored values over defaults, dropping anything that fails validation. */
export function mergeSettings(stored: unknown): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(isObject(stored) ? stored : {}) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function getSettings(): Promise<Settings> {
  const res = await local().get(KEYS.settings);
  return mergeSettings(res[KEYS.settings]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await local().set({ [KEYS.settings]: next });
  return next;
}

export async function getProfile(): Promise<Profile> {
  const res = await local().get(KEYS.profile);
  const stored = res[KEYS.profile];
  return { ...EMPTY_PROFILE, ...(isObject(stored) ? (stored as Partial<Profile>) : {}) };
}

export async function saveProfile(profile: Profile): Promise<void> {
  await local().set({ [KEYS.profile]: profile });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
