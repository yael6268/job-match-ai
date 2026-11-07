// Service worker: side panel behaviour, messaging, runs, daily alarm, notifications and badge.
import { dispatch, isMessage, type Handlers } from '@/shared/messages';
import { getLatestRun } from '@/pipeline/run';
import { realDeps, startOrResumeRun } from '@/pipeline/controller';
import { markJobsViewed, onAlarm, onBrowserStart, onSettingsChanged, resumeIfUnfinished, runHooks } from '@/pipeline/automation';
import { getAdapter } from '@/sources';
import { parseCompany } from '@/shared/companies';
import { resolveComeetPage } from '@/sources/comeet';
import { getFillData, markAppliedFromForm } from '@/formfill/data';
import { refreshBadge } from '@/pipeline/automation';

const handlers: Handlers = {
  startRun: async () => (await startOrResumeRun(realDeps, runHooks))!,
  getRunState: async () => (await getLatestRun()) ?? null,
  testCompany: async ({ company }) => {
    const c = parseCompany(company);
    const jobs = await getAdapter(c.source).fetchJobs(c);
    return { count: jobs.length };
  },
  markViewed: async ({ jobIds }) => ({ badge: await markJobsViewed(jobIds) }),
  resolveComeet: ({ url }) => resolveComeetPage(url),
  getFillData: ({ url }) => getFillData(url),
  markAppliedFromForm: async ({ jobId, cvId }) => {
    await markAppliedFromForm(jobId, cvId);
    return { badge: await refreshBadge() };
  },
};

export default defineBackground(() => {
  const openPanelOnClick = () =>
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((e: unknown) => console.error('setPanelBehavior failed', e));

  const logError = (what: string) => (e: unknown) => console.error(what, e);

  openPanelOnClick();
  browser.runtime.onInstalled.addListener(() => {
    openPanelOnClick();
    onBrowserStart().catch(logError('onInstalled'));
  });
  browser.runtime.onStartup.addListener(() => {
    openPanelOnClick();
    onBrowserStart().catch(logError('onStartup'));
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    onAlarm(alarm.name).catch(logError(`alarm ${alarm.name}`));
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      onSettingsChanged(changes.settings.oldValue, changes.settings.newValue).catch(logError('settings changed'));
    }
  });

  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!isMessage(msg)) return false;
    void dispatch(handlers, msg).then(sendResponse);
    return true; // keep the channel open for the async response
  });

  // The worker may have been killed mid-run; whatever woke it up, pick the run up again.
  resumeIfUnfinished().catch(logError('resume'));
});
