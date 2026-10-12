#!/usr/bin/env bash
# These checks fail closed. A process name alone is never proof of ownership.
port_listeners() { ss -H -ltnp "sport = :$1"; }
rejista_pid() {
  local pid=$1 uid cwd
  [[ $pid =~ ^[0-9]+$ && -r /proc/$pid/status ]] || return 1
  uid=$(awk '/^Uid:/ {print $2}' "/proc/$pid/status")
  [[ $uid == "$(id -u rejista)" ]] || return 1
  cwd=$(readlink -f "/proc/$pid/cwd") || return 1
  [[ $cwd == /opt/rejista/releases/*/artifacts/api-server ]] || return 1
  grep -qE '(^|/)rejista-api\.service$' "/proc/$pid/cgroup"
}
own_listeners() {
  local text=$1 pid pids row
  [[ -n $text ]] || return 1
  while IFS= read -r row; do
    pids=$(grep -oE 'pid=[0-9]+' <<< "$row" | cut -d= -f2 | sort -u) || return 1
    [[ -n $pids ]] || return 1
    while read -r pid; do rejista_pid "$pid" || return 1; done <<< "$pids"
  done <<< "$text"
}
select_api_port() {
  local port=$1 text
  [[ $port =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || return 1
  while (( port <= 65535 )); do
    text=$(port_listeners "$port") || return 1
    if [[ -z $text ]] || own_listeners "$text"; then echo "$port"; return; fi
    ((port+=1))
  done
  echo "No free API port available." >&2; return 1
}
stop_owned_port() {
  local text
  text=$(port_listeners "$1") || return 1
  [[ -n $text ]] || return 0
  own_listeners "$text" || { echo "Port ownership changed; refusing to stop another application." >&2; return 1; }
  # systemd stops/kills only this unit, including its verified processes.
  systemctl stop rejista-api
  [[ -z $(port_listeners "$1") ]]
}

host_preflight() {
  local tool path config managed=0
  for tool in flock ss pgrep sudo rsync openssl curl nginx node pnpm python3; do
    command -v "$tool" >/dev/null || die "Missing $tool. Install required tools explicitly; shared packages are never changed automatically."
  done
  if [[ $LOCAL_DB == 0 ]]; then
    command -v pg_restore >/dev/null || die "pg_restore is required to check backup archives."
  fi
  if [[ -f $ENV_DIR/installer-owned && ! -L $ENV_DIR/installer-owned && $(stat -c %u "$ENV_DIR/installer-owned") == 0 ]]; then
    managed=1
  elif [[ ${ADOPT_EXISTING:-0} == 1 ]]; then
    [[ -f $ENV_FILE && ! -L $ENV_FILE && $(stat -c %u "$ENV_FILE") == 0 ]] || die "Cannot adopt: root-owned settings missing."
    [[ $(getent passwd rejista | cut -d: -f6) == "$APP_ROOT" && $(id -u rejista) != 0 ]] || die "Cannot adopt: system account does not match."
    [[ -L $APP_ROOT/current && $(readlink -f "$APP_ROOT/current") == "$APP_ROOT"/releases/* ]] || die "Cannot adopt: no valid existing release."
    grep -Fxq "WorkingDirectory=$APP_ROOT/current/artifacts/api-server" /etc/systemd/system/rejista-api.service || die "Cannot adopt: unit does not match Rejista."
    grep -Fxq 'User=rejista' /etc/systemd/system/rejista-api.service || die "Cannot adopt: service owner mismatch."
    managed=1
  fi
  [[ $(node -p 'process.versions.node.split(".")[0]') -ge $NODE_MAJOR ]] || die "Node $NODE_MAJOR+ required. Shared Node was not modified."
  [[ $(pnpm -v) == "$PNPM_VERSION" ]] || die "pnpm $PNPM_VERSION required. Shared pnpm was not modified."
  systemctl is-active --quiet nginx || die "nginx must already be running; it will not be started automatically."
  local webport webtext webpid
  for webport in 80 $([[ $SSL == 1 ]] && echo 443); do
    webtext=$(port_listeners "$webport") || die "Cannot inspect web ports."
    if [[ -n $webtext ]]; then
      while IFS= read -r row; do
        [[ $row == *pid=* ]] || die "Cannot identify the owner of web port $webport."
      done <<< "$webtext"
      while read -r webpid; do
        [[ $(basename "$(readlink -f "/proc/$webpid/exe")") == nginx ]] || die "Web port $webport belongs to another server. Configure your reverse proxy explicitly."
      done < <(grep -oE 'pid=[0-9]+' <<< "$webtext" | cut -d= -f2 | sort -u)
    fi
  done
  if [[ $SSL == 1 && ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
    command -v certbot >/dev/null || die "Install certbot explicitly, or supply an existing certificate."
  fi
  [[ $KEEP_RELEASES =~ ^[0-9]+$ && $KEEP_RELEASES -ge 2 ]] || die "--keep must be at least 2."
  for path in "$APP_ROOT" "$ENV_DIR" "$DATA_DIR"; do
    [[ ! -L $path ]] || die "Refusing symlink: $path"
    if [[ -e $path && $managed == 0 ]]; then
      die "Existing $path is not marked as managed. For a verified older Rejista installation use --adopt-existing; nothing was taken over."
    fi
  done
  if id rejista >/dev/null 2>&1 && [[ $managed == 0 ]]; then
    die "Existing rejista system user is not verified as this installation."
  fi
  [[ ! -e $ENV_DIR/deploy-in-progress ]] || die "Interrupted deployment detected. Inspect the recovery snapshot named in $ENV_DIR/deploy-in-progress before retrying."
  for path in /etc/systemd/system/rejista-api.service /etc/nginx/sites-available/rejista.conf /etc/nginx/sites-enabled/rejista.conf /etc/nginx/snippets/rejista-headers.conf; do
    [[ ! -e $path && ! -L $path || $managed == 1 ]] || die "Unowned configuration collision: $path"
  done
  for path in "$ENV_FILE" /etc/systemd/system/rejista-api.service /etc/nginx/sites-available/rejista.conf /etc/nginx/snippets/rejista-headers.conf; do
    [[ ! -L $path ]] || die "Refusing to overwrite symlink: $path"
  done
  [[ ! -L /etc/nginx/sites-enabled/rejista.conf || $(readlink -f /etc/nginx/sites-enabled/rejista.conf) == /etc/nginx/sites-available/rejista.conf ]] || die "Rejista nginx link points to another site."
  if [[ -L $APP_ROOT/current ]]; then
    [[ $(readlink -f "$APP_ROOT/current") == "$APP_ROOT"/releases/* ]] || die "Current release points outside Rejista."
  elif [[ -e $APP_ROOT/current ]]; then die "Current release must be a managed symlink."; fi
  nginx -t -q
  config=$(nginx -T 2>&1) || die "Cannot inspect nginx configuration."
  # Search the actual loaded configuration, including custom includes.
  CONFIG="$config" TARGET_DOMAIN="$DOMAIN" python3 - <<'PY' || die "This domain is already configured outside Rejista."
import os, re, sys
parts = re.split(r"(?m)^# configuration file ([^\n]+):\s*$", os.environ["CONFIG"])
for index in range(1, len(parts), 2):
    current, body = parts[index:index + 2]
    if current in ("/etc/nginx/sites-enabled/rejista.conf", "/etc/nginx/sites-available/rejista.conf"):
        continue
    body = re.sub(r"(?m)#.*$", "", body)
    if re.search(r"\bupstream\s+rejista_api\b", body):
        sys.exit(1)
    for names in re.findall(r"\bserver_name\s+([^;]+);", body):
        for name in names.split():
            name = name.strip("'\"")
            target = os.environ["TARGET_DOMAIN"]
            if name == target or (name.startswith("*.") and target.endswith(name[1:])) or (name.startswith(".") and (target == name[1:] or target.endswith(name))) or name.startswith("~"):
                sys.exit(1)
PY
}

begin_recovery() {
  RECOVERY=$(mktemp -d /var/tmp/rejista-recovery.XXXXXXXX)
  chmod 700 "$RECOVERY"
  local path
  for path in /etc/rejista/rejista.env /etc/systemd/system/rejista-api.service /etc/nginx/sites-available/rejista.conf /etc/nginx/sites-enabled/rejista.conf /etc/nginx/snippets/rejista-headers.conf; do
    if [[ -e $path || -L $path ]]; then
      mkdir -p "$RECOVERY$(dirname "$path")"; cp -a "$path" "$RECOVERY$path"
    fi
  done
  PREVIOUS=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)
  WAS_ENABLED=0
  systemctl is-enabled --quiet rejista-api && WAS_ENABLED=1
  printf '%s\n' "$PREVIOUS" > "$RECOVERY/previous-release"
  printf '%s\n' "$RECOVERY" > "$ENV_DIR/deploy-in-progress"
  DEPLOY_SUCCESS=0; MIGRATIONS_STARTED=0
  trap recover_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}
recover_on_exit() {
  local status=$? path
  [[ ${DEPLOY_SUCCESS:-0} == 1 ]] && return
  set +e
  if [[ ${CUTOVER_STARTED:-0} == 1 || ${MIGRATIONS_STARTED:-0} == 1 ]]; then systemctl stop rejista-api; fi
  for path in /etc/rejista/rejista.env /etc/systemd/system/rejista-api.service /etc/nginx/sites-available/rejista.conf /etc/nginx/sites-enabled/rejista.conf /etc/nginx/snippets/rejista-headers.conf; do
    rm -f "$path"
    [[ ! -e $RECOVERY$path && ! -L $RECOVERY$path ]] || cp -a "$RECOVERY$path" "$path"
  done
  if [[ -n $PREVIOUS && -d $PREVIOUS ]]; then ln -sfn "$PREVIOUS" "$APP_ROOT/current"; else rm -f "$APP_ROOT/current"; fi
  systemctl daemon-reload
  [[ ${WAS_ENABLED:-0} == 1 ]] || systemctl disable rejista-api
  nginx -t -q && systemctl reload nginx
  echo "Deployment failed. Configuration restored. Recovery snapshot: $RECOVERY" >&2
  if [[ $MIGRATIONS_STARTED == 1 ]]; then
    echo "API left stopped: database may have changed. Inspect backup and schema before restarting. No automatic database restore was attempted." >&2
  elif [[ ${CUTOVER_STARTED:-0} == 1 && -n $PREVIOUS ]]; then
    systemctl start rejista-api
  fi
  exit "${status:-1}"
}
