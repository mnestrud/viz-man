import assert from "node:assert/strict";
import { test } from "node:test";
import { allPrefs, hasPref, loadPref, mergePrefs, mergeSettings, normalizeParams, onPrefChange, parseQuery, readLaunchParams, savePref } from "../src/settings.js";

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

test("preferences fall back to memory without localStorage, and merging only fills gaps", () => {
  const changes = [];
  onPrefChange((snapshot) => changes.push(snapshot));
  assert.equal(loadPref("favourites", "none"), "none");
  savePref("favourites", ["a"]);
  assert.deepEqual(loadPref("favourites"), ["a"]);
  assert.equal(hasPref("favourites"), true);
  assert.deepEqual(changes, [{ favourites: ["a"] }]);

  const taken = mergePrefs({ favourites: ["remote"], trim: 50 });
  assert.deepEqual(taken, ["trim"], "the local favourites win; the missing trim is taken");
  assert.equal(loadPref("trim"), 50);
  assert.deepEqual(allPrefs(), { favourites: ["a"], trim: 50 });
  assert.equal(changes.length, 1, "merging does not count as a change");
  onPrefChange(null);
});

test("favourites reconcile per preset by the time of the last change", async () => {
  const { mergeFavourites, favouritesFromList, favouriteNames } = await import("../src/settings.js");
  const mine = { a: { on: true, at: 100 }, b: { on: true, at: 100 }, c: { on: false, at: 300 } };
  const theirs = { a: { on: false, at: 200 }, b: { on: false, at: 50 }, c: { on: true, at: 250 }, d: { on: true, at: 400 } };
  const merged = mergeFavourites(mine, theirs);
  assert.deepEqual(favouriteNames(merged).sort(), ["b", "d"], "a: their later removal wins; b: my later state wins; c: my later removal wins; d: new");
  assert.equal(mergeFavourites(mine, { a: { on: true, at: 10 } }), mine, "nothing newer: same object back");
  assert.equal(mergeFavourites(mine, {}), mine);
  assert.deepEqual(mergeFavourites(undefined, theirs), theirs);
  assert.deepEqual(favouritesFromList(["x"]), { x: { on: true, at: 0 } });
  assert.deepEqual(favouritesFromList(["x", "y"], { x: { on: false, at: 5 } }), { x: { on: false, at: 5 }, y: { on: true, at: 0 } }, "folded into an existing map, which keeps its entries");
  assert.deepEqual(favouriteNames(null), []);
});
