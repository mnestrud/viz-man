// Render loop and visualizer registry.
//
// A mode is { id, name, create({canvas, ctx}) -> { draw(ctx, frame) } } plus
// optional sizing: `width`/`height` for a fixed grid, `pixelated` to scale it
// with hard pixels, `scale` for a size relative to the window, and `gl` for a
// mode that draws with WebGL on its own canvas.

const FPS_WINDOW_MS = 1000;
const DEFAULT_SCALE = 0.5;

export function createEngine({ canvas, glCanvas, analysis, source }) {
  const ctx = canvas.getContext("2d");
  const modes = [];
  const afterRender = [];
  const modeListeners = [];
  const idleListeners = [];
  let idle = false;
  let index = -1;
  let instance = null;
  let target = canvas;
  let raf = 0;
  let running = false;
  let lastFrameMs = 0;
  let fpsCap = 60;
  let fps = 0;
  let fpsFrames = 0;
  let fpsSince = 0;

  function prepareCanvas(mode) {
    target = mode.gl ? glCanvas : canvas;
    canvas.style.display = mode.gl ? "none" : "block";
    glCanvas.style.display = mode.gl ? "block" : "none";
    const scale = mode.scale || DEFAULT_SCALE;
    const w = mode.width || Math.round(window.innerWidth * scale);
    const h = mode.height || Math.round(window.innerHeight * scale);
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    target.style.imageRendering = mode.pixelated ? "pixelated" : "auto";
    if (!mode.gl) {
      // Modes share one 2D context; hand each a clean one.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function setMode(next) {
    if (!modes.length) return;
    const n = ((next % modes.length) + modes.length) % modes.length;
    if (instance && instance.dispose) instance.dispose();
    index = n;
    prepareCanvas(modes[n]);
    instance = modes[n].create({ canvas: target, ctx });
    for (const fn of modeListeners) fn(modes[n]);
  }

  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    const minInterval = 1000 / fpsCap - 2;
    if (nowMs - lastFrameMs < minInterval) return;
    const dt = lastFrameMs ? Math.min((nowMs - lastFrameMs) / 1000, 0.25) : 1 / 60;
    lastFrameMs = nowMs;

    if (nowMs - fpsSince >= FPS_WINDOW_MS) {
      fps = Math.round((fpsFrames * 1000) / (nowMs - fpsSince));
      fpsFrames = 0;
      fpsSince = nowMs;
    }
    fpsFrames++;

    const wave = source.wave(nowMs);
    if (wave === null) {
      // Nothing is playing: blank the picture once and wait.
      if (!idle) {
        idle = true;
        canvas.style.visibility = glCanvas.style.visibility = "hidden";
        for (const fn of idleListeners) fn(true);
      }
    } else {
      if (idle) {
        idle = false;
        canvas.style.visibility = glCanvas.style.visibility = "visible";
        for (const fn of idleListeners) fn(false);
      }
      analysis.setWave(wave, dt);
      if (instance) {
        instance.draw(ctx, {
          t: nowMs / 1000,
          dt,
          analysis,
          sampleRate: source.sampleRate || 44100,
          beatHit: source.beatHit || 0,
          palette: source.palette || null,
        });
      }
    }
    for (const fn of afterRender) fn(target, modes[index]);
  }

  return {
    register(list) {
      for (const mode of list) modes.push(mode);
    },
    setMode,
    setModeById(id) {
      const found = modes.findIndex((m) => m.id === id);
      if (found >= 0) setMode(found);
      return found >= 0;
    },
    // Take a mode out of rotation (MilkDrop when it cannot run).
    remove(id) {
      const found = modes.findIndex((m) => m.id === id);
      if (found < 0) return;
      const wasActive = found === index;
      modes.splice(found, 1);
      if (found < index) index--;
      if (wasActive) setMode(0);
    },
    next() {
      setMode(index + 1);
    },
    prev() {
      setMode(index - 1);
    },
    start() {
      if (running) return;
      running = true;
      lastFrameMs = 0;
      fpsSince = performance.now();
      fpsFrames = 0;
      if (index < 0) setMode(0);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setFpsCap(cap) {
      fpsCap = cap;
    },
    onAfterRender(fn) {
      afterRender.push(fn);
    },
    onModeChange(fn) {
      modeListeners.push(fn);
    },
    onIdleChange(fn) {
      idleListeners.push(fn);
    },
    get idle() {
      return idle;
    },
    get running() {
      return running;
    },
    get mode() {
      return modes[index] || null;
    },
    get modes() {
      return modes;
    },
    get fps() {
      return fps;
    },
    get fpsCap() {
      return fpsCap;
    },
  };
}
