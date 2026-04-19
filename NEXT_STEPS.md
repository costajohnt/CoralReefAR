# Next Steps

A checklist of things I (the maintainer) still need to do manually. Claude
has taken everything as far as it reasonably can from a development
environment. The remaining items require either external accounts, physical
hardware, or direct decisions.

## Deployment

### 1. Stand up the app on Fly.io

The workflow is armed but gated: it no-ops until `FLY_API_TOKEN` is set as a
repo secret. Run these commands once, from any machine with `flyctl`
installed (`brew install flyctl`):

```sh
fly auth login
fly apps create coralreefar --org personal
fly volumes create reef_data --size 1 --region iad --yes
fly secrets set \
  ADMIN_TOKEN="$(openssl rand -hex 32)" \
  CORS_ORIGINS="https://coralreefar.fly.dev"
fly tokens create deploy   # copy output
```

Then in the repo settings → Secrets and variables → Actions → "New repository
secret": name `FLY_API_TOKEN`, value from the `fly tokens create deploy`
command.

Next push to `main` triggers `.github/workflows/fly-deploy.yml` and the app
goes live at `https://coralreefar.fly.dev`. Save the `ADMIN_TOKEN` value
locally — you'll need it to moderate polyps via `/admin`.

### 2. Pedestal marker

`assets/pedestal/marker.svg` is a placeholder. For a production install,
commission or design the real marker image (see `assets/pedestal/README.md`
for the guidelines — asymmetric, mid-tone, matte, ~150–200 mm printed). Then:

- Drop the production image at `assets/pedestal/marker.png` (or similar).
- Upload it to 8th Wall's image-target dashboard (or compile to a `.mind`
  file for MindAR).
- Print matte on heavyweight paper, mount flat and level.

### 3. NFC tags

Program an NTAG215 batch with a single NDEF URL record pointing at the live
host (`https://reef.example.com/` or `https://coralreefar.fly.dev/`). Test
one tag end-to-end (tap → Safari/Chrome → AR startup) before programming the
rest.

## Testing

### 4. Real-device AR smoke test

Nothing here has ever been driven through a camera against a printed marker.
Before shipping to visitors:

- Print a test marker from `assets/pedestal/marker.svg` at ~180 mm square.
- Open the site on an iPhone (Safari) and an Android (Chrome).
- Confirm tracking picks up the marker within a few seconds under venue
  lighting.
- Place a polyp and confirm it persists (close the tab, reopen, see the
  polyp).
- Open a second tab; delete via `/admin`; the first tab's reef should update
  live.

### 5. Docker smoke test

The GHCR image is green in CI but I never pulled it locally:

```sh
docker pull ghcr.io/costajohnt/coralreefar:latest
docker run --rm -p 8787:8787 -e ADMIN_TOKEN=smoketest \
  ghcr.io/costajohnt/coralreefar:latest &
sleep 3
curl http://127.0.0.1:8787/healthz
```

Expect `{"ok":true,"time":...}`. If the container exits immediately, check
`docker logs`.

## Optional polish

### 6. Branch protection review settings

`main` protection currently requires the `Build and test` check and linear
history but allows admin bypass. If you ever get a collaborator, toggle
"Require pull request reviews before merging" in repo settings.

### 7. Node 20 deprecation for `actions/deploy-pages`

The Pages deploy step still uses `actions/deploy-pages@v4` (Node 20).
GitHub will force Node 24 on 2026-06-02. Dependabot will open the bump PR
automatically when v5 ships; no action until then.

### 8. CODEOWNERS (if the repo ever has collaborators)

Add `.github/CODEOWNERS` with `* @costajohnt` so every PR auto-requests your
review. Skip until there's someone else pushing.

### 9. Pitch

The project exists but nobody knows. Options I can't execute:

- Write a short blog post / devlog with screenshots from the static preview
  and a demo video.
- Post to HN (`Show HN: …`), /r/programming, the Fastify / Three.js Discords.
- Submit to "Awesome" lists (awesome-threejs, awesome-ar, etc.).

## Known limitations

These are intentional or accepted trade-offs — documenting so you remember.

- **Metrics are in-process only.** `reef_polyps_total` / `reef_ws_clients` /
  `reef_rate_limited_total` reset on restart. Multi-instance deploys need
  Prometheus to aggregate across scraped replicas.
- **Rate limit is coarse.** 1 polyp / device / hour, 60 reads / IP /
  minute. The device key is `sha256(UA, IP, rotating-salt)`, which a
  motivated user can circumvent with a VPN + another device. That's
  accepted given the installation context.
- **No auth for regular users.** Anyone who loads the page can plant once
  per window. The moderation path (admin delete + restore) assumes
  low-volume mid-abuse cleanup, not spam at scale.
- **8th Wall binary not vendored.** `packages/client/vendor/8thwall/` is
  `.gitignore`d. If you need to ship the AR path, drop the engine binary
  there before building the client.
- **Vitest is pinned at 2.x.** Vitest 4 needs Vite 6. The Vite ecosystem
  hasn't reached that yet. Dependabot will catch it up.
