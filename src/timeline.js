// Buffers waveform frames and beats, which arrive a few seconds early, and
// hands each one out when the server clock reaches its timestamp.

const CAPACITY = 2048;
const HOLD_US = 300000; // keep showing the last frame this long when starved
const FADE_US = 500000; // then fade it to silence over this long
const SAMPLES = 1024;
const MAX_FACTOR = 4;
const TARGET_RATE = 48000;

const STANDARD_RATES = [44100, 48000, 88200, 96000, 176400, 192000];

// Timestamps are whole microseconds, so the measured rate wobbles by a few
// hertz; settle it on the standard rate it is nearest to.
function snapRate(measured) {
  for (const rate of STANDARD_RATES) if (Math.abs(measured - rate) < rate * 0.01) return rate;
  return Math.round(measured);
}

export function createTimeline() {
  let frames = []; // {ts, samples}, in timestamp order
  let beats = []; // {ts, downbeat}
  let current = null;
  let sampleRate = 0;
  let lastPushed = 0;
  const faded = new Uint8Array(SAMPLES);
  // The newest samples shown, kept so hi-res streams can be downsampled: at
  // 96 kHz a 1024-sample window is too short and too wide-band to analyse, so
  // two (or four) windows are averaged down to one at about 48 kHz.
  const history = new Uint8Array(SAMPLES * MAX_FACTOR).fill(128);
  const reduced = new Uint8Array(SAMPLES);

  function factor() {
    return Math.max(1, Math.min(MAX_FACTOR, Math.round(sampleRate / TARGET_RATE)));
  }

  function remember(samples) {
    history.copyWithin(0, SAMPLES);
    history.set(samples, history.length - SAMPLES);
  }

  function shown() {
    const k = factor();
    if (k === 1) return current.samples;
    const start = history.length - SAMPLES * k;
    for (let i = 0; i < SAMPLES; i++) {
      let sum = 0;
      for (let j = 0; j < k; j++) sum += history[start + i * k + j];
      reduced[i] = sum / k;
    }
    return reduced;
  }

  return {
    push(ts, samples) {
      // Frames are back-to-back 1024-sample windows, so their spacing gives
      // the track's sample rate, which the wire does not carry.
      const gap = ts - lastPushed;
      if (lastPushed && gap > 0 && gap < 100000) sampleRate = snapRate(1024e6 / gap);
      lastPushed = ts;
      if (frames.length && ts < frames[frames.length - 1].ts) {
        // Out of order only happens around a reconnect; start again.
        frames = [];
      }
      frames.push({ ts, samples });
      if (frames.length > CAPACITY) frames.shift();
    },
    pushBeat(ts, downbeat) {
      beats.push({ ts, downbeat });
      if (beats.length > CAPACITY) beats.shift();
    },
    clear() {
      frames = [];
      beats = [];
      current = null;
      lastPushed = 0;
      history.fill(128);
    },
    // The waveform to show at server time `nowUs`, or null when there is none.
    pick(nowUs) {
      let due = -1;
      while (due + 1 < frames.length && frames[due + 1].ts <= nowUs) due++;
      if (due >= 0) {
        for (let i = Math.max(0, due + 1 - MAX_FACTOR); i <= due; i++) remember(frames[i].samples);
        current = frames[due];
        frames.splice(0, due + 1);
      }
      if (!current) return null;
      const age = nowUs - current.ts;
      const samples = shown();
      if (age <= HOLD_US) return samples;
      if (age >= HOLD_US + FADE_US) return null;
      const keep = 1 - (age - HOLD_US) / FADE_US;
      for (let i = 0; i < SAMPLES; i++) faded[i] = 128 + (samples[i] - 128) * keep;
      return faded;
    },
    // Beats that have come due since the last call: 0 none, 1 beat, 2 downbeat.
    takeBeat(nowUs) {
      let hit = 0;
      while (beats.length && beats[0].ts <= nowUs) {
        hit = Math.max(hit, beats[0].downbeat ? 2 : 1);
        beats.shift();
      }
      return hit;
    },
    get buffered() {
      return frames.length;
    },
    // The rate of the track as the relay sends it.
    get sourceRate() {
      return sampleRate;
    },
    // The rate of the samples pick() returns, after any downsampling.
    get sampleRate() {
      return sampleRate / factor();
    },
    // How far ahead of `nowUs` the newest buffered frame is.
    leadUs(nowUs) {
      return frames.length ? frames[frames.length - 1].ts - nowUs : 0;
    },
  };
}
