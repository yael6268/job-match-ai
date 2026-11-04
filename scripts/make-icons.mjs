// Generates the extension icons (public/icon/<size>.png) with no dependencies: a rounded blue
// square with a white magnifier. WXT picks up public/icon/*.png as the manifest icons.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ACCENT = [59, 91, 219]; // --accent #3b5bdb
const WHITE = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Coverage (0..1) of the pixel at (x, y) by the shape, with 4x4 supersampling for smooth edges. */
function sample(size, x, y, inside) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside((x + (i + 0.5) / 4) / size, (y + (j + 0.5) / 4) / size)) hit++;
  return hit / 16;
}

const roundedSquare = (u, v) => {
  const r = 0.22;
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
};
// Magnifier: ring centered at (0.44, 0.44) + a handle toward the bottom-right.
const magnifier = (u, v) => {
  const d = Math.hypot(u - 0.44, v - 0.44);
  if (d <= 0.24 && d >= 0.15) return true;
  const t = (u - 0.6 + (v - 0.6)) / 2; // projection on the diagonal
  const off = Math.abs(u - 0.6 - (v - 0.6)) / Math.SQRT2;
  return t >= 0 && t <= 0.17 && off <= 0.055;
};

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const bg = sample(size, x, y, roundedSquare);
      const fg = sample(size, x, y, magnifier);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(ACCENT[c] * (1 - fg) + WHITE[c] * fg);
      raw[o + 3] = Math.round(255 * bg);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icon/${size}.png`, png(size));
console.log('wrote public/icon/{16,32,48,128}.png');
