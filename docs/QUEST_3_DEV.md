# Quest 3 — developer guide

How to run, debug, and iterate on the WebXR client surface at `quest.html`
during development. Companion docs:
- Design spec: [`docs/superpowers/specs/2026-05-25-quest3-mr-surface-design.md`](superpowers/specs/2026-05-25-quest3-mr-surface-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-25-quest3-mr-surface.md`](superpowers/plans/2026-05-25-quest3-mr-surface.md)

## Why WebXR can't just hit `localhost`

WebXR requires a "secure context." That's localhost OR HTTPS. The Quest
isn't running your dev server — it's connecting to your Mac across the
LAN — so from the Quest's perspective, the dev server is *not* localhost.
That means you need HTTPS even in dev.

This project uses `vite-plugin-mkcert`, gated behind `VITE_ENABLE_MKCERT=1`.
Without that env var, Vite serves plain HTTP and Quest will refuse WebXR.

## Three iteration tiers

Each tier trades setup effort for feedback fidelity.

### Tier 1 — Unit / integration tests (no headset, no Mac IP)

```bash
pnpm --filter @reef/client test
# or just the quest module:
pnpm --filter @reef/client test src/quest/
```

Fastest loop. Doesn't exercise WebGL, real XRSession, or hand-tracking —
but pinch detection math, anchor placement state machine, server message
routing, rotation math, and overlay billboarding all have real tests.

### Tier 2 — LAN dev on the headset (recommended for interaction tuning)

```bash
# One-time per machine (installs a local CA into the keychain):
brew install mkcert

# Each dev session:
pnpm dev:server                                       # terminal 1
VITE_ENABLE_MKCERT=1 pnpm --filter @reef/client dev   # terminal 2

# On Quest: open the Meta Quest Browser and navigate to
#   https://<your-mac-lan-ip>:5173/quest.html
# Trust the cert prompt the first time.
```

Iteration cycle: edit code → Vite hot-reloads → reload the page in Quest
Browser → re-enter MR. About 10 seconds per cycle once you've put the
headset on.

**Mac IP discovery:** `ipconfig getifaddr en0` (or check System Settings
→ Wi-Fi → Details).

**Firewall:** macOS may prompt to allow incoming connections on first
launch. Allow Node.

**Quest network requirements:** Quest and Mac must be on the same
network. A guest network with client isolation enabled blocks them from
seeing each other.

### Tier 3 — Deploy preview (slowest but most realistic)

```bash
# Build, commit, push the branch → GitHub Pages preview deploys
# automatically via .github/workflows/pages.yml.
# Open the preview URL in Quest Browser.
```

Useful for testing against the real production backend, sharing with
others, or when you don't want to keep your laptop awake. Each iteration
is a full CI build (~2 minutes).

The Pages bundle has no backend — the reef won't load. To test against
a real reef, deploy your branch via Fly.io.

## Architecture quick reference

```
packages/client/src/quest/
  quest.ts                  Entry — checks WebXR availability, sets up
                            the "Enter MR" button
  questApp.ts               XRSession lifecycle, state machine, render
                            loop, hand interaction dispatch
  serverMessageHandler.ts   Applies polyp_added / polyp_removed /
                            sim_update events to the local Reef
  hotspotLayer.ts           Mirrors the live Reef and parents
                            tip-node hotspot meshes per polyp
  anchor/
    placementMode.ts        First right-hand pinch captures anchor pose
    reefAnchor.ts           Wraps XRAnchor, per-frame matrix update
    anchorPersistence.ts    URL flag + localStorage I/O for the
                            persistent-anchor UUID
  hand/
    handInteraction.ts      Pinch detection (hysteresis), hotspot raycast
                            (pickHotspot), direct-touch button pick
                            (pickPokedButton)
  ui/
    wristPalette.ts         Two-row palette (shapes + colors) +
                            move-reef button, pinned to left wrist
    instructionOverlay.ts   3D canvas-textured panel rendered in front
                            of the head pose
    tipNodeHotspot.ts       Glowing sphere markers on extendable tips
```

Tip metadata comes from the generator: each `GeneratedPolyp` carries
an optional `tips: TipNode[]` array (up to 3 for branching, 1 for
bulbous/fan/tube, 0 for encrusting). The Quest `HotspotLayer` reads
those tips when each polyp is added and parents a `tipNodeHotspot`
mesh at each tip's world transform.

The Quest surface deliberately **does not implement** the `Tracker`
interface used by the phone-AR client. WebXR owns the reference space,
the render loop, and the per-frame camera — different model than
marker-based pose pipelines.

## State machine

```
  idle ── start ──► xr-starting ── session ready ──► placement
                       │                                 │
                       │                                 │ right-hand pinch
                       ▼                                 ▼
                     error ◄── anchor create fail ── loading
                                                         │
                                                         │ anchor + reef ready
                                                         ▼
                                                    interactive
                                                       ▲ │
                                                       │ │ tracking lost
                                                       │ ▼
                                                  tracking-lost
                                                         │
                                                         │ moveReef
                                                         ▼
                                                     placement (re-anchor)
```

## Tunables (likely v1.1 targets)

These are all educated guesses that need real-hardware feedback:

| Constant | Location | Default | What it controls |
|---|---|---|---|
| `PINCH_THRESHOLD_METERS` | `hand/handInteraction.ts` | `0.025` | Distance under which thumb+index tips read as pinched |
| `PINCH_RELEASE_THRESHOLD_METERS` | `hand/handInteraction.ts` | `0.04` | Hysteresis: above this distance, an in-progress pinch ends |
| `BUTTON_SIZE_METERS` | `ui/wristPalette.ts` | `0.025` | Wrist-palette button edge length |
| `wrist Y offset` | `questApp.updatePalettePose` | `+0.04` | Distance the palette floats above the wrist joint |
| `HOTSPOT_RADIUS_METERS` | `ui/tipNodeHotspot.ts` | `0.015` | Visible tip-node hotspot sphere radius |
| `questRateLimitMax` | `server/src/config.ts` | `20` | Polyps per hour from a quest device hash |

## URL flags

| Flag | Effect |
|---|---|
| `?persist=1` | Enables cross-session anchor persistence. On entry, attempts to restore the saved anchor (if any) and skip placement. After successful new placement, saves the anchor's UUID to `localStorage`. Move-Reef clears the saved handle. **Per device** — handles do not travel between Quest accounts or browsers. |

## Known limitations / open items

These are tracked in the project changelog and `NEXT_STEPS.md`.

- **No controller support.** Hand tracking only. Adding controllers
  would mostly just be a different input pipeline that produces the
  same `pinch-start / pinch-hold / pinch-end` events.
- **LOD at 10 cm not validated.** Phone-AR meshes were tuned for ~1m
  viewing distance. Life-size MR puts the user's eye much closer; may
  need a generator polish pass.
- **Hotspot count is fixed per species.** Branching exposes the 3
  highest L-system endpoints; bulbous/fan/tube each expose 1 at the
  top. Encrusting has no hotspots. May want to expose more tips or
  derive them from each polyp's actual mesh after hardware tuning.
- **Persistence is single-device.** WebXR persistent-anchor UUIDs are
  scoped to the device's saved room geometry. Sharing a reef anchor
  between two Quest users requires Shared Spatial Anchors (Meta-only,
  not in WebXR).

## Debugging tips

- **Hand tracking not detected:** Settings → Hands → enable hand
  tracking. The "Enter MR" button checks
  `xr.isSessionSupported('immersive-ar')` but does not verify hand
  tracking specifically.
- **Reef doesn't appear after pinch:** check the browser console — the
  most common failure is the `frame.createAnchor()` API being absent
  (older browsers). The QuestApp transitions to `error` and the overlay
  shows the failure reason.
- **WebSocket can't connect:** verify the backend is reachable from the
  headset's network. Try opening `https://<host>/api/reef` in Quest
  Browser — it should return JSON.
- **Palette doesn't appear:** look at your left wrist. The palette is
  pinned to the wrist joint and is invisible if the joint isn't being
  tracked (e.g. left hand outside the headset's camera field of view).
