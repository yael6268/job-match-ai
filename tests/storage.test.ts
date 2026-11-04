import { describe, expect, it } from 'vitest';
import { fake as fakeBrowser } from './setup';
import {
  DEFAULT_SETTINGS, EMPTY_PROFILE, getProfile, getSettings, mergeSettings, saveProfile, saveSettings,
} from '@/shared/storage';

describe('settings storage', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves a patch and keeps other defaults', async () => {
    await saveSettings({ minScoreToShow: 70, geminiModel: 'some-flash' });
    const s = await getSettings();
    expect(s.minScoreToShow).toBe(70);
    expect(s.geminiModel).toBe('some-flash');
    expect(s.runHour).toBe(DEFAULT_SETTINGS.runHour);
  });

  it('rejects out-of-range values without writing', async () => {
    await expect(saveSettings({ runHour: 24 })).rejects.toThrow();
    expect((await getSettings()).runHour).toBe(8);
  });

  it('falls back to defaults if stored data is corrupt', async () => {
    await fakeBrowser.storage.local.set({ settings: { runHour: 'eight' } });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('profile storage', () => {
  it('round-trips the profile under the "profile" key', async () => {
    const p = { ...EMPTY_PROFILE, firstName: 'Test', lastName: 'User', fullName: 'Test User', email: 'test@example.com', phone: '050-0000000' };
    await saveProfile(p);
    expect(await getProfile()).toEqual(p);
    const raw = await fakeBrowser.storage.local.get('profile');
    expect(raw.profile).toEqual(p);
  });

  it('returns an empty profile by default', async () => {
    expect(await getProfile()).toEqual(EMPTY_PROFILE);
  });
});
