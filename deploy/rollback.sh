#!/usr/bin/env bash
# Switches Rejista back to the previous release (or a named one) and restarts the API.
#   sudo ./deploy/rollback.sh              previous release
#   sudo ./deploy/rollback.sh 20261009-1430  a specific release from /opt/rejista/releases
# Database migrations are not undone: roll back only to releases built against the same database schema.
set -Eeuo pipefail
APP_ROOT=/opt/rejista
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo $0"; exit 1; }
exec 9>/run/lock/rejista-deploy.lock
flock -n 9 || { echo "Another deployment or rollback is running."; exit 1; }
[[ ${1:-} == --schema-compatible ]] || { echo "Verify the current database schema supports the target release, then use --schema-compatible [release]. Database/configuration rollback is not automatic."; exit 1; }
shift
[[ -f /etc/rejista/installer-owned && ! -e /etc/rejista/deploy-in-progress ]] || { echo "Unmanaged or interrupted installation: resolve recovery first."; exit 1; }
. "$(dirname "${BASH_SOURCE[0]}")/host-safety.sh"

current=$(readlink -f "$APP_ROOT/current")
if [[ -n ${1:-} ]]; then
  [[ $1 =~ ^[A-Za-z0-9-]+$ ]] || { echo "Invalid release name."; exit 1; }
  target=$APP_ROOT/releases/$1
else
  target=$(ls -1dt "$APP_ROOT"/releases/*/ | sed 's#/$##' | grep -vx "$current" | head -1 || true)
fi
[[ -n $target && -d $target ]] || { echo "No release to roll back to. Available:"; ls -1t "$APP_ROOT/releases"; exit 1; }
[[ ! -L $target && $(readlink -f "$target") == "$APP_ROOT"/releases/* && -f $target/artifacts/api-server/dist/index.mjs ]] || { echo "Invalid release target."; exit 1; }
port=$(awk -F= '$1=="PORT"{print $2}' /etc/rejista/rejista.env); port=${port:-8080}
listeners=$(port_listeners "$port")
[[ -z $listeners ]] || own_listeners "$listeners" || { echo "Port belongs to another service. Run installer to select a new port."; exit 1; }
restore() { ln -sfn "$current" "$APP_ROOT/current"; systemctl restart rejista-api || true; }
trap restore ERR

echo "Switching from $(basename "$current") to $(basename "$target")"
ln -sfn "$target" "$APP_ROOT/current.new" && mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
systemctl restart rejista-api
port=$(awk -F= '$1=="PORT"{print $2}' /etc/rejista/rejista.env); port=${port:-8080}
for _ in $(seq 1 30); do
  if systemctl is-active --quiet rejista-api && own_listeners "$(port_listeners "$port")" && curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1; then echo "API healthy on $(basename "$target")"; exit 0; fi
  sleep 2
done
restore
echo "Target release failed; previous code restored. See: journalctl -u rejista-api -e"; exit 1
