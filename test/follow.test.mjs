import assert from "node:assert/strict";
import { test } from "node:test";
import { createFollow } from "../src/follow.js";

function harness(t, pinned = "", onTrack, onRemotePrefs) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sockets = [];
  class Fake {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.readyState = 1;
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
    receive(message) {
      this.onmessage({ data: JSON.stringify(message) });
    }
    // Server greeting, then a successful login.
    login() {
      this.receive({ server_version: "2.10.5" });
      this.receive({ message_id: "auth", result: { authenticated: true } });
    }
    queues(states) {
      this.receive({ message_id: "queues", result: Object.keys(states).map((id) => ({ queue_id: id, state: states[id] })) });
    }
  }
  const relay = { connects: [], state: "closed", connect(id) { this.connects.push(id); this.state = "open"; } };
  const follow = createFollow({ host: "h", token: "tok", pinned, relay, WebSocketImpl: Fake, onTrack, onRemotePrefs, deviceId: "cx", sharedKeys: ["favourites"] });
  return { follow, relay, sockets };
}

test("a pinned player is connected straight away; the API is only used for track info", (t) => {
  const { follow, relay, sockets } = harness(t, "RINCON_PIN");
  follow.start();
  assert.deepEqual(relay.connects, ["RINCON_PIN"]);
  sockets[0].login();
  sockets[0].queues({ RINCON_PIN: "idle", other: "playing" });
  assert.deepEqual(relay.connects, ["RINCON_PIN"], "never switches away from the pinned player");
});

test("it logs in, polls, and connects the relay to the first playing queue", (t) => {
  const { follow, relay, sockets } = harness(t);
  follow.start();
  assert.equal(sockets[0].url, "ws://h:8095/ws");
  sockets[0].login();
  assert.deepEqual(sockets[0].sent.map((m) => m.command), ["auth", "auth/me", "player_queues/all"]);
  assert.equal(sockets[0].sent[0].args.token, "tok");

  sockets[0].queues({ a: "idle", b: "idle" });
  assert.deepEqual(relay.connects, []);
  assert.equal(follow.state, "waiting");

  t.mock.timers.tick(3000);
  assert.equal(sockets[0].sent.length, 4, "polled again");
  sockets[0].queues({ a: "idle", b: "playing", c: "playing" });
  assert.deepEqual(relay.connects, ["b"]);
  assert.equal(follow.state, "watching");
});

test("once frames flow it polls the watched queue for its track; after the stream ends it looks around again", (t) => {
  const tracks = [];
  const { follow, relay, sockets } = harness(t, "", (track) => tracks.push(track));
  follow.start();
  sockets[0].login();
  sockets[0].queues({ a: "playing" });
  follow.noteFrame();
  assert.equal(sockets[0].readyState, 1, "API socket stays open while streaming");
  const last = () => sockets[0].sent[sockets[0].sent.length - 1];
  assert.deepEqual(last(), { message_id: "queue", command: "player_queues/get", args: { queue_id: "a" } });

  sockets[0].receive({ message_id: "queue", result: { queue_id: "a", current_item: { queue_item_id: "i1", name: "x", media_item: { name: "Would?", artists: [{ name: "Alice In Chains" }], album: { name: "Dirt", year: 1992 }, metadata: { label: "Columbia" } } } } });
  assert.deepEqual(tracks, [{ id: "i1", title: "Would?", artist: "Alice In Chains", album: "Dirt", year: 1992, label: "Columbia" }]);
  sockets[0].receive({ message_id: "queue", result: { queue_id: "a", current_item: { queue_item_id: "i1", name: "x", media_item: { name: "Would?" } } } });
  assert.equal(tracks.length, 1, "the same item is not reported twice");

  t.mock.timers.tick(4000);
  assert.equal(last().command, "player_queues/get", "keeps asking about the track while streaming");

  follow.noteEnd();
  t.mock.timers.tick(3000);
  assert.equal(last().command, "player_queues/all", "back to looking for a playing queue");
  sockets[0].queues({ a: "idle", b: "playing" });
  assert.deepEqual(relay.connects, ["a", "b"]);
});

test("a radio stream's single 'Artist - Title' string is split; no item means no track", (t) => {
  const tracks = [];
  const { follow, sockets } = harness(t, "", (track) => tracks.push(track));
  follow.start();
  sockets[0].login();
  sockets[0].queues({ r: "playing" });
  follow.noteFrame();
  sockets[0].receive({ message_id: "queue", result: { queue_id: "r", current_item: { queue_item_id: "s1", name: "Boards of Canada - Roygbiv" } } });
  assert.deepEqual(tracks[0], { id: "s1", title: "Roygbiv", artist: "Boards of Canada", album: "", year: "", label: "" });
  sockets[0].receive({ message_id: "queue", result: { queue_id: "r", current_item: null } });
  assert.equal(tracks[1], null);
});

test("a queue that claims to play but sends nothing is skipped until it stops", (t) => {
  const { follow, relay, sockets } = harness(t);
  follow.start();
  sockets[0].login();
  sockets[0].queues({ tv: "playing", office: "playing" });
  assert.deepEqual(relay.connects, ["tv"]);

  t.mock.timers.tick(3000);
  sockets[0].queues({ tv: "playing", office: "playing" });
  assert.deepEqual(relay.connects, ["tv"], "still within the grace period");

  t.mock.timers.tick(3000);
  sockets[0].queues({ tv: "playing", office: "playing" });
  assert.deepEqual(relay.connects, ["tv", "office"]);

  // tv stops, then plays again: it gets another chance
  follow.noteFrame();
  follow.noteEnd();
  t.mock.timers.tick(3000);
  sockets[0].queues({ tv: "idle", office: "idle" });
  sockets[0].queues({ tv: "playing", office: "idle" });
  assert.deepEqual(relay.connects, ["tv", "office", "tv"]);
});

test("a rejected login stops the polling", (t) => {
  const { follow, sockets } = harness(t);
  follow.start();
  sockets[0].receive({ server_version: "2.10.5" });
  sockets[0].receive({ message_id: "auth", result: { authenticated: false } });
  assert.equal(follow.state, "rejected");
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 1);
});

test("an API socket that never answers the login is reopened", (t) => {
  const { follow, sockets } = harness(t);
  follow.start();
  sockets[0].receive({ server_version: "2.10.5" }); // login sent, no reply
  t.mock.timers.tick(10000);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].readyState, 3);
});

test("preferences are read from the account and saved back, shared ones on top and the rest per TV", (t) => {
  const remote = [];
  const { follow, sockets } = harness(t, "", null, (shared, device) => remote.push([shared, device]));
  follow.start();
  follow.savePrefs({ favourites: ["a"], trim: 25 }); // before login: must wait
  sockets[0].login();
  t.mock.timers.tick(5000);
  assert.ok(!sockets[0].sent.some((m) => m.command === "auth/user/update"), "nothing saved before the remote copy is known");

  sockets[0].receive({ message_id: "me", result: { user_id: "u", preferences: { theme: "dark", vizman: { favourites: ["x", "y"], devices: { cx: { trim: 50 }, other: { trim: 0 } } } } } });
  assert.deepEqual(remote, [[{ favourites: ["x", "y"] }, { trim: 50 }]], "this TV's own settings are handed over, not another TV's");
  const save = sockets[0].sent.find((m) => m.command === "auth/user/update");
  assert.deepEqual(save.args.preferences, {
    theme: "dark",
    vizman: { favourites: ["a"], devices: { cx: { trim: 25 }, other: { trim: 0 } } },
  }, "other preferences and other TVs are kept");

  follow.savePrefs({ favourites: ["a", "b"] });
  follow.savePrefs({ favourites: ["a", "b", "c"] });
  t.mock.timers.tick(1500);
  const saves = sockets[0].sent.filter((m) => m.command === "auth/user/update");
  assert.equal(saves.length, 2, "rapid changes are sent once");
  assert.deepEqual(saves[1].args.preferences.vizman.favourites, ["a", "b", "c"]);

  t.mock.timers.tick(60000);
  assert.equal(sockets[0].sent.filter((m) => m.command === "auth/me").length, 2, "the account is re-read every minute for other TVs' changes");
});
