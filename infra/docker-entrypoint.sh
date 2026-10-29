#!/bin/sh
set -e

# /data is a Fly volume mounted at runtime, owned by root. Make it writable by
# the unprivileged "reef" user before dropping privileges, so the server can
# write the SQLite DB without running as root. No-op when there's no volume
# (e.g. CI / plain `docker run`), where the DB lives under the already
# reef-owned /app. Only recurse when the volume isn't already reef-owned, so
# the cost is paid once on first boot rather than on every (auto-stop) start.
if [ -d /data ] && [ "$(stat -c '%U' /data)" != "reef" ]; then
  chown -R reef:reef /data
fi

log() { echo "[entrypoint] $*" >&2; }

# Off-machine backups via Litestream (docs/runbook.md, "Backups"). Enabled only
# when the S3-compatible replica is fully configured; the variable names are the
# secrets `fly storage create` (Tigris) sets on the app. Otherwise the server
# starts exactly as it would without Litestream.
if [ -z "${BUCKET_NAME:-}" ]; then
  log "backups disabled: no Litestream replica configured (BUCKET_NAME unset)"
  exec su-exec reef:reef "$@"
fi
missing=""
[ -n "${AWS_ENDPOINT_URL_S3:-}" ] || missing="$missing AWS_ENDPOINT_URL_S3"
[ -n "${AWS_ACCESS_KEY_ID:-}" ] || missing="$missing AWS_ACCESS_KEY_ID"
[ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || missing="$missing AWS_SECRET_ACCESS_KEY"
if [ -n "$missing" ]; then
  log "backups disabled: BUCKET_NAME is set but missing:$missing"
  exec su-exec reef:reef "$@"
fi

LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"
# Litestream needs an absolute path; this matches the server's own default
# (./data/reef.db relative to WORKDIR /app) so both always agree.
export DB_PATH="${DB_PATH:-/app/data/reef.db}"
export AWS_REGION="${AWS_REGION:-auto}"
replica="s3://$BUCKET_NAME/reef.db" # replica path is fixed in litestream.yml

# Restore only when there is no local database. Never overwrite an existing DB:
# once it exists, the local file is the source of truth.
if [ ! -e "$DB_PATH" ]; then
  log "no database at $DB_PATH; restoring from $replica if a backup exists"
  # Best effort: if the directory can't be created, restore fails below and the
  # server starts (or fails) exactly as it would without backups.
  su-exec reef:reef mkdir -p "$(dirname "$DB_PATH")" || true
  if ! su-exec reef:reef timeout "${LITESTREAM_RESTORE_TIMEOUT:-300}" \
      litestream restore -config "$LITESTREAM_CONFIG" -if-replica-exists "$DB_PATH"; then
    # Don't block startup on the replica, but don't replicate either: a fresh
    # empty DB must not be pushed over a replica we just failed to read.
    log "restore FAILED; starting WITHOUT replication so $replica is left untouched. Fix the replica and restart."
    rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
    exec su-exec reef:reef "$@"
  fi
  if [ -e "$DB_PATH" ]; then
    log "restored $DB_PATH from $replica"
  else
    log "no backup in $replica yet; starting with a new database"
  fi
fi

log "backups enabled: replicating $DB_PATH to $replica"
# Litestream supervises the server: it forwards signals, does a final sync on
# shutdown, and exits with the server's exit code.
exec su-exec reef:reef litestream replicate -config "$LITESTREAM_CONFIG" -exec "$*"
