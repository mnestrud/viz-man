import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSettings, normalizeParams, parseQuery, readLaunchParams } from "../src/settings.js";

test("query string is parsed, with bare keys meaning on", () => {
  assert.deepEqual(parseQuery("?mock=1&player=RINCON_1&debug"), { mock: "1", player: "RINCON_1", debug: "1" });
  assert.deepEqual(parseQuery(""), {});
});

test("launch parameters are accepted as an object or a JSON string", () => {
  assert.deepEqual(normalizeParams('{"player":"a"}'), { player: "a" });
  assert.deepEqual(normalizeParams({ player: "a" }), { player: "a" });
  assert.deepEqual(normalizeParams("not json"), {});
  assert.deepEqual(normalizeParams(undefined), {});
});

test("launch parameters are read from the event, then the window, then the system object", () => {
  assert.deepEqual(readLaunchParams({}, { detail: { player: "event" } }), { player: "event" });
  assert.deepEqual(readLaunchParams({ launchParams: '{"player":"window"}' }, null), { player: "window" });
  assert.deepEqual(readLaunchParams({ PalmSystem: { launchParams: '{"player":"palm"}' } }, {}), { player: "palm" });
  assert.deepEqual(readLaunchParams({}, null), {});
});

test("query overrides launch parameters, which override the build config", () => {
  const merged = mergeSettings({ host: "h", token: "t", player: "config" }, { player: "launch" }, { player: "query" }, "");
  assert.equal(merged.player, "query");
  assert.equal(mergeSettings({ player: "config" }, { player: "launch" }, {}, "").player, "launch");
  assert.equal(merged.host, "h");
});

test("flags become booleans and report=1 means the page's own server", () => {
  const merged = mergeSettings({ holdWhenIdle: false }, {}, { mock: "1", report: "1" }, "http://192.168.113.31:8137");
  assert.equal(merged.mock, true);
  assert.equal(merged.debug, false);
  assert.equal(merged.holdWhenIdle, false);
  assert.equal(merged.report, "http://192.168.113.31:8137");
  assert.equal(mergeSettings({ report: "http://host:1/" }, {}, {}, "").report, "http://host:1");
  assert.equal(mergeSettings({}, {}, {}, "http://x").report, "");
});
