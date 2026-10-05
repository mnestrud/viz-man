// Decides which player the relay should watch. The relay binds to one player
// per connection and never switches, so while nothing is streaming this polls
// Music Assistant's API socket for a queue that is playing.
//   ws://<host>:8095/ws: server info, then {command:"auth"}, then commands.

import { authority } from "./relay.js";

const POLL_MS = 3000;
const RESUME_MS = 3000; // wait this long after a stream ends before looking elsewhere
const NO_FRAMES_MS = 5000; // a "playing" queue that sends nothing by then is skipped
const RETRY_MS = 3000;

export function createFollow({ host, token, pinned, relay, WebSocketImpl, onState }) {
  const Socket = WebSocketImpl || WebSocket;
  let socket = null;
  let generation = 0;
  let active = false;
  let authed = false;
  let streaming = false;
  let current = "";
  let connectedAt = 0;
  let pollTimer = 0;
  let waitTimer = 0;
  let state = "idle";
  const skipped = {}; // queue ids that claimed to play but sent no frames

  function setState(next) {
    if (next !== state) {
      state = next;
      if (onState) onState(next);
    }
  }

  function closeApi() {
    generation++;
    clearTimeout(pollTimer);
    clearTimeout(waitTimer);
    pollTimer = waitTimer = 0;
    authed = false;
    if (socket) {
      try {
        socket.close();
      } catch (e) {
        // already closed
      }
      socket = null;
    }
  }

  function choose(queues) {
    const playing = [];
    for (const queue of queues) {
      if (queue.state === "playing") playing.push(queue.queue_id);
      else delete skipped[queue.queue_id];
    }
    if (current && playing.indexOf(current) >= 0 && !skipped[current]) {
      if (Date.now() - connectedAt < NO_FRAMES_MS) return;
      skipped[current] = true; // playing something the relay cannot read
    }
    for (const id of playing) {
      if (skipped[id]) continue;
      if (id !== current || relay.state === "closed") {
        current = id;
        connectedAt = Date.now();
        relay.connect(id);
      }
      setState("watching");
      return;
    }
    setState("waiting");
  }

  function poll(gen) {
    if (gen !== generation || !socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ message_id: "queues", command: "player_queues/all" }));
    pollTimer = setTimeout(() => poll(gen), POLL_MS);
  }

  function openApi() {
    closeApi();
    if (!active || streaming) return;
    const gen = generation;
    const ws = new Socket("ws://" + authority(host) + "/ws");
    socket = ws;
    ws.onmessage = (event) => {
      if (gen !== generation || typeof event.data !== "string") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (!authed && message.server_version && !message.message_id) {
        ws.send(JSON.stringify({ message_id: "auth", command: "auth", args: { token } }));
      } else if (message.message_id === "auth") {
        if (message.result && message.result.authenticated) {
          authed = true;
          poll(gen);
        } else {
          setState("rejected");
          closeApi();
        }
      } else if (message.message_id === "queues" && Array.isArray(message.result)) {
        choose(message.result);
      }
    };
    ws.onclose = () => {
      if (gen !== generation) return;
      socket = null;
      clearTimeout(pollTimer);
      if (active && !streaming && state !== "rejected") waitTimer = setTimeout(openApi, RETRY_MS);
    };
    ws.onerror = () => {};
  }

  return {
    start() {
      active = true;
      streaming = false;
      if (pinned) {
        current = pinned;
        relay.connect(pinned);
        setState("pinned");
      } else {
        setState("waiting");
        openApi();
      }
    },
    stop() {
      active = false;
      closeApi();
      current = "";
      setState("idle");
    },
    // The relay delivered a frame: the right player is being watched.
    noteFrame() {
      if (streaming) return;
      streaming = true;
      if (!pinned) {
        closeApi();
        setState("watching");
      }
    },
    // The stream stopped. Keep the relay socket (the same player may resume)
    // and, after a pause, start looking for another one.
    noteEnd() {
      if (!streaming) return;
      streaming = false;
      if (active && !pinned) {
        clearTimeout(waitTimer);
        waitTimer = setTimeout(openApi, RESUME_MS);
      }
    },
    // The relay refused this player.
    noteError() {
      if (!pinned && current) skipped[current] = true;
    },
    get state() {
      return state;
    },
    get player() {
      return current;
    },
  };
}
