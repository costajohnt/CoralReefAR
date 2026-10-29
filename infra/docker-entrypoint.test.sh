#!/bin/sh
# Unit tests for infra/docker-entrypoint.sh's backup logic. su-exec, timeout and
# litestream are replaced by stubs on PATH that record how they were called, so
# this runs anywhere with a POSIX sh (no Docker, no S3).
#
# Usage: sh infra/docker-entrypoint.test.sh
# shellcheck disable=SC2016,SC2034 # check() conditions are single-quoted and eval'd
set -eu

ENTRYPOINT="$(cd "$(dirname "$0")" && pwd)/docker-entrypoint.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STUBS="$WORK/bin"
mkdir -p "$STUBS"
CALLS="$WORK/calls"

cat >"$STUBS/su-exec" <<'EOF'
#!/bin/sh
shift
exec "$@"
EOF
cat >"$STUBS/timeout" <<'EOF'
#!/bin/sh
shift
exec "$@"
EOF
# STUB_RESTORE: "backup" writes the DB, "empty" writes nothing (no replica yet),
# "zero" leaves a zero-byte DB, "fail" leaves a partial file and exits non-zero.
# STUB_LTX: "empty" prints "[]" (what 0.5.17 prints for an empty bucket or
# prefix), "null" prints "null", "data" lists an LTX file, "fail" exits
# non-zero (auth/region/network error).
cat >"$STUBS/litestream" <<'EOF'
#!/bin/sh
echo "litestream $*" >>"$CALLS"
for last; do :; done
case "$1" in
  restore)
    case "$STUB_RESTORE" in
      backup) echo restored >"$last" ;;
      empty) ;;
      zero) : >"$last" ;;
      fail) echo partial >"$last"; exit 1 ;;
    esac ;;
  ltx)
    case "${STUB_LTX:-empty}" in
      empty) echo '[]' ;;
      null) echo 'null' ;;
      data) printf '[\n  {\n    "level": 9,\n    "min_txid": "0000000000000001"\n  }\n]\n' ;;
      fail) echo 'Error: operation error S3: ListObjectsV2, StatusCode: 403' >&2; exit 1 ;;
    esac ;;
esac
EOF
cat >"$STUBS/app" <<'EOF'
#!/bin/sh
echo "app $*" >>"$CALLS"
EOF
chmod +x "$STUBS"/*

pass=0
failures=0
status=0
boot() { # boot <name> [VAR=value ...]: run the entrypoint against the current $WORK/data
  name="$1"; shift
  : >"$CALLS"
  status=0
  env -i PATH="$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=backup \
    LITESTREAM_CONFIG=/etc/litestream.yml "$@" \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1 || status=$?
}
run() { # run <name> [VAR=value ...]: boot with an empty data dir
  rm -rf "$WORK/data"; mkdir -p "$WORK/data"
  boot "$@"
}
fresh_db() { rm -rf "$WORK/data"; mkdir -p "$WORK/data"; echo original >"$WORK/data/reef.db"; }
with_db() { # with_db <name> [VAR=value ...]: boot with an existing, unbound DB
  fresh_db
  boot "$@"
}
check() { # check <description> <shell condition>
  if eval "$2"; then
    pass=$((pass + 1))
  else
    echo "not ok  $name: $1"
    sed 's/^/    out: /' "$WORK/out"; sed 's/^/    call: /' "$CALLS"
    failures=$((failures + 1))
  fi
}
ok_exit() { check "entrypoint exits 0" '[ "$status" = 0 ]'; }
replicates() { check "replicates around the app" 'grep -qx "litestream replicate -config /etc/litestream.yml -exec app --flag" "$CALLS"'; }
no_replicate() {
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'
}
FULL="BUCKET_NAME=reef AWS_ENDPOINT_URL_S3=https://s3.example AWS_ACCESS_KEY_ID=k AWS_SECRET_ACCESS_KEY=s"
DB="DB_PATH=$WORK/data/reef.db"
HOLD="$WORK/data/reef.db.replication-hold"
BIND="$WORK/data/reef.db.replica-bound"
IDENTITY="s3://reef/reef.db endpoint=https://s3.example"
LISTED='grep -qx "litestream ltx -json -level all -config /etc/litestream.yml $WORK/data/reef.db" "$CALLS"'

# shellcheck disable=SC2086 # $FULL / $DB are deliberate word-split VAR=value lists
{
  run "no replica env" "$DB"
  ok_exit
  check "logs exactly one disabled line" '[ "$(grep -c "backups disabled" "$WORK/out")" = 1 ] && [ "$(wc -l <"$WORK/out")" -eq 1 ]'
  check "runs the app directly" 'grep -qx "app --flag" "$CALLS"'
  check "never calls litestream" '! grep -q litestream "$CALLS"'

  run "partial env" BUCKET_NAME=reef AWS_ACCESS_KEY_ID=k "$DB"
  ok_exit
  check "names the missing secrets" 'grep -q "missing: AWS_ENDPOINT_URL_S3 AWS_SECRET_ACCESS_KEY" "$WORK/out"'
  check "never calls litestream" '! grep -q litestream "$CALLS"'

  # --- DB present ---------------------------------------------------------

  with_db "first enable: existing DB, empty replica" STUB_LTX=empty $FULL "$DB"
  ok_exit
  check "lists the replica" "$LISTED"
  check "does not restore" '! grep -q "litestream restore" "$CALLS"'
  check "binds the DB to this replica" '[ "$(cat "$BIND")" = "$IDENTITY" ]'
  check "leaves the DB untouched" '[ "$(cat "$WORK/data/reef.db")" = original ]'
  replicates

  boot "normal restart: DB bound to this replica" STUB_LTX=fail $FULL "$DB"
  ok_exit
  check "skips the listing" '! grep -q "litestream ltx" "$CALLS"'
  replicates

  with_db "first enable, listing prints null" STUB_LTX=null $FULL "$DB"
  ok_exit
  check "treats null as empty and binds" '[ "$(cat "$BIND")" = "$IDENTITY" ]'
  replicates

  with_db "foreign replica: unbound DB, non-empty replica" STUB_LTX=data $FULL "$DB"
  ok_exit
  check "holds with an explanation" 'grep -q "not bound to this replica" "$HOLD"'
  check "prints the exact command to bind it anyway" 'grep -qF "echo '"'"'$IDENTITY'"'"' > $BIND && rm $HOLD" "$WORK/out"'
  check "logs the hold" 'grep -q "replication HELD" "$WORK/out"'
  check "does not bind" '[ ! -e "$BIND" ]'
  no_replicate

  with_db "unbound DB, listing errors" STUB_LTX=fail $FULL "$DB"
  ok_exit
  check "holds (an error is never empty)" 'grep -q "could not list" "$HOLD"'
  check "does not bind" '[ ! -e "$BIND" ]'
  no_replicate

  fresh_db
  echo "s3://old-bucket/reef.db endpoint=https://s3.example" >"$BIND"
  boot "mismatched identity: bucket changed" STUB_LTX=data $FULL "$DB"
  ok_exit
  check "lists the new replica" "$LISTED"
  check "holds" 'grep -q "not bound to this replica" "$HOLD"'
  no_replicate

  fresh_db
  echo "s3://reef/reef.db endpoint=https://other.example" >"$BIND"
  boot "mismatched identity, new bucket empty" STUB_LTX=empty $FULL "$DB"
  ok_exit
  check "rebinds to the new replica" '[ "$(cat "$BIND")" = "$IDENTITY" ]'
  replicates

  # --- DB missing ---------------------------------------------------------

  run "missing DB, backup exists" $FULL "$DB"
  ok_exit
  check "restores only if a replica exists" 'grep -qx "litestream restore -config /etc/litestream.yml -if-replica-exists $WORK/data/reef.db" "$CALLS"'
  check "restored the DB" '[ "$(cat "$WORK/data/reef.db")" = restored ]'
  check "binds after restoring" '[ "$(cat "$BIND")" = "$IDENTITY" ]'
  check "writes no hold marker" '[ ! -e "$HOLD" ]'
  replicates

  run "missing DB, replica verified empty" STUB_RESTORE=empty STUB_LTX=empty $FULL "$DB"
  ok_exit
  check "lists every LTX level before trusting 'no backup'" "$LISTED"
  check "logs a fresh start" 'grep -q "starting with a new database" "$WORK/out"'
  check "binds" '[ "$(cat "$BIND")" = "$IDENTITY" ]'
  replicates

  run "missing DB, restore leaves a zero-byte DB, replica not empty" STUB_RESTORE=zero STUB_LTX=data $FULL "$DB"
  ok_exit
  check "treats it as not restored and lists" "$LISTED"
  check "removes the zero-byte DB" '[ ! -e "$WORK/data/reef.db" ]'
  check "holds" 'grep -q "replica is not empty" "$HOLD"'
  no_replicate

  run "missing DB, restore found nothing but replica has data" STUB_RESTORE=empty STUB_LTX=data $FULL "$DB"
  ok_exit
  check "holds with a reason" 'grep -q "replica is not empty" "$HOLD"'
  no_replicate

  run "missing DB, replica listing errors" STUB_RESTORE=empty STUB_LTX=fail $FULL "$DB"
  ok_exit
  check "holds (an error is never empty)" 'grep -q "could not list" "$HOLD"'
  no_replicate

  run "missing DB, restore fails" STUB_RESTORE=fail $FULL "$DB"
  ok_exit
  check "logs the failure" 'grep -q "restore FAILED" "$WORK/out"'
  check "removes the partial DB" '[ ! -e "$WORK/data/reef.db" ]'
  check "writes a timestamped hold marker" 'grep -Eq "^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*restore failed" "$HOLD"'
  no_replicate

  # Restart after that failure: the server created a fresh DB, and the replica
  # now looks fine. The marker must still hold replication off.
  echo fresh-after-failure >"$WORK/data/reef.db"
  marker_before="$(cat "$HOLD" 2>/dev/null || true)"
  boot "restart after restore failure" STUB_LTX=empty $FULL "$DB"
  ok_exit
  check "logs that replication is held" 'grep -q "replication HELD" "$WORK/out"'
  check "names the marker to remove" 'grep -q "$HOLD" "$WORK/out"'
  check "neither restores nor lists" '! grep -q "litestream" "$CALLS"'
  check "keeps the DB and the original marker" '[ "$(cat "$WORK/data/reef.db")" = fresh-after-failure ] && [ "$(cat "$HOLD")" = "$marker_before" ]'
  no_replicate

  # --- marker writes fail: refuse to boot rather than run unprotected ------

  # The DB's parent is a regular file, so nothing under it can be created (not
  # even by root): the restore fails, then writing the hold marker fails.
  echo not-a-dir >"$WORK/afile"
  boot "hold marker write fails" $FULL DB_PATH="$WORK/afile/reef.db"
  check "exits non-zero" '[ "$status" != 0 ]'
  check "says why" 'grep -q "could not write" "$WORK/out"'
  check "never runs the app" '! grep -q "^app" "$CALLS"'
  check "never replicates" '! grep -q "litestream replicate" "$CALLS"'

  fresh_db
  mkdir "$BIND"   # directory in the way of the binding file
  boot "binding write fails" STUB_LTX=empty $FULL "$DB"
  check "exits non-zero" '[ "$status" != 0 ]'
  check "says why" 'grep -q "could not write" "$WORK/out"'
  check "never runs the app" '! grep -q "^app" "$CALLS"'
  check "never replicates" '! grep -q "litestream replicate" "$CALLS"'

  # /app isn't writable outside the image, so stub mkdir for this case.
  printf '#!/bin/sh\necho "mkdir $*" >>"$CALLS"\n' >"$WORK/mkdir-stub"
  mkdir -p "$WORK/defaults-bin" && mv "$WORK/mkdir-stub" "$WORK/defaults-bin/mkdir"
  chmod +x "$WORK/defaults-bin/mkdir"
  name="defaults"
  : >"$CALLS"
  env -i PATH="$WORK/defaults-bin:$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=backup $FULL \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1 || true
  check "uses the server default DB path" 'grep -q "no database at /app/data/reef.db" "$WORK/out"'
}

echo "$pass passed, $failures failed"
[ "$failures" -eq 0 ]
