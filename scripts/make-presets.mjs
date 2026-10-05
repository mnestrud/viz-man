#!/usr/bin/env node
// Usage: scripts/make-presets.mjs
// Writes app/vendor/presets.js: the MilkDrop presets named in presets.json,
// taken from the butterchurn-presets packs, as window.vizmanPresets.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = ["butterchurnPresets", "butterchurnPresetsExtra", "butterchurnPresetsExtra2", "butterchurnPresetsMD1"];

// Every preset in the packs, by name.
export function allPresets() {
  const all = {};
  for (const pack of PACKS) {
    const loaded = require(`butterchurn-presets/lib/${pack}.min.js`);
    const presets = (loaded.default || loaded).getPresets();
    for (const name of Object.keys(presets)) if (!(name in all)) all[name] = presets[name];
  }
  return all;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = JSON.parse(readFileSync(join(root, "presets.json"), "utf8"));
  const all = allPresets();
  const chosen = {};
  for (const name of wanted) {
    if (!(name in all)) throw new Error(`presets.json names an unknown preset: ${name}`);
    chosen[name] = all[name];
  }
  const out = join(root, "app", "vendor");
  mkdirSync(out, { recursive: true });
  const text = "window.vizmanPresets = " + JSON.stringify(chosen) + ";\n";
  writeFileSync(join(out, "presets.js"), text);
  console.log(`wrote app/vendor/presets.js (${wanted.length} presets, ${text.length} bytes)`);
}
