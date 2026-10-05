import assert from "node:assert/strict";
import { test } from "node:test";
import { makePalette, stopsFromAlbum } from "../src/modes/palette.js";

test("album colours: black is dropped, duplicates merged, one colour gets a range", () => {
  const stops = stopsFromAlbum({ primary: [4, 4, 4], accent: [228, 132, 63], on_dark: [228, 132, 63] });
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0], [228, 132, 63]);
  assert.ok(stops[1][0] > 228 && stops[1][2] > 63, "second stop is a lighter tint");
});

test("dark colours are lifted so they show on black; no album means the default", () => {
  const [first] = stopsFromAlbum({ primary: [60, 20, 10], accent: [10, 60, 200] });
  assert.equal(Math.round(Math.max(...first)), 170);
  assert.equal(stopsFromAlbum(null).length, 4);
  assert.equal(stopsFromAlbum({ primary: null }).length, 4);
});

test("palette colours interpolate between stops and reuse their strings", () => {
  const palette = makePalette([[0, 0, 0], [200, 100, 50]]);
  assert.equal(palette.color(0, 1), "rgba(0,0,0,1)");
  assert.equal(palette.color(1, 0.5), "rgba(200,100,50,0.5)");
  assert.equal(palette.color(1), "rgba(200,100,50,1)");
  assert.equal(palette.color(5, 2), "rgba(200,100,50,1)", "out-of-range inputs are clamped");
  assert.equal(palette.bg, "#000");
});
