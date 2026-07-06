# Security Policy

## Reporting

If you find a vulnerability, please **do not open a public issue**. Email
the maintainer at `costajohnt@gmail.com` with:

- A description of the issue
- Reproduction steps or a proof-of-concept
- Your assessment of impact (who can do what as a result)

I'll acknowledge within a few days and keep you in the loop on the fix
and any coordinated disclosure.

## Scope

Relevant threats for this project:

- **Unauthenticated writes**: reef admin routes are unconditionally
  bearer-token gated. Destructive tree routes (`POST /api/tree/reset`,
  `DELETE /api/tree/polyp/:id`) are gated behind the same admin token
  whenever `ADMIN_TOKEN` is configured; with no token set (the
  single-installation default) they stay open so the in-app Clear/Undo
  buttons work. Polyp creation is open by design and bounded by the rate
  limits below.
- **Rate-limit bypass**: the write rate limit is **off by default**
  (`RATE_LIMIT_MAX=0`) while the project is in single-installation
  testing. When an operator sets `RATE_LIMIT_MAX` (e.g. 1), the
  deviceHash + per-IP token bucket enforce one polyp per device per the
  configured window. Read-side limiting is likewise opt-in via
  `READ_RATE_LIMIT_PER_MIN`.
- **Resource exhaustion**: WebSocket frames have a 64 KB payload cap;
  the server soft-hearbeats and evicts silent clients.
- **Cross-site leaks**: CORS pins the origin via `CORS_ORIGINS`; no
  secrets are ever rendered into HTML responses.

Out of scope:

- Issues in third-party dependencies (report upstream)
- Social engineering of the operator's Cloudflare / domain
- Physical access to the server (self-hosted — assume a trusted LAN)

## Hardening recommendations for operators

- Set `ADMIN_TOKEN` to a long random string (`openssl rand -hex 32`).
  The startup log warns if unset.
- Keep `CORS_ORIGINS` restricted to your production hostname. `*` is
  the dev default; change it in `.env`.
- Put the service behind Cloudflare Tunnel (recommended) or another
  reverse proxy. Don't expose `:8787` directly to the internet.
- Back up `data/reef.db` on a cron; the SQLite `.backup` command is
  safe against a live writer.
