// Colours for the wavescope visualizers: a palette in the shape those modes
// use, built from the album-art colours the relay sends.

const BACKGROUND = "#000";
export const DEFAULT_STOPS = [[40, 120, 255], [150, 80, 255], [255, 70, 170], [255, 190, 70]];
const MIN_BRIGHTNESS = 170; // album colours are lifted to at least this on black
const MIN_HUE = 40; // darker than this, a colour is treated as black
const POSITION_STEPS = 64;
const ALPHA_STEPS = 20;

function lift(rgb) {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1);
  if (peak >= MIN_BRIGHTNESS) return rgb;
  const gain = MIN_BRIGHTNESS / peak;
  return [Math.min(255, rgb[0] * gain), Math.min(255, rgb[1] * gain), Math.min(255, rgb[2] * gain)];
}

// A palette in the shape wavescope modes use. Modes ask for thousands of
// colours a second, so the strings are built once per (position, alpha) step.
export function makePalette(stops) {
  const cache = {};
  return {
    id: "album",
    name: "Album",
    bg: BACKGROUND,
    color(pos, alpha) {
      const p = Math.round(Math.max(0, Math.min(1, pos)) * (POSITION_STEPS - 1));
      const a = Math.round(Math.max(0, Math.min(1, alpha === undefined ? 1 : alpha)) * ALPHA_STEPS);
      const key = p * (ALPHA_STEPS + 1) + a;
      let css = cache[key];
      if (!css) {
        const at = (p / (POSITION_STEPS - 1)) * (stops.length - 1);
        const i = Math.min(Math.floor(at), stops.length - 2);
        const f = at - i;
        const lo = stops[i];
        const hi = stops[i + 1];
        css = cache[key] =
          "rgba(" +
          Math.round(lo[0] + (hi[0] - lo[0]) * f) + "," +
          Math.round(lo[1] + (hi[1] - lo[1]) * f) + "," +
          Math.round(lo[2] + (hi[2] - lo[2]) * f) + "," +
          a / ALPHA_STEPS + ")";
      }
      return css;
    },
  };
}

// Colour stops from the album-art palette the relay sends, or the default.
export function stopsFromAlbum(album) {
  if (!album) return DEFAULT_STOPS;
  const stops = [];
  for (const key of ["primary", "accent", "on_dark"]) {
    const rgb = album[key];
    // Near-black entries carry no hue to lift; near-duplicates add nothing.
    if (!Array.isArray(rgb) || Math.max(rgb[0], rgb[1], rgb[2]) < MIN_HUE) continue;
    const lifted = lift(rgb);
    if (!stops.some((s) => Math.abs(s[0] - lifted[0]) + Math.abs(s[1] - lifted[1]) + Math.abs(s[2] - lifted[2]) < 60)) {
      stops.push(lifted);
    }
  }
  if (stops.length === 0) return DEFAULT_STOPS;
  // A single colour still needs a range to draw with: run it up toward white.
  if (stops.length === 1) stops.push(stops[0].map((c) => c + (255 - c) * 0.65));
  return stops;
}
