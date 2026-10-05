// Runs visualizers vendored from wavescope (MIT, Signal Ridge Labs) inside
// this app's engine: builds the frame and palette they expect and paints the
// trail-fading background wash their own render loop would.
import { geometryModes } from "../vendor/wavescope/modes/geometry.ts";
import { particleModes } from "../vendor/wavescope/modes/particles.ts";
import { spectrumModes } from "../vendor/wavescope/modes/spectrum.ts";
import { waveformModes } from "../vendor/wavescope/modes/waveform.ts";
import { DEFAULT_STOPS, makePalette, stopsFromAlbum } from "./palette.js";

// The modes cheap enough per frame for a TV, in the order they are shown.
const PICKED = ["radial-bars", "ribbon", "ring-scope", "lissajous", "kaleido", "spiro", "tunnel", "orbitals"];

// Modes drawn at full window size rather than the engine's default half:
// Orbitals is all small dots, which half size leaves too faint to see.
const SCALE = { orbitals: 1 };

// A translucent wash never fades a trail to zero: 8-bit rounding leaves the
// last few levels stuck, which shows as a grey haze on an OLED. Every few
// frames this takes one level off every pixel, so trails end in true black.
// (Colour-burning with a just-off-white fill maps v to (v - 1) / 254.)
const FLOOR_EVERY = 4;
export const wavescopeOptions = { floor: true, blank: false };

function floorTrails(ctx, w, h) {
  ctx.globalCompositeOperation = "color-burn";
  // An engine without this blend mode ignores the assignment; filling then
  // would paint the screen near-white.
  if (ctx.globalCompositeOperation === "color-burn") {
    ctx.fillStyle = "rgb(254,254,254)";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = "source-over";
}

function adapt(mode) {
  return {
    id: mode.id,
    name: mode.name,
    scale: SCALE[mode.id],
    create() {
      const state = {};
      let frames = 0;
      let album;
      let palette = makePalette(DEFAULT_STOPS);
      return {
        draw(ctx, f) {
          if (f.palette !== album) {
            album = f.palette;
            palette = makePalette(stopsFromAlbum(album));
          }
          const w = ctx.canvas.width;
          const h = ctx.canvas.height;
          // `fade` is how much of the previous frame a 60 Hz frame wipes out;
          // scale it so trails last as long at any frame rate.
          const fade = mode.fade === undefined ? 1 : mode.fade;
          ctx.globalAlpha = fade >= 1 ? 1 : 1 - Math.pow(1 - fade, f.dt * 60);
          ctx.fillStyle = palette.bg;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          if (wavescopeOptions.floor && fade < 1 && ++frames % FLOOR_EVERY === 0) floorTrails(ctx, w, h);
          if (wavescopeOptions.blank) return; // test hook: let the trails die away
          mode.draw({ ctx, w, h, f: f.analysis.frame(f.t, f.dt, f.sampleRate, f.beatHit), p: palette, state, pointer: null });
        },
      };
    },
  };
}

const all = spectrumModes.concat(waveformModes, geometryModes, particleModes);

export const wavescopeModes = PICKED.map((id) => adapt(all.find((mode) => mode.id === id)));
