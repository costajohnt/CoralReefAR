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

exec su-exec reef:reef "$@"
