// Content script for application forms (SPEC.md section 11). Fills name/email/phone/LinkedIn/city
// from the profile and attaches the recommended CV. It never submits: a banner asks the user to
// review and send, and offers "סמני כהוגשה".
import { send } from '@/shared/messages';
import { autoFill, showBanner, waitForForm, waitForQuiet, type FillResult } from '@/formfill/dom';
import { jobRefFromUrl } from '@/formfill/fields';

export default defineContentScript({
  matches: [
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
    'https://jobs.lever.co/*',
    'https://jobs.eu.lever.co/*',
    'https://www.comeet.com/jobs/*',
    // Comeet's application form is an iframe from comeet.co inside its job page (seen 2026-11-07).
    'https://www.comeet.co/jobs/*',
    // SmartRecruiters Easy-apply form (web components with shadow DOM).
    'https://jobs.smartrecruiters.com/*',
  ],
  allFrames: true,
  runAt: 'document_idle',
  async main() {
    // Forms embedded in iframes on company sites are out of scope (v1), except Comeet's own form frame.
    const inFrame = window.top !== window;
    if (inFrame && location.hostname !== 'www.comeet.co') return;
    // Only pages of a specific job (not board listings).
    if (!jobRefFromUrl(location.href)) return;
    // On the Comeet job page the form is in the comeet.co frame; that frame does the work.
    if (!inFrame && location.hostname === 'www.comeet.com') return;

    if (!(await waitForForm())) return;
    // Let the page finish rendering/hydrating first, or a React form wipes what we fill.
    await waitForQuiet();
    try {
      const data = await send('getFillData', { url: location.href });
      let marked = false;
      let closed = false;
      const render = (result: FillResult) => {
        if (closed) return;
        showBanner({
          result,
          data,
          marked,
          onClose: () => { closed = true; },
          onMarkApplied: async () => {
            await send('markAppliedFromForm', { jobId: data.job!.id, cvId: data.cv?.id ?? '' });
            marked = true;
          },
        });
      };
      // Fills now and keeps refilling late or wiped fields for a few seconds; the banner follows.
      autoFill(document, data.profile, data.cv, render);
    } catch (e) {
      console.warn('[Job Match AI] form fill failed', e);
    }
  },
});
