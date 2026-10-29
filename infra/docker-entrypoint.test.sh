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
# "fail" leaves a partial file behind and exits non-zero.
# STUB_LTX: "empty" lists nothing ("[]", as 0.5.17 prints for an empty prefix),
# "data" lists an LTX file, "fail" exits non-zero (auth/region/network error).
cat >"$STUBS/litestream" <<'EOF'
#!/bin/sh
echo "litestream $*" >>"$CALLS"
for last; do :; done
case "$1" in
  restore)
    case "$STUB_RESTORE" in
      backup) echo restored >"$last" ;;
      empty) ;;
      fail) echo partial >"$last"; exit 1 ;;
    esac ;;
  ltx)
    case "${STUB_LTX:-empty}" in
      empty) echo '[]' ;;
      data) echo '[{"level":9,"min_txid":"0000000000000001","max_txid":"0000000000000007"}]' ;;
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
boot() { # boot <name> [VAR=value ...]: run the entrypoint against the current $WORK/data
  name="$1"; shift
  : >"$CALLS"
  env -i PATH="$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=backup \
    LITESTREAM_CONFIG=/etc/litestream.yml "$@" \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1 || {
      echo "not ok  $name: entrypoint exited non-zero"; cat "$WORK/out"; failures=$((failures + 1)); return 1; }
}
run() { # run <name> [VAR=value ...]: boot with an empty data dir
  rm -rf "$WORK/data"; mkdir -p "$WORK/data"
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
FULL="BUCKET_NAME=reef AWS_ENDPOINT_URL_S3=https://s3.example AWS_ACCESS_KEY_ID=k AWS_SECRET_ACCESS_KEY=s"
DB="DB_PATH=$WORK/data/reef.db"
HOLD="$WORK/data/reef.db.replication-hold"

# shellcheck disable=SC2086 # $FULL / $DB are deliberate word-split VAR=value lists
{
  run "no replica env" "$DB"
  check "logs exactly one disabled line" '[ "$(grep -c "backups disabled" "$WORK/out")" = 1 ] && [ "$(wc -l <"$WORK/out")" -eq 1 ]'
  check "runs the app directly" 'grep -qx "app --flag" "$CALLS"'
  check "never calls litestream" '! grep -q litestream "$CALLS"'

  run "partial env" BUCKET_NAME=reef AWS_ACCESS_KEY_ID=k "$DB"
  check "names the missing secrets" 'grep -q "missing: AWS_ENDPOINT_URL_S3 AWS_SECRET_ACCESS_KEY" "$WORK/out"'
  check "runs the app directly" 'grep -qx "app --flag" "$CALLS"'
  check "never calls litestream" '! grep -q litestream "$CALLS"'

  rm -rf "$WORK/data"; mkdir -p "$WORK/data"; echo original >"$WORK/data/reef.db"
  boot "existing DB" $FULL "$DB"
  check "does not restore" '! grep -q "litestream restore" "$CALLS"'
  check "leaves the DB untouched" '[ "$(cat "$WORK/data/reef.db")" = original ]'
  check "replicates around the app" 'grep -qx "litestream replicate -config /etc/litestream.yml -exec app --flag" "$CALLS"'

  run "missing DB, backup exists" $FULL "$DB"
  check "restores only if a replica exists" 'grep -qx "litestream restore -config /etc/litestream.yml -if-replica-exists $WORK/data/reef.db" "$CALLS"'
  check "restored the DB" '[ "$(cat "$WORK/data/reef.db")" = restored ]'
  check "logs the restore" 'grep -q "restored $WORK/data/reef.db" "$WORK/out"'
  check "then replicates" 'grep -q "litestream replicate" "$CALLS"'
  check "writes no hold marker" '[ ! -e "$HOLD" ]'

  run "missing DB, replica verified empty" STUB_RESTORE=empty STUB_LTX=empty $FULL "$DB"
  check "lists every LTX level before trusting 'no backup'" 'grep -qx "litestream ltx -json -level all -config /etc/litestream.yml $WORK/data/reef.db" "$CALLS"'
  check "logs a fresh start" 'grep -q "starting with a new database" "$WORK/out"'
  check "then replicates" 'grep -q "litestream replicate" "$CALLS"'
  check "writes no hold marker" '[ ! -e "$HOLD" ]'

  run "missing DB, restore found nothing but replica has data" STUB_RESTORE=empty STUB_LTX=data $FULL "$DB"
  check "writes the hold marker with a reason" 'grep -q "replica is not empty" "$HOLD"'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'

  run "missing DB, replica listing errors" STUB_RESTORE=empty STUB_LTX=fail $FULL "$DB"
  check "treats a listing error as not-empty and holds" 'grep -q "could not list" "$HOLD"'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'

  run "missing DB, restore fails" STUB_RESTORE=fail $FULL "$DB"
  check "logs the failure" 'grep -q "restore FAILED" "$WORK/out"'
  check "removes the partial DB" '[ ! -e "$WORK/data/reef.db" ]'
  check "writes a timestamped hold marker" 'grep -Eq "^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*restore failed" "$HOLD"'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'

  # Restart after that failure: the server created a fresh DB, and the replica
  # now looks fine. The marker must still hold replication off.
  echo fresh-after-failure >"$WORK/data/reef.db"
  marker_before="$(cat "$HOLD" 2>/dev/null || true)"
  boot "restart after restore failure" STUB_LTX=empty $FULL "$DB"
  check "logs that replication is held" 'grep -q "replication HELD" "$WORK/out"'
  check "names the marker to remove" 'grep -q "$HOLD" "$WORK/out"'
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'
  check "does not restore over the DB" '! grep -q "litestream restore" "$CALLS" && [ "$(cat "$WORK/data/reef.db")" = fresh-after-failure ]'
  check "keeps the original marker" '[ "$(cat "$HOLD")" = "$marker_before" ]'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'

  rm -f "$HOLD"
  boot "operator removed the marker" $FULL "$DB"
  check "replicates again" 'grep -q "litestream replicate" "$CALLS"'

  # /app isn't writable outside the image, so stub mkdir for this case.
  printf '#!/bin/sh\necho "mkdir $*" >>"$CALLS"\n' >"$WORK/mkdir-stub"
  mkdir -p "$WORK/defaults-bin" && mv "$WORK/mkdir-stub" "$WORK/defaults-bin/mkdir"
  chmod +x "$WORK/defaults-bin/mkdir"
  name="defaults"
  : >"$CALLS"
  env -i PATH="$WORK/defaults-bin:$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=empty $FULL \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1
  check "uses the server default DB path" 'grep -q "replicating /app/data/reef.db to s3://reef/reef.db" "$WORK/out"'
}

echo "$pass passed, $failures failed"
[ "$failures" -eq 0 ]
