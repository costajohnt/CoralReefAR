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
# Canonical endpoint for comparing bindings: scheme defaults to https, scheme
# and host are lowercased, trailing slashes are dropped. Litestream itself still
# gets AWS_ENDPOINT_URL_S3 exactly as set.
normalize_endpoint() {
  ep="$1"
  case "$ep" in
    *://*) scheme="${ep%%://*}"; rest="${ep#*://}" ;;
    *) scheme=https; rest="$ep" ;;
  esac
  host="${rest%%/*}"
  path="${rest#"$host"}"
  while [ "${path%/}" != "$path" ]; do path="${path%/}"; done
  printf '%s://%s%s\n' "$(echo "$scheme" | tr '[:upper:]' '[:lower:]')" \
    "$(echo "$host" | tr '[:upper:]' '[:lower:]')" "$path"
}
# normalize_identity "<replica> endpoint=<endpoint>"
normalize_identity() { echo "${1%% endpoint=*} endpoint=$(normalize_endpoint "${1#* endpoint=}")"; }
identity="$(normalize_identity "$replica endpoint=$AWS_ENDPOINT_URL_S3")"
restore_timeout="${LITESTREAM_RESTORE_TIMEOUT:-300}"

# Litestream 0.5 treats whatever local DB it replicates as the next state of the
# history already in the replica: replicating the wrong DB makes it the latest
# backup and the real one ages out under retention. So the local DB is only
# replicated once it is BOUND to this replica (docs/runbook.md, "Replica
# binding"): restored from it, or confirmed to be first in an empty replica.
#
# $BIND_FILE records the replica the DB is bound to. $HOLD_FILE is the sticky
# "don't replicate" marker written whenever a boot can't prove replication is
# safe; while it exists every boot runs the server WITHOUT replication, until
# an operator removes it. If either file can't be written the container exits
# rather than run unprotected.
BIND_FILE="$DB_PATH.replica-bound"
HOLD_FILE="$DB_PATH.replication-hold"

run_without_replication() {
  log "replication HELD: $(cat "$HOLD_FILE" 2>/dev/null || echo "marker unreadable")"
  log "the server runs WITHOUT backups until $HOLD_FILE is removed (see docs/runbook.md, \"Replication held\")"
  log "to make THIS local DB the latest backup instead (copy the replica first): echo '$identity' > $BIND_FILE && rm $HOLD_FILE, then restart"
  exec su-exec reef:reef "$@"
}
hold() { # hold <reason> <server command...>
  reason="$1"; shift
  if ! echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $reason" >"$HOLD_FILE"; then
    log "could not write $HOLD_FILE (reason: $reason); refusing to start unprotected"
    exit 1
  fi
  run_without_replication "$@"
}
bind() {
  if ! echo "$identity" >"$BIND_FILE"; then
    log "could not write $BIND_FILE; refusing to start"
    exit 1
  fi
}
# Prints "empty", "data" or "error". Empty only when the listing of every LTX
# level succeeds and is empty; 0.5.17 prints [] for an empty bucket or prefix
# ("null" is accepted too). A listing error (auth, region, network, missing
# bucket) is never "empty".
replica_state() {
  if ! listing="$(su-exec reef:reef timeout "$restore_timeout" \
      litestream ltx -json -level all -config "$LITESTREAM_CONFIG" "$DB_PATH")"; then
    echo error
    return
  fi
  case "$listing" in
    "[]" | null) echo empty ;;
    *) echo data ;;
  esac
}

if [ -e "$HOLD_FILE" ]; then
  run_without_replication "$@"
fi

if [ -e "$DB_PATH" ]; then
  # Never overwrite an existing DB. Replicate it only if it's bound to this
  # replica; an unbound DB binds only to an empty replica (first enable). A
  # binding to a different replica is never switched automatically.
  if [ ! -s "$DB_PATH" ]; then
    hold "local DB $DB_PATH is zero bytes (its data may be only in the WAL, or it is a bad copy); refusing to replicate it" "$@"
  fi
  if [ -e "$BIND_FILE" ]; then
    bound="$(normalize_identity "$(cat "$BIND_FILE")")"
    if [ "$bound" != "$identity" ]; then
      hold "local DB is bound to $bound, configured $identity; refusing to switch replicas automatically; see docs/runbook.md \"Replica binding\"" "$@"
    fi
  else
    case "$(replica_state)" in
      empty)
        log "local DB not yet bound and $replica is empty; binding it (first enable)"
        bind ;;
      data) hold "local DB not bound to this replica and $replica already holds data; see docs/runbook.md \"Replica binding\"" "$@" ;;
      *) hold "local DB not bound to this replica and could not list $replica to confirm it is empty" "$@" ;;
    esac
  fi
else
  log "no database at $DB_PATH; restoring from $replica if a backup exists"
  # Best effort: if the directory can't be created, restore fails below.
  su-exec reef:reef mkdir -p "$(dirname "$DB_PATH")" || true
  if ! su-exec reef:reef timeout "$restore_timeout" \
      litestream restore -config "$LITESTREAM_CONFIG" -if-replica-exists "$DB_PATH"; then
    # Don't block startup on the replica, but don't replicate either: a fresh
    # empty DB must not be pushed over a replica we just failed to read.
    log "restore FAILED; starting WITHOUT replication so $replica is left untouched"
    rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" || true
    hold "restore failed from $replica; the server started on a new empty DB" "$@"
  fi
  if [ -s "$DB_PATH" ]; then
    log "restored $DB_PATH from $replica"
    bind
  else
    # No DB, or a zero-byte one: not restored. Trust "no backup" only if the
    # replica is provably empty.
    rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" || true
    case "$(replica_state)" in
      empty)
        log "no backup in $replica (verified empty); starting with a new database"
        bind ;;
      data) hold "restore found no backup but the replica is not empty: $replica" "$@" ;;
      *) hold "could not list $replica to confirm it is empty" "$@" ;;
    esac
  fi
fi

log "backups enabled: replicating $DB_PATH to $replica"
# Litestream supervises the server: it forwards signals, does a final sync on
# shutdown, and exits with the server's exit code. -exec takes ONE string that
# Litestream re-splits shell-style, so "$*" joins the arguments with spaces and
# their original quoting is lost: the server command (Dockerfile CMD) must not
# contain an argument with spaces or quotes. Today's CMD doesn't.
exec su-exec reef:reef litestream replicate -config "$LITESTREAM_CONFIG" -exec "$*"
