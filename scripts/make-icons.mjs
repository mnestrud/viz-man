#!/usr/bin/env node
// Usage: scripts/make-icons.mjs
// Draws the app's bar-graph icons as PNGs without any image library.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bar heights out of 16, low frequencies on the left.
const BARS = [9, 13, 15, 12, 14, 10, 7, 9, 5, 6, 3];
const PEAKS = [11, 15, 16, 14, 15, 12, 9, 10, 7, 7, 5];

function rowColor(row) {
  // row 0 is the bottom of a bar; green rises through yellow to red.
  const t = row / 15;
  if (t < 0.55) return [41 + 180 * (t / 0.55), 190 + 20 * (t / 0.55), 16];
  return [222 + 17 * ((t - 0.55) / 0.45), 181 - 132 * ((t - 0.55) / 0.45), 16];
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let i = 3; i < px.length; i += 4) px[i] = 255;

  const margin = Math.round(size * 0.14);
  const inner = size - margin * 2;
  const pitch = inner / BARS.length;
  const barW = Math.max(1, Math.floor(pitch * 0.72));
  const cell = inner / 16;
  for (let b = 0; b < BARS.length; b++) {
    const x0 = Math.round(margin + b * pitch);
    for (let row = 0; row < 16; row++) {
      const lit = row < BARS[b];
      const peak = row === PEAKS[b] - 1;
      if (!lit && !peak) continue;
      const color = peak && !lit ? [190, 196, 200] : rowColor(row);
      const yTop = Math.round(size - margin - (row + 1) * cell);
      const yBot = Math.round(size - margin - row * cell) - (cell >= 3 ? 1 : 0);
      for (let y = yTop; y < yBot; y++) for (let x = x0; x < x0 + barW; x++) set(x, y, color);
    }
  }
  return px;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [["icon.png", 80], ["largeIcon.png", 130]]) {
  const file = join(root, "app", name);
  writeFileSync(file, png(size, draw(size)));
  console.log(`wrote app/${name} (${size}x${size})`);
}
