// MilkDrop presets through Butterchurn (MIT, Jordan Berg). Needs WebGL2, which
// a TV may lack or run badly, so the library is fetched only once a context
// has been obtained, and every way it can fail leads back to `onFail`.
//
// Presets differ enormously in cost: on an LG CX some hold 60 fps and others
// manage 5. A preset that stays slow is skipped and remembered, rather than
// MilkDrop as a whole being given up on.
import { loadPref, savePref } from "../settings.js";

const SCRIPTS = ["./vendor/butterchurn.min.js", "./vendor/presets.js"];
const BLEND_SECONDS = 2.7;
const PROVEN_FRAMES = 120; // frames rendered before a start counts as survived
const SCALE = 0.5; // render size relative to the window
const SLOW_FPS = 20;
const SLOW_SECONDS = 4; // this long below SLOW_FPS and a preset is skipped
const SETTLE_SECONDS = 4; // not judged while loading and blending in
const GIVE_UP_AFTER = 6; // this many slow presets in a row and MilkDrop is off
export const ROTATE_CHOICES = [0, 30, 120, 300]; // seconds; 0 = stay on the chosen preset

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
  return "";
}

export function clearMilkdropBlocks() {
  savePref("milkdropPending", false);
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

// onFail(reason): MilkDrop cannot run. onNotice(text): something to tell the viewer.
export function createMilkdropMode(onFail, onNotice) {
  // One visualizer for the life of the page: it owns the canvas's GL context
  // and cannot be torn down, so it is reused each time the mode is entered.
  let visualizer = null;
  let presets = {};
  let names = [];
  let index = 0;
  let current = "";
  let loading = null;
  let failed = false;
  let frames = 0;
  let sincePreset = 0;
  let slow = loadPref("slowPresets", []);
  let rotateSeconds = loadPref("presetRotate", 0);
  // frame-rate watch for the current preset
  let windowTime = 0;
  let windowFrames = 0;
  let slowSeconds = 0;
  let skippedInARow = 0;
  let watching = true;

  function fail(reason) {
    if (failed) return;
    failed = true;
    onFail(reason);
  }

  function show(name, preset, blend) {
    visualizer.loadPreset(preset, blend);
    current = name;
    sincePreset = windowTime = windowFrames = slowSeconds = 0;
  }

  function showIndexed(blend) {
    watching = true;
    show(names[index], presets[names[index]], blend);
    savePref("preset", names[index]);
    onNotice(names[index]);
  }

  // Move to the next preset in `direction` that is not known to be slow.
  function step(direction, blend) {
    if (!visualizer || !names.length) return;
    for (let tried = 0; tried < names.length; tried++) {
      index = (index + direction + names.length) % names.length;
      if (slow.indexOf(names[index]) < 0) break;
    }
    showIndexed(blend === undefined ? BLEND_SECONDS : blend);
  }

  function random() {
    if (!visualizer || names.length < 2) return;
    const from = index;
    for (let tried = 0; tried < 20; tried++) {
      index = Math.floor(Math.random() * names.length);
      if (index !== from && slow.indexOf(names[index]) < 0) break;
    }
    showIndexed(BLEND_SECONDS);
  }

  function watchFrameRate(dt) {
    windowTime += dt;
    windowFrames++;
    if (windowTime < 1) return;
    const fps = windowFrames / windowTime;
    windowTime = windowFrames = 0;
    if (!watching || sincePreset < SETTLE_SECONDS) return;
    slowSeconds = fps < SLOW_FPS ? slowSeconds + 1 : 0;
    if (slowSeconds === 0 && sincePreset > SETTLE_SECONDS * 2) skippedInARow = 0;
    if (slowSeconds < SLOW_SECONDS) return;
    slow.push(current);
    savePref("slowPresets", slow);
    if (++skippedInARow >= GIVE_UP_AFTER) return fail("too slow on this TV");
    onNotice("Too slow, skipped: " + current);
    step(1, 0);
  }

  function start(canvas) {
    // If the TV dies inside Butterchurn, this flag is still set on the next
    // launch and MilkDrop is skipped.
    savePref("milkdropPending", true);
    loading = Promise.all(SCRIPTS.map(loadScript))
      .then(() => {
        const api = window.butterchurn.default || window.butterchurn;
        presets = window.vizmanPresets || {};
        names = Object.keys(presets).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        if (!names.length) throw new Error("no presets in the package");
        index = Math.max(0, names.indexOf(loadPref("preset", "")));
        if (slow.indexOf(names[index]) >= 0) index = Math.max(0, names.findIndex((n) => slow.indexOf(n) < 0));
        const options = { width: canvas.width, height: canvas.height, pixelRatio: 1, meshWidth: 32, meshHeight: 24 };
        // Butterchurn only uses the audio context to tap live audio; the
        // waveform is handed to render() instead.
        visualizer = api.createVisualizer(null, canvas, options);
        showIndexed(0);
      })
      .catch((error) => fail(String((error && error.message) || error)));
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      fail("graphics context lost");
    });
  }

  return {
    id: "milkdrop",
    name: "MilkDrop",
    gl: true,
    scale: SCALE,
    create({ canvas }) {
      if (visualizer) {
        visualizer.setRendererSize(canvas.width, canvas.height);
        onNotice(current);
      }
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
          watchFrameRate(f.dt);
          if (rotateSeconds && sincePreset >= rotateSeconds) random();
        },
      };
    },
    step,
    fail,
    // Show a preset that is not in the package (used to measure candidates).
    // It is never skipped, so its true frame rate can be read.
    showExternal(name, preset) {
      if (!visualizer) return false;
      watching = false;
      show(name, preset, 0);
      return true;
    },
    // Called when the page is hidden or closed normally: a start that got
    // this far did not take the TV down.
    settle() {
      if (loading && !failed) savePref("milkdropPending", false);
    },
    forgetSlow() {
      slow = [];
      savePref("slowPresets", slow);
    },
    get slowCount() {
      return slow.length;
    },
    get rotateSeconds() {
      return rotateSeconds;
    },
    set rotateSeconds(seconds) {
      rotateSeconds = seconds;
      savePref("presetRotate", seconds);
    },
    get ready() {
      return visualizer !== null && !failed;
    },
    get presetName() {
      return visualizer ? current : loading ? "loading" : "";
    },
    get presetPosition() {
      return visualizer ? index + 1 + "/" + names.length : "";
    },
  };
}
