// Per-frame audio analysis. Each derived value is computed at most once per
// waveform frame, and only when a visualizer asks for it.
import { FFT } from "./vendor/FFTNullsoft.ts";
import { analyzeFrame, newAnalysisState } from "./vendor/wavescope/analyze.ts";

export const WAVE_SAMPLES = 1024;
export const SPECTRUM_BINS = 512;

const SILENCE = new Uint8Array(WAVE_SAMPLES).fill(128);

// Byte spectrum in the style of a Web Audio AnalyserNode: Blackman window,
// time smoothing, decibels mapped onto 0-255. The window is narrower than the
// AnalyserNode default (-100..-30 dB) because the relay's 8-bit samples have a
// noise floor near -75 dB per bin (higher once levelled), which would otherwise
// show as a haze.
const MIN_DB = -60;
const MAX_DB = -14;
// Music has less energy the higher the frequency, and what the 8-bit samples
// keep of the top octave is mostly noise. So the spectrum handed to the
// visualizers stops at TOP_HZ, and is tilted upward so it reads as level
// across that range rather than as a bass hump.
const TOP_HZ = 10000;
const TILT_DB_PER_OCTAVE = 3;
const TILT_PIVOT_HZ = 1000;
const SMOOTHING = 0.8; // per 1/60 s, as an AnalyserNode applies it per frame
const SERVER_BEAT_MEMORY = 4; // seconds a track counts as having server beats

// Automatic level: tracks arrive at whatever loudness they were mastered at,
// and a quiet one would barely move the bars. The waveform is scaled so its
// recent peak sits near full scale: gain drops at once on a loud passage and
// recovers slowly.
const LEVEL_TARGET = 100; // of 127
const LEVEL_MAX_GAIN = 8;
const LEVEL_RELEASE_SECONDS = 10;
const BEAT_DECAY = 6;

const BLACKMAN = new Float32Array(WAVE_SAMPLES);
const COS = new Float32Array(WAVE_SAMPLES / 2);
const SIN = new Float32Array(WAVE_SAMPLES / 2);
const REVERSED = new Uint16Array(WAVE_SAMPLES);
{
  const n = WAVE_SAMPLES;
  for (let i = 0; i < n; i++) {
    BLACKMAN[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
    let r = 0;
    for (let bit = 0, v = i; bit < 10; bit++, v >>= 1) r = (r << 1) | (v & 1);
    REVERSED[i] = r;
  }
  for (let i = 0; i < n / 2; i++) {
    COS[i] = Math.cos((2 * Math.PI * i) / n);
    SIN[i] = -Math.sin((2 * Math.PI * i) / n);
  }
}

// In-place radix-2 FFT over WAVE_SAMPLES points.
function transform(re, im) {
  const n = WAVE_SAMPLES;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step];
        const wi = SIN[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

export function createAnalysis() {
  const nullsoft = new FFT();
  const input = new Float32Array(WAVE_SAMPLES);
  const spectrum = new Float32Array(SPECTRUM_BINS);
  const re = new Float32Array(WAVE_SAMPLES);
  const im = new Float32Array(WAVE_SAMPLES);
  const smoothed = new Float32Array(SPECTRUM_BINS);
  const bytes = new Uint8Array(SPECTRUM_BINS);
  const state = newAnalysisState();
  const levelled = new Uint8Array(WAVE_SAMPLES);
  let autoLevel = true;
  let peak = LEVEL_TARGET;
  let gain = 1;
  let wave = SILENCE;
  let stamp = 0;
  let spectrumStamp = -1;
  let frameStamp = -1;
  let frame = null;
  let sinceServerBeat = Infinity;

  let rate = 0;
  let used = SPECTRUM_BINS; // bins up to TOP_HZ
  let view = bytes;
  const tilt = new Float32Array(SPECTRUM_BINS);

  function setRate(sampleRate) {
    rate = sampleRate;
    const hzPerBin = sampleRate / WAVE_SAMPLES;
    used = Math.max(32, Math.min(SPECTRUM_BINS, Math.round(TOP_HZ / hzPerBin)));
    view = bytes.subarray(0, used);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      tilt[i] = TILT_DB_PER_OCTAVE * Math.log2(Math.max(i, 1) * hzPerBin / TILT_PIVOT_HZ);
    }
  }

  function byteSpectrum(dt) {
    for (let i = 0; i < WAVE_SAMPLES; i++) {
      re[REVERSED[i]] = ((wave[i] - 128) / 128) * BLACKMAN[i];
      im[i] = 0;
    }
    transform(re, im);
    const keep = Math.pow(SMOOTHING, dt * 60);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const magnitude = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / WAVE_SAMPLES;
      smoothed[i] = keep * smoothed[i] + (1 - keep) * magnitude;
      const db = 20 * Math.log10(smoothed[i] + 1e-12) + tilt[i];
      bytes[i] = Math.max(0, Math.min(255, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 255));
    }
  }

  return {
    // `dt` is the time since the previous frame, which paces the level release.
    setWave(next, dt) {
      stamp++;
      if (!next || !autoLevel) {
        wave = next || SILENCE;
        gain = 1;
        return;
      }
      let loudest = 0;
      for (let i = 0; i < WAVE_SAMPLES; i++) {
        const d = next[i] > 128 ? next[i] - 128 : 128 - next[i];
        if (d > loudest) loudest = d;
      }
      peak = Math.max(loudest, peak * Math.exp(-(dt || 1 / 60) / LEVEL_RELEASE_SECONDS), LEVEL_TARGET / LEVEL_MAX_GAIN);
      gain = Math.max(1, LEVEL_TARGET / peak);
      for (let i = 0; i < WAVE_SAMPLES; i++) {
        const v = 128 + (next[i] - 128) * gain;
        levelled[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      wave = levelled;
    },
    get gain() {
      return gain;
    },
    get autoLevel() {
      return autoLevel;
    },
    set autoLevel(on) {
      autoLevel = on;
    },
    get wave() {
      return wave;
    },
    // Magnitudes in Winamp's own scale (input divided by 24, log-equalized).
    spectrum() {
      if (spectrumStamp !== stamp) {
        for (let i = 0; i < WAVE_SAMPLES; i++) input[i] = (wave[i] - 128) / 24;
        nullsoft.timeToFrequencyDomain(input, spectrum);
        spectrumStamp = stamp;
      }
      return spectrum;
    },
    // The frame the wavescope visualizers draw from: byte spectrum, waveform,
    // level, band energies and a beat envelope. `beatHit` is non-zero on the
    // frame a beat from the server lands; tracks without server beats fall
    // back to wavescope's bass-onset detection.
    frame(t, dt, sampleRate, beatHit) {
      if (frameStamp === stamp) return frame;
      frameStamp = stamp;
      if ((sampleRate || 44100) !== rate) setRate(sampleRate || 44100);
      byteSpectrum(dt);
      const before = state.beatEnv;
      // The spectrum view ends at bin `used`, so describe it as audio sampled
      // at twice that bin's frequency to keep wavescope's band maths right.
      frame = analyzeFrame(view, wave, (used * rate) / (WAVE_SAMPLES / 2), t, dt, state);
      sinceServerBeat = beatHit ? 0 : sinceServerBeat + dt;
      if (sinceServerBeat < SERVER_BEAT_MEMORY) {
        state.beatEnv = beatHit ? 1 : before * Math.exp(-dt * BEAT_DECAY);
        frame.beat = state.beatEnv;
      }
      return frame;
    },
  };
}
