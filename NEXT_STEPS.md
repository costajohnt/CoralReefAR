# Next Steps

What's done, what's open, and what you (the maintainer) still need to do
manually. This file is the single source of truth for project state — keep
it edited alongside the work.

## Current state

- **Main branch CI**: green. 180 tests pass across 4 packages (shared 12 /
  generator 22 / server 70 / client 76).
- **Stack**: TypeScript 6 · Vite 7 · Vitest 4 · better-sqlite3 12 ·
  @fastify/cors 9 (pinned — issue #54 tracks Fastify 5 migration) ·
  node:25-alpine · happy-dom 19 · Oxlint.
- **Live production**: **<https://reef.home.local/>** (LAN) — v0.2.0
  image on LXC 300 behind Nginx Proxy Manager with self-signed TLS.
  See _Managing the deployed LXC_ below.
- **Live static demo**: <https://jcosta.tech/CoralReefAR/> (GitHub
  Pages). No backend; AR entry loads but can't save polyps.
- **Docker image**: `ghcr.io/costajohnt/coralreefar:latest`. Multi-arch
  (amd64 + arm64). Auto-published on `vX.Y.Z` tag. Last tag: v0.2.0.
- **Branch protection** on `main`: CI required, linear history, no
  force-push. Hook bypass for `costajohnt/*` repos so operator actions
  flow without per-command approval.
- **Rate limits**: off by default (tracked in [#25] — flip env vars for
  production).

## Deployment

### What's actually running right now (as of 2026-04-21)

- **LXC 300** on the homelab Proxmox host (hostname `homelab`,
  192.168.5.100). Debian 12, 2 CPU / 2 GB RAM / 10 GB disk,
  unprivileged with `nesting=1, keyctl=1` for Docker. Auto-starts on
  host boot. IP: **192.168.5.174**.
- **Docker container** `reef-server` on LXC 300, running
  `ghcr.io/costajohnt/coralreefar:v0.2.0` (or whatever `:latest`
  resolves to). Bound to `0.0.0.0:8787`. Data volume at
  `/opt/coralreefar/data`. Admin token stored at
  `/opt/coralreefar/admin_token.txt` (mode 600, root-only).
- **Reverse proxy**: Nginx Proxy Manager in LXC 100 (mediastack)
  routes `reef.home.local` (HTTPS) → `http://192.168.5.174:8787`.
  Self-signed cert at
  `/opt/mediastack/config/npm/data/custom_ssl/npm-reef/`,
  valid 10 years. Conf at
  `/opt/mediastack/config/npm/data/nginx/proxy_host/20.conf`.
- **DNS**: Pi-hole (LXC 201) has `reef.home.local` → 192.168.5.82
  in `/etc/dnsmasq.d/10-home-local.conf`.
- **Homepage tile**: gethomepage dashboard has an **Experiments →
  Coral Reef AR** entry linking `https://reef.home.local/`.

**Live URL**: <https://reef.home.local/> (LAN only; browsers will
show a one-time self-signed cert warning).

### Managing the deployed LXC

All commands assume you're on your laptop with the `proxmox` SSH
alias configured (`~/.ssh/config` already has it).

**Check status:**

```sh
# Container health + uptime
ssh proxmox "pct exec 300 -- docker ps --filter name=reef-server"

# Server logs (tail)
ssh proxmox "pct exec 300 -- docker logs reef-server --tail 50"

# Server logs (follow)
ssh proxmox "pct exec 300 -- docker logs reef-server -f"

# LXC resource use (CPU, memory, disk)
ssh proxmox "pct status 300"
```

**Retrieve the admin token** (for the `/admin` moderation page):

```sh
ssh proxmox "pct exec 300 -- cat /opt/coralreefar/admin_token.txt"
```

Paste that value into the token field at
<https://reef.home.local/admin>. The browser will remember it in
memory for the session.

**Update to the latest tagged image:**

```sh
ssh proxmox "pct exec 300 -- bash -c '
docker pull ghcr.io/costajohnt/coralreefar:latest
docker stop reef-server
docker rm reef-server
ADMIN_TOKEN=\$(cat /opt/coralreefar/admin_token.txt)
docker run -d --name reef-server --restart unless-stopped \
  -p 0.0.0.0:8787:8787 \
  -v /opt/coralreefar/data:/data \
  -e NODE_ENV=production -e PORT=8787 -e DB_PATH=/data/reef.db \
  -e ADMIN_TOKEN=\$ADMIN_TOKEN \
  ghcr.io/costajohnt/coralreefar:latest
sleep 3
docker ps --filter name=reef-server
'"
```

After updating, smoke-test:

```sh
curl -sk https://reef.home.local/healthz    # expect {"ok":true,...}
```

If the container crash-loops (`docker ps` shows `Restarting`), pull
logs and diagnose. Most likely culprits: a dep bump that broke the
Fastify plugin load order (the boot smoke test in CI should catch
these now, but it's possible to regress), or a missing env var.

**Get into the container for debugging:**

```sh
ssh proxmox "pct exec 300 -- docker exec -it reef-server sh"
# Inside: ls /data  (the persistent volume)
# Inside: node -v   (confirm Node version in the image)
# Inside: cat /etc/os-release  (alpine version)
```

**Back up the database:**

```sh
ssh proxmox "pct exec 300 -- cp /opt/coralreefar/data/reef.db /opt/coralreefar/data/reef.db.bak.\$(date +%s)"
# Copy off the LXC:
scp proxmox:/var/lib/vz/lxc/300/... your-local-path
# (Actual LXC rootfs paths vary; easier: exec a tar + pipe)
ssh proxmox "pct exec 300 -- tar czf - -C /opt/coralreefar data" > ~/Backups/reef-$(date +%s).tar.gz
```

**Tear down** (if you ever want to start fresh):

```sh
ssh proxmox "pct stop 300 && pct destroy 300"
# Plus: remove the NPM proxy host 20.conf + DB row, remove the pihole
# DNS entry, remove the homepage tile. None auto-deleted.
```

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

### Step 0.5 — Tree mode testing (coming soon)

A new third surface, `tree.html`, is planned — see
[`docs/superpowers/plans/2026-04-22-tree-mode.md`](./docs/superpowers/plans/2026-04-22-tree-mode.md).
Different from the landscape playground: visitors attach small
composable branch pieces to each other's exposed tips, growing a
fractal coral web. Avatar-bioluminescent styling (bloom, vivid
palette, no translucency). Separate reef in the DB — doesn't share
polyps with the landscape view.

Usage (once shipped):

```
https://reef.home.local/tree.html              # interactive
https://reef.home.local/tree.html?mode=screen  # auto-orbit demo view
https://reef.home.local/tree.html?readonly=1   # browse-only
```

The tree's pedestal is auto-seeded with one Starburst piece at
install time, so visitors always have something to branch off
(the first visitor's experience isn't an empty stage).

Phase 2 of the plan: once the tree's visuals feel right, migrate the
AR client to read from the tree data so visitors at the pedestal see
the same fractal reef growing in AR that the wall screen shows.

### Step 0 — Non-AR testing via the playground

Before investing in the marker print + NFC tag + real-device cycle,
exercise the full reef pipeline without any AR dependencies. The
`playground.html` view gives you:

- Orbit-camera Three.js view of the reef (mouse-drag rotate, scroll zoom)
- Click-to-place polyps on a virtual pedestal — same picker UI, same
  submit path, same live WebSocket updates as the AR client
- `?mode=screen` — auto-orbit camera with no UI, for the eventual
  museum-screen display next to the physical pedestal
- `?readonly=1` — browse-only mode for demo kiosks

URLs:

```
https://reef.home.local/playground.html           # interactive
https://reef.home.local/playground.html?mode=screen
https://reef.home.local/playground.html?readonly=1
```

Local dev: `pnpm --filter @reef/client dev` → `http://localhost:5173/playground.html?api=http://localhost:8787`.

What it **doesn't** test: the 8th Wall engine, camera permissions,
SLAM tracking, anchor stability, real lighting, the marker print.
Steps 1-5 below remain necessary for AR verification.

---


Everything code-side is done, including compiling the placeholder
pedestal image-target and wiring it into 8th Wall (PR #49). The
remaining work is physical-world and can't be automated.

**Dependency graph:**

```
[✓ Compile placeholder image-target — done in PR #49]
        ↓
Step 1 — Deploy to Beelink and confirm the backend is reachable
        ↓
Step 2 — Print the marker
        ↓
Step 3 — Real-device smoke test (iPhone + Android)
        ↓                       ↓
     (if passes)            (if fails: fix lighting / reprint / debug)
        ↓
Step 4 — Commission production artwork  (optional, but recommended)
        ↓  (repeat compile → print → smoke)
Step 5 — Program NFC tags
        ↓
Ready for public visitors.
```

Each step below explains **what is happening**, **why it matters**,
and **how to tell it worked**. Do not skip steps — the failure modes
compound when you do.

---

### Step 1 — Deploy to the Beelink and confirm the backend is reachable

**What you're doing.** The client already works as a static bundle
(GitHub Pages hosts one), but the AR experience is _collaborative_ —
every polyp you place goes to a real Fastify + SQLite server, and
every visitor's WebSocket connection gets live updates when anyone
else plants. You need that server up before anything else works
end-to-end.

**Why it matters.** Tracking can be tested against a dev server, but
iPhone Safari will only connect to a HTTPS origin for camera access
(a browser security constraint for mixed-content reasons). That
means you need the Cloudflare Tunnel in front of the Beelink so the
phone can reach `https://reef.<yourdomain>` and get a TLS
certificate. Without that, step 3 will fail at "grant camera
permission" because the browser refuses mixed-content origins.

**Exactly how:**

1. On the Beelink host (via SSH or direct console):
   ```sh
   git clone https://github.com/costajohnt/CoralReefAR.git
   cd CoralReefAR
   cp .env.example .env
   ```
2. Edit `.env`:
   - `ADMIN_TOKEN=<some-long-random-string>` — you will paste this
     into the admin page later to delete/restore polyps. Generate
     via `openssl rand -hex 32` or similar.
   - `CORS_ORIGINS=https://reef.<yourdomain>` — exact origin the
     phone will load from. Include the `https://` scheme.
   - `CLOUDFLARE_TUNNEL_TOKEN=<token-from-CF-dashboard>` — paste
     from the tunnel you create at
     <https://one.dash.cloudflare.com/> → Zero Trust → Tunnels.
3. Boot it:
   ```sh
   docker compose up -d
   docker compose logs -f server
   ```
4. Verify locally from the Beelink:
   ```sh
   curl -fsS http://localhost:8787/healthz
   # {"ok":true,"time":1745...}
   ```
5. Verify externally from your laptop:
   ```sh
   curl -fsS https://reef.<yourdomain>/healthz
   # same
   ```

**How to tell it worked.** Both `curl` commands return `ok:true`.
Open `https://reef.<yourdomain>/` in a browser — you see the AR
landing page. `docker compose logs -f server` shows no repeated
warnings.

**If anything here fails**, debugging here is much easier than
during the real-device test: you're on a laptop with dev tools, not
crouched over a phone. Fix connectivity, TLS, CORS, and admin-token
issues now, not later.

---

### Step 2 — Print the marker and mount it

**What you're doing.** Producing the physical square the camera will
see. The 8th Wall engine matches features (corners, edges, mid-tone
gradients) in live camera frames against a fingerprint extracted
from the compiled target. Print-quality artifacts directly affect
match quality.

**Why it matters.** This is the single biggest determinant of
tracking robustness. A perfect code pipeline against a bad print
gives visitors a 50/50 experience.

**Physical specs:**

| Property | Value | Why |
|---|---|---|
| Size | 180 mm × 180 mm | At ~1 m viewing distance, feature corners are still 20+ pixels apart in the camera frame. Smaller = tracking only works up close. |
| Paper | Matte, heavyweight (≥120 gsm) | Gloss reflects museum lighting straight into the lens, washing out contrast at the worst possible moment. Thin paper bows under its own weight, warping the homography. |
| Printing | Photo-quality inkjet OR toner laser | Draft-quality inkjet bands/bleeds. Banding looks like features to a corner detector → false matches → drifting anchor. |
| Mounting | Flat rigid surface (foamboard, MDF, pedestal top) | Any curvature screws up pose estimation — the engine assumes the target is flat. |
| Orientation | Any, but fix it | Once mounted, don't rotate the marker between test cycles; orientation becomes part of the anchor pose. |

**How to print:**

```sh
# The marker is currently the placeholder at assets/pedestal/marker.svg.
# Rasterize to a high-res PNG first:
rsvg-convert -w 2048 -h 2048 ~/dev/CoralReefAR/assets/pedestal/marker.svg > /tmp/pedestal.png

# macOS:
open -a Preview /tmp/pedestal.png
# Preview → File → Print → Size: set to 180 mm × 180 mm (Preview shows mm
# when you flip the ruler unit in macOS System Settings → Language & Region)
# → Paper Handling: "Scale to fit" OFF
# → Print (or Save as PDF then to a print shop)
```

For a cheap test print: any home inkjet. For a durable final print
that'll live on the pedestal for months: take the PDF to a print
shop and ask for **180×180 mm, matte, dry-mounted to 3 mm foamboard,
black-core if available**. Black-core hides edge wear.

**How to tell it worked.** Print is square-perpendicular to its
edges, has visible fine detail (no banding), feels stiff, no
visible gloss under overhead light. Put it flat on a table.

---

### Step 3 — Real-device smoke test

**What you're doing.** Exercising the full visitor experience: load
the URL → camera → tracking → plant → persist → live updates. Every
layer the CI tests can't reach.

**Why it matters.** 147 unit + integration tests cover code correctness.
They tell you the code does what the code says it does. They don't tell
you whether the SLAM tracking actually locks onto the marker under
your venue's lighting, whether the phone's GPU renders the reef at
30+ fps, whether the NFC-tap → browser → camera flow feels fast to a
visitor who's never seen it before. **This is where the installation
succeeds or fails as an art piece.**

**What's happening under the hood when a visitor taps Start:**

1. Browser requests camera (MediaDevices API).
2. `<script src="...8thwall/engine-binary@1.0.0/dist/xr.js">` is
   fetched from jsDelivr if not already cached.
3. Our app polls `window.XR8` for up to 8 seconds
   (`EightWallProvider.waitUntilReady`).
4. Once XR8 is present, the app fetches `image-targets/pedestal.json`
   (553 bytes) and the companion 49 KB luminance PNG that the
   engine reads for feature comparison.
5. The engine starts SLAM — it uses the phone's gyroscope +
   accelerometer + camera for spatial understanding, and runs
   image-target matching at the same time.
6. When the marker comes into frame, SLAM builds a pose and fires
   `reality.imagefound` with position + rotation quaternion.
7. Our code composes that into a 4×4 matrix and applies it to the
   reef's root `Group`, which has all the polyps attached.
8. From that point on, SLAM tracks the marker frame-to-frame at
   ~30 Hz; the reef stays pinned even when the camera moves.
9. Tap-to-place: a raycast from the tap position against the reef
   plane gives you a local-space position; we show a ghost polyp;
   on Grow, we POST to `/api/reef/polyp`; the server inserts,
   broadcasts over WebSocket to every other connected client.

**Devices to test on, in this order:**

- **iPhone** (any model ≥ iPhone XR), **Safari** (not Chrome — iOS
  locks camera access to Safari system-wide). iOS ≥ 13.
- **Android** (any mid-to-high-end phone from the last 4 years),
  **Chrome**. SLAM needs a reasonably recent GPU; very old Androids
  drop frames.

If either device fails catastrophically (no anchor, black screen),
stop and debug — don't proceed to NFC.

**The golden path to confirm works on each device:**

| # | Action | Expected result |
|---|---|---|
| 1 | Load `https://reef.<yourdomain>/ar.html` | Landing page renders, "Grow the reef" + Start button |
| 2 | Tap **Start** | Camera permission prompt. Grant it. |
| 3 | (Still on Start screen until camera gets permission) | Camera view fills the screen; status text "Looking for the reef…" |
| 4 | Point camera at printed marker from ~60 cm, marker filling ~30% of frame | Within 2-3 seconds: status vanishes, reef appears anchored to the marker, picker slides up |
| 5 | Walk 45° around the pedestal keeping the marker in view | Reef stays pinned to the marker, no drift or jitter as you move |
| 6 | Tilt the phone toward the marker at various angles | Reef rotates with the marker (because the anchor rotates). Keep the marker in frame. |
| 7 | Tap an empty spot on the reef | A ghost polyp appears at that spot; picker shows species + color options |
| 8 | Pick a species (e.g. Branching) and a color | Ghost updates live to reflect your choice |
| 9 | Tap **Grow** | Ghost becomes a real polyp, animates from tiny to full size over ~2 seconds |
| 10 | Close the browser tab, reopen `/ar.html` | Your polyp is still there after the anchor locks. Other polyps (if any) load too. |
| 11 | On a laptop, open `https://reef.<yourdomain>/admin`, paste your `ADMIN_TOKEN` | Admin UI loads, shows your polyp in the live list |
| 12 | On the laptop, click Delete next to your polyp | On the phone (still running the AR session), your polyp disappears within 1 second (WebSocket update). |
| 13 | On the laptop, click Restore | Phone gets the polyp back, also within 1 second |

**Failure diagnosis:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Camera permission prompt never appears | Wrong URL scheme (http vs https) | Confirm Cloudflare Tunnel is routing https |
| Camera opens but "Looking for the reef…" never clears | Marker not recognized | Better lighting (bright diffuse overhead beats direct sunlight), print bigger, matte-ify, confirm you're within ~1 m |
| Reef appears but drifts/jitters as you move | Print too flat-looking or too symmetric, OR lighting too even | More features in the marker (see Step 4), OR add directional lighting |
| Reef appears but the wrong way up or mirrored | Marker compiled with different orientation than it's mounted | Rotate the physical print 90° until correct; update compile if it's upside-down |
| Tap does nothing | Anchor is "lost" behind the scenes while you tap | Keep the marker in frame while tapping |
| Polyp vanishes after Grow | Server POST failed | Check `docker compose logs server`, likely a CORS or rate-limit issue. `CORS_ORIGINS` must exactly match the URL the phone is loaded from. |
| Phone 1's polyp doesn't appear on phone 2 | WebSocket not connecting | Browser devtools (if remote debugging) → Network → WS — should see a 101 Switching Protocols |
| 20-second delay between Grow and polyp rendering | Server slow-path (DB transaction stuck) | Unlikely under museum load; check logs |

**If tracking is bad across 4-6 marker-lock cycles**, stop and
decide before moving on: is the placeholder too symmetric for the
engine? Is venue lighting too even or too shadowed? Try a different
print size (150 mm, 200 mm). These knobs beat re-commissioning
artwork. Real artwork can still fail tracking if feature density
isn't high — and the diagnosis process is the same.

---

### Step 4 — Commission the production marker (optional but recommended)

**What you're doing.** Replacing the placeholder square pattern with
actual artwork that matches the installation's aesthetic while
staying trackable.

**Why it matters.** Two reasons:

1. **Aesthetics.** A placeholder pattern on the pedestal says
   "prototype." Real artwork says "artist deliberately chose this."
   Museum visitors read that instantly.
2. **Tracking quality.** Properly designed artwork is *better* for
   tracking than the placeholder — more features, more asymmetry,
   higher-contrast mid-tones. Placeholder is deliberately minimal.

**What a good marker needs** (designer brief):

- **Asymmetric.** The engine recovers not just position but rotation
  from the marker; a rotationally-symmetric image gives the engine
  4 equally-valid orientations and the anchor flips randomly.
- **Feature-dense.** Hundreds of distinct corners distributed across
  the square. Imagine the marker broken into a 10×10 grid — each
  cell should have something trackable in it.
- **Mid-tone palette**, not pure primaries. Phone cameras demosaic
  red/green/blue through a Bayer filter; pure-primary regions lose
  contrast under exposure. Teal, coral, cream, deep navy all work.
- **Matte printability.** Palette should look fine printed on
  matte paper — no gradients so subtle they'd band on 300 dpi.
- **Unique.** If you also plan a second marker for anything else,
  they must not share local features or they'll cross-match.

**Workflow when you get the final art:**

1. Designer delivers a ≥2048×2048 PNG of the final marker.
2. Save it to `assets/pedestal/marker.png` (commit; this is now
   the canonical artwork).
3. Recompile the image-target:
   ```sh
   cd ~/dev/CoralReefAR
   # Rasterize if needed (skip if designer delivered PNG already)
   rsvg-convert -w 2048 -h 2048 assets/pedestal/marker.svg > /tmp/pedestal.png
   npx @8thwall/image-target-cli@latest
   ```
   Answer the prompts the way PR #49 did:
   - Image path → `/tmp/pedestal.png` (or directly to
     `assets/pedestal/marker.png`)
   - Type → 1 (flat)
   - Default crop → Y (enter)
   - Output folder → `/tmp/pedestal-target` (temp, we'll move)
   - Target name → `pedestal`
4. Replace the 5 files under `packages/client/public/image-targets/`
   with the new output.
5. Ping me — I'll open a PR with the new assets so you don't have
   to wrangle git LFS or worry about embedding a huge PNG. I'll
   also re-run the smoke test checklist from Step 3 to confirm
   tracking quality improved.
6. Print the new marker at 180 mm; repeat Step 2.
7. Repeat Step 3 in full. Quality should improve on every metric
   (time-to-lock, drift amplitude, re-acquisition speed).

**Timing:** production artwork typically lags everything else by
weeks (designer time + print-shop turnaround). Plan to spend at
least 2-3 weeks on this once you commission.

---

### Step 5 — Program NFC tags

**What you're doing.** Putting physical tappable tokens in the
installation so visitors launch the AR without typing a URL.

**Why it matters.** The difference between "I have to remember and
type `reef.jcosta.tech/ar`" and "I tap my phone to this thing" is
the difference between 5% of visitors engaging and 70%. NFC is the
museum-install-standard way to do this.

**Which tags:**

- **NTAG215**. Cheap (~$0.30 each in bulk), 540 bytes storage (way
  more than you need — a URL record is ~50 bytes). Compatible with
  iPhone (iOS 13+, works from Control Center or Safari's background
  NFC scanner) and every modern Android. Buy blank, in 50-100 tag
  stickers. Amazon, AliExpress, or specialty museum suppliers.
- **Stickers vs cards vs embedded:** stickers are easiest — peel and
  stick under the pedestal. If you want it invisible to the
  visitor, embed behind a thin non-metal surface.

**Programming:**

1. Install **NFC Tools** (free) on your phone:
   - iOS: <https://apps.apple.com/app/nfc-tools/id1252962749>
   - Android: <https://play.google.com/store/apps/details?id=com.wakdev.wdnfc>
2. In the app, go to the **Write** tab.
3. **Add a record** → **URL/URI** → paste the deployed URL (e.g.
   `https://reef.jcosta.tech/ar.html`). Make sure it's the `ar.html`
   path, not just the landing page — you want visitors straight
   into the AR view.
4. Tap **Write**, then tap the phone to the first blank tag. The
   tag is programmed in ~1 second.

**Test ONE tag end-to-end before batch-programming:**

1. Lock your phone. (Tag reading works from the lock screen on iOS.)
2. Hold the phone near the tag.
3. iPhone: a system banner appears "Open in Safari?" → tap it.
4. Android: Chrome opens automatically.
5. Complete the full AR flow from Step 3 (camera → anchor → plant →
   close → reopen).
6. If that works, program the rest of the batch. If it doesn't, the
   URL is wrong or the tag write failed — diagnose before batching.

**Optional hardening:**

- Lock the tag after writing (NFC Tools → Other → Lock tag) so
  visitors can't accidentally overwrite. Once locked, it's
  read-only forever. Don't lock until you've confirmed the URL is
  final.
- Add a password (NFC Tools supports it) if you want to be able to
  edit later but prevent random overwriting.

**How to tell it worked.** Tap the tag with a locked iPhone → phone
wakes, Safari banner appears, AR launches. Total elapsed time from
tap to "Looking for the reef…" should be under 5 seconds on a good
connection (most of it engine-binary download on first use).

---

### Decide later — Fly billing

**Context.** The Fly.io workflow was provisioned but never boots
because Fly trial orgs require a credit card before any VM runs.
You decided Beelink was simpler for testing, and
`.github/workflows/fly-deploy.yml` is currently gated to
`workflow_dispatch` only so main pushes don't fail red every merge.

**Why you might care later.** If the Beelink ever goes down (power
outage, ISP, hardware failure), Fly is your hot standby. It's
region-redundant, TLS-terminated, and the deploy workflow will push
`:latest` automatically once re-enabled.

**Exactly how to resume:**

1. Add a credit card at
   <https://fly.io/dashboard/john-costa-307/billing>.
2. Edit `.github/workflows/fly-deploy.yml` and restore the
   `push: branches: [main]` trigger that was removed in PR #31:
   ```yaml
   on:
     push:
       branches: [main]
     workflow_dispatch:
   ```
3. Push. Next merge to main will trigger `flyctl deploy` against
   the existing `coralreefar` app.
4. Point DNS at Fly (or not — keep Beelink as primary and Fly as
   disaster recovery).

Until then, the infra sits dormant. No cost while not running.

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
