# Job Match AI

Chrome extension (MV3) that ranks open tech jobs against your CV versions. Full spec: [SPEC.md](SPEC.md).
Status: **M1 (skeleton)** done. A complete README comes in M10.

## Develop

```bash
npm i
npm run build      # -> .output/chrome-mv3
npm test           # vitest
npm run typecheck
```

Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick `.output/chrome-mv3`.
Click the toolbar icon to open the side panel.

## Privacy

All data stays in the browser (IndexedDB + `chrome.storage.local`). The Gemini API key is sent only
in the `x-goog-api-key` header to `generativelanguage.googleapis.com`.
