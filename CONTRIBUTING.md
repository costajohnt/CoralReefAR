# Contributing

## Setup

```sh
pnpm install
pnpm -r typecheck   # one round to prime tsc caches
```

Run the app locally:

```sh
pnpm --filter @reef/server dev   # http://localhost:8787
pnpm --filter @reef/client dev   # http://localhost:5173
```

For desktop dev without a camera / pedestal, open
`http://localhost:5173/?tracker=noop` — the reef anchors a fixed
distance in front of the virtual camera.

## Testing

Each package has its own suite. Run them all:

```sh
pnpm -r test
```

Or target a package:

```sh
pnpm --filter @reef/shared test
pnpm --filter @reef/generator test
pnpm --filter @reef/server test
pnpm --filter @reef/client test     # vitest + happy-dom
```

Server has both route tests (Fastify inject) and integration tests
against a real `ws` client (see `packages/server/src/ws.integration.test.ts`).

## Test-first, please

New behaviour lands with a test that was written first and seen fail.
The generator has hash goldens + structural invariants; any intended
change to mesh output needs the hash rolled in the same commit.

## Lint / typecheck before pushing

```sh
pnpm lint
pnpm -r typecheck
```

CI runs both; the PR can't merge if either fails.

## Commit style

Plain English, present tense, no prefixes like `[feat]`. Leading
sentence is a summary; wrap body at ~72 chars. Example:

```
Compact WS broadcast to drop closed clients atomically

Broadcast used to iterate `clients` and call `ws.send` without
checking `readyState`; a closed socket threw, aborting the loop
mid-way. Switch to `readyState === WS_OPEN` with a per-client
try/catch that evicts on throw.
```

## Opening a PR

- One PR per logical change. Small PRs merge faster.
- Include a test plan in the description (CI covers typecheck/build/tests;
  manual verification for UX-affecting changes).
- CI must be green. `main` is protected and requires the **Build and test**
  check to pass.

## Questions

Open a discussion or draft PR and tag me. Rough ideas welcome; nothing
is load-bearing yet.
