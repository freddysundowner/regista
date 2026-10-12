#!/usr/bin/env bash
# Rejista server installer and updater for Ubuntu 22.04/24.04 and Debian 12.
#
# First install (run from the project folder on the server). With no options it asks a few questions:
# the domain (skultab.com unless you type another), your email, the product name and whether to set up HTTPS.
#   sudo ./deploy/install.sh --install-postgres  # fresh server only
# The same without questions:
#   sudo ./deploy/install.sh --domain skultab.com --email you@example.com --yes --install-postgres
# Update to the code now in this folder (settings are remembered, nothing is asked):
#   sudo ./deploy/install.sh
#
# What it does, every run:
#   1. checks existing tools without changing shared packages; PostgreSQL only with explicit --install-postgres
#   2. creates the "rejista" system user and the folders below
#   3. first run only: creates the database and /etc/rejista/rejista.env with fresh secrets
#   4. copies this code into a new release folder, installs dependencies, builds the API and the web app
#   5. applies database migrations and installs the background job schedules
#   6. switches the release and checks ownership-aware API health; restores config on failure
#   7. configures only Rejista's nginx site; never changes the firewall or shared renewal hooks
#
# Layout:
#   /opt/rejista/releases/<time>   one folder per build (the last few are kept for rollback)
#   /opt/rejista/current           the live release
#   /etc/rejista/rejista.env       settings and secrets, outside every build folder (root:rejista, 0640)
#   /var/lib/rejista/storage       uploads, documents and nightly database backups (kept across releases)
set -Eeuo pipefail

# --- Settings ----------------------------------------------------------------------------------------------------------
APP_USER=rejista
APP_ROOT=/opt/rejista
ENV_DIR=/etc/rejista
ENV_FILE=$ENV_DIR/rejista.env
DATA_DIR=/var/lib/rejista
STORAGE_DIR=$DATA_DIR/storage
NODE_MAJOR=24
PNPM_VERSION=10.32.1
API_PORT=8080
KEEP_RELEASES=5
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEMPLATES=$REPO_DIR/deploy/templates

DEFAULT_DOMAIN=skultab.com
DOMAIN="" EMAIL="" DB_URL="" MODE="" SSL=1 FIREWALL=0 LOCAL_DB=0 ASSUME_YES=0 NAME=""
ADOPT_EXISTING=0

usage() {
  cat <<EOF
Usage: sudo $0 [options]

  --domain NAME      Public domain (default on the first run: $DEFAULT_DOMAIN)
  --email ADDRESS    Email for Let's Encrypt expiry notices (required with SSL on the first run)
  --name NAME        Product name shown everywhere (default: Rejista)
  --yes              First run: do not ask anything; use the options given and the defaults
  --db-url URL       Use an existing PostgreSQL database instead of installing one locally
  --db-url-file FILE Read the database URL from a root-only file (avoids shell history)
  --adopt-existing   Explicitly adopt a verified installation made by the old installer
  --install-postgres Explicitly install PostgreSQL on a fresh server (refuses existing installations)
  --mode MODE        hosted (default) or standalone
  --no-ssl           Serve plain HTTP only (testing; banks and payment providers need HTTPS)
  --no-firewall      Leave the firewall alone
  --keep N           Compatibility option; releases are now retained for manual cleanup
  -h, --help         Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN=${2:?}; shift 2 ;;
    --email) EMAIL=${2:?}; shift 2 ;;
    --name) NAME=${2:?}; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --db-url) DB_URL=${2:?}; shift 2 ;;
    --db-url-file) [[ $(stat -c '%u:%a' "${2:?}") == 0:600 ]] || { echo "Database URL file must be root-owned, mode 600."; exit 1; }; DB_URL=$(cat "$2"); shift 2 ;;
    --install-postgres) LOCAL_DB=1; shift ;;
    --adopt-existing) ADOPT_EXISTING=1; shift ;;
    --mode) MODE=${2:?}; shift 2 ;;
    --no-ssl) SSL=0; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --keep) KEEP_RELEASES=${2:?}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# --- Helpers -----------------------------------------------------------------------------------------------------------
log()  { printf '\n\033[1;32m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Failed at line $LINENO. Stopping; check the preceding error."' ERR

# Reads KEY from the env file (empty if missing). Values are taken literally: no quotes, no shell expansion.
env_get() { [[ -f $ENV_FILE ]] && awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$ENV_FILE" || true; }
# Sets KEY=VALUE in the env file, replacing an existing or commented-out line, or appending it.
env_set() {
  atomic_env_set "$ENV_FILE" "$1" "$2"
}
# Runs a command as the app user with the settings loaded and pnpm's store shared between releases.
as_app() { sudo -u "$APP_USER" -H env HOME="$APP_ROOT" npm_config_store_dir="$APP_ROOT/.pnpm-store" CI=true "$APP_ROOT/bin/rejista-env" "$@"; }
render() { # render TEMPLATE > file, replacing __KEYS__
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__APP_ROOT__|$APP_ROOT|g" -e "s|__API_PORT__|$API_PORT|g" -e "s|__NODE_BIN__|$NODE_BIN|g" "$1"
}

# --- 0. Checks ---------------------------------------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Run as root: sudo $0"
umask 077
[[ ! -L /run/rejista-installer ]] || die "Unsafe installer lock directory."
install -d -m 700 -o root -g root /run/rejista-installer
exec 9>/run/rejista-installer/deploy.lock
flock -n 9 || die "Another Rejista deployment or rollback is running."
[[ -f $REPO_DIR/pnpm-workspace.yaml && -d $REPO_DIR/artifacts/api-server ]] || die "Run this from the Rejista project folder (deploy/install.sh inside it)."
. /etc/os-release
[[ ${ID:-} == ubuntu || ${ID:-} == debian || ${ID_LIKE:-} == *debian* ]] || die "Supported on Ubuntu and Debian only (found ${PRETTY_NAME:-unknown})."

FIRST_INSTALL=0; [[ -f $ENV_FILE ]] || FIRST_INSTALL=1
# Before swap, apt, users, files or services are changed, decide database ownership.
. "$REPO_DIR/deploy/postgres-checks.sh"
SELECTED_DB_URL=$DB_URL
if [[ $FIRST_INSTALL -eq 0 && -z $SELECTED_DB_URL ]]; then SELECTED_DB_URL=$(env_get DATABASE_URL); fi
postgres_plan "$FIRST_INSTALL" "$LOCAL_DB" "$SELECTED_DB_URL" || die "Database safety check failed."
if [[ $LOCAL_DB -eq 0 ]]; then
  check_existing_database "$SELECTED_DB_URL" || die "Existing database check failed."
  info "Using the selected database. PostgreSQL packages, services, roles and passwords will not be managed."
  info "Rejista migrations will run on this database; it must be dedicated to Rejista."
fi
if [[ -z $DOMAIN && $FIRST_INSTALL -eq 0 ]]; then
  DOMAIN=$(env_get APP_BASE_URL | sed -E 's#^https?://##; s#/.*$##')
fi
# --- First run: a short wizard -----------------------------------------------------------------------------------------
# Asked only on the first install, only at a real terminal, and only for what was not given as an option.
# Enter keeps the answer shown in [brackets].
ask() { # ask "Question" "default" -> prints the answer
  local reply
  read -r -p "    $1${2:+ [$2]}: " reply </dev/tty || true
  printf '%s' "${reply:-$2}"
}
if [[ $FIRST_INSTALL -eq 1 && $ASSUME_YES -eq 0 && -r /dev/tty && -t 1 ]]; then
  log "Set up Rejista on this server"
  info "Press Enter to keep the answer in [brackets]."
  while :; do
    DOMAIN=$(ask "Domain the system will live at" "${DOMAIN:-$DEFAULT_DOMAIN}")
    DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}
    [[ $DOMAIN =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $DOMAIN == *.* ]] && break
    warn "That does not look like a domain (example: skultab.com or app.skultab.com)."; DOMAIN=""
  done
  if [[ $SSL -eq 1 ]]; then
    [[ $(ask "Set up HTTPS with a free Let's Encrypt certificate? (y/n)" "y") =~ ^[Nn] ]] && SSL=0
  fi
  if [[ $SSL -eq 1 ]]; then
    while :; do
      EMAIL=$(ask "Your email, for certificate expiry notices" "$EMAIL")
      [[ $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] && break
      warn "Enter a valid email address."; EMAIL=""
    done
  fi
  NAME=$(ask "Product name shown on screens, emails and PDFs" "${NAME:-Rejista}")
  if [[ -z $MODE ]]; then
    [[ $(ask "Many schools on this server (hosted) or just one (standalone)? (h/s)" "h") =~ ^[Ss] ]] && MODE=standalone || MODE=hosted
  fi
  SERVER_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)
  DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 { print $1 }' || true)
  printf '\n    Domain:        %s\n    HTTPS:         %s\n    Product name:  %s\n    Mode:          %s\n' "$DOMAIN" "$([[ $SSL -eq 1 ]] && echo "yes ($EMAIL)" || echo no)" "$NAME" "$MODE"
  if [[ -n $SERVER_IP && -n $DOMAIN_IP && $SERVER_IP != "$DOMAIN_IP" ]]; then
    warn "$DOMAIN points at $DOMAIN_IP, but this server is $SERVER_IP. The certificate step will fail until the domain's A record points here."
  elif [[ -z $DOMAIN_IP ]]; then
    warn "$DOMAIN does not resolve yet. Point its A record at ${SERVER_IP:-this server} before continuing, or the certificate step will fail."
  fi
  [[ $(ask "Install with these settings? (y/n)" "y") =~ ^[Yy] ]] || die "Cancelled. Nothing was installed."
fi
# With no domain given at all (first run, no questions asked), the default is used.
if [[ -z $DOMAIN && $FIRST_INSTALL -eq 1 ]]; then DOMAIN=$DEFAULT_DOMAIN; fi
[[ -n $DOMAIN ]] || die "Could not work out the domain. Pass --domain NAME."
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "Invalid domain: $DOMAIN"
if [[ $SSL -eq 1 && $FIRST_INSTALL -eq 1 && -z $EMAIL ]]; then die "--email is required for the SSL certificate (or use --no-ssl)."; fi
SCHEME=https; [[ $SSL -eq 1 ]] || SCHEME=http
. "$REPO_DIR/deploy/host-safety.sh"
host_preflight
NODE_BIN=$(command -v node)
[[ $NODE_BIN =~ ^/[A-Za-z0-9/_.-]+$ ]] || die "Node must have a safe absolute executable path."
API_PORT=$(env_get PORT); API_PORT=${API_PORT:-8080}
API_PORT=$(select_api_port "$API_PORT") || die "Could not select an API port safely."
info "Selected API port: $API_PORT"

log "Installing Rejista for $SCHEME://$DOMAIN"
info "Source: $REPO_DIR"
if [[ $FIRST_INSTALL -eq 1 ]]; then info "First install"; else info "Update (settings kept in $ENV_FILE)"; fi

# --- 1. System packages ------------------------------------------------------------------------------------------------
# Shared-server mode: never modify swap, firewall or global runtime packages.
log "Using existing system tools"
export DEBIAN_FRONTEND=noninteractive

# Never add or rewrite PostgreSQL repositories or install clients on an existing server.
if [[ $LOCAL_DB -eq 1 && $FIRST_INSTALL -eq 1 ]]; then
  postgres_present && die "PostgreSQL appeared since preflight; refusing installation."
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-client >/dev/null
  systemctl enable --now postgresql >/dev/null
fi

info "node $(node -v), pnpm $(pnpm -v), $(psql --version | head -1)"

# --- 2. User and folders -----------------------------------------------------------------------------------------------
log "User and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
install -d -o root -g root -m 755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/bin"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_ROOT/.pnpm-store" "$APP_ROOT/.cache" "$APP_ROOT/.local"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR" "$STORAGE_DIR"
install -d -o root -g "$APP_USER" -m 750 "$ENV_DIR"
touch "$ENV_DIR/installer-owned"
begin_recovery
install -d -m 755 /var/www/certbot
# Loads the settings file and runs a command with them; also handy for admins:
#   sudo -u rejista /opt/rejista/bin/rejista-env <command>
cat > "$APP_ROOT/bin/rejista-env" <<'EOF'
#!/usr/bin/env bash
# Runs a command with /etc/rejista/rejista.env loaded. Values are used literally; blank and commented lines are skipped.
set -euo pipefail
while IFS= read -r line || [[ -n $line ]]; do
  [[ -z $line || $line == \#* || $line != *=* ]] && continue
  export "${line%%=*}=${line#*=}"
done < /etc/rejista/rejista.env
exec "$@"
EOF
chown root:root "$APP_ROOT/bin/rejista-env"
chmod 755 "$APP_ROOT/bin/rejista-env"

# --- 3. Database and settings (first run only) -------------------------------------------------------------------------
if [[ $FIRST_INSTALL -eq 1 ]]; then
  log "Database"
  if [[ $LOCAL_DB -eq 1 ]]; then
    DB_PASS=$(openssl rand -hex 24)
    printf 'postgresql://%s:%s@127.0.0.1:5432/rejista\n' "$APP_USER" "$DB_PASS" > "$RECOVERY/new-database-url"
    # Refuse name collisions, including leftovers after an interrupted installation.
    # Never take over a role/database or reset someone else's password.
    COLLISIONS=$(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -d postgres -tAc \
      "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='$APP_USER') + (SELECT count(*) FROM pg_database WHERE datname='rejista')")
    [[ ${COLLISIONS//[[:space:]]/} == 0 ]] || die "The rejista role or database already exists. Use --db-url with its existing credentials; nothing was overwritten."
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -d postgres -q <<SQL
CREATE ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASS';
CREATE DATABASE rejista OWNER $APP_USER ENCODING 'UTF8' TEMPLATE template0;
SQL
    DB_URL="postgresql://$APP_USER:$DB_PASS@127.0.0.1:5432/rejista"
    info "Local database 'rejista' ready"
  else
    info "Using the database given with --db-url"
  fi

  log "Settings: $ENV_FILE"
  install -o root -g "$APP_USER" -m 640 "$REPO_DIR/deploy/rejista.env.example" "$ENV_FILE"
  env_set APP_BASE_URL "$SCHEME://$DOMAIN"
  env_set SITE_URL "$SCHEME://$DOMAIN"
  env_set DATABASE_URL "$DB_URL"
  env_set SESSION_SECRET "$(openssl rand -hex 32)"
  env_set ENCRYPTION_KEY "$(openssl rand -hex 32)"
  env_set SETUP_TOKEN "$(openssl rand -hex 24)"
  env_set UPLOAD_DIR "$STORAGE_DIR"
  env_set PORT "$API_PORT"
  env_set DEPLOYMENT_MODE "${MODE:-hosted}"
  if [[ -n $NAME && $NAME != Rejista ]]; then env_set APP_NAME "$NAME"; fi
  info "Secrets generated. Back this file up somewhere safe: without ENCRYPTION_KEY saved bank credentials cannot be read."
else
  if [[ -n $MODE ]]; then env_set DEPLOYMENT_MODE "$MODE"; fi
  if [[ -n $NAME ]]; then env_set APP_NAME "$NAME"; fi
  if [[ -n $DB_URL ]]; then env_set DATABASE_URL "$DB_URL"; fi
fi
env_set PORT "$API_PORT"
env_set HOST 127.0.0.1
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
cp -p "$ENV_FILE" "$RECOVERY/proposed.env"
for key in APP_BASE_URL DATABASE_URL SESSION_SECRET ENCRYPTION_KEY UPLOAD_DIR; do
  [[ -n $(env_get "$key") ]] || die "$key is empty in $ENV_FILE"
done
[[ $(env_get UPLOAD_DIR) == /* ]] || die "UPLOAD_DIR must be an absolute path outside the release folders"
API_PORT=$(env_get PORT); API_PORT=${API_PORT:-8080}

# --- 4. New release: copy, install, build ------------------------------------------------------------------------------
RELEASE=$(mktemp -d "$APP_ROOT/releases/$(date +%Y%m%d-%H%M%S)-XXXXXXXX")
chmod 755 "$RELEASE"
umask 022
log "Building release $(basename "$RELEASE")"
# Code only: no git history, dependencies, builds, local settings or local uploads.
rsync -a \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' --exclude '*.tsbuildinfo' \
  --exclude '.env' --exclude '.env.*' --exclude '/artifacts/api-server/storage/' \
  --exclude '.local/' --exclude '.cache/' --exclude 'screenshots/' --exclude 'reports/' \
  --exclude '/.claude/' --exclude '/.agents/' \
  "$REPO_DIR/" "$RELEASE/"
chown -R "$APP_USER:$APP_USER" "$RELEASE"
cd "$RELEASE"
info "Installing dependencies"
sudo -u "$APP_USER" -H env HOME="$APP_ROOT" npm_config_store_dir="$APP_ROOT/.pnpm-store" CI=true pnpm install --frozen-lockfile --reporter=silent
info "Building the API"
sudo -u "$APP_USER" -H env HOME="$APP_ROOT" NODE_ENV=production APP_NAME="$(env_get APP_NAME)" pnpm --filter @workspace/api-server run build >/dev/null
info "Building the web app"
sudo -u "$APP_USER" -H env HOME="$APP_ROOT" NODE_ENV=production PORT=5173 BASE_PATH=/ SITE_URL="$(env_get SITE_URL)" APP_NAME="$(env_get APP_NAME)" BRAND_IMAGES_READY="$(env_get BRAND_IMAGES_READY)" \
  GOOGLE_SITE_VERIFICATION="$(env_get GOOGLE_SITE_VERIFICATION)" BING_SITE_VERIFICATION="$(env_get BING_SITE_VERIFICATION)" \
  pnpm --filter @workspace/school-management run build >/dev/null
[[ -f $RELEASE/artifacts/api-server/dist/index.mjs ]] || die "API build missing"
[[ -f $RELEASE/artifacts/school-management/dist/public/index.html ]] || die "Web build missing"
umask 077

# --- 5. Database migrations and job schedules --------------------------------------------------------------------------
# Database identity check: empty DB for a new install, known Rejista tables for updates.
DB_CONNECTION=$(libpq_database_url "$(env_get DATABASE_URL)")
export PGCONNECT_TIMEOUT=10
DB_TABLES=$(PGDATABASE="$DB_CONNECTION" psql -X -w -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')" 2>/dev/null)
if [[ $FIRST_INSTALL == 1 && $DB_TABLES != 0 ]]; then die "First installation requires an empty, dedicated database."; fi
if [[ $FIRST_INSTALL == 0 ]]; then
  DB_IDENTITY=$(PGDATABASE="$DB_CONNECTION" psql -X -w -Atqc "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name='20260501000000_phase1' AND finished_at IS NOT NULL" 2>/dev/null) || die "Selected database is not a recognized Rejista database."
  [[ $DB_IDENTITY == 1 ]] || die "Rejista baseline migration not found in the selected database."
fi
# Stop only the verified Rejista service before schema changes.
if systemctl is-active --quiet rejista-api; then
  MAIN_PID=$(systemctl show rejista-api -p MainPID --value)
  rejista_pid "$MAIN_PID" || die "Cannot verify running Rejista process."
  CUTOVER_STARTED=1
  systemctl stop rejista-api
fi
API_PORT=$(select_api_port "$API_PORT") || die "No port available before migration."
stop_owned_port "$API_PORT" || die "API port changed ownership."
install -d -m 700 "$ENV_DIR/backups"
BACKUP="$ENV_DIR/backups/$(basename "$RELEASE").dump"
PGDATABASE="$DB_CONNECTION" pg_dump --lock-wait-timeout=30s --format=custom --file="$BACKUP" || die "Database backup failed. No migration was started."
pg_restore --list "$BACKUP" >/dev/null || die "Backup archive is unreadable."
pg_restore --file=/dev/null "$BACKUP" || die "Backup data could not be read completely."
printf '%s\n' "$BACKUP" > "$RECOVERY/database-backup"
MIGRATIONS_STARTED=1
log "Database migrations (backup: $BACKUP)"
as_app pnpm --filter @workspace/db exec prisma migrate deploy
log "Background job schedules"
as_app pnpm --filter @workspace/api-server run jobs:install >/dev/null

# --- 6. Go live, with automatic rollback -------------------------------------------------------------------------------
log "Starting the API"
render "$TEMPLATES/rejista-api.service" > /etc/systemd/system/rejista-api.service
systemctl daemon-reload
CUTOVER_STARTED=1
API_PORT=$(select_api_port "$API_PORT") || die "No safe port at cutover."
env_set PORT "$API_PORT"
stop_owned_port "$API_PORT" || die "Cannot free Rejista port safely."
ln -sfn "$RELEASE" "$APP_ROOT/current.new" && mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
systemctl enable rejista-api >/dev/null 2>&1
systemctl restart rejista-api

healthy=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet rejista-api && own_listeners "$(port_listeners "$API_PORT")" && curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [[ $healthy -ne 1 ]]; then
  warn "The new release did not pass its health check. Last log lines:"
  journalctl -u rejista-api -n 30 --no-pager >&2 || true
  die "The API did not start. See: journalctl -u rejista-api -e"
fi
info "API healthy on 127.0.0.1:$API_PORT"

# Keep releases for explicit administrator cleanup; never delete during deployment.

# --- 7. nginx, SSL and firewall ----------------------------------------------------------------------------------------
log "nginx"
install -m 644 "$TEMPLATES/rejista-headers.conf" /etc/nginx/snippets/rejista-headers.conf
LOCATIONS=$(render "$TEMPLATES/nginx-app-locations.conf")
write_site() { # write_site TEMPLATE
  # Passed through the environment: awk -v rejects multi-line values on some systems.
  render "$1" | BLOCK="$LOCATIONS" awk '{ if ($0 ~ /__APP_LOCATIONS__/) print ENVIRON["BLOCK"]; else print }' > /etc/nginx/sites-available/rejista.conf
  ln -sfn /etc/nginx/sites-available/rejista.conf /etc/nginx/sites-enabled/rejista.conf
  nginx -t -q && systemctl reload nginx
}
systemctl is-active --quiet nginx || die "Start nginx explicitly before deploying."
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
if [[ $SSL -eq 1 ]]; then
  if [[ ! -f $CERT ]]; then
    write_site "$TEMPLATES/nginx-http.conf"
    log "SSL certificate from Let's Encrypt"
    info "$DOMAIN must already point at this server's public IP."
    EMAIL=${EMAIL:-$(env_get PROVIDER_CONTACT_EMAIL)}
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
      || die "Certificate request failed. Check that $DOMAIN resolves to this server and port 80 is open, then re-run."
  fi
  write_site "$TEMPLATES/nginx-https.conf"
  info "Certificate renewal scheduling is managed by the server administrator; shared hooks were not changed."
else
  write_site "$TEMPLATES/nginx-http.conf"
  warn "Serving plain HTTP. Banks and payment providers will not send notifications until HTTPS is set up."
fi

info "Firewall unchanged. The administrator must allow the site's HTTP/HTTPS ports."
DEPLOY_SUCCESS=1
rm -f "$ENV_DIR/deploy-in-progress"

# --- Done --------------------------------------------------------------------------------------------------------------
if curl -fsS "$SCHEME://$DOMAIN/api/healthz" >/dev/null 2>&1; then PUBLIC=ok; else PUBLIC="not reachable yet (check DNS)"; fi
log "Done"
cat <<EOF
    Site:        $SCHEME://$DOMAIN   ($PUBLIC)
    Release:     $(basename "$RELEASE")
    Settings:    $ENV_FILE
    Files:       $STORAGE_DIR
    Logs:        journalctl -u rejista-api -f
    Update:      copy the new code here, then: sudo $REPO_DIR/deploy/install.sh
    Roll back:   verify database compatibility, then sudo $REPO_DIR/deploy/rollback.sh --schema-compatible
EOF
if [[ $FIRST_INSTALL -eq 1 ]]; then
  cat <<EOF

    First-time setup: open $SCHEME://$DOMAIN and use this setup token when asked:
        $(env_get SETUP_TOKEN)
    (Also stored as SETUP_TOKEN in $ENV_FILE.)
EOF
fi
