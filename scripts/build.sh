#!/usr/bin/env bash
# Usage: scripts/build.sh
# Bundles src/main.js into app/app.js, writes app/config.js from
# config.local.json, and copies the MilkDrop library into app/vendor/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATH="$ROOT/node_modules/.bin:$PATH"
OUT="$ROOT/app"

# OffscreenCanvas: vendored code falls back to it only inside a worker, which
# this app never is; defining it away keeps it out of the bundle.
esbuild "$ROOT/src/main.js" --bundle --format=iife --target=chrome68 --minify \
  --define:OffscreenCanvas=undefined --log-level=warning --outfile="$OUT/app.js"

# esbuild lowers syntax only. Fail on APIs the TV's Chromium 68 does not have.
TOO_NEW='globalThis|\.flat\(|\.flatMap\(|Object\.fromEntries|\.replaceAll\(|\.at\(|\.matchAll\(|Promise\.allSettled|structuredClone|OffscreenCanvas'
if hits="$(grep -oE "$TOO_NEW" "$OUT/app.js" | sort -u)" && [ -n "$hits" ]; then
  echo "app.js uses APIs newer than Chromium 68:" >&2
  echo "$hits" >&2
  exit 1
fi

if [ -f "$ROOT/config.local.json" ]; then
  node -e 'process.stdout.write("window.VIS_CONFIG = " + JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) + ";\n")' \
    "$ROOT/config.local.json" > "$OUT/config.js"
else
  echo "warning: config.local.json missing; building with an empty config" >&2
  echo "window.VIS_CONFIG = {};" > "$OUT/config.js"
fi

mkdir -p "$OUT/vendor"
cp "$ROOT/node_modules/butterchurn/lib/butterchurn.min.js" \
   "$ROOT/node_modules/butterchurn-presets/lib/butterchurnPresetsMinimal.min.js" "$OUT/vendor/"

echo "built app/app.js ($(wc -c < "$OUT/app.js") bytes)"
