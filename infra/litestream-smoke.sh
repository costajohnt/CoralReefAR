#!/bin/sh
# End-to-end backup/restore check for the server image against a throwaway
# local S3 server (versitygw). Proves, with the real image and Litestream:
#   1. first enable: a DB created with backups off binds to an empty bucket
#      and replicates;
#   2. a fresh volume restores that DB on boot (the disaster-recovery path),
#      and a normal restart of it keeps replicating;
#   3. foreign replica: a DB created with backups off is NOT replicated over a
#      bucket that already holds data (held), the bucket still restores the
#      original data, and the override command the log prints resumes it;
#   4. a fresh volume on an empty bucket verifies it's empty, then replicates;
#   5. an unreachable replica never blocks startup, a failed restore leaves a
#      sticky hold marker, and a restart stays held once the replica is back;
#   6. a bound DB with a dead replica still starts, replicating.
#
# Usage: sh infra/litestream-smoke.sh [image]   (default: reef-server:ci)
set -eu

IMAGE="${1:-reef-server:ci}"
GW_IMAGE="versity/versitygw:v1.8.0"
P="reefbk$$"
NET="$P-net"
GW="http://$P-gw:7070"
DEAD="http://nonexistent.invalid:7070"

cleanup() {
  docker ps -aq --filter "name=^$P-" | xargs docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=^$P-" | xargs docker volume rm >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*" >&2
  for c in $(docker ps -aq --filter "name=^$P-"); do
    echo "--- $(docker inspect -f '{{.Name}}' "$c")" >&2
    docker logs "$c" 2>&1 | grep -v '^{' | tail -15 >&2 || true
  done
  exit 1
}

# start <name> <volume> [bucket endpoint]: run the server; with a bucket, backups on.
start() {
  name="$P-$1"; vol="$P-$2"
  if [ $# -ge 4 ]; then
    docker run -d --name "$name" --network "$NET" -v "$vol:/data" -e DB_PATH=/data/reef.db \
      -e BUCKET_NAME="$3" -e AWS_ENDPOINT_URL_S3="$4" -e AWS_ACCESS_KEY_ID=testkey \
      -e AWS_SECRET_ACCESS_KEY=testsecret -e AWS_REGION=us-east-1 \
      -e LITESTREAM_RESTORE_TIMEOUT=15 "$IMAGE" >/dev/null
  else
    docker run -d --name "$name" --network "$NET" -v "$vol:/data" -e DB_PATH=/data/reef.db \
      "$IMAGE" >/dev/null
  fi
}
wait_healthy() {
  for _ in $(seq 1 45); do
    if docker exec "$P-$1" wget -qO- http://127.0.0.1:8787/healthz >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "$1 /healthz never came up"
}
logs_have() { docker logs "$P-$1" 2>&1 | grep -q "$2"; }
replicating() { docker exec "$P-$1" ps -o args | grep -q '^litestream replicate'; }
# latest_probe <bucket>: what a plain restore of the bucket returns for backup_probe.
latest_probe() {
  docker run --rm --network "$NET" -e AWS_ACCESS_KEY_ID=testkey -e AWS_SECRET_ACCESS_KEY=testsecret \
    --entrypoint sh "$IMAGE" -c "litestream restore -o /tmp/r.db 's3://$1/reef.db?endpoint=$GW&region=us-east-1' >/dev/null 2>&1 \
      && sqlite3 /tmp/r.db 'SELECT v FROM backup_probe;' 2>&1"
}

docker network create "$NET" >/dev/null
docker run -d --name "$P-gw" --network "$NET" \
  -e ROOT_ACCESS_KEY=testkey -e ROOT_SECRET_KEY=testsecret \
  --entrypoint sh "$GW_IMAGE" -c 'mkdir -p /gw/reef /gw/reef2 && exec versitygw posix /gw' >/dev/null

echo "== 1. first enable: existing DB, empty bucket"
start a0 va
wait_healthy a0
docker exec -u reef "$P-a0" sqlite3 /data/reef.db \
  "CREATE TABLE backup_probe(v); INSERT INTO backup_probe VALUES('marker-$P');"
docker rm -f "$P-a0" >/dev/null
start a va reef "$GW"
wait_healthy a
logs_have a 'binding it (first enable)' || fail "a: did not bind on first enable"
replicating a || fail "a: litestream is not running"
docker exec "$P-a" grep -q "s3://reef/reef.db" /data/reef.db.replica-bound || fail "a: no binding file"
sleep 5
docker stop "$P-a" >/dev/null # SIGTERM: Litestream does a final sync on exit
echo "ok  existing DB bound to the empty bucket and replicated"

echo "== 2. restore into an empty volume, then a normal restart"
start b vb reef "$GW"
wait_healthy b
logs_have b 'restored /data/reef.db' || fail "b: no 'restored' log"
got=$(docker exec -u reef "$P-b" sqlite3 /data/reef.db "SELECT v FROM backup_probe;")
[ "$got" = "marker-$P" ] || fail "b: restored marker was '$got'"
owner=$(docker exec "$P-b" stat -c %U /data/reef.db)
[ "$owner" = "reef" ] || fail "b: restored DB owned by '$owner'"
replicating b || fail "b: litestream is not running after restore"
echo "ok  restored marker-$P (owner $owner) and replicating"
docker restart "$P-b" >/dev/null
wait_healthy b
replicating b || fail "b: litestream is not running after a normal restart"
logs_have b 'replication HELD' && fail "b: normal restart was held"
echo "ok  normal restart of the bound DB keeps replicating"
docker stop "$P-b" >/dev/null

echo "== 3. foreign replica: DB created with backups off, bucket already has data"
start f0 vf
wait_healthy f0
docker rm -f "$P-f0" >/dev/null
start f vf reef "$GW"
wait_healthy f
logs_have f 'replication HELD' || fail "f: not held"
docker exec "$P-f" grep -q 'not bound to this replica' /data/reef.db.replication-hold || fail "f: no hold marker"
replicating f && fail "f: litestream is running over a foreign replica"
got=$(latest_probe reef)
[ "$got" = "marker-$P" ] || fail "f: bucket's latest restore changed to '$got'"
echo "ok  held, and the bucket still restores marker-$P"
# The operator override the hold log prints ("local DB is the truth"):
override=$(docker logs "$P-f" 2>&1 | sed -n 's/.*(copy the replica first): \(.*\), then restart$/\1/p' | tail -1)
[ -n "$override" ] || fail "f: no override command in the log"
docker exec "$P-f" sh -c "$override"
docker restart "$P-f" >/dev/null
wait_healthy f
replicating f || fail "f: not replicating after the logged override"
echo "ok  the logged override binds the local DB and replication resumes"
docker rm -f "$P-f" >/dev/null

echo "== 4. fresh volume, empty bucket"
start g vg reef2 "$GW"
wait_healthy g
logs_have g 'verified empty' || fail "g: empty bucket not verified empty"
replicating g || fail "g: litestream is not running"
echo "ok  verified empty, bound and replicating"
docker rm -f "$P-g" >/dev/null

echo "== 5. unreachable replica, then a restart with it reachable"
start c vc reef "$DEAD"
for _ in $(seq 1 45); do logs_have c 'restore FAILED' && break; sleep 1; done
logs_have c 'restore FAILED' || fail "c: no 'restore FAILED' log"
wait_healthy c
replicating c && fail "c: litestream is running after a failed restore"
docker exec "$P-c" grep -q 'restore failed' /data/reef.db.replication-hold || fail "c: no hold marker"
docker stop "$P-c" >/dev/null
start e vc reef "$GW"
wait_healthy e
logs_have e 'replication HELD' || fail "e: no 'replication HELD' log"
replicating e && fail "e: litestream is running despite the hold marker"
logs_have e 'no database at' && fail "e: tried to restore over an existing DB"
echo "ok  failed restore held, and the restart stayed held"
docker rm -f "$P-e" >/dev/null

echo "== 6. bound DB, replica down"
docker stop "$P-gw" >/dev/null
start d vb reef "$GW"
wait_healthy d
replicating d || fail "d: litestream is not running"
echo "ok  bound DB with a dead replica came up replicating"

echo "PASS litestream smoke"
