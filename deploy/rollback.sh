#!/usr/bin/env bash
# Switches Rejista back to the previous release (or a named one) and restarts the API.
#   sudo ./deploy/rollback.sh              previous release
#   sudo ./deploy/rollback.sh 20261009-1430  a specific release from /opt/rejista/releases
# Database migrations are not undone: roll back only to releases built against the same database schema.
set -Eeuo pipefail
APP_ROOT=/opt/rejista
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo $0"; exit 1; }

current=$(readlink -f "$APP_ROOT/current")
if [[ -n ${1:-} ]]; then
  target=$APP_ROOT/releases/$1
else
  target=$(ls -1dt "$APP_ROOT"/releases/*/ | sed 's#/$##' | grep -vx "$current" | head -1 || true)
fi
[[ -n $target && -d $target ]] || { echo "No release to roll back to. Available:"; ls -1t "$APP_ROOT/releases"; exit 1; }

echo "Switching from $(basename "$current") to $(basename "$target")"
ln -sfn "$target" "$APP_ROOT/current.new" && mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
systemctl restart rejista-api
port=$(awk -F= '$1=="PORT"{print $2}' /etc/rejista/rejista.env); port=${port:-8080}
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1; then echo "API healthy on $(basename "$target")"; exit 0; fi
  sleep 2
done
echo "API did not become healthy. See: journalctl -u rejista-api -e"; exit 1
