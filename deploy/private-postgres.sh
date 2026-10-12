#!/usr/bin/env bash
# Sourced by install.sh under its deployment lock. Never manages shared PostgreSQL.
setup_private_postgres() {
  local root=/opt/rejista-postgres account=rejista-pg path stage version archive hash port text source_url target_url snapshot="" pending="" previous
  local bin="$root/pgsql/bin" unit=/etc/systemd/system/rejista-postgres.service
  for path in "$APP_ROOT" "$ENV_DIR" "$ENV_FILE" "$ENV_DIR/deploy-in-progress"; do
    [[ ! -L $path ]] || die "Unsafe Rejista recovery path: $path"
  done
  if [[ -e $APP_ROOT || -e $ENV_DIR ]]; then
    [[ -f $ENV_DIR/installer-owned && ! -L $ENV_DIR/installer-owned && $(stat -c %u "$ENV_DIR/installer-owned") == 0 ]] || die "Existing Rejista paths are not installer-owned."
  fi
  for path in curl python3 gcc make perl tar sha256sum ss sudo; do
    command -v "$path" >/dev/null || die "Private PostgreSQL build requires $path. No shared PostgreSQL packages will be changed."
  done
  # This command supports a fresh/interrupted first deployment, not a live cutover.
  ! systemctl is-active --quiet rejista-api || die "Stop and back up the live app before requesting a database move."
  [[ ! -e $APP_ROOT/current ]] || die "Private database migration is limited to first installation; a live release needs a planned migration."
  for path in "$root" "$unit"; do
    [[ ! -L $path ]] || die "Unsafe private PostgreSQL path: $path"
    [[ ! -e $path || -f $root/installer-owned ]] || die "Unmanaged private PostgreSQL path: $path"
  done
  if [[ -e $root ]]; then
    [[ $(stat -c %u "$root") == 0 && ! -L $root/installer-owned && $(stat -c %u "$root/installer-owned") == 0 ]] || die "Private PostgreSQL ownership mismatch."
  elif id "$account" >/dev/null 2>&1; then
    die "Existing $account account is not owned by this installer."
  fi
  for path in "$root/pgsql" "$root/data" "$root/socket" "$root/connection-url" "$root/port"; do
    [[ ! -L $path ]] || die "Unsafe private PostgreSQL symlink: $path"
  done
  if [[ -f $ENV_DIR/deploy-in-progress ]]; then
    snapshot=$(cat "$ENV_DIR/deploy-in-progress")
    [[ $snapshot == /var/tmp/rejista-recovery.* && -d $snapshot && ! -L $snapshot && $(stat -c %u "$snapshot") == 0 ]] || die "Invalid recovery snapshot."
    [[ -f $snapshot/proposed.env && ! -L $snapshot/proposed.env && $(stat -c %u "$snapshot/proposed.env") == 0 ]] || die "Recovery settings are missing or unsafe."
    [[ -f $snapshot/previous-release && ! -L $snapshot/previous-release ]] || die "Recovery history is missing; refusing automatic resume."
    previous=$(cat "$snapshot/previous-release")
    [[ -z $previous || $previous == "$APP_ROOT/current" ]] || die "Recovery belongs to an existing release; a planned database migration is required."
    pending="$snapshot/proposed.env"
  fi
  if [[ -n $pending ]]; then
    source_url=$(awk -F= '$1=="DATABASE_URL"{print substr($0,14);exit}' "$pending")
  elif [[ -f $ENV_FILE ]]; then source_url=$(env_get DATABASE_URL)
  elif [[ -e /root/rejista-db-url || -L /root/rejista-db-url ]]; then
    [[ -f /root/rejista-db-url && ! -L /root/rejista-db-url && $(stat -c '%u:%a' /root/rejista-db-url) == 0:600 ]] || die "Saved database connection must be a root-owned, mode-600 regular file."
    source_url=$(cat /root/rejista-db-url)
  else source_url=""; fi
  install -d -m 755 -o root -g root "$root"
  touch "$root/installer-owned"
  id "$account" >/dev/null 2>&1 || useradd --system --home-dir "$root/data" --shell /usr/sbin/nologin "$account"
  if [[ ! -x $bin/postgres ]]; then
    stage=$(mktemp -d "$root/build.XXXXXXXX")
    chmod 755 "$stage"
    curl -fsSL --retry 2 --max-time 120 https://ftp.postgresql.org/pub/source/ -o "$stage/releases"
    version=$(python3 -c 'import re,sys; v=set(re.findall(r"v(16\.\d+)/",open(sys.argv[1]).read())); print(max(v,key=lambda x:int(x.split(".")[1])))' "$stage/releases")
    [[ $version =~ ^16\.[0-9]+$ ]] || die "Cannot select a PostgreSQL 16 release."
    archive="postgresql-$version.tar.gz"
    info "Building isolated PostgreSQL $version; this can take several minutes."
    curl -fsSL --retry 2 --max-time 300 "https://ftp.postgresql.org/pub/source/v$version/$archive" -o "$stage/$archive"
    curl -fsSL --retry 2 --max-time 120 "https://ftp.postgresql.org/pub/source/v$version/$archive.sha256" -o "$stage/checksum"
    hash=$(awk '{print $1}' "$stage/checksum")
    (cd "$stage"; printf '%s  %s\n' "$hash" "$archive" | sha256sum -c -) || die "PostgreSQL checksum failed."
    (umask 022; tar -xzf "$stage/$archive" -C "$stage")
    chown -R "$account:$account" "$stage"
    # Compile without optional library dependencies; only local connections are exposed.
    sudo -u "$account" bash -c 'set -e; umask 022; cd "$1"; ./configure --prefix="$2" --without-readline --without-zlib --without-icu; make -j2; make DESTDIR="$3" install' \
      bash "$stage/postgresql-$version" "$root/pgsql" "$stage/dest" > "$stage/build.log" 2>&1 || die "Private PostgreSQL build failed. See $stage/build.log."
    chown -R root:root "$stage/dest$root/pgsql"
    mv -T "$stage/dest$root/pgsql" "$root/pgsql"
  fi
  "$bin/postgres" --version | grep -q 'PostgreSQL) 16\.' || die "Private runtime is not PostgreSQL 16."
  install -d -m 700 -o "$account" -g "$account" "$root/data" "$root/socket"
  if [[ ! -f $root/data/PG_VERSION ]]; then
    [[ -z $(find "$root/data" -mindepth 1 -print -quit) ]] || die "Incomplete private data directory; refusing to overwrite."
    sudo -u "$account" "$bin/initdb" -D "$root/data" --auth-local=peer --auth-host=reject --encoding=UTF8 --no-locale > "$root/initdb.log" 2>&1
    port=5433
    while :; do
      (( port <= 65535 )) || die "No port available for private PostgreSQL."
      text=$(ss -H -ltn "sport = :$port") || die "Cannot inspect PostgreSQL ports."
      [[ -n $text ]] || break
      port=$((port + 1))
    done
    printf '%s\n' "$port" > "$root/port"
    cat >> "$root/data/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = $port
unix_socket_directories = '$root/socket'
password_encryption = 'scram-sha-256'
EOF
    printf 'local all all peer\nhost rejista rejista 127.0.0.1/32 scram-sha-256\n' > "$root/data/pg_hba.conf"
    chown "$account:$account" "$root/data/pg_hba.conf"
  fi
  port=$(cat "$root/port")
  [[ $port =~ ^[1-9][0-9]{0,4}$ && $port -ge 5433 && $port -le 65535 ]] || die "Invalid private PostgreSQL port."
  cat > "$unit" <<EOF
[Unit]
Description=Rejista isolated PostgreSQL 16
After=network.target
[Service]
Type=simple
User=$account
Group=$account
ExecStart=$bin/postgres -D $root/data
Restart=on-failure
TimeoutStopSec=120
KillSignal=SIGINT
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$root/data $root/socket
[Install]
WantedBy=multi-user.target
EOF
  chmod 644 "$unit"
  systemctl daemon-reload
  systemctl enable --now rejista-postgres
  private_admin() { sudo -u rejista-pg /opt/rejista-postgres/pgsql/bin/psql -X -w -v ON_ERROR_STOP=1 -h /opt/rejista-postgres/socket -p "$port" -d postgres "$@"; }
  local ready=0
  for _ in $(seq 1 30); do
    if private_admin -Atqc 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [[ $ready == 1 ]] || die "Private PostgreSQL did not start; inspect journalctl -u rejista-postgres."
  if [[ ! -f $root/connection-url ]]; then
    local password
    [[ $(private_admin -Atqc "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='rejista') + (SELECT count(*) FROM pg_database WHERE datname='rejista')") == 0 ]] || die "Private database name collision; no passwords were reset."
    password=$(openssl rand -hex 32)
    printf 'postgresql://rejista:%s@127.0.0.1:%s/rejista\n' "$password" "$port" > "$root/connection-url.pending"
    private_admin > "$root/create.log" 2>&1 <<SQL
CREATE ROLE rejista LOGIN PASSWORD '$password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE rejista OWNER rejista TEMPLATE template0 ENCODING 'UTF8';
REVOKE ALL ON DATABASE rejista FROM PUBLIC;
SQL
    mv -T "$root/connection-url.pending" "$root/connection-url"
    unset password
  fi
  export PATH="$bin:$PATH"
  target_url=$(cat "$root/connection-url")
  check_existing_database "$target_url" || die "Private database login failed."
  if [[ -n $source_url && $source_url != "$target_url" && ! -f $root/migration-verified ]]; then
    info "Copying only the Rejista database; the source database will remain intact."
    SOURCE_DATABASE_URL="$source_url" TARGET_DATABASE_URL="$target_url" python3 "$REPO_DIR/deploy/copy-postgres.py" "$root" || die "Database copy not verified; the app connection was not switched. Source and backup remain intact."
  fi
  if [[ -n $pending ]]; then
    install -o root -g "$APP_USER" -m 640 "$pending" "$ENV_FILE"
    FIRST_SETUP_PENDING=1
  fi
  if [[ -f $ENV_FILE ]]; then atomic_env_set "$ENV_FILE" DATABASE_URL "$target_url"; fi
  stage=$(mktemp /root/.rejista-db-url.XXXXXXXX)
  printf '%s\n' "$target_url" > "$stage"
  mv -T "$stage" /root/rejista-db-url
  # Only retire the failed-first-install marker after a verified copy and preserved settings.
  if [[ -n $snapshot ]]; then
    cp -a "$ENV_DIR/deploy-in-progress" "$snapshot/resumed-by-private-postgres"
    rm "$ENV_DIR/deploy-in-progress"
  fi
  DB_URL=$target_url
}
