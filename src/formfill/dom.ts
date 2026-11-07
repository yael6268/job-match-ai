// DOM side of the form filler (SPEC.md section 11). Fills empty fields, attaches the CV, shows a
// banner. NEVER clicks or submits anything — the user reviews and sends the form.
import type { Profile } from '@/shared/types';
import { base64ToBlob } from '@/shared/utils';
import type { FillData } from './data';
import { classifyField, pickResumeInput, profileValue, type FieldInfo, type ProfileKey } from './fields';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const LABEL_HE: Record<ProfileKey, string> = {
  firstName: 'שם פרטי', lastName: 'שם משפחה', fullName: 'שם מלא', email: 'מייל', phone: 'טלפון',
  linkedin: 'לינקדאין', city: 'עיר',
};

function labelText(el: Control): string {
  const fromLabels = el.labels?.[0]?.innerText;
  if (fromLabels) return fromLabels;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ');
  return '';
}

export function describe(el: Control): FieldInfo {
  return {
    tag: el.tagName.toLowerCase() as FieldInfo['tag'],
    type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
    name: el.getAttribute('name') ?? '',
    id: el.id,
    autocomplete: el.getAttribute('autocomplete') ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    placeholder: el.getAttribute('placeholder') ?? '',
    label: labelText(el),
  };
}

/**
 * querySelectorAll that also looks inside open shadow roots. SmartRecruiters' form is built from web
 * components (spl-input, spl-dropzone) whose <input> elements live in shadow DOM (seen 2026-11-07).
 */
export function deepQueryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const out: T[] = [...root.querySelectorAll<T>(selector)];
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepQueryAll<T>(el.shadowRoot, selector));
  return out;
}

/** A picker (autocomplete/combobox), on the input itself or on the web component that wraps it. */
function isPicker(el: Element): boolean {
  const host = (el.getRootNode() as ShadowRoot).host;
  return [el, host].some((e) =>
    !!e && (e.getAttribute('role') === 'combobox' || e.getAttribute('ariarole') === 'combobox' ||
      !!e.getAttribute('aria-autocomplete') || !!e.getAttribute('ariaautocomplete')));
}

function usable(el: Control): boolean {
  if (el.disabled || (el as HTMLInputElement).readOnly) return false;
  if (isPicker(el)) return false; // pickers need a choice from a list, not typed text
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Set a value so React/Angular notice: native setter + input/change events. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  // composed: the events also reach listeners outside a web component's shadow root.
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
}

export interface FillResult {
  filled: ProfileKey[];
  cv: 'attached' | 'failed' | 'no-input' | 'no-cv' | 'already';
}

export function fillForm(root: ParentNode, profile: Profile, cv: FillData['cv']): FillResult {
  const controls = [...root.querySelectorAll<Control>('input, textarea, select')];
  const filled: ProfileKey[] = [];
  for (const el of controls) {
    if (el instanceof HTMLSelectElement || !usable(el) || el.value.trim()) continue; // never overwrite
    const key = classifyField(describe(el));
    if (!key) continue;
    const value = profileValue(profile, key);
    if (!value) continue;
    setValue(el, value);
    filled.push(key);
  }

  const files = controls.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'file' && !el.disabled);
  let cvResult: FillResult['cv'] = 'no-cv';
  if (cv) {
    const i = pickResumeInput(files.map(describe));
    const input = files[i];
    if (!input) cvResult = 'no-input';
    else if (input.files?.length) cvResult = 'already';
    else {
      try {
        const dt = new DataTransfer();
        dt.items.add(new File([base64ToBlob(cv.base64, cv.type)], cv.fileName, { type: cv.type }));
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        cvResult = input.files?.length === 1 ? 'attached' : 'failed';
      } catch {
        cvResult = 'failed';
      }
    }
  }
  return { filled: [...new Set(filled)], cv: cvResult };
}

/** Resolves once the page shows something worth filling (an email field or a file input), or after the timeout. */
export function waitForForm(timeoutMs = 20_000): Promise<boolean> {
  const ready = () =>
    deepQueryAll<Control>(document, 'input, textarea').some((el) => {
      const k = el instanceof HTMLInputElement && el.type === 'file' ? 'file' : classifyField(describe(el));
      return k === 'email' || k === 'file' || k === 'firstName' || k === 'fullName';
    });
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (ready()) { obs.disconnect(); clearTimeout(t); resolve(true); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const t = setTimeout(() => { obs.disconnect(); resolve(false); }, timeoutMs);
  });
}

/**
 * Resolves once the DOM has been quiet for `quietMs` (or after `maxMs`), so single-page apps can
 * finish rendering and hydrating before we fill. Real case: Greenhouse's React form cleared values
 * filled while it was still hydrating.
 */
export function waitForQuiet(quietMs = 700, maxMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => { obs.disconnect(); clearTimeout(quiet); clearTimeout(cap); resolve(); };
    const obs = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, quietMs); });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    quiet = setTimeout(done, quietMs);
    const cap = setTimeout(done, maxMs);
  });
}

const MAX_TRIES = 3;

/**
 * Fills now, then keeps watching for `watchMs`: fields that appear later get filled, and values a
 * framework wipes again (re-render, hydration) are put back, at most MAX_TRIES times per field.
 * A field the user types in is theirs from then on and never touched again. Calls `onUpdate` whenever
 * the outcome changes. Never clicks or submits anything.
 */
export function autoFill(
  root: ParentNode,
  profile: Profile,
  cv: FillData['cv'],
  onUpdate: (r: FillResult) => void,
  watchMs = 15_000,
): () => void {
  const ours: { el: HTMLInputElement | HTMLTextAreaElement; key: ProfileKey; value: string; tries: number; user: boolean }[] = [];
  let attached: HTMLInputElement | null = null;
  let attachTries = 0;
  let cvState: FillResult['cv'] = cv ? 'no-input' : 'no-cv';
  let last = '';

  // Real typing (isTrusted) hands the field to the user; our own synthetic events are not trusted.
  const onUserInput = (e: Event) => {
    if (!e.isTrusted) return;
    // Inside a shadow root the event is retargeted to the host; the real field is first in the path.
    const target = e.composedPath()[0] ?? e.target;
    const rec = ours.find((r) => r.el === target);
    if (rec) rec.user = true;
  };
  document.addEventListener('input', onUserInput, true);

  const pass = () => {
    for (const el of deepQueryAll<Control>(root, 'input, textarea')) {
      if (el instanceof HTMLSelectElement || !usable(el)) continue;
      const rec = ours.find((r) => r.el === el);
      if (rec) {
        // Ours, but wiped by the page: put it back (a few times at most), unless the user took over.
        if (!rec.user && !el.value.trim() && rec.tries < MAX_TRIES) { setValue(el, rec.value); rec.tries++; }
        continue;
      }
      if (el.value.trim()) continue; // never overwrite what is there
      const key = classifyField(describe(el));
      if (!key) continue;
      const value = profileValue(profile, key);
      if (!value) continue;
      setValue(el, value);
      ours.push({ el, key, value, tries: 1, user: false });
    }

    if (cv) {
      const files = deepQueryAll<HTMLInputElement>(root, 'input[type=file]').filter((f) => !f.disabled);
      const input = files[pickResumeInput(files.map(describe))];
      if (!input) cvState = attached?.isConnected && attached.files?.length ? 'attached' : 'no-input';
      else if (input.files?.length) cvState = input === attached ? 'attached' : cvState === 'attached' ? 'attached' : 'already';
      else if (attachTries < MAX_TRIES) {
        attachTries++;
        try {
          const dt = new DataTransfer();
          dt.items.add(new File([base64ToBlob(cv.base64, cv.type)], cv.fileName, { type: cv.type }));
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          attached = input;
          cvState = input.files?.length === 1 ? 'attached' : 'failed';
        } catch {
          cvState = 'failed';
        }
      } else cvState = 'failed';
    }

    // Report what actually holds our value right now.
    const filled = [...new Set(ours.filter((r) => r.el.isConnected && r.el.value === r.value).map((r) => r.key))];
    const result: FillResult = { filled, cv: cvState };
    const sig = JSON.stringify(result);
    if (sig !== last) { last = sig; onUpdate(result); }
  };

  pass();
  // Value resets do not show up as DOM mutations, so poll as well as observe.
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const obs = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(pass, 300); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  const tick = setInterval(pass, 1000);
  const stop = () => { obs.disconnect(); clearInterval(tick); clearTimeout(debounce); document.removeEventListener('input', onUserInput, true); };
  setTimeout(stop, watchMs);
  return stop;
}

// ---------- banner ----------

const CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; bottom: 16px; left: 16px; max-width: 340px; direction: rtl;
  font: 14px/1.5 system-ui, 'Segoe UI', Arial, sans-serif; color: #1c2430; background: #fff;
  border: 1px solid #dde2e9; border-top: 4px solid #3b5bdb; border-radius: 8px; padding: 12px 14px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); }
.title { font-weight: 700; margin: 0 0 4px; }
.muted { color: #5d6878; font-size: 13px; margin: 2px 0; }
.warn { background: #fff7e0; border-radius: 6px; padding: 6px 8px; font-size: 13px; margin: 6px 0; }
.ok { color: #1d6b3a; font-weight: 600; }
.row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
button { font: inherit; border-radius: 6px; padding: 5px 12px; cursor: pointer; border: 1px solid #dde2e9; background: #fff; color: inherit; }
button.primary { background: #3b5bdb; border-color: #3b5bdb; color: #fff; font-weight: 600; }
button.x { position: absolute; top: 6px; left: 6px; border: 0; background: none; font-size: 16px; padding: 0 4px; color: #5d6878; }
`;

export function showBanner(opts: {
  result: FillResult;
  data: FillData;
  /** Already marked from this banner (keeps the state when the banner is redrawn). */
  marked?: boolean;
  onMarkApplied: () => Promise<void>;
  onClose?: () => void;
}): void {
  document.getElementById('jobmatch-formfill-banner')?.remove();
  const host = document.createElement('div');
  host.id = 'jobmatch-formfill-banner';
  const shadow = host.attachShadow({ mode: 'open' });
  const { result, data } = opts;

  const el = (tag: string, cls: string, text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  };

  const style = document.createElement('style');
  style.textContent = CSS;
  const box = el('div', 'box');
  const close = el('button', 'x', '×') as HTMLButtonElement;
  close.title = 'סגירה';
  close.onclick = () => { host.remove(); opts.onClose?.(); };
  box.append(close);

  const profileEmpty = !data.profile.email && !data.profile.firstName && !data.profile.fullName;
  box.append(el('p', 'title', result.filled.length ? 'הטופס מולא — בדקי ושלחי' : 'Job Match AI'));
  if (data.job) box.append(el('p', 'muted', `${data.job.title} · ${data.job.company}`));
  if (result.filled.length) box.append(el('p', 'muted', `מולאו: ${result.filled.map((k) => LABEL_HE[k]).join(', ')}`));
  else if (profileEmpty) box.append(el('p', 'warn', 'פרטי ההגשה בתוסף ריקים — מלאי אותם בלשונית "פרטי הגשה".'));
  else box.append(el('p', 'muted', 'לא נמצאו כאן שדות ריקים שאפשר למלא.'));

  if (data.cv) {
    if (result.cv === 'attached') box.append(el('p', 'muted', `צורפו קורות חיים: ${data.cv.name}`));
    else if (result.cv !== 'already') box.append(el('p', 'warn', `יש לצרף את קובץ קורות החיים ידנית: ${data.cv.name}`));
  } else {
    box.append(el('p', 'warn', 'לא הועלו קורות חיים בתוסף — יש לצרף קובץ ידנית.'));
  }
  box.append(el('p', 'muted', 'התוסף לא שולח את הטופס. בדקי את הפרטים ולחצי בעצמך על שליחה.'));

  if (opts.marked) {
    box.append(el('p', 'ok', 'סומנה כהוגשה ✓'));
  } else if (data.job && data.job.status !== 'applied') {
    const row = el('div', 'row');
    const mark = el('button', 'primary', 'סמני כהוגשה') as HTMLButtonElement;
    mark.onclick = async () => {
      mark.disabled = true;
      try {
        await opts.onMarkApplied();
        row.replaceChildren(el('span', 'ok', 'סומנה כהוגשה ✓'));
      } catch (e) {
        mark.disabled = false;
        row.append(el('span', 'muted', (e as Error).message));
      }
    };
    row.append(mark);
    box.append(row);
  } else if (data.job?.status === 'applied') {
    box.append(el('p', 'ok', 'המשרה כבר מסומנת כהוגשה'));
  }

  shadow.append(style, box);
  document.documentElement.append(host);
}
