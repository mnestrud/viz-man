// Winamp 2 main-window spectrum analyzer and oscilloscope.
// Ported from Webamp's VisPainter.ts (MIT, Jordan Eldredge and contributors),
// which follows the Winamp 2.63 / 5.666 executables. Drawn on Winamp's native
// 76x16 grid and scaled up by the engine.

import { makePalette, stopsFromAlbum } from "./palette.js";

export const VIS_WIDTH = 76;
export const VIS_HEIGHT = 16;

// Winamp's default viscolor.txt: 0 background, 1 dots (unused here), 2-17
// analyzer rows from the top down, 18-22 oscilloscope, 23 peak caps.
export const VIS_COLORS = [
  "rgb(0,0,0)", "rgb(24,33,41)", "rgb(239,49,16)", "rgb(206,41,16)",
  "rgb(214,90,0)", "rgb(214,102,0)", "rgb(214,115,0)", "rgb(198,123,8)",
  "rgb(222,165,24)", "rgb(214,181,33)", "rgb(189,222,41)", "rgb(148,222,33)",
  "rgb(41,206,16)", "rgb(50,190,16)", "rgb(57,181,16)", "rgb(49,156,8)",
  "rgb(41,148,0)", "rgb(24,132,8)", "rgb(255,255,255)", "rgb(214,214,222)",
  "rgb(181,189,189)", "rgb(160,170,175)", "rgb(148,156,165)", "rgb(150,150,150)",
];

const BARS = 75;
const MAX_HEIGHT = 15;
const MAX_FREQ_INDEX = 512;
const LOG_SCALE = 0.91; // 0 = linear frequency axis, 1 = logarithmic
const BAR_FALLOFF = 12 / 16; // Winamp's default "moderate"
const PEAK_FALLOFF = 1.1; // Winamp's default "slow"
const STEP_SECONDS = 1 / 60; // Winamp advances falloff once per 60 Hz frame
const MAX_STEPS_PER_DRAW = 4;
const SCOPE_SAMPLES = 576;

// Position of each bar on the frequency axis, as a fractional spectrum index.
const BAR_INDEX = new Float32Array(BARS);
{
  const logMax = Math.log10(MAX_FREQ_INDEX);
  for (let x = 0; x < BARS; x++) {
    const linear = (x / (BARS - 1)) * (MAX_FREQ_INDEX - 1);
    const log = Math.pow(10, (logMax * x) / (BARS - 1));
    BAR_INDEX[x] = (1 - LOG_SCALE) * linear + LOG_SCALE * log;
  }
}

export function createAnalyzerState() {
  return {
    sample: new Float32Array(VIS_WIDTH),
    level: new Int16Array(VIS_WIDTH),
    falloff: new Float32Array(VIS_WIDTH),
    peaks: new Int16Array(VIS_WIDTH), // 8.8 fixed point, as Winamp keeps them
    peakSpeed: new Float32Array(VIS_WIDTH),
    barPeak: new Int16Array(VIS_WIDTH),
  };
}

// Advance bars and peak caps by one 60 Hz step.
export function stepAnalyzer(s, spectrum, wide) {
  for (let x = 0; x < BARS; x++) {
    const at = BAR_INDEX[x];
    const lo = Math.min(Math.floor(at), MAX_FREQ_INDEX - 1);
    const hi = Math.min(Math.ceil(at), MAX_FREQ_INDEX - 1);
    s.sample[x] = lo === hi ? spectrum[lo] : (1 - (at - lo)) * spectrum[lo] + (at - lo) * spectrum[hi];
  }

  for (let x = 0; x < BARS; x++) {
    if (wide) {
      const chunk = x & ~3;
      s.level[x] = (s.sample[chunk] + s.sample[chunk + 1] + s.sample[chunk + 2] + s.sample[chunk + 3]) / 4;
    } else {
      s.level[x] = s.sample[x];
    }
    if (s.level[x] > MAX_HEIGHT) s.level[x] = MAX_HEIGHT;

    s.falloff[x] -= BAR_FALLOFF;
    if (s.falloff[x] <= s.level[x]) s.falloff[x] = s.level[x];

    if (s.peaks[x] <= Math.round(s.falloff[x] * 256)) {
      s.peaks[x] = s.falloff[x] * 256;
      s.peakSpeed[x] = 3;
    }
    s.barPeak[x] = s.peaks[x] / 256;
    s.peaks[x] -= Math.round(s.peakSpeed[x]);
    s.peakSpeed[x] *= PEAK_FALLOFF;
    if (s.peaks[x] <= 0) s.peaks[x] = 0;
  }
}

// Winamp draws a grid of dim dots (colour 1) behind its visualizer. It is left
// out here so that everything unlit is true black on an OLED panel.
function paintBackground(ctx) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIS_WIDTH, VIS_HEIGHT);
}

// `colors` is a viscolor-style table: 2-17 bar rows, 18-22 scope, 23 peaks.
export function paintAnalyzer(ctx, s, wide, colors) {
  paintBackground(ctx);
  for (let x = 0; x < BARS; x++) {
    if (wide && (x & 3) === 3) continue; // one-pixel gap between wide bars
    const height = Math.round(s.falloff[x]);
    for (let row = VIS_HEIGHT - height; row < VIS_HEIGHT; row++) {
      ctx.fillStyle = colors[2 + row];
      ctx.fillRect(x, row, 1, 1);
    }
    if (s.barPeak[x] >= 1) {
      ctx.fillStyle = colors[23];
      ctx.fillRect(x, VIS_HEIGHT - (s.barPeak[x] + 1), 1, 1);
    }
  }
}

function scopeColor(y) {
  if (y >= 14) return 4;
  if (y >= 12) return 3;
  if (y >= 10) return 2;
  if (y >= 8) return 1;
  if (y >= 6) return 0;
  if (y >= 4) return 1;
  if (y >= 2) return 2;
  return 3;
}

export function paintScope(ctx, wave, colors) {
  paintBackground(ctx);
  const stride = Math.floor(SCOPE_SAMPLES / BARS);
  let last = 0;
  for (let x = 0; x < BARS; x++) {
    let y = Math.round((wave[x * stride] / 16) * 2) - 9;
    y = Math.max(0, Math.min(VIS_HEIGHT - 1, y));
    if (x === 0) last = y;
    let top = y;
    let bottom = last;
    last = y;
    if (bottom < top) {
      const swap = top;
      top = bottom + 1;
      bottom = swap;
    }
    ctx.fillStyle = colors[18 + scopeColor(y)];
    ctx.fillRect(x, top, 1, bottom - top + 1);
  }
}

// Colours are Winamp's own unless `album` is switched on, in which case they
// are drawn from the album-art palette Music Assistant sends, when it has one.
export const classicOptions = { album: false };

function albumColors(album) {
  const palette = makePalette(stopsFromAlbum(album));
  const colors = VIS_COLORS.slice();
  for (let row = 0; row < 16; row++) colors[2 + row] = palette.color(1 - row / 15); // top of a bar is the far end
  for (let i = 0; i < 5; i++) colors[18 + i] = palette.color(1 - i / 4, 1 - i * 0.12); // scope: brightest at the centre
  colors[23] = "rgb(235,235,235)";
  return colors;
}

// Picks the colour table for a frame, rebuilding only when the album changes.
function colorPicker() {
  let album = null;
  let table = VIS_COLORS;
  return (f) => {
    if (!classicOptions.album || !f.palette) return VIS_COLORS;
    if (f.palette !== album) {
      album = f.palette;
      table = albumColors(album);
    }
    return table;
  };
}

function analyzerMode(id, name, wide) {
  return {
    id,
    name,
    width: VIS_WIDTH,
    height: VIS_HEIGHT,
    pixelated: true,
    create() {
      const state = createAnalyzerState();
      const colorsFor = colorPicker();
      let pending = 0;
      return {
        draw(ctx, f) {
          pending += f.dt;
          let steps = 0;
          while (pending >= STEP_SECONDS && steps < MAX_STEPS_PER_DRAW) {
            stepAnalyzer(state, f.analysis.spectrum(), wide);
            pending -= STEP_SECONDS;
            steps++;
          }
          if (pending >= STEP_SECONDS) pending = 0; // fell behind; drop the backlog
          paintAnalyzer(ctx, state, wide, colorsFor(f));
        },
      };
    },
  };
}

export const classicModes = [
  analyzerMode("winamp-bars", "Winamp Bars", true),
  analyzerMode("winamp-thin", "Winamp Thin Bars", false),
  {
    id: "winamp-scope",
    name: "Winamp Scope",
    width: VIS_WIDTH,
    height: VIS_HEIGHT,
    pixelated: true,
    create() {
      const colorsFor = colorPicker();
      return {
        draw(ctx, f) {
          paintScope(ctx, f.analysis.wave, colorsFor(f));
        },
      };
    },
  },
];
