#!/bin/sh
# End-to-end backup/restore check for the server image against a throwaway
# local S3 server (versitygw). Proves, with the real image and Litestream:
#   1. a running server replicates its DB to the bucket;
#   2. a fresh volume restores that DB on boot (the disaster-recovery path);
#   3. an unreachable replica never blocks startup, with or without a local DB.
#
# Usage: sh infra/litestream-smoke.sh [image]   (default: reef-server:ci)
set -eu

IMAGE="${1:-reef-server:ci}"
GW_IMAGE="versity/versitygw:v1.8.0"
P="reefbk$$"
NET="$P-net"
ENVS="-e BUCKET_NAME=reef -e AWS_ENDPOINT_URL_S3=http://$P-gw:7070
  -e AWS_ACCESS_KEY_ID=testkey -e AWS_SECRET_ACCESS_KEY=testsecret
  -e AWS_REGION=us-east-1 -e DB_PATH=/data/reef.db"

cleanup() {
  docker rm -f "$P-gw" "$P-a" "$P-b" "$P-c" "$P-d" >/dev/null 2>&1 || true
  docker volume rm "$P-va" "$P-vb" "$P-vc" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; for c in a b c d; do docker logs "$P-$c" 2>&1 | grep -v '^{' | tail -20 || true; done; exit 1; }

wait_healthy() {
  for _ in $(seq 1 30); do
    if docker exec "$1" wget -qO- http://127.0.0.1:8787/healthz >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "$1 /healthz never came up"
}

docker network create "$NET" >/dev/null
docker run -d --name "$P-gw" --network "$NET" \
  -e ROOT_ACCESS_KEY=testkey -e ROOT_SECRET_KEY=testsecret \
  --entrypoint sh "$GW_IMAGE" -c 'mkdir -p /gw/reef && exec versitygw posix /gw' >/dev/null

echo "== 1. replicate"
# shellcheck disable=SC2086 # ENVS is a deliberate word-split list of -e flags
docker run -d --name "$P-a" --network "$NET" $ENVS -v "$P-va:/data" "$IMAGE" >/dev/null
wait_healthy "$P-a"
docker logs "$P-a" 2>&1 | grep -q 'backups enabled' || fail "a: no 'backups enabled' log"
docker exec -u reef "$P-a" sqlite3 /data/reef.db \
  "CREATE TABLE backup_probe(v); INSERT INTO backup_probe VALUES('marker-$P');"
sleep 5
docker stop "$P-a" >/dev/null # SIGTERM: Litestream does a final sync on exit
echo "ok  server A replicated"

echo "== 2. restore into an empty volume"
# shellcheck disable=SC2086
docker run -d --name "$P-b" --network "$NET" $ENVS -v "$P-vb:/data" "$IMAGE" >/dev/null
wait_healthy "$P-b"
docker logs "$P-b" 2>&1 | grep -q 'restored /data/reef.db' || fail "b: no 'restored' log"
got=$(docker exec -u reef "$P-b" sqlite3 /data/reef.db "SELECT v FROM backup_probe;")
[ "$got" = "marker-$P" ] || fail "b: restored marker was '$got'"
owner=$(docker exec "$P-b" stat -c %U /data/reef.db)
[ "$owner" = "reef" ] || fail "b: restored DB owned by '$owner'"
echo "ok  server B restored marker-$P (owner $owner)"

echo "== 3. unreachable replica does not block startup"
docker run -d --name "$P-c" --network "$NET" -e BUCKET_NAME=reef \
  -e AWS_ENDPOINT_URL_S3=http://nonexistent.invalid:7070 -e AWS_ACCESS_KEY_ID=x \
  -e AWS_SECRET_ACCESS_KEY=y -e DB_PATH=/data/reef.db -e LITESTREAM_RESTORE_TIMEOUT=15 \
  -v "$P-vc:/data" "$IMAGE" >/dev/null
for _ in $(seq 1 45); do
  docker logs "$P-c" 2>&1 | grep -q 'restore FAILED' && break
  sleep 1
done
docker logs "$P-c" 2>&1 | grep -q 'restore FAILED' || fail "c: no 'restore FAILED' log"
wait_healthy "$P-c"
echo "ok  server C came up without replication"
docker rm -f "$P-c" >/dev/null

# Same dead replica, but the volume now holds a DB: replication starts (and
# retries in the background) while the server itself must still come up.
docker run -d --name "$P-d" --network "$NET" -e BUCKET_NAME=reef \
  -e AWS_ENDPOINT_URL_S3=http://nonexistent.invalid:7070 -e AWS_ACCESS_KEY_ID=x \
  -e AWS_SECRET_ACCESS_KEY=y -e DB_PATH=/data/reef.db \
  -v "$P-vc:/data" "$IMAGE" >/dev/null
wait_healthy "$P-d"
docker logs "$P-d" 2>&1 | grep -q 'backups enabled' || fail "d: no 'backups enabled' log"
echo "ok  server D (existing DB, dead replica) came up"

echo "PASS litestream smoke"
