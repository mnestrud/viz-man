// Decides which player the relay should watch, and reports what it is
// playing. The relay binds to one player per connection and never switches,
// so while nothing is streaming this polls Music Assistant's API socket for a
// queue that is playing; while streaming it polls that queue for its track.
//   ws://<host>:8095/ws: server info, then {command:"auth"}, then commands.

import { authority } from "./relay.js";

const POLL_MS = 3000;
const TRACK_POLL_MS = 4000;
const RESUME_MS = 3000; // wait this long after a stream ends before looking elsewhere
const NO_FRAMES_MS = 5000; // a "playing" queue that sends nothing by then is skipped
const RETRY_MS = 3000;
const HANDSHAKE_MS = 10000; // an API socket must be logged in by then

export function createFollow({ host, token, pinned, relay, WebSocketImpl, onState, onTrack }) {
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
  let helloTimer = 0;
  let state = "idle";
  let trackId = null;
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
    clearTimeout(helloTimer);
    pollTimer = waitTimer = helloTimer = 0;
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
    if (pinned) return; // only ever watching the one player
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
    clearTimeout(pollTimer);
    if (streaming && current) {
      socket.send(JSON.stringify({ message_id: "queue", command: "player_queues/get", args: { queue_id: current } }));
      pollTimer = setTimeout(() => poll(gen), TRACK_POLL_MS);
    } else {
      socket.send(JSON.stringify({ message_id: "queues", command: "player_queues/all" }));
      pollTimer = setTimeout(() => poll(gen), POLL_MS);
    }
  }

  // What the watched queue is playing, in the shape the track card shows.
  function trackOf(queue) {
    const item = queue && queue.current_item;
    if (!item) return null;
    const media = item.media_item || {};
    const album = media.album || {};
    const meta = media.metadata || {};
    const artists = (media.artists || []).map((a) => a.name).filter(Boolean);
    let title = media.name || item.name || "";
    let artist = artists.join(", ");
    if (!artist && item.name && item.name.indexOf(" - ") > 0) {
      // Radio and other streams only have "Artist - Title" as one string.
      artist = item.name.slice(0, item.name.indexOf(" - "));
      title = item.name.slice(item.name.indexOf(" - ") + 3);
    }
    return { id: item.queue_item_id, title, artist, album: album.name || "", year: album.year || "", label: meta.label || "" };
  }

  function sawQueue(queue) {
    const track = trackOf(queue);
    const id = track ? track.id : null;
    if (id === trackId) return;
    trackId = id;
    if (onTrack) onTrack(track);
  }

  function openApi() {
    closeApi();
    if (!active) return;
    const gen = generation;
    const ws = new Socket("ws://" + authority(host) + "/ws");
    socket = ws;
    // Start over if the server never answers the login.
    helloTimer = setTimeout(() => {
      if (gen === generation && !authed) openApi();
    }, HANDSHAKE_MS);
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
        for (const queue of message.result) if (queue.queue_id === current) sawQueue(queue);
      } else if (message.message_id === "queue" && message.result) {
        sawQueue(message.result);
      }
    };
    ws.onclose = () => {
      if (gen !== generation) return;
      socket = null;
      clearTimeout(pollTimer);
      if (active && state !== "rejected") waitTimer = setTimeout(openApi, RETRY_MS);
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
      }
      openApi();
    },
    stop() {
      active = false;
      closeApi();
      current = "";
      trackId = null;
      setState("idle");
    },
    // The relay delivered a frame: the right player is being watched.
    noteFrame() {
      if (streaming) return;
      streaming = true;
      if (!pinned) setState("watching");
      poll(generation);
    },
    // The stream stopped. Keep the relay socket (the same player may resume)
    // and, after a pause, start looking for another one.
    noteEnd() {
      if (!streaming) return;
      streaming = false;
      if (active && !pinned) {
        clearTimeout(waitTimer);
        waitTimer = setTimeout(() => poll(generation), RESUME_MS);
      }
    },
    // A new track is starting on the relay: look up what it is straight away.
    noteClear() {
      poll(generation);
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
