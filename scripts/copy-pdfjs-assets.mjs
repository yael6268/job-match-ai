// Copies pdfjs character maps into public/ so the extension bundles them (no CDN).
// Runs on postinstall; public/pdfjs is generated and git-ignored.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist', 'cmaps');
const dest = join(root, 'public', 'pdfjs', 'cmaps');

if (!existsSync(src)) {
  console.warn('pdfjs-dist cmaps not found, skipping');
} else {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log('Copied pdfjs cmaps to public/pdfjs/cmaps');
}
