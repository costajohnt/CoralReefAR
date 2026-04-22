#!/bin/bash
set -euo pipefail

# Rewrites packages/client/dist so GitHub Pages gets a sensible landing.
# The AR app needs a backend, so we can't host it statically — only the
# offline dev pages (preview.html, timelapse.html) work without a server.
# We swap the default index.html for a small landing page and move the
# original AR-app index.html aside so curious visitors can still reach it.

DIST=packages/client/dist

if [ ! -d "$DIST" ]; then
  echo "error: $DIST does not exist — run the client build first" >&2
  exit 1
fi

mv "$DIST/index.html" "$DIST/ar.html"
cat > "$DIST/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>CoralReefAR — static preview</title>
  <style>
    body { margin: 0; background: #02111d; color: #eef; font-family: system-ui, sans-serif; padding: 2rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.4rem; }
    p { color: #9ab; max-width: 38rem; line-height: 1.5; }
    a { color: #2ec4b6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { line-height: 1.9; }
  </style>
</head>
<body>
  <h1>CoralReefAR</h1>
  <p>Static demo of the procedural reef client. The main AR app requires
    a backend (camera feed, WebSocket, SQLite), so only the offline dev
    pages work here.</p>
  <ul>
    <li><a href="preview.html">Species preview</a> — orbit-camera grid of all five procedurally-generated coral species. No server needed.</li>
    <li><a href="ar.html">AR app</a> — will fail to load the reef (no backend on Pages) but shows the startup screen.</li>
    <li><a href="playground.html">Playground</a> — interactive reef (no AR needed, works against any deployed backend)</li>
    <li><a href="playground.html?mode=screen">Screen view</a> — auto-orbit camera, demo-ready</li>
    <li><a href="https://github.com/costajohnt/CoralReefAR">Source + runbook</a></li>
    <li><a href="https://github.com/costajohnt/CoralReefAR/pkgs/container/coralreefar">Docker image on GHCR</a></li>
  </ul>
</body>
</html>
HTML

echo "rewrote $DIST/index.html and moved original to $DIST/ar.html"
