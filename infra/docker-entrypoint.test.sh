#!/bin/sh
# Unit tests for infra/docker-entrypoint.sh's backup logic. su-exec, timeout and
# litestream are replaced by stubs on PATH that record how they were called, so
# this runs anywhere with a POSIX sh (no Docker, no S3).
#
# Usage: sh infra/docker-entrypoint.test.sh
# shellcheck disable=SC2016 # check() conditions are single-quoted for eval
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
cat >"$STUBS/litestream" <<'EOF'
#!/bin/sh
echo "litestream $*" >>"$CALLS"
if [ "$1" = restore ]; then
  for last; do :; done
  case "$STUB_RESTORE" in
    backup) echo restored >"$last" ;;
    empty) ;;
    fail) echo partial >"$last"; exit 1 ;;
  esac
fi
EOF
cat >"$STUBS/app" <<'EOF'
#!/bin/sh
echo "app $*" >>"$CALLS"
EOF
chmod +x "$STUBS"/*

pass=0
failures=0
run() { # run <name> [VAR=value ...]; entrypoint output goes to $WORK/out
  name="$1"; shift
  : >"$CALLS"
  rm -rf "$WORK/data"; mkdir -p "$WORK/data"
  env -i PATH="$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=backup \
    LITESTREAM_CONFIG=/etc/litestream.yml "$@" \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1 || {
      echo "not ok  $name: entrypoint exited non-zero"; cat "$WORK/out"; failures=$((failures + 1)); return 1; }
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

  name="existing DB"
  : >"$CALLS"; rm -rf "$WORK/data"; mkdir -p "$WORK/data"; echo original >"$WORK/data/reef.db"
  env -i PATH="$STUBS:/usr/bin:/bin" CALLS="$CALLS" STUB_RESTORE=backup $FULL "$DB" \
    sh "$ENTRYPOINT" app --flag >"$WORK/out" 2>&1
  check "does not restore" '! grep -q "litestream restore" "$CALLS"'
  check "leaves the DB untouched" '[ "$(cat "$WORK/data/reef.db")" = original ]'
  check "replicates around the app" 'grep -qx "litestream replicate -config /etc/litestream.yml -exec app --flag" "$CALLS"'

  run "missing DB, backup exists" $FULL "$DB"
  check "restores only if a replica exists" 'grep -qx "litestream restore -config /etc/litestream.yml -if-replica-exists $WORK/data/reef.db" "$CALLS"'
  check "restored the DB" '[ "$(cat "$WORK/data/reef.db")" = restored ]'
  check "logs the restore" 'grep -q "restored $WORK/data/reef.db" "$WORK/out"'
  check "then replicates" 'grep -q "litestream replicate" "$CALLS"'

  run "missing DB, empty replica" STUB_RESTORE=empty $FULL "$DB"
  check "logs a fresh start" 'grep -q "starting with a new database" "$WORK/out"'
  check "then replicates" 'grep -q "litestream replicate" "$CALLS"'

  run "missing DB, restore fails" STUB_RESTORE=fail $FULL "$DB"
  check "logs the failure" 'grep -q "restore FAILED" "$WORK/out"'
  check "removes the partial DB" '[ ! -e "$WORK/data/reef.db" ]'
  check "still runs the app" 'grep -qx "app --flag" "$CALLS"'
  check "does not replicate" '! grep -q "litestream replicate" "$CALLS"'

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
