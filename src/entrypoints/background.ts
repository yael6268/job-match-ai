// Service worker: side panel behaviour, messaging, runs. Alarms and notifications arrive in M6.
import { dispatch, isMessage, type Handlers } from '@/shared/messages';
import { getLatestRun } from '@/pipeline/run';
import { startOrResumeRun } from '@/pipeline/controller';
import { getAdapter } from '@/sources';
import { parseCompany } from '@/shared/companies';

const handlers: Handlers = {
  startRun: () => startOrResumeRun(),
  getRunState: async () => (await getLatestRun()) ?? null,
  testCompany: async ({ company }) => {
    const c = parseCompany(company);
    const jobs = await getAdapter(c.source).fetchJobs(c);
    return { count: jobs.length };
  },
};

export default defineBackground(() => {
  const openPanelOnClick = () =>
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((e: unknown) => console.error('setPanelBehavior failed', e));

  openPanelOnClick();
  browser.runtime.onInstalled.addListener(openPanelOnClick);
  browser.runtime.onStartup.addListener(openPanelOnClick);

  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!isMessage(msg)) return false;
    void dispatch(handlers, msg).then(sendResponse);
    return true; // keep the channel open for the async response
  });
});
