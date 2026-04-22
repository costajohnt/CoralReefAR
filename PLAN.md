# Coral Reef AR — Implementation Plan (v2)

A collaborative AR installation where visitors tap an NFC tag, open a web-based AR view of a living, procedurally-generated coral reef anchored to a physical pedestal, and add their own polyp. The reef persists and grows forever, simulates subtle biological activity between visitors, and runs entirely on self-hosted infrastructure.

## What changed from v1

- **Tracking:** 8th Wall open source (free, SLAM-based) instead of MindAR. Real world tracking, not just flat-image targets.
- **Assets:** Procedurally generated polyps via L-systems and reaction-diffusion. No hand-modeled GLTFs. Every contribution is unique.
- **Liveness:** Simulated currents, background growth, and ambient life. The reef changes visibly even with zero tappers.
- **Tracking abstraction:** Swappable tracking provider interface so a future provider (WebXR image-tracking, another engine) can slot in without touching app code.
- **Still $0 ongoing cost.** Everything self-hosted on existing Beelink + Cloudflare Tunnel.
- **Dual surface:** the installation has both an AR layer (phone tapped to a pedestal) and a non-AR screen layer (`playground.html`) that shows the reef growing from a fixed orbit viewpoint on a wall-mounted display. Same backend, same sim loop, same geometry — two ways to experience the same living reef.
- **Third surface (planned — tree mode):** a third entry (`tree.html`) for a different reef — a fractal branching-coral web where visitors attach small composable pieces to each other's exposed tips. Avatar-bioluminescent styling (bloom post-processing, vivid palette). Separate reef in the DB. Concept fully specified in [`docs/superpowers/plans/2026-04-22-tree-mode.md`](./docs/superpowers/plans/2026-04-22-tree-mode.md). Phase 2 migrates the AR client to read the tree data so the pedestal AR view shows the same growing fractal structure the wall screen shows.

## Goals

- Zero friction: tap → AR → add polyp → leave, under 60 seconds, no app install.
- Cross-platform: iOS Safari + Android Chrome, no workarounds for the user.
- Alive: the reef looks and behaves like a living organism, not a static gallery of objects.
- Persistent + shared: every contribution is permanent and visible to all future visitors.
- Self-hosted: no paid services, no vendor lock-in, no monthly bills.

## Tech stack

### Frontend (`packages/client`)

- **Vite + TypeScript**
- **Three.js** for rendering
- **8th Wall open source XR engine** (free binary, self-hosted) for SLAM + image target tracking
- **Custom `TrackingProvider` interface** wrapping the engine, with `NoopProvider` as the desktop/dev fallback
- **Plain DOM + CSS** for UI (picker, confirm button, status overlays)
- **TensorFlow.js** (optional, v2) for any on-device content checks

### Backend (`packages/server`)

- **Node.js + TypeScript**
- **Fastify** for HTTP, **ws** for WebSockets
- **better-sqlite3** for storage
- **Zod** for validation
- **Sharp** if we need server-side image processing for snapshots

### Procedural generation (`packages/generator`)

- Pure TypeScript, runs in both client and server (server for baking "seed reef," client for new contributions)
- No dependencies beyond math utilities
- Outputs Three.js `BufferGeometry` or serialized equivalent

### Infrastructure

- Docker Compose on Proxmox (LXC or VM)
- Cloudflare Tunnel for public access
- Domain: `reef.<yourdomain>.com`
- NFC tags: NTAG215 with NDEF URL records

## Architecture overview

```
                  ┌────────────────────┐
                  │  Visitor's phone   │
                  │                    │
    NFC tap ──▶   │  Browser ──▶ WS ───┼────┐
                  │  8th Wall SLAM     │    │
                  │  Three.js render   │    │
                  └────────────────────┘    │
                                            ▼
                                   ┌─────────────────┐
                                   │   Fastify API   │
                                   │   WS hub        │
                                   │   SQLite        │
                                   │   Sim worker    │
                                   └─────────────────┘
                                            │
                                   ┌─────────────────┐
                                   │  Beelink / Prox │
                                   │  Cloudflare Tnl │
                                   └─────────────────┘
```

## Tracking: 8th Wall open source

### What we're using

As of February 2026, Niantic released 8th Wall under a free/open model. The XR Engine (including SLAM) is a free-to-use binary, including for commercial projects. Surrounding components (image targets, utilities, examples) are MIT-licensed. We download once, self-host, and never pay or phone home.

### Anchoring strategy

We use an image target as the origin anchor, but SLAM extends tracking beyond the marker. The marker itself can be the top of the pedestal — a printed pattern integrated into the pedestal's design.

### Tracking provider abstraction

```ts
// packages/shared/src/tracking.ts
export interface TrackingProvider {
  init(opts: { markerImage: Blob; videoElement: HTMLVideoElement }): Promise<void>;
  onAnchorFound(cb: (anchor: { pose: Matrix4; id: string }) => void): void;
  onAnchorLost(cb: (id: string) => void): void;
  onFrame(cb: (cameraPose: Matrix4) => void): void;
  destroy(): Promise<void>;
}
```

Implementations:

- `EightWallProvider` — default, uses the self-hosted 8th Wall engine binary
- `NoopProvider` — desktop/dev fallback (fixed anchor in front of the camera)

Feature detection + URL query param override: `?tracker=noop` forces the fallback; `?tracker=eightwall` asserts 8th Wall.

## Procedural coral generation

### The five species

1. **Branching (staghorn-style)** — L-system
2. **Bulbous (brain coral-style)** — Reaction-diffusion on sphere
3. **Fan (gorgonian)** — Coplanar L-system, extruded
4. **Tube (sponge)** — Cluster of cylinders
5. **Encrusting** — Noise-displaced disk

### Storage model

Polyps are stored as **parameters, not meshes**:

```ts
interface Polyp {
  id: number;
  species: 'branching' | 'bulbous' | 'fan' | 'tube' | 'encrusting';
  seed: number;
  colorKey: string;
  position: [number, number, number];
  orientation: [number, number, number, number];
  scale: number;
  createdAt: number;
  deviceHash: string;
  deleted: boolean;
}
```

## Live simulation

### Client-side ambient motion

- Current sway (vertex shader)
- Fish particles (boids)
- Light shafts

### Server-side background growth

- Algae blooming on older polyps
- Barnacles accumulating
- Age weathering

## Build phases

- **Phase 0** — Setup
- **Phase 1** — 8th Wall scaffold + anchor
- **Phase 2** — Tracking abstraction
- **Phase 3** — Procedural branching coral
- **Phase 4** — Remaining four species
- **Phase 5** — Server + persistence
- **Phase 6** — Placement UX
- **Phase 7** — Real-time WebSockets
- **Phase 8** — Live simulation
- **Phase 9** — Polish
- **Phase 10** — Install

## Open questions

1. Venue: indefinite home installation, gallery pitch, or both?
2. Name for the piece?
3. Conservation framing / partner org?
4. Pedestal budget ceiling?
5. Soft-open target date?
