// Full JSON backup (SPEC.md section 9.8): IndexedDB (repo.exportAll) + profile, settings and companies
// from chrome.storage.local. The Gemini API key is never written to the file, and an import keeps
// the key that is already set.
import { browser } from 'wxt/browser';
import { clearAll, exportAll, importAll, type Backup } from '@/db/repo';
import { getCompanies, parseCompany, saveCompanies } from './companies';
import { EMPTY_PROFILE, getProfile, getSettings, mergeSettings, NOT_IN_EXTENSION_MSG, saveProfile, saveSettings } from './storage';
import type { Company, Profile, Settings } from './types';

export interface FullBackup extends Backup {
  storage: { profile: Profile; settings: Settings; companies: Company[] };
}

export async function exportBackup(): Promise<FullBackup> {
  const [data, profile, settings, companies] = await Promise.all([exportAll(), getProfile(), getSettings(), getCompanies()]);
  return { ...data, storage: { profile, settings: { ...settings, geminiApiKey: '' }, companies } };
}

export function backupFileName(now: Date = new Date()): string {
  return `job-match-backup-${now.toISOString().slice(0, 10)}.json`;
}

const BAD_FILE = 'קובץ הגיבוי אינו תקין';

/** Validates the chrome.storage part up front, so a broken file changes nothing. */
function parseStorage(raw: unknown): FullBackup['storage'] | undefined {
  if (raw === undefined) return undefined; // older backup with IndexedDB data only
  const s = raw as { profile?: unknown; settings?: unknown; companies?: unknown } | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.companies)) throw new Error(BAD_FILE);
  let companies: Company[];
  try {
    companies = s.companies.map(parseCompany);
  } catch {
    throw new Error(BAD_FILE);
  }
  const p = (s.profile && typeof s.profile === 'object' ? s.profile : {}) as Record<string, unknown>;
  const profile = Object.fromEntries(
    Object.entries(EMPTY_PROFILE).map(([k, v]) => [k, typeof p[k] === 'string' ? p[k] : v]),
  ) as unknown as Profile;
  return { profile, settings: mergeSettings(s.settings), companies };
}

/** Replaces all data with the backup. Throws (and changes nothing) on an invalid file. */
export async function importBackup(json: unknown): Promise<void> {
  let obj: unknown = json;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch {
      throw new Error(`${BAD_FILE} (לא JSON)`);
    }
  }
  const storage = parseStorage((obj as { storage?: unknown } | null)?.storage);
  await importAll(obj); // validates the envelope before clearing anything
  if (storage) {
    const { geminiApiKey } = await getSettings();
    await saveProfile(storage.profile);
    await saveCompanies(storage.companies);
    await saveSettings({ ...storage.settings, geminiApiKey });
  }
}

/** "Reset all data": every IndexedDB table and everything in chrome.storage.local (incl. the API key). */
export async function resetAllData(): Promise<void> {
  const area = browser?.storage?.local;
  if (!area) throw new Error(NOT_IN_EXTENSION_MSG);
  await clearAll();
  await area.clear();
}
