# Quest 3 MR Surface — Design

**Status:** proposed
**Date:** 2026-05-25
**Author:** John Costa
**Related:** [vault: coralreef-ar/quest3-integration](../../../../../../Documents/notes/coralreef-ar/quest3-integration.md)

## Summary

Add a new client surface (`quest.html`) that runs CoralReefAR in the Meta Quest 3 Browser using WebXR `immersive-ar` mode with passthrough, hand tracking, and spatial anchors. The Quest user pinches a spot in their room to place a session-scoped anchor; the shared global reef materializes life-size around that anchor and they grow it with hand interactions. No new backend, no app install, no separate reef state.

## Motivation

- **Portfolio asset.** Differentiated, visual, demonstrates WebXR / spatial computing skill. Strong video and screenshot material for jcosta.tech.
- **Better UX than phone AR.** Phone screen frame is too small for the reef at expressive scale. MR lets the user walk around a life-size reef.
- **Unblocks current AR path.** Phone AR is currently blocked by no color printer (pedestal marker can't be produced). WebXR spatial anchors avoid the marker entirely.
- **Preserves project identity.** "No install, web-based, runs on a $5 Fly VM" — a native Meta Spatial SDK app would betray that. WebXR keeps it.

## Goals (v1)

1. Open the URL in Quest Browser, tap "Enter MR," pinch a spot, see the global reef materialize life-size.
2. Grow the reef with hand tracking: poke close hotspots, ray-pinch far ones.
3. Cycle shape (5 species), pick color, rotate before committing — all via wrist palette.
4. Same backend, same reef data, same WebSocket protocol as the web client. Polyps planted in MR appear on web in real time and vice versa.
5. Walk around / through the reef; no auto-fit to room.

## Non-goals (v1)

- Ambient life (fish boids, currents, sim-tick growth). Static reef only.
- Cross-session anchor persistence. Session anchor only — user re-pinches each session.
- Controller support. Hand tracking only.
- Native Quest app (Unity / Meta Spatial SDK).
- Shared spatial anchors between Quest users (everyone anchors to their own room).
- Visual / behavioral parity with the phone-AR 2D placement UI.

## Architecture

A new client surface alongside the existing five (`index.html`, `playground.html`, `tree.html`, `treeAr.html`, `preview.html`, `timelapse.html`). No changes to `@reef/generator`. `@reef/shared` gains an optional `surface` field on the polyp-submission schema. `@reef/server` gains a Quest-aware rate-limit branch driven by that field.

**Quest does not extend the existing `Tracker` interface.** That interface was designed for marker-based "find pose → return transform" trackers (8th Wall, noop). WebXR fundamentally owns the reference space, render loop, and per-frame camera — forcing it through `Tracker` would misrepresent the model. Quest gets its own session-management module.

### Module layout

```
packages/client/
  quest.html                              # new entry point
  src/quest/
    quest.ts                              # bootstrap
    questApp.ts                           # XRSession lifecycle, state machine, render loop
    anchor/
      placementMode.ts                    # ray-from-hand + pinch-to-drop flow
      reefAnchor.ts                       # XRAnchor wrapper, per-frame pose
    hand/
      handInteraction.ts                  # poke + ray-pinch hit testing
      handVisualizer.ts                   # toggleable debug overlay
    ui/
      wristPalette.ts                     # shape cycle, color picker, "Move reef" button
      tipNodeHotspot.ts                   # 3D glowing hotspots on reef tip nodes
      instructionOverlay.ts               # placement-mode hints, fades after first action
    scene/
      questScene.ts                       # builds Three.js scene from generator output

packages/server/
  src/routes.ts                           # extend POST /api/reef/polyp rate limit (see below)
```

### Reused (zero changes)

- `@reef/generator` — polyp mesh generation
- `@reef/shared` — types, schema, palette
- `packages/client/src/scene/` — materials, helpers
- `packages/client/src/net/` — WebSocket client

### Loop / camera

WebXR's render loop is driven by `XRSession.requestAnimationFrame`, not the usual rAF. The camera is provided by the session per-frame (`XRView.transform`, `XRView.projectionMatrix`) and rendered into an `XRWebGLLayer` framebuffer. `questApp.ts` wraps the standard loop pattern: get `XRFrame` → update anchors and input sources → render scene with WebXR-provided views.

## Data flow

### Boot

1. User opens `https://coralreefar.fly.dev/quest.html` → static page with "Enter MR" button
2. Tap → `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hand-tracking', 'anchors'], optionalFeatures: ['local-floor'] })`
3. Passthrough enabled → instructional overlay: "Pinch a spot on your floor to plant the reef"
4. `placementMode` shows a green ray from the right hand
5. Pinch detected → `XRAnchor` created at hit pose → `reefAnchor` set as scene root
6. Fetch `/api/reef`, build meshes from generator, attach to anchor
7. Open `/ws`, subscribe to `polyp_added` / `polyp_removed`
8. Overlay fades, wrist palette becomes available

### Interaction (per frame)

- Get `XRFrame`, update both hands' joint poses
- Detect pinch (thumb tip + index tip distance < threshold, debounced)
- Raycast from right index fingertip (poke mode) and from the WebXR-provided ray-pinch ray (far mode)
- `tipNodeHotspot` highlights any hit
- On pinch-while-hovering-hotspot:
  - Spawn current selected shape attached to that hotspot
  - Allow rotation around the hotspot's outward normal axis via wrist-roll delta on the active hand (`XRInputSource.gripSpace` orientation Δ since pinch start)
  - Confirm pinch (or 1s idle) commits → `POST /api/reef/polyp`
- Server broadcasts via `/ws` → all clients (Quest + web) update their scenes

### Wrist palette

- Look at the inside of your left wrist (left hand orientation matches a palette-visible threshold) → palette pinned to the back of the left hand
- Right index finger pokes:
  - 5 shape buttons (branching, bulbous, fan, tube, encrusting)
  - 5 color swatches (current palette colors)
  - 1 "Move reef" button (re-enters placement mode)

## State machine (questApp)

| State | Description | Transitions |
|---|---|---|
| `idle` | Pre-MR, 2D page | → `xr-starting` (user taps Enter MR) |
| `xr-starting` | XRSession requested, awaiting | → `placement` (session ready) / `error` |
| `placement` | Passthrough on, awaiting anchor pinch | → `loading` (anchor placed) |
| `loading` | Fetching reef state, building meshes | → `interactive` (done) |
| `interactive` | Normal play | → `placement` ("Move reef") / `tracking-lost` |
| `tracking-lost` | Reef visible at last pose, warn toast | → `interactive` (recovery) |
| `error` | Unrecoverable; user must reload | (terminal) |

## Server changes

The only backend change: extend the per-device rate limit in `POST /api/reef/polyp`.

**Current:** 1 polyp / hour / device.
**Quest:** ~20 polyps / hour / device (active demoing requires many placements).

Detection: the polyp payload gains an optional `surface: "quest" | "web"` field (schema change in `@reef/shared`). Server uses the surface tag to choose which rate-limit bucket to apply; missing/unknown surface defaults to the strict web bucket. Server still enforces a global per-IP ceiling for abuse defense.

Tests: extend `packages/server/src/routes.test.ts` to cover the Quest rate-limit branch.

## Dev workflow

WebXR `immersive-ar` requires either localhost or HTTPS, and Quest can't see the Mac's localhost. Three-tier dev loop:

1. **Unit tests:** vitest, mock `XRSession` / `XRInputSource`. Fast inner loop, no headset.
2. **LAN dev:** Vite bound to `0.0.0.0`, HTTPS via `vite-plugin-mkcert`. Quest connects to `https://<mac-ip>:5173/quest.html` over the same wifi. Real headset, fast iteration. Mac firewall + mkcert root install required once.
3. **Deploy preview:** push branch → GitHub Pages preview build → open in Quest Browser. End-to-end validation including backend.

Optional: Immersive Web Emulator Chrome extension for desktop-browser smoke testing during development (no headset, no Mac IP).

## Error handling

- **WebXR unsupported:** fallback page links to `/playground.html` and a Quest Browser install hint. No graceful degradation; the surface IS the Quest experience.
- **`requestSession` rejection:** surface the actual error, link to "ensure hand tracking is enabled in Quest settings."
- **Anchor creation fails (rare):** stay in `placement`, show "Tracking lost — make sure you're facing the floor and try again."
- **WebSocket disconnect:** reuse the web client's existing reconnect logic in `net/`.
- **Polyp POST fails (rate limit, server error):** the in-progress polyp shimmers and dissolves; toast surfaces the error message.
- **Tracking lost mid-session:** transition to `tracking-lost`; reef holds at last good pose, toast appears. WebXR usually recovers automatically.

## Testing

**Unit (vitest, runs in CI):**

- `handInteraction.test.ts` — synthetic input source data; assert pinch detection, raycast hit ordering
- `placementMode.test.ts` — state-machine transitions
- `questScene.test.ts` — given mock reef state, assert mesh tree shape
- `routes.test.ts` — Quest device-hash rate-limit branch (server-side)

**Integration (vitest with mocked `XRSession`):**

- Anchor placement → fetch reef → render → broadcast loop
- Hand interaction → polyp commit → POST → WebSocket fan-out

**Manual smoke (run on real Quest before merging):**

- Enter MR, place anchor, see reef materialize
- Plant 3 polyps using poke-close, ray-far, and rotate-while-composing flows
- Open web client on phone simultaneously, confirm Quest polyp appears in <1s
- Plant on web, confirm it appears on Quest
- Trigger "Move reef" → re-anchor → reef reappears at new origin
- Tracking-lost recovery (briefly cover front cameras)

## Open items deferred to implementation plan

- Exact pinch detection thresholds (tune on hardware)
- Wrist palette positioning offset (tune on hardware)
- LOD check at life-size proximity — phone reef was built for ~1m view, MR users get within 10cm. May need a generator polish pass; will assess during first deploy and file follow-up issue if it looks bad.
- Choice between mkcert and ngrok for LAN dev HTTPS
- Whether Immersive Web Emulator can be driven from CI

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebXR hand tracking precision insufficient for tip-node clicks | Medium | Implement both poke and ray modes; large visible hotspots; tune detection thresholds with real hardware |
| Mesh quality looks bad at 10cm | Medium | Will eyeball during first deploy; if bad, file follow-up to add LOD/subdivision pass in generator |
| Quest Browser WebSocket connection blocked | Low | Test in first deploy-to-Quest smoke; fall back to long-poll if needed (no current evidence this is an issue) |
| Wrist palette UX feels clunky | Medium | Standard pattern, lots of prior art; iterate during manual smoke testing |
| WebXR session crashes on long sessions | Low | Reuse existing WebSocket reconnect logic; XR session restart flow lives in the `error` state |

## Estimate

3–5 days of focused work to v1 (per the initial scoping). Larger if LOD or hand-tracking precision turns out to need significant rework.
