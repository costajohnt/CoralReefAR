# Security Policy

## Reporting

If you find a vulnerability, please **do not open a public issue**. Email
the maintainer at `jcosta@execonline.com` with:

- A description of the issue
- Reproduction steps or a proof-of-concept
- Your assessment of impact (who can do what as a result)

I'll acknowledge within a few days and keep you in the loop on the fix
and any coordinated disclosure.

## Scope

Relevant threats for this project:

- **Unauthenticated writes**: all POST/DELETE paths should require the
  right capability. Admin routes are bearer-token gated.
- **Rate-limit bypass**: one polyp per device per hour is the public
  contract; deviceHash + per-IP token bucket enforce it.
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
