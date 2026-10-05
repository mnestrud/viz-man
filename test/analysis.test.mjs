import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnalysis, SPECTRUM_BINS, WAVE_SAMPLES } from "../src/analysis.js";
import { createAnalyzerState, stepAnalyzer } from "../src/modes/classic.js";

function sine(cycles, amplitude = 100) {
  // amplitude 100 is the auto-level target, so tests see the wave unscaled
  const wave = new Uint8Array(WAVE_SAMPLES);
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    wave[i] = Math.round(128 + amplitude * Math.sin((2 * Math.PI * cycles * i) / WAVE_SAMPLES));
  }
  return wave;
}

function loudest(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

test("spectrum peaks at the bin of a pure tone", () => {
  const analysis = createAnalysis();
  analysis.setWave(sine(40));
  const spectrum = analysis.spectrum();
  assert.equal(spectrum.length, SPECTRUM_BINS);
  assert.equal(loudest(spectrum), 40);
});

test("silence gives an empty spectrum, and no wave means silence", () => {
  const analysis = createAnalysis();
  analysis.setWave(null);
  assert.equal(Math.max(...analysis.spectrum()), 0);
});

test("spectrum is recomputed only when the wave changes", () => {
  const analysis = createAnalysis();
  analysis.setWave(sine(10));
  const first = Array.from(analysis.spectrum());
  assert.deepEqual(Array.from(analysis.spectrum()), first);
  analysis.setWave(sine(200));
  assert.equal(loudest(analysis.spectrum()), 200);
});

test("analyzer bars rise at once, fall gradually, and leave a peak cap behind", () => {
  const analysis = createAnalysis();
  const state = createAnalyzerState();
  analysis.setWave(sine(4, 120));
  stepAnalyzer(state, analysis.spectrum(), true);
  const bar = loudest(state.falloff);
  const risen = state.falloff[bar];
  assert.ok(risen > 5, `expected a tall bar, got ${risen}`);
  assert.ok(risen <= 15);
  // wide bars: the four columns of a chunk share one level
  assert.equal(state.level[bar & ~3], state.level[(bar & ~3) + 1]);

  analysis.setWave(null);
  stepAnalyzer(state, analysis.spectrum(), true);
  assert.equal(state.falloff[bar], risen - 0.75);
  assert.ok(state.barPeak[bar] >= Math.floor(risen) - 1, "peak cap should still hang near the top");

  for (let i = 0; i < 120; i++) stepAnalyzer(state, analysis.spectrum(), true);
  assert.equal(state.falloff[bar], 0);
  assert.equal(state.peaks[bar], 0);
});

test("the wavescope frame has a byte spectrum peaking at the tone and sane levels", () => {
  const analysis = createAnalysis();
  analysis.setWave(sine(40));
  const frame = analysis.frame(1, 1 / 60, 44100, 0);
  assert.equal(frame.fft.length, 232, "bins up to 10 kHz at 44.1 kHz");
  assert.equal(loudest(frame.fft), 40);
  assert.equal(frame.wave.length, WAVE_SAMPLES);
  assert.ok(frame.level > 0 && frame.level <= 1);
  assert.equal(analysis.frame(1, 1 / 60, 44100, 0), frame, "computed once per wave");
  // 40 cycles in 1024 samples at 44.1 kHz is 1.7 kHz: the mid band
  assert.ok(frame.mid > frame.bass && frame.mid > frame.treble);
});

test("silence gives an empty byte spectrum", () => {
  const analysis = createAnalysis();
  analysis.setWave(null);
  const frame = analysis.frame(0, 1 / 60, 44100, 0);
  assert.equal(Math.max(...frame.fft), 0);
  assert.equal(frame.level, 0);
});

test("a server beat charges the beat envelope, which then decays", () => {
  const analysis = createAnalysis();
  analysis.setWave(sine(40, 20));
  assert.equal(analysis.frame(0, 1 / 60, 44100, 1).beat, 1);
  analysis.setWave(sine(40, 20));
  const next = analysis.frame(1 / 60, 1 / 60, 44100, 0).beat;
  assert.ok(next < 1 && next > 0.8, `expected a decaying envelope, got ${next}`);
});

test("auto level lifts a quiet wave toward full scale and backs off at once when it gets loud", () => {
  const analysis = createAnalysis();
  analysis.setWave(sine(8, 25), 1 / 60);
  assert.ok(analysis.gain < 1.01, "starts from the assumption that the track is loud");
  for (let i = 0; i < 60 * 40; i++) analysis.setWave(sine(8, 25), 1 / 60);
  assert.ok(analysis.gain > 3.9 && analysis.gain <= 4, `expected about x4, got ${analysis.gain}`);
  const lifted = Math.max(...analysis.wave) - 128;
  assert.ok(lifted >= 98 && lifted <= 100, `expected a peak near 100, got ${lifted}`);

  analysis.setWave(sine(8, 120), 1 / 60);
  assert.equal(analysis.gain, 1);
  assert.ok(Math.max(...analysis.wave) <= 255);

  analysis.autoLevel = false;
  analysis.setWave(sine(8, 25), 1 / 60);
  assert.equal(Math.max(...analysis.wave) - 128, 25);
});

test("auto level never exceeds its maximum gain, even on near-silence", () => {
  const analysis = createAnalysis();
  for (let i = 0; i < 60 * 120; i++) analysis.setWave(sine(8, 2), 1 / 60);
  assert.equal(analysis.gain, 8);
});
