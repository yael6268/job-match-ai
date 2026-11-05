import { defineConfig } from 'wxt';

// See SPEC.md section 12 for the permission list.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Job Match AI',
    description: 'התאמת משרות לקורות חיים בעזרת AI',
    permissions: ['storage', 'alarms', 'sidePanel', 'notifications', 'unlimitedStorage'],
    host_permissions: [
      'https://boards-api.greenhouse.io/*',
      'https://api.lever.co/*',
      'https://api.eu.lever.co/*',
      'https://www.comeet.co/*',
      'https://www.comeet.com/*',
      'https://api.smartrecruiters.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    action: { default_title: 'Job Match AI' },
    // pdfjs-dist 6 uses Promise.try and Uint8Array.prototype.toHex.
    minimum_chrome_version: '140',
  },
});
