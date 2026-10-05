// MilkDrop presets through Butterchurn (MIT, Jordan Berg). Needs WebGL2, which
// a TV may lack or run badly, so the library is fetched only once a context
// has been obtained, and every way it can fail leads back to `onFail`.
import { loadPref, savePref } from "../settings.js";

const SCRIPTS = ["./vendor/butterchurn.min.js", "./vendor/butterchurnPresetsMinimal.min.js"];
const PRESET_SECONDS = 30;
const BLEND_SECONDS = 2.7;
const PROVEN_FRAMES = 120; // frames rendered before a start counts as survived
const SCALE = 0.5; // render size relative to the window

let probed = null;

// Whether this browser hands out a WebGL2 context at all.
export function hasWebGL2() {
  if (probed === null) {
    try {
      probed = !!document.createElement("canvas").getContext("webgl2");
    } catch (e) {
      probed = false;
    }
  }
  return probed;
}

// Why MilkDrop should not be started, or "" if it may be.
export function milkdropBlocker() {
  if (!hasWebGL2()) return "no WebGL2";
  if (loadPref("milkdropPending", false)) return "did not survive its last start";
  if (loadPref("milkdropSlow", false)) return "too slow on this TV";
  return "";
}

export function clearMilkdropBlocks() {
  savePref("milkdropPending", false);
  savePref("milkdropSlow", false);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error("could not load " + src));
    document.head.appendChild(tag);
  });
}

export function createMilkdropMode(onFail) {
  // One visualizer for the life of the page: it owns the canvas's GL context
  // and cannot be torn down, so it is reused each time the mode is entered.
  let visualizer = null;
  let presets = null;
  let names = [];
  let index = 0;
  let loading = null;
  let failed = false;
  let frames = 0;
  let sincePreset = 0;

  function fail(reason) {
    if (failed) return;
    failed = true;
    onFail(reason);
  }

  function showPreset(blend) {
    visualizer.loadPreset(presets[names[index]], blend);
    sincePreset = 0;
    savePref("preset", names[index]);
  }

  function start(canvas) {
    // If the TV dies inside Butterchurn, this flag is still set on the next
    // launch and MilkDrop is skipped.
    savePref("milkdropPending", true);
    loading = Promise.all(SCRIPTS.map(loadScript))
      .then(() => {
        const api = window.butterchurn.default || window.butterchurn;
        const pack = window.butterchurnPresetsMinimal.default || window.butterchurnPresetsMinimal;
        presets = pack.getPresets();
        names = Object.keys(presets).sort();
        index = Math.max(0, names.indexOf(loadPref("preset", "")));
        const options = { width: canvas.width, height: canvas.height, pixelRatio: 1, meshWidth: 32, meshHeight: 24 };
        // Butterchurn only uses the audio context to tap live audio; the
        // waveform is handed to render() instead.
        visualizer = api.createVisualizer(null, canvas, options);
        showPreset(0);
      })
      .catch((error) => fail(String((error && error.message) || error)));
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      fail("graphics context lost");
    });
  }

  function step(direction) {
    if (!visualizer) return;
    index = (index + direction + names.length) % names.length;
    showPreset(BLEND_SECONDS);
  }

  return {
    id: "milkdrop",
    name: "MilkDrop",
    gl: true,
    scale: SCALE,
    create({ canvas }) {
      if (visualizer) visualizer.setRendererSize(canvas.width, canvas.height);
      return {
        draw(ctx, f) {
          // Started on the first frame of audio, not on entering the mode, so
          // an idle screen never counts as a start that failed.
          if (!loading) start(canvas);
          if (!visualizer || failed) return;
          try {
            const wave = f.analysis.wave;
            visualizer.render({ audioLevels: { timeByteArray: wave, timeByteArrayL: wave, timeByteArrayR: wave } });
          } catch (error) {
            return fail(String((error && error.message) || error));
          }
          if (++frames === PROVEN_FRAMES) savePref("milkdropPending", false);
          sincePreset += f.dt;
          if (sincePreset >= PRESET_SECONDS) step(1);
        },
      };
    },
    step,
    fail,
    // Called when the page is hidden or closed normally: a start that got
    // this far did not take the TV down.
    settle() {
      if (loading && !failed) savePref("milkdropPending", false);
    },
    get ready() {
      return visualizer !== null && !failed;
    },
    get presetName() {
      return visualizer ? names[index] : loading ? "loading" : "";
    },
    get presetCount() {
      return names.length;
    },
  };
}
