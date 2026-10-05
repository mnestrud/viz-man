// Synthetic signal for developing without music playing (?mock=1): a kick on
// every beat at 120 bpm, a bass note per bar, an arpeggio and off-beat noise.

const SAMPLE_RATE = 44100;
const SAMPLES = 1024;
const BEAT = 0.5;
const BASS = [55, 65.4, 73.4, 49];
const ARP = [220, 277.2, 329.6, 440, 554.4, 659.3];
const TAU = Math.PI * 2;

function noise(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function sampleAt(t, n) {
  const sinceBeat = t % BEAT;
  const kick = Math.sin(TAU * (48 * sinceBeat + (90 / 28) * (1 - Math.exp(-28 * sinceBeat)))) * Math.exp(-7 * sinceBeat);
  const bass = Math.sin(TAU * BASS[Math.floor(t / (BEAT * 4)) % BASS.length] * t) * 0.35;
  const arpStep = Math.floor(t / (BEAT / 2));
  const sinceArp = t % (BEAT / 2);
  const note = ARP[arpStep % ARP.length];
  const arp = (Math.sin(TAU * note * t) + 0.5 * Math.sin(TAU * note * 4 * t)) * Math.exp(-6 * sinceArp) * 0.3;
  const sinceHat = (t + BEAT / 2) % BEAT;
  const hat = noise(n) * Math.exp(-25 * sinceHat) * 0.45;
  return kick * 0.5 + bass + arp + hat;
}

export function createMock() {
  const buffer = new Uint8Array(SAMPLES);
  return {
    sampleRate: SAMPLE_RATE,
    // The window of audio that finishes sounding at nowMs.
    wave(nowMs) {
      const end = Math.floor((nowMs / 1000) * SAMPLE_RATE);
      for (let i = 0; i < SAMPLES; i++) {
        const n = end - SAMPLES + i;
        const v = sampleAt(n / SAMPLE_RATE, n);
        buffer[i] = Math.max(0, Math.min(255, Math.round(128 + v * 100)));
      }
      return buffer;
    },
  };
}
