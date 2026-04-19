# Next Steps

What's done, what's open, and what you (the maintainer) still need to do
manually. This file is the single source of truth for project state — keep
it edited alongside the work.

## Current state

- **Main branch CI**: green. 145 tests pass across 4 packages (shared 12 /
  generator 22 / server 66 / client 45).
- **Stack**: TypeScript 6 · Vite 7 · Vitest 4 · better-sqlite3 12 ·
  @fastify/cors 11 · node:25-alpine · happy-dom 19 · Oxlint. All fully
  up-to-date.
- **Live**: static demo at <https://jcosta.tech/CoralReefAR/> (HTTPS
  enforced). HTML landing links to the species preview; the AR entry is
  there too but can't talk to a backend.
- **Docker image**: `ghcr.io/costajohnt/coralreefar:latest`. Verified
  locally — `/healthz`, `/`, `/api/reef`, `/metrics`, POST polyp all work.
  Multi-arch (amd64 + arm64). Auto-published on `vX.Y.Z` tag.
- **Branch protection** on `main`: CI required, linear history, no
  force-push. Hook bypass for `costajohnt/*` repos so operator actions
  flow without per-command approval.
- **Rate limits**: off by default (tracked in [#25] — flip env vars for
  production).

## Deployment

### Primary path: Beelink + Docker Compose

The original plan stands — self-host on the Beelink running in a Proxmox
LXC or VM. Runbook is [`INSTALL.md`](./INSTALL.md).

```sh
git clone https://github.com/costajohnt/CoralReefAR.git
cd CoralReefAR
cp .env.example .env
# edit .env: set ADMIN_TOKEN, CORS_ORIGINS, CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d
docker compose logs -f server
```

`docker-compose.yml` references `ghcr.io/costajohnt/coralreefar:latest`,
so `docker compose pull && docker compose up -d` picks up new versions
without a local build.

### Alternative: Fly.io (on pause)

The Fly app is provisioned but blocked on billing:

- App `coralreefar` created.
- Volume `reef_data` (1 GB, iad) created.
- Secrets `ADMIN_TOKEN` + `CORS_ORIGINS` staged.
- `FLY_API_TOKEN` added to the repo secrets so the workflow is ready to
  go when billing unblocks.
- **Blocker**: Fly trial orgs need a credit card at
  <https://fly.io/dashboard/john-costa-307/billing> before the first VM
  boots. Decided to defer — Beelink/Proxmox is simpler for testing.

`.github/workflows/fly-deploy.yml` is gated to `workflow_dispatch` only
while paused, so main-pushes don't paint the repo red on every merge.
To resume auto-deploy after billing is resolved, add back the
`push: branches: [main]` trigger. Nothing else to clean up.

## AR tracker

`packages/client/src/tracking/eightwall.ts` now targets the self-hosted
`@8thwall/engine-binary`. The retired cloud-hosted
`apps.8thwall.com/xrweb?appKey=…` path is gone. The engine loads via
jsDelivr with `data-preload-chunks="slam"`; `EightWallProvider.waitUntilReady()`
absorbs the async-script race on the first user tap. MindAR (the old
fallback) has been dropped — 8th Wall is the only active tracker, with
`NoopProvider` as the desktop/dev path when the engine isn't loaded.

### Not to lose sight of

- Niantic Spatial's binary-engine maintenance ends ~March 2026 and
  existing self-hosted projects keep working through Feb 28, 2027. If
  a tracker bug surfaces after that you probably can't get it fixed
  upstream. This is an installation piece that might run 2-3 years —
  worth a re-think if the engine stops meeting our needs.

Tracking issue: [#28].

## Operator runbook — exactly what you need to do

The code side is done. The remaining work is physical-world and
can't be automated. Run these in order. Each step is a blocker for
the next.

### Step 1 — Compile a pedestal image target (~15 min)

You need a `.json` image-target file that the 8th Wall engine can
use for tracking. Start with the placeholder `marker.svg` so you can
smoke-test end-to-end cheaply before commissioning real artwork.

**1.1 — Rasterize the placeholder.**
You need a PNG at ≥2048×2048 for the CLI. If you have
`rsvg-convert`:

```sh
brew install librsvg    # one-time, if not installed
cd ~/dev/CoralReefAR
rsvg-convert -w 2048 -h 2048 assets/pedestal/marker.svg > /tmp/pedestal.png
```

No rsvg? Open `assets/pedestal/marker.svg` in Chrome, Print → Save
as PDF, then use Preview on macOS to export as PNG at 2048×2048.

**1.2 — Run the 8th Wall image-target CLI.**

```sh
npx @8thwall/image-target-cli@latest
```

It's interactive. When it prompts:
- **Image path** → `/tmp/pedestal.png`
- **Crop** → leave default (the full image)
- **Target name** → `pedestal`
- **Output folder** → `assets/pedestal/target/`

It produces a directory containing a `pedestal.json` metadata file,
a cropped image, a 263×350 thumbnail, and a 480×640 luminance
image. The `.json` is what the engine consumes.

> ⚠️ UI note: the CLI prompts may have changed between versions —
> follow what the tool actually asks, not these exact labels.
> Report back if anything's different so I can update the runbook.

**1.3 — Commit the compiled target.**

```sh
git checkout -b add-compiled-pedestal-target
git add assets/pedestal/target/
git commit -m "Add compiled 8th Wall image-target for placeholder marker"
git push -u origin add-compiled-pedestal-target
```

**1.4 — Ping me to wire it into the code.**
The current `packages/client/src/tracking/eightwall.ts` still calls
`XR8.XrController.configure({ imageTargets: ['pedestal'] })` (the
retired cloud-named-target API). The self-hosted binary wants
`imageTargetData: [<json>]` — i.e. the JSON bundled at build time.
Once you've pushed the compiled target, I'll open a PR that
imports the JSON and swaps the configure call. That PR can only
land after step 1.3.

### Step 2 — Print the marker (~5 min)

Target: **~180 mm square, matte, heavyweight paper.**
Glossy finishes and thin copier paper kill tracking — the marker
lives under museum lighting and both will glare.

```sh
# If you rasterized in step 1.1, reuse that PNG:
open -a Preview /tmp/pedestal.png
# File → Print → Scale to 180 mm × 180 mm → Save as PDF / Print
```

Or print the SVG directly: open `assets/pedestal/marker.svg` in
Chrome, Print, set page scaling so the marker fills a 180 mm
square. Mount the print flat on top of the pedestal — bowed or
tilted surfaces also kill tracking.

### Step 3 — Smoke-test on real devices (~30 min)

Once steps 1 + 2 are done **and** the follow-up code PR from 1.4
has merged, open the live site on:

- **iPhone** in Safari (not Chrome — Safari is the only browser
  with camera access on iOS)
- **Android** in Chrome

For each device, confirm this golden path:

1. Load the live URL. Camera permission prompt appears; grant it.
2. Tap **Start**. Status text: "Looking for the reef…"
3. Point the camera at the printed marker. Anchor should lock
   within 2-3 seconds under venue lighting.
4. Walk 90° around the pedestal while keeping the marker in
   frame. The reef geometry should stay pinned to the marker —
   no drift, no jitter.
5. Tap the reef to place a polyp ghost. Pick species + color.
   Tap **Grow**.
6. Close the tab. Reopen. Your polyp persists. Anyone else's
   polyps persist too.
7. On a laptop at a second tab, open `/admin`, paste your
   `ADMIN_TOKEN`, delete your polyp. The phone's live view
   should update over WebSocket (≤1 s) — polyp disappears.

**If tracking flakes**, the fix is almost always lighting
(diffuse, overhead) or a larger/matte print. See
`assets/pedestal/README.md` for trackability guidelines.

**If anchor stability is poor across 4-6 test cycles**, step back
and decide before committing to NFC tags: is the placeholder
marker too symmetric? Is the print too small? Is the lighting
wrong? Tuning those beats re-commissioning artwork.

### Step 4 — Commission the production marker (optional, after step 3)

`assets/pedestal/marker.svg` is a **placeholder**, not
production artwork. Commission real artwork once you've
confirmed the tracking workflow above actually works with the
placeholder — no point paying a designer before you know the
pipeline is sound.

See `assets/pedestal/README.md` for the trackability
characteristics artwork needs: asymmetric, feature-dense,
mid-tone palette, matte print. When you get the final PNG,
repeat step 1 (CLI → JSON) + step 2 (print) + step 3 (real-
device re-test).

### Step 5 — Program NFC tags

Once the real marker is in place and step 3 passes again, batch-
program **NTAG215** tags with the live URL (`https://jcosta.tech/CoralReefAR/ar.html`
— confirm this is the URL you actually want).

The tool I'd use: **NFC Tools** (free, iOS + Android). Encode a
single URL record, tap-test one tag end-to-end (tap → phone opens
browser → AR flow completes) before programming the rest of the
batch. Don't program all the tags until one full cycle works.

### Decide later — Fly billing

`.github/workflows/fly-deploy.yml` is gated to `workflow_dispatch`
only so main pushes don't fail red. If you want auto-deploy back,
add a credit card at
<https://fly.io/dashboard/john-costa-307/billing> then restore the
`push: branches: [main]` trigger in that workflow. Beelink is the
simpler path; Fly is a nice-to-have.

## Optional polish

- **CODEOWNERS** — only useful when collaborators join.
- **Branch protection review-required** — same.
- **Pitch / write-up** — devlog, HN submission, awesome-list PR.
- **Content moderation beyond admin delete** — if the installation is
  public and unsupervised, think about report-abuse link or keyword
  filter on submitted colors or seeds (unlikely attack surface, but).

## Known limitations

Carrying forward — these are intentional or accepted:

- **Metrics are in-process only.** `reef_polyps_total` /
  `reef_ws_clients` / `reef_rate_limited_total` reset on restart.
  Multi-instance deploys need Prometheus aggregation.
- **Rate limiting is off by default.** Intentional for testing; see
  [#25].
- **No auth for regular users.** Anyone can plant once per device
  (or once, period, with limits off). Admin path is the moderation
  surface.
- **Vitest 4 + Vite 7** is current; Vitest 4 needed Vite 6+ and we
  skipped straight to 7. Tests pass; stay alert for Vite 7 ecosystem
  gaps.
- **8th Wall binary EOL** — self-hosted projects work through Feb 28,
  2027; binary-engine maintenance ends ~March 2026. See _AR tracker_
  above.

[#25]: https://github.com/costajohnt/CoralReefAR/issues/25
[#28]: https://github.com/costajohnt/CoralReefAR/issues/28
