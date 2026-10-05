#!/usr/bin/env node
// Usage: npm run dev   (PORT=8137 by default)
// Serves app/ and backs the page's test link:
//   POST /report  a page posts {client, status, shot?}; written to .dev/
//   GET  /cmd     a page collects the commands queued since its last poll
//   POST /cmd     queue a command, e.g. {"type":"key","key":"right"}
// Run it only while testing: it serves the app's config.js, token included.
import { createServer } from "node:http";
import { mkdirSync, readFile, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app");
const outDir = join(root, ".dev");
const port = Number(process.env.PORT || 8137);
const MAX_BODY = 8 * 1024 * 1024;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".md": "text/plain" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

mkdirSync(outDir, { recursive: true });
const commands = [];
let shots = 0;

function send(res, code, body, type = "application/json") {
  res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, CORS));
  res.end(body);
}

function readBody(req, done) {
  const parts = [];
  let size = 0;
  req.on("data", (part) => {
    size += part.length;
    if (size > MAX_BODY) req.destroy();
    else parts.push(part);
  });
  req.on("end", () => {
    try {
      done(JSON.parse(Buffer.concat(parts).toString("utf8")));
    } catch (e) {
      done(null);
    }
  });
}

function report(body) {
  const client = String(body.client || "page").replace(/[^a-z0-9-]/gi, "");
  const status = Object.assign(
    { receivedAt: new Date().toISOString() },
    body.status,
    body.blacks ? { blacks: body.blacks } : {},
    body.shotError ? { shotError: body.shotError } : {}
  );
  writeFileSync(join(outDir, `status-${client}.json`), JSON.stringify(status, null, 2) + "\n");
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body.shot || "");
  if (match) {
    const name = `shot-${client}-${String(++shots).padStart(3, "0")}.${match[1] === "png" ? "png" : "jpg"}`;
    writeFileSync(join(outDir, name), Buffer.from(match[2], "base64"));
    console.log(`snapshot ${name}`);
  }
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname === "/report" && req.method === "POST") {
    return readBody(req, (body) => {
      if (body) report(body);
      send(res, body ? 200 : 400, "{}");
    });
  }
  if (url.pathname === "/cmd" && req.method === "POST") {
    return readBody(req, (body) => {
      if (body) commands.push(body);
      send(res, body ? 200 : 400, JSON.stringify({ queued: commands.length - 1 }));
    });
  }
  if (url.pathname === "/cmd") {
    // A page that has just loaded (after=new) starts from the end of the queue.
    const raw = url.searchParams.get("after");
    const after = raw === "new" ? commands.length - 1 : Math.min(Number(raw), commands.length - 1);
    return send(res, 200, JSON.stringify({ cursor: commands.length - 1, commands: commands.slice(after + 1) }));
  }
  const file = normalize(join(appDir, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (file !== appDir && !file.startsWith(appDir + sep)) return send(res, 403, "forbidden", "text/plain");
  readFile(file, (error, data) => {
    if (error) send(res, 404, "not found", "text/plain");
    else send(res, 200, data, TYPES[extname(file)] || "application/octet-stream");
  });
}).listen(port, () => {
  const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal);
  console.log(`serving app/ at http://${lan ? lan.address : "localhost"}:${port}/`);
});
