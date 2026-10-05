import assert from "node:assert/strict";
import { test } from "node:test";
import { createFollow } from "../src/follow.js";

function harness(t, pinned = "") {
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
  const follow = createFollow({ host: "h", token: "tok", pinned, relay, WebSocketImpl: Fake });
  return { follow, relay, sockets };
}

test("a pinned player is connected straight away, without asking the API", (t) => {
  const { follow, relay, sockets } = harness(t, "RINCON_PIN");
  follow.start();
  assert.deepEqual(relay.connects, ["RINCON_PIN"]);
  assert.equal(sockets.length, 0);
});

test("it logs in, polls, and connects the relay to the first playing queue", (t) => {
  const { follow, relay, sockets } = harness(t);
  follow.start();
  assert.equal(sockets[0].url, "ws://h:8095/ws");
  sockets[0].login();
  assert.deepEqual(sockets[0].sent.map((m) => m.command), ["auth", "player_queues/all"]);
  assert.equal(sockets[0].sent[0].args.token, "tok");

  sockets[0].queues({ a: "idle", b: "idle" });
  assert.deepEqual(relay.connects, []);
  assert.equal(follow.state, "waiting");

  t.mock.timers.tick(3000);
  assert.equal(sockets[0].sent.length, 3, "polled again");
  sockets[0].queues({ a: "idle", b: "playing", c: "playing" });
  assert.deepEqual(relay.connects, ["b"]);
  assert.equal(follow.state, "watching");
});

test("once frames flow it stops polling; after the stream ends it looks again", (t) => {
  const { follow, relay, sockets } = harness(t);
  follow.start();
  sockets[0].login();
  sockets[0].queues({ a: "playing" });
  follow.noteFrame();
  assert.equal(sockets[0].readyState, 3, "API socket closed while streaming");

  follow.noteEnd();
  t.mock.timers.tick(2999);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 2, "polling resumed");
  sockets[1].login();
  sockets[1].queues({ a: "idle", b: "playing" });
  assert.deepEqual(relay.connects, ["a", "b"]);
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
  sockets[1].login();
  sockets[1].queues({ tv: "idle", office: "idle" });
  sockets[1].queues({ tv: "playing", office: "idle" });
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
