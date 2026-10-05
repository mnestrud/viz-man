import "./polyfills.js";
import { createAnalysis } from "./analysis.js";
import { createDebug } from "./debug.js";
import { startDevlink } from "./devlink.js";
import { startDrift } from "./drift.js";
import { createEngine } from "./engine.js";
import { createKeepAwake } from "./keepawake.js";
import { exitApp, installKeys } from "./keys.js";
import { createLive } from "./live.js";
import { createMenu } from "./menu.js";
import { createMock } from "./mock.js";
import { classicModes, classicOptions } from "./modes/classic.js";
import { clearMilkdropBlocks, createMilkdropMode, hasWebGL2, milkdropBlocker } from "./modes/milkdrop.js";
import { wavescopeModes, wavescopeOptions } from "./modes/wavescope.js";
import { loadPref, mergeSettings, normalizeParams, parseQuery, readLaunchParams, savePref } from "./settings.js";

const TRIM_STEP_MS = 25;
const MESSAGE_REFRESH_MS = 1000;
const HINT_MS = 3000;
const SLOW_FPS = 15;
const SLOW_SECONDS = 10;

let booted = false;

function boot(event) {
  if (booted) return;
  booted = true;

  const settings = mergeSettings(
    window.VIS_CONFIG || {},
    readLaunchParams(window, event),
    parseQuery(location.search),
    location.origin
  );
  const byId = (id) => document.getElementById(id);
  const canvas = byId("canvas");
  const message = byId("message");
  const hint = byId("hint");
  const isTv = /Web0S|webOS/i.test(navigator.userAgent);
  const configured = !!(settings.host && settings.token);
  let holdWhenIdle = loadPref("holdWhenIdle", settings.holdWhenIdle);

  const analysis = createAnalysis();
  analysis.autoLevel = loadPref("autoLevel", true);
  classicOptions.album = loadPref("classicAlbum", false);
  const live = settings.mock || !configured ? null : createLive(settings);
  const source = settings.mock ? createMock() : live || { wave: () => null };
  const engine = createEngine({ canvas, glCanvas: byId("gl"), analysis, source });
  engine.setFpsCap(loadPref("fpsCap", 60));

  // MilkDrop goes into the rotation only if it may run; every failure takes
  // it back out and falls back to the classic analyzer.
  let milkdropOff = settings.noWebgl ? "no WebGL2" : milkdropBlocker();
  const milkdrop = createMilkdropMode((reason) => {
    milkdropOff = reason;
    debug.record("MilkDrop off: " + reason);
    engine.remove("milkdrop");
  });
  engine.register(classicModes);
  engine.register(wavescopeModes);
  if (!milkdropOff) engine.register([milkdrop]);
  engine.onModeChange((mode) => savePref("mode", mode.id));

  // Veto the screensaver only while this page is on screen and has something
  // to show (or was asked to hold the screen while idle).
  const keepAwake = createKeepAwake(() => !document.hidden && (!engine.idle || holdWhenIdle));
  keepAwake.start();

  const menu = createMenu(byId("menu"), [
    {
      label: "Visualizer",
      value: () => (engine.mode ? engine.mode.name : ""),
      change: (direction) => (direction < 0 ? engine.prev() : engine.next()),
    },
    {
      label: "Preset",
      visible: () => engine.mode === milkdrop,
      value: () => milkdrop.presetName,
      change: (direction) => milkdrop.step(direction),
    },
    {
      label: "MilkDrop",
      visible: () => !!milkdropOff && hasWebGL2() && !settings.noWebgl,
      value: () => "off: " + milkdropOff + " (OK to retry)",
      change() {
        clearMilkdropBlocks();
        savePref("mode", "milkdrop");
        location.reload();
      },
    },
    {
      label: "Sync trim",
      visible: () => !!live,
      value: () => (live.trimMs > 0 ? "+" : "") + live.trimMs + " ms",
      change: (direction) => live.nudgeTrim(direction * TRIM_STEP_MS),
    },
    {
      label: "Winamp colours",
      value: () => (classicOptions.album ? "from album" : "classic"),
      change() {
        classicOptions.album = !classicOptions.album;
        savePref("classicAlbum", classicOptions.album);
      },
    },
    {
      label: "Auto level",
      value: () => (analysis.autoLevel ? "on" : "off"),
      change() {
        analysis.autoLevel = !analysis.autoLevel;
        savePref("autoLevel", analysis.autoLevel);
      },
    },
    {
      label: "Frame rate cap",
      value: () => engine.fpsCap + " fps",
      change() {
        engine.setFpsCap(engine.fpsCap === 60 ? 30 : 60);
        savePref("fpsCap", engine.fpsCap);
      },
    },
    {
      label: "Hold screen when idle",
      value: () => (holdWhenIdle ? "on" : "off"),
      change() {
        holdWhenIdle = !holdWhenIdle;
        savePref("holdWhenIdle", holdWhenIdle);
      },
    },
    { label: "Debug readout", value: () => (debug.visible ? "on" : "off"), change: () => debug.show(!debug.visible) },
    { label: "Close menu", change: () => menu.close() },
  ]);

  const debug = createDebug(byId("debug"), () =>
    Object.assign(
      {
        mode: engine.mode ? engine.mode.name : "-",
        preset: engine.mode === milkdrop ? milkdrop.presetName : "-",
        fps: engine.fps + " (cap " + engine.fpsCap + ")",
        canvas: (engine.mode && engine.mode.gl ? byId("gl").width + "x" + byId("gl").height + " gl" : canvas.width + "x" + canvas.height),
        window: window.innerWidth + "x" + window.innerHeight,
        webgl2: hasWebGL2() ? "yes" + (milkdropOff ? ", MilkDrop off: " + milkdropOff : "") : "no",
        source: settings.mock ? "mock" : live ? "live" : "not configured",
        idle: engine.idle + (engine.idle ? " (" + message.textContent + ")" : ""),
        scripts: document.scripts.length,
        gain: analysis.autoLevel ? "x" + analysis.gain.toFixed(1) : "off",
        menu: menu.describe(),
      },
      live ? live.status() : {},
      { keepAwake: keepAwake.status, agent: navigator.userAgent }
    )
  );
  debug.show(settings.debug);

  function refreshMessage() {
    if (!engine.idle) {
      message.style.display = "none";
      return;
    }
    message.textContent = !configured && !settings.mock ? "Not configured" : (live && live.problem) || "Waiting for music";
    message.style.display = "block";
  }
  engine.onIdleChange(refreshMessage);
  setInterval(refreshMessage, MESSAGE_REFRESH_MS);

  // MilkDrop that cannot keep up is worse than bars that can.
  let slowSeconds = 0;
  setInterval(() => {
    const struggling = engine.running && engine.mode === milkdrop && milkdrop.ready && !engine.idle && engine.fps < SLOW_FPS;
    slowSeconds = struggling ? slowSeconds + 1 : 0;
    if (slowSeconds >= SLOW_SECONDS) {
      savePref("milkdropSlow", true);
      milkdrop.fail("too slow on this TV");
    }
  }, 1000);

  function onKey(name) {
    if (menu.handleKey(name)) return;
    if (name === "right") engine.next();
    else if (name === "left") engine.prev();
    else if (name === "up" && engine.mode === milkdrop) milkdrop.step(1);
    else if (name === "down" && engine.mode === milkdrop) milkdrop.step(-1);
    else if (name === "ok") menu.open();
    else if (name === "red" && live) live.nudgeTrim(-TRIM_STEP_MS);
    else if (name === "green" && live) live.nudgeTrim(TRIM_STEP_MS);
    else if (name === "back") exitApp();
  }
  installKeys(onKey);

  // Moving the Magic Remote pointer shows how to reach the menu.
  let hintTimer = 0;
  function showHint() {
    if (menu.isOpen) return;
    hint.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint.style.opacity = "0"), HINT_MS);
  }
  document.addEventListener("mousemove", showHint);
  document.addEventListener("cursorStateChange", (change) => {
    if (change.detail && change.detail.visibility) showHint();
  });
  hint.addEventListener("click", () => menu.open());

  startDrift([byId("stage"), message]);

  startDevlink({
    base: settings.report,
    client: isTv ? "tv" : "browser",
    getStatus: debug.status,
    engine,
    onCommand(command) {
      if (command.type === "key") onKey(command.key);
      else if (command.type === "mode") engine.setModeById(command.id);
      else if (command.type === "debug") debug.show(!!command.on);
      else if (command.type === "floor") wavescopeOptions.floor = !!command.on;
      else if (command.type === "blank") wavescopeOptions.blank = !!command.on;
    },
  });

  // A hidden app is suspended by webOS and its sockets may die unnoticed, so
  // drop everything when hidden and start afresh when shown again.
  function resume() {
    if (engine.running) return;
    if (live) live.start();
    engine.start();
  }
  function suspend() {
    engine.stop();
    if (live) live.stop();
    milkdrop.settle();
  }
  function onVisibility() {
    if (document.hidden) suspend();
    else resume();
  }
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("webkitvisibilitychange", onVisibility);
  window.addEventListener("pagehide", () => milkdrop.settle());
  document.addEventListener("webOSRelaunch", (relaunch) => {
    // Relaunched with parameters (a different player, say): start over so
    // they are read the same way as on a first launch.
    if (Object.keys(normalizeParams(relaunch.detail)).length) return location.reload();
    suspend();
    resume();
  });

  // Start on the last visualizer used; failing that MilkDrop, then the bars.
  if (!engine.setModeById(loadPref("mode", "")) && !engine.setModeById("milkdrop")) engine.setMode(0);
  if (document.hidden) refreshMessage();
  else resume();
}

// webOS delivers launch parameters with webOSLaunch on some firmware and not
// at all on others, so boot on whichever comes first.
document.addEventListener("webOSLaunch", boot);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot());
else boot();
