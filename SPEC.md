# Job Match AI — Chrome Extension Build Spec

This file is the single source of truth for building the extension. Read it fully before writing code.
Build **one milestone at a time** (section 10), in order. After each milestone: run the build, run the tests,
check every "Done when" item, then stop and summarize what was built and what the user should test manually.

---

## 0. Working rules for the agent

- Ask before adding any dependency not listed in section 2.
- Never hardcode the Gemini API key, personal details, or real CV text in code, tests or fixtures.
- Never auto-submit an application form. The extension fills fields; the user reviews and clicks submit.
- Never scrape LinkedIn, AllJobs or Drushim. Only use the public job-board APIs listed in section 6.
- Before implementing a job source adapter, verify its endpoint and response shape with one real `curl`
  call against a real company board, and save a trimmed sample response as a test fixture.
- All UI text is **Hebrew**, right-to-left (`dir="rtl"` on the root). Code, identifiers and comments are English.
- TypeScript strict mode. No `any` unless justified in a comment.
- Every module that talks to the network must handle failure without crashing the whole run.
- Keep functions small and pure where possible, so they can be unit-tested without Chrome APIs.

---

## 1. Product overview

A Chrome extension (Manifest V3) that:

1. Collects open tech jobs from public job-board APIs of a configurable list of (mainly Israeli) companies.
2. Matches each job against several versions of the user's CV (e.g. "QA", "Backend").
3. For each matching job shows: link, match score (0–100), which CV version to send, and concrete tips
   for adjusting that CV to this specific job.
4. Asks "Did you apply?" — applied jobs go to an applications history with statistics; other jobs are
   saved and never re-analyzed.
5. After the first full run, runs once a day and processes **only new jobs**.
6. Stores the user's application details (name, email, phone, LinkedIn) and auto-fills application forms.
7. Optionally shows a contact who works at the company and drafts a referral-request email.

**MVP success criterion:** the user opens the side panel and sees a list of new jobs ranked by match,
each with a link, recommended CV version and tips. Marking "Applied" is saved and removes the job
from the main list.

Everything runs locally in the browser. No backend server.

---

## 2. Tech stack

| Area | Choice |
|---|---|
| Extension framework | [WXT](https://wxt.dev) (Vite-based, Manifest V3) |
| UI | React 18 + TypeScript (strict) |
| Styling | Plain CSS modules or Tailwind (pick one, stay consistent); RTL |
| Storage (data) | IndexedDB via `dexie` |
| Storage (small settings) | `chrome.storage.local` |
| PDF text extraction | `pdfjs-dist` (worker bundled locally, no CDN) |
| DOCX text extraction | `mammoth` |
| AI | Google Gemini REST API (`generativelanguage.googleapis.com`), called with `fetch` |
| Schema validation | `zod` |
| Tests | `vitest` (unit) — Jest-compatible API |
| Hashing | Web Crypto `crypto.subtle.digest('SHA-256')` |

---

## 3. Folder structure

```
/
├── SPEC.md
├── README.md
├── wxt.config.ts
├── src/
│   ├── entrypoints/
│   │   ├── background.ts          # service worker: alarms, runs, messaging
│   │   ├── sidepanel/             # main UI (index.html + main.tsx)
│   │   ├── options/               # settings page (optional; can live in side panel)
│   │   └── formfill.content.ts    # content script for application forms
│   ├── sources/
│   │   ├── types.ts               # SourceAdapter interface
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── comeet.ts
│   │   ├── smartrecruiters.ts     # milestone 7
│   │   └── index.ts               # registry: source name -> adapter
│   ├── data/
│   │   └── companies.json         # company list (section 6.1)
│   ├── db/
│   │   ├── schema.ts              # Dexie database + tables
│   │   └── repo.ts                # typed read/write helpers
│   ├── pipeline/
│   │   ├── run.ts                 # orchestrates a full or daily run (resumable)
│   │   ├── prefilter.ts           # rule-based filtering, no AI
│   │   ├── overlap.ts             # keyword-overlap scoring, no AI
│   │   └── experience.ts          # extract required years from description
│   ├── ai/
│   │   ├── gemini.ts              # REST client, rate limit, retry, daily cap
│   │   ├── prompts.ts             # prompt builders
│   │   └── schemas.ts             # zod schemas + Gemini responseSchema objects
│   ├── cv/
│   │   ├── extract.ts             # PDF/DOCX -> text
│   │   └── redact.ts              # strip phone/email/address before sending to AI
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── screens/               # TodayJobs, JobsDb, CVs, Profile, Contacts, Stats, Settings
│   │   └── components/            # JobCard, ScoreBadge, ProgressBar, EmptyState...
│   └── shared/
│       ├── types.ts               # domain types (section 4)
│       ├── messages.ts            # typed messages between UI <-> background <-> content
│       └── utils.ts               # normalizeUrl, hash, sleep, html-to-text...
└── tests/
    ├── fixtures/                  # trimmed real API responses, sample job texts
    └── *.test.ts
```

---

## 4. Domain types (`src/shared/types.ts`)

```ts
export type SourceName = 'greenhouse' | 'lever' | 'comeet' | 'smartrecruiters';

export type JobStatus = 'new' | 'saved' | 'applied' | 'dismissed' | 'closed';

export interface Company {
  name: string;            // display name, e.g. "Wix"
  source: SourceName;
  boardId: string;         // greenhouse board token / lever company slug / comeet company uid
  token?: string;          // comeet public token, if needed
  aliases?: string[];      // for matching contacts, e.g. ["Wix.com"]
  enabled: boolean;
}

export interface Job {
  id: string;              // sha256(normalizedUrl) — stable, see utils.normalizeUrl
  source: SourceName;
  sourceJobId: string;     // the id from the source API
  company: string;
  title: string;
  url: string;             // public job page
  applyUrl?: string;
  location: string;
  department?: string;
  descriptionText: string; // plain text, HTML stripped
  postedAt?: string;       // ISO
  firstSeenAt: string;     // ISO, set once
  lastSeenAt: string;      // ISO, updated each run while still listed
  requiredYears?: number;  // from experience.ts
  status: JobStatus;
  prefilterPassed?: boolean;
  overlapScore?: number;   // 0..1, best across CVs
  viewed: boolean;         // for the badge count
}

export interface CV {
  id: string;              // uuid
  name: string;            // "QA", "Backend"...
  domains: string[];       // user-chosen domains, see DOMAINS constant
  fileName: string;
  fileBlob: Blob;          // original file, used for form upload
  text: string;            // extracted full text (local only)
  redactedText: string;    // text sent to AI (no phone/email/address)
  versionHash: string;     // sha256(redactedText) — invalidates cached matches when CV changes
  updatedAt: string;
}

export interface Match {
  jobId: string;
  score: number;           // 0..100
  bestCvId: string;
  reasons: string[];       // short Hebrew sentences
  tips: string[];          // concrete, job-specific Hebrew tips
  requiredYears?: number;
  cvVersionHashes: string; // joined versionHash of all CVs used, for cache invalidation
  model: string;
  analyzedAt: string;
}

export interface Application {
  jobId: string;
  cvId: string;
  appliedAt: string;
  domain: string;          // category used for stats
  viaReferral: boolean;
  contactId?: string;
  notes?: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  email?: string;
  referralLink?: string;
  notes?: string;
}

export interface Profile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin?: string;
  city?: string;
}

export interface Settings {
  geminiApiKey: string;
  geminiModel: string;          // chosen from the models list, not hardcoded
  minScoreToShow: number;       // default 60
  minScoreToNotify: number;     // default 75
  runHour: number;              // 0..23, default 8
  dailyCallLimit: number;       // default 200 — user should check current free-tier quota
  maxAiCandidatesPerRun: number;// default 40
  locations: string[];          // default ["Israel", "Tel Aviv", "Remote", "Hybrid", ...]
}

export interface RunState {
  runId: string;
  kind: 'full' | 'daily';
  startedAt: string;
  phase: 'fetch' | 'prefilter' | 'overlap' | 'ai' | 'done' | 'error';
  companiesDone: string[];      // for resume
  aiQueue: string[];            // job ids waiting for AI
  aiDone: string[];
  callsToday: number;
  callsDate: string;            // YYYY-MM-DD, reset counter when date changes
  errors: { source: string; company?: string; message: string; at: string }[];
  finishedAt?: string;
}

export const DOMAINS = [
  'QA', 'Automation', 'Backend', 'Frontend', 'Full Stack', 'DevOps',
  'Data', 'Mobile', 'Embedded', 'Security', 'Product', 'Support',
] as const;
```

---

## 5. Database (`src/db/schema.ts`)

Dexie database `jobmatch`, version 1:

```ts
jobs:         'id, source, company, status, firstSeenAt, lastSeenAt, viewed'
matches:      'jobId, score, bestCvId, analyzedAt'
cvs:          'id, name, updatedAt'
applications: 'jobId, appliedAt, domain, cvId'
contacts:     'id, company'
runs:         'runId, startedAt'
```

`Profile` and `Settings` live in `chrome.storage.local` under keys `profile` and `settings`.

Repo helpers (`repo.ts`) at minimum: `upsertJobsFromSource(jobs)` (insert new with `firstSeenAt`,
update `lastSeenAt` for existing, never overwrite `status`), `markClosed(source, company, seenIds)`,
`getJobsForToday()`, `setStatus(jobId, status)`, `saveMatch(match)`, `getMatch(jobId)`,
`addApplication(app)`, `getStats()`, `exportAll()` / `importAll(json)`.

---

## 6. Job sources (`src/sources/`)

```ts
export interface SourceAdapter {
  name: SourceName;
  /** Fetch all currently open jobs for one company. Must throw a descriptive Error on failure. */
  fetchJobs(company: Company): Promise<Omit<Job, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'status' | 'viewed'>[]>;
  /** URL patterns of this source's application forms, used by the content script. */
  applyUrlPatterns: string[];
}
```

Each adapter maps the raw response into the common shape, strips HTML to plain text
(`utils.htmlToText`, which also decodes HTML entities), and never throws for one bad job item
(skip it and log).

| Source | Endpoint (verify first!) | Notes |
|---|---|---|
| Greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{boardId}/jobs?content=true` | Response `{ jobs: [...] }`. `content` is HTML-entity-encoded HTML. Use `absolute_url`, `location.name`, `updated_at`, `departments[0].name`. |
| Lever | `GET https://api.lever.co/v0/postings/{boardId}?mode=json` | Response is an array. Use `text`, `hostedUrl`, `applyUrl`, `categories.location`, `categories.team`, `descriptionPlain` + `lists`, `createdAt` (ms). Some companies use `api.eu.lever.co`. |
| Comeet | Public careers API, typically `https://www.comeet.co/careers-api/2.0/company/{companyUid}/positions?token={token}&details=true` | The company UID and token appear in the company's Comeet careers page. Verify shape before coding. Very common in Israel. |
| SmartRecruiters (M7) | `GET https://api.smartrecruiters.com/v1/companies/{boardId}/postings` | Paginated; details per posting. |

### 6.1 `src/data/companies.json`

Start with an **empty-but-valid** array plus 3 example entries clearly marked as examples, and a UI
screen to add/edit/disable companies (stored in DB or `chrome.storage.local`, seeded from the JSON).
The user will fill in the real list (goal: 30–50 companies at first). Add a "Test" button per company
that fetches once and shows how many jobs were found or the error.

### 6.2 Fetch rules

- Concurrency limit: 5 companies at a time (`p-limit`-style helper in utils; no extra dependency needed).
- Timeout 20s per request (`AbortController`).
- One company failing must not stop others; record it in `RunState.errors` and show it in the UI.
- After a successful fetch of a company, jobs of that company that were `new`/`saved` and are no longer
  listed become `closed`.

---

## 7. Matching pipeline (`src/pipeline/`)

A run goes through phases, cheapest first. **State is persisted to the `runs` table after every
company and every AI call**, because the MV3 service worker can be killed at any time. On startup and on
each alarm, the background checks for an unfinished run and resumes it.

1. **fetch** — all enabled companies → `upsertJobsFromSource`. Only jobs whose `id` did not exist
   before are "new" for this run.
2. **prefilter** (`prefilter.ts`, no AI) on new jobs only:
   - location matches one of `settings.locations` (case-insensitive substring; Hebrew + English).
   - title matches at least one CV's domains via a keyword map, e.g.
     `QA: ['qa','quality','test','automation','sdet']`, `Backend: ['backend','back-end','server','java','python','node','.net','go ']`…
     Keep the map in one exported constant, easy to edit.
   - `requiredYears` (from `experience.ts`) not above a configurable max (default 5).
   - exclude titles with: `senior director|vp|head of|principal|staff` (configurable).
3. **overlap** (`overlap.ts`, no AI): tokenize job text and each CV's text (lowercase, strip
   punctuation, drop stopwords in English + Hebrew, keep tech tokens like `c#`, `.net`, `node.js`).
   Score = |job significant tokens ∩ CV tokens| / |job significant tokens|. Keep best score per job.
   Take the top `maxAiCandidatesPerRun` by score into `aiQueue`.
4. **ai** — for each job in `aiQueue`: skip if a `Match` exists with the same `cvVersionHashes`;
   otherwise call Gemini (section 8). Stop when `callsToday >= dailyCallLimit`; remaining jobs stay
   queued for the next run.
5. **done** — notification + badge.

`experience.ts`: regex extraction of required years from English and Hebrew phrasing
("3+ years", "at least 2 years", "2-4 years", "שנות ניסיון 3", "ניסיון של 3 שנים לפחות").
Return the minimum number mentioned in a requirements context, or `undefined`.

---

## 8. Gemini (`src/ai/`)

### 8.1 Client

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  with header `x-goog-api-key: <key>` (not in the URL).
- Model is **not hardcoded**: the Settings screen calls
  `GET https://generativelanguage.googleapis.com/v1beta/models` and lets the user pick a Flash model.
- Use structured output: `generationConfig.responseMimeType = "application/json"` and
  `generationConfig.responseSchema` (built in `schemas.ts`). `temperature: 0.2`.
- Validate the parsed result with zod. On invalid output: retry once; if still invalid, mark the job
  as `ai_failed` in the run errors and move on.
- Rate limiting: minimum delay between calls (default 4s, configurable). On HTTP 429 or 503:
  exponential backoff (5s, 15s, 45s), then leave the job in the queue.
- Count every call in `RunState.callsToday`; reset when the date changes.
- A "Test key" button in Settings makes one tiny call and shows success or the error message.

### 8.2 Match prompt (`prompts.ts`)

Send **only `redactedText`** of CVs. One call per job, containing all CV versions.

Output schema:

```json
{
  "score": 0,
  "bestCvId": "string (one of the provided ids)",
  "requiredYears": 0,
  "reasons": ["string"],
  "tips": ["string"]
}
```

Prompt rules (put them in the system instruction):

- You are a technical recruiter. Compare the job to each CV version and pick the best one.
- `score` reflects fit of the best CV: skills, stack, seniority, domain.
- `reasons`: 2–4 short Hebrew sentences.
- `tips`: 3–5 concrete Hebrew tips **specific to this job** — what to add, emphasize, reorder or remove
  in the chosen CV, quoting the job requirement each tip addresses.
- **Never suggest adding experience, skills or tools that do not appear in the CV.** You may suggest
  emphasizing or rephrasing what exists, and you may point out a gap honestly.
- Return JSON only.

### 8.3 Referral email prompt

Input: job title, company, contact name, user's first name, best CV's short summary.
Output: `{ "subject": string, "body": string }` in Hebrew, short and polite, 80–120 words.

### 8.4 CV redaction (`cv/redact.ts`)

Remove emails, phone numbers (Israeli and international formats), URLs other than GitHub/portfolio,
and lines that look like a street address. Unit-test this thoroughly.

---

## 9. UI (side panel, Hebrew, RTL)

Open the side panel when the toolbar icon is clicked (`chrome.sidePanel.setPanelBehavior`).
Tabs / screens:

1. **✨ ההתאמות היומיות (Today)** — button "לחפיסה של היום" starts a run; progress bar per phase
   (companies fetched X/Y, AI analyzed X/Y, calls left today). List of `JobCard`s for jobs with a match
   ≥ `minScoreToShow` and status `new`, sorted by score.
2. **JobCard** — company, title, location, score badge, link (opens in new tab), recommended CV name,
   reasons (collapsible), tips (list). Buttons: "הגשתי" (asks which CV was sent, default = recommended),
   "שמירה להמשך", "לא רלוונטי", "מלאי טופס" (opens apply URL; content script fills). If a contact exists
   at this company: "הגשה דרך הפניה" (opens their referral link) and "בקשת הפניה במייל"
   (generates the email and opens a Gmail compose URL; fallback `mailto:`).
3. **💼 מאגר המשרות (Jobs DB)** — all jobs with filters: status, company, score range, date; search box.
4. **📄 קורות חיים (CVs)** — upload PDF/DOCX, name the version, pick domains (chips from `DOMAINS`),
   preview extracted text and redacted text, replace file, delete.
5. **📝 פרטי הגשה (Profile)** — the `Profile` fields.
6. **👥 אנשי קשר (Contacts)** — CRUD + CSV import (`name,company,email,referralLink,notes`).
7. **📊 סטטיסטיקה (Stats)** — applications per domain, per CV version, per week; total applied/saved.
8. **⚙️ הגדרות (Settings)** — API key (password field + test), model picker, thresholds, run hour,
   daily call limit, locations, companies list, export/import JSON backup, "reset all data" with confirm.

Empty states are required: no CV, no API key, no companies, no matches yet, offline.

---

## 10. Background (`entrypoints/background.ts`)

- `chrome.alarms.create('daily-run', { when: nextRunHour, periodInMinutes: 1440 })`; recreate when
  `runHour` changes.
- On `runtime.onStartup` and `onInstalled`: if the last run is older than 24h → start a catch-up run;
  if an unfinished run exists → resume it.
- First run ever = `kind: 'full'`; later runs = `kind: 'daily'` (same pipeline; "new" = ids not in DB).
- On done: `chrome.notifications.create` with the count of new jobs ≥ `minScoreToNotify`;
  `chrome.action.setBadgeText` = count of unviewed new matches; clear when the user views them.
- Typed message handlers in `shared/messages.ts`: `startRun`, `getRunState`, `setJobStatus`,
  `getFillData`, `generateReferralEmail`, etc.

---

## 11. Form filler (`entrypoints/formfill.content.ts`)

- Matches: `https://boards.greenhouse.io/*`, `https://job-boards.greenhouse.io/*`,
  `https://jobs.lever.co/*`, `https://www.comeet.com/jobs/*` (verify actual form hosts).
- Asks the background for `{ profile, cvFile, cvName }` for the current URL's job (by normalized URL);
  if the job is unknown, uses the default CV.
- Finds fields by, in order: `name`, `id`, `autocomplete`, `aria-label`, `placeholder`, associated
  `<label>` text (English + Hebrew synonyms: first name / שם פרטי, email / דוא"ל / מייל, phone / טלפון…).
- Sets values in a React-safe way (native value setter + dispatch `input` and `change` events).
- Attaches the CV file via `DataTransfer` to `input[type=file]` when present; if it fails, show a
  small banner "יש לצרף את קובץ קורות החיים ידנית: {cvName}".
- **Never clicks submit.** Shows a floating banner: "הטופס מולא — בדקי ושלחי" with a button
  "סמני כהוגשה" that sets the job status to `applied`.
- Forms embedded in iframes on company sites are out of scope for v1; show nothing there.

---

## 12. Manifest / permissions

`permissions`: `storage`, `alarms`, `sidePanel`, `notifications`, `unlimitedStorage`.
`host_permissions`: `https://boards-api.greenhouse.io/*`, `https://api.lever.co/*`,
`https://api.eu.lever.co/*`, `https://www.comeet.co/*`, `https://generativelanguage.googleapis.com/*`,
and the form hosts from section 11. Add more only when a new source is added.

---

## 13. Milestones

Do them in order. Each ends with: build passes, `vitest` passes, every "Done when" item checked,
then a short summary + manual test steps for the user. Estimated effort in brackets.

### M1 — Skeleton [1–2 days]
- [ ] WXT + React + TS strict project, side panel opening from the toolbar icon, RTL layout, tab navigation.
- [ ] `shared/types.ts`, Dexie schema, `repo.ts` with unit tests (use `fake-indexeddb` in tests).
- [ ] Settings screen: API key save + "Test key", model picker from the models list.
- [ ] Profile screen.

**Done when:** extension loads unpacked in Chrome, side panel opens, key test succeeds with a real key,
profile survives closing and reopening Chrome.

### M2 — CVs [1–2 days]
- [ ] Upload PDF (pdfjs-dist, local worker) and DOCX (mammoth); store blob + text.
- [ ] Name + domains per CV; multiple versions; preview text and redacted text.
- [ ] `redact.ts` with thorough tests.

**Done when:** two CV versions are stored, text is extracted correctly, redacted text contains no phone
or email, and they survive a browser restart.

### M3 — Job collection [2–3 days]
- [ ] `SourceAdapter` + Greenhouse + Lever adapters, each with fixture-based tests.
- [ ] Companies screen with add/edit/disable/"Test".
- [ ] `normalizeUrl` + stable `id`, `upsertJobsFromSource`, closed-job handling.
- [ ] Concurrency limit, timeouts, per-company error isolation, progress bar.

**Done when:** one click fetches hundreds of jobs; a second run creates zero duplicates; a broken
company id shows an error without stopping the others.

### M4 — Matching [2–3 days]
- [ ] `prefilter.ts`, `experience.ts`, `overlap.ts` — all unit-tested with realistic samples.
- [ ] Gemini client: structured output, zod validation, one retry, delay, backoff, daily cap.
- [ ] Match prompt; cache by `cvVersionHashes`.
- [ ] Today screen with `JobCard`s sorted by score.

**Done when:** at least 20 jobs are analyzed, each with score, recommended CV, reasons and specific
tips; re-running does not call Gemini again for the same jobs; changing a CV re-analyzes them.

### M5 — Statuses and stats [2 days]
- [ ] "הגשתי" / "שמירה להמשך" / "לא רלוונטי"; applied/dismissed never return to Today.
- [ ] Jobs DB screen with filters; Stats screen.
- [ ] Export / import JSON backup.

**Done when:** the full lifecycle of a job is managed from the UI and stats reflect it.

### M6 — Daily automation [1–2 days]
- [ ] Alarm at `runHour`, catch-up run on startup, resumable `RunState`.
- [ ] Notification + badge.

**Done when:** killing the service worker mid-run (chrome://serviceworker-internals → Stop) and
reopening resumes the run; the next day only new jobs appear.

### M7 — More sources [1–2 days]
- [ ] Comeet adapter (+ fixtures), then SmartRecruiters.

**Done when:** Comeet jobs appear in the same unified shape.

### M8 — Contacts and referrals [2 days, optional]
- [ ] Contacts CRUD + CSV import; company matching via name + `aliases` (case/punctuation-insensitive).
- [ ] Referral buttons on `JobCard`; referral email generation; Gmail compose / `mailto:`.

**Done when:** a job at a company with a contact shows both referral options and a ready draft.

### M9 — Form filling [2–3 days]
- [ ] Content script per section 11, tested manually on one real form of each source.

**Done when:** on Greenhouse, Lever and Comeet forms, name/email/phone are filled correctly and the
"mark as applied" banner works. Submit is never clicked by the extension.

### M10 — Polish [2 days]
- [ ] All empty states, error messages in Hebrew, loading states.
- [ ] README: install (`npm i`, `npm run build`, load unpacked from `.output/chrome-mv3`), getting a
      Gemini key in Google AI Studio, adding companies, privacy notes.

---

## 14. Testing

- Unit tests (vitest) for: `normalizeUrl`, `htmlToText`, every adapter's mapping (fixtures),
  `prefilter`, `experience`, `overlap`, `redact`, zod parsing of Gemini output (valid + broken),
  repo upsert/closed logic, daily-cap and resume logic in `run.ts` (Chrome APIs mocked).
- No test may call the real network or the real Gemini API.
- Manual test checklist per milestone goes into the milestone summary.

---

## 15. Privacy and security

- All data stays in the browser (IndexedDB / `chrome.storage.local`).
- Only redacted CV text and public job descriptions are sent to Gemini. Note in the README that on
  Google's free tier, submitted content may be used by Google to improve its products.
- The API key is stored in `chrome.storage.local`, never logged, never put in URLs.
- This build is for personal use. Publishing to the Chrome Web Store would require moving AI calls
  to a small backend so the key is not inside the extension.

---

## 16. Out of scope for v1 (future)

Post-application status tracking (interview / rejected / no answer), follow-up reminders,
Google Sheets export, auto-generated tailored CV drafts, Chrome Web Store publishing.
