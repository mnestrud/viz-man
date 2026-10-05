// Test link to scripts/dev-server.mjs. Does nothing unless a report address is
// configured. Sends status, sends canvas snapshots on request, and runs the
// commands the server passes on.
//
// It is a WebSocket rather than HTTP requests: the TV's browser sends none of
// the latter from a packaged app's page, while WebSockets work.

const STATUS_MS = 2000;
const RETRY_MS = 3000;
const SHOT_WIDTH = 960;
const SHOT_HEIGHT = 540;

export function startDevlink({ base, client, getStatus, engine, onCommand }) {
  if (!base) return;
  const url = base.replace(/^http/, "ws") + "/link?client=" + encodeURIComponent(client);
  const shot = document.createElement("canvas");
  shot.width = SHOT_WIDTH;
  shot.height = SHOT_HEIGHT;
  const shotCtx = shot.getContext("2d");
  let socket = null;
  let wantShot = false;
  let wantBlacks = false;
  let lastBlacks = "";

  function send(body) {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(Object.assign({ status: getStatus(), blacks: lastBlacks }, body)));
  }

  // How much of the picture is true black, and how much is the near-black
  // haze an OLED shows as grey. 2D canvases only.
  function measureBlacks(canvas, mode) {
    if (mode && mode.gl) return "not measured for WebGL";
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    let haze = 0;
    for (let i = 0; i < data.length; i += 4) {
      const peak = Math.max(data[i], data[i + 1], data[i + 2]);
      if (peak === 0) black++;
      else if (peak <= 16) haze++;
    }
    const pixels = data.length / 4;
    return (mode ? mode.name : "") + ": " + ((black / pixels) * 100).toFixed(1) + "% black, " + ((haze / pixels) * 100).toFixed(2) + "% haze (1-16)";
  }

  // Snapshots are taken straight after a render so a WebGL canvas still holds
  // its frame, and scaled to what the panel shows.
  engine.onAfterRender((canvas, mode) => {
    if (wantBlacks) {
      wantBlacks = false;
      lastBlacks = measureBlacks(canvas, mode);
    }
    if (!wantShot) return;
    wantShot = false;
    try {
      shotCtx.imageSmoothingEnabled = !(mode && mode.pixelated);
      shotCtx.drawImage(canvas, 0, 0, SHOT_WIDTH, SHOT_HEIGHT);
      send({ shot: shot.toDataURL(mode && mode.pixelated ? "image/png" : "image/jpeg", 0.85) });
    } catch (e) {
      send({ shotError: String(e) });
    }
  });

  function run(command) {
    if (command.type === "snapshot") wantShot = true;
    else if (command.type === "blacks") wantBlacks = true;
    else if (command.type === "reload") location.reload();
    else if (command.type === "go") location.search = command.query;
    else onCommand(command);
  }

  function connect() {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => send({});
    ws.onmessage = (event) => {
      try {
        run(JSON.parse(event.data));
      } catch (e) {
        // not a command
      }
    };
    ws.onclose = () => setTimeout(connect, RETRY_MS);
    ws.onerror = () => {};
  }

  setInterval(() => send({}), STATUS_MS);
  connect();
}
