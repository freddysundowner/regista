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
#   1. installs Node 24, pnpm, nginx and certbot; PostgreSQL only with explicit --install-postgres
#   2. creates the "rejista" system user and the folders below
#   3. first run only: creates the database and /etc/rejista/rejista.env with fresh secrets
#   4. copies this code into a new release folder, installs dependencies, builds the API and the web app
#   5. applies database migrations and installs the background job schedules
#   6. switches /opt/rejista/current to the new release and restarts the API; rolls back if it fails its health check
#   7. writes the nginx site, gets or renews the Let's Encrypt certificate, and opens the firewall for web traffic
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
DOMAIN="" EMAIL="" DB_URL="" MODE="" SSL=1 FIREWALL=1 LOCAL_DB=0 ASSUME_YES=0 NAME=""

usage() {
  cat <<EOF
Usage: sudo $0 [options]

  --domain NAME      Public domain (default on the first run: $DEFAULT_DOMAIN)
  --email ADDRESS    Email for Let's Encrypt expiry notices (required with SSL on the first run)
  --name NAME        Product name shown everywhere (default: Rejista)
  --yes              First run: do not ask anything; use the options given and the defaults
  --db-url URL       Use an existing PostgreSQL database instead of installing one locally
  --install-postgres Explicitly install PostgreSQL on a fresh server (refuses existing installations)
  --mode MODE        hosted (default) or standalone
  --no-ssl           Serve plain HTTP only (testing; banks and payment providers need HTTPS)
  --no-firewall      Leave the firewall alone
  --keep N           Releases to keep for rollback (default $KEEP_RELEASES)
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
    --install-postgres) LOCAL_DB=1; shift ;;
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
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
    !done && (index($0, k "=") == 1 || index($0, "# " k "=") == 1) { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
# Runs a command as the app user with the settings loaded and pnpm's store shared between releases.
as_app() { sudo -u "$APP_USER" -H env HOME="$APP_ROOT" npm_config_store_dir="$APP_ROOT/.pnpm-store" CI=true "$APP_ROOT/bin/rejista-env" "$@"; }
render() { # render TEMPLATE > file, replacing __KEYS__
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__APP_ROOT__|$APP_ROOT|g" -e "s|__API_PORT__|$API_PORT|g" "$1"
}

# --- 0. Checks ---------------------------------------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Run as root: sudo $0"
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

log "Installing Rejista for $SCHEME://$DOMAIN"
info "Source: $REPO_DIR"
if [[ $FIRST_INSTALL -eq 1 ]]; then info "First install"; else info "Update (settings kept in $ENV_FILE)"; fi

# --- 1. System packages ------------------------------------------------------------------------------------------------
# Small servers run out of memory building the web app: add 2 GB of swap when there is little RAM and none yet.
if [[ $(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo) -lt 3000 && -z $(swapon --noheadings 2>/dev/null) ]]; then
  log "Adding a 2 GB swap file (low memory)"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync openssl nginx certbot ufw sudo >/dev/null

# Never add or rewrite PostgreSQL repositories or install clients on an existing server.
if [[ $LOCAL_DB -eq 1 && $FIRST_INSTALL -eq 1 ]]; then
  postgres_present && die "PostgreSQL appeared since preflight; refusing installation."
  apt-get install -y -qq postgresql postgresql-client >/dev/null
  systemctl enable --now postgresql >/dev/null
fi

# Node.js from NodeSource, and pnpm pinned to the version the lockfile was made with.
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt $NODE_MAJOR ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if [[ $(pnpm -v 2>/dev/null || true) != "$PNPM_VERSION" ]]; then
  npm install -g --silent "pnpm@$PNPM_VERSION"
fi
info "node $(node -v), pnpm $(pnpm -v), $(psql --version | head -1)"

# --- 2. User and folders -----------------------------------------------------------------------------------------------
log "User and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/bin"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR" "$STORAGE_DIR"
install -d -o root -g "$APP_USER" -m 750 "$ENV_DIR"
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
chmod 755 "$APP_ROOT/bin/rejista-env"

# --- 3. Database and settings (first run only) -------------------------------------------------------------------------
if [[ $FIRST_INSTALL -eq 1 ]]; then
  log "Database"
  if [[ $LOCAL_DB -eq 1 ]]; then
    DB_PASS=$(openssl rand -hex 24)
    # Refuse name collisions, including leftovers after an interrupted installation.
    # Never take over a role/database or reset someone else's password.
    COLLISIONS=$(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -d postgres -tAc \
      "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='$APP_USER') + (SELECT count(*) FROM pg_database WHERE datname='rejista')")
    [[ ${COLLISIONS//[[:space:]]/} == 0 ]] || die "The rejista role or database already exists. Use --db-url with its existing credentials; nothing was overwritten."
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -d postgres -q \
      -c "CREATE ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASS'"
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -d postgres -q \
      -c "CREATE DATABASE rejista OWNER $APP_USER ENCODING 'UTF8' TEMPLATE template0"
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
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
for key in APP_BASE_URL DATABASE_URL SESSION_SECRET ENCRYPTION_KEY UPLOAD_DIR; do
  [[ -n $(env_get "$key") ]] || die "$key is empty in $ENV_FILE"
done
[[ $(env_get UPLOAD_DIR) == /* ]] || die "UPLOAD_DIR must be an absolute path outside the release folders"
API_PORT=$(env_get PORT); API_PORT=${API_PORT:-8080}

# --- 4. New release: copy, install, build ------------------------------------------------------------------------------
RELEASE=$APP_ROOT/releases/$(date +%Y%m%d-%H%M%S)
log "Building release $(basename "$RELEASE")"
# Code only: no git history, dependencies, builds, local settings or local uploads.
rsync -a --delete \
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

# --- 5. Database migrations and job schedules --------------------------------------------------------------------------
log "Database migrations"
as_app pnpm --filter @workspace/db exec prisma migrate deploy
log "Background job schedules"
as_app pnpm --filter @workspace/api-server run jobs:install >/dev/null

# --- 6. Go live, with automatic rollback -------------------------------------------------------------------------------
log "Starting the API"
render "$TEMPLATES/rejista-api.service" > /etc/systemd/system/rejista-api.service
systemctl daemon-reload
PREVIOUS=""
if [[ -L $APP_ROOT/current ]]; then PREVIOUS=$(readlink -f "$APP_ROOT/current"); fi
ln -sfn "$RELEASE" "$APP_ROOT/current.new" && mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
systemctl enable rejista-api >/dev/null 2>&1
systemctl restart rejista-api

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [[ $healthy -ne 1 ]]; then
  warn "The new release did not pass its health check. Last log lines:"
  journalctl -u rejista-api -n 30 --no-pager >&2 || true
  if [[ -n $PREVIOUS && -d $PREVIOUS && $PREVIOUS != "$RELEASE" ]]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.new" && mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
    systemctl restart rejista-api
    die "Rolled back to $(basename "$PREVIOUS"). Database migrations from this run stay applied."
  fi
  die "The API did not start. See: journalctl -u rejista-api -e"
fi
info "API healthy on 127.0.0.1:$API_PORT"

# Keep the newest releases only (never the live one).
ls -1dt "$APP_ROOT"/releases/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [[ $(readlink -f "$old") == $(readlink -f "$APP_ROOT/current") ]] || rm -rf "$old"
done

# --- 7. nginx, SSL and firewall ----------------------------------------------------------------------------------------
log "nginx"
install -m 644 "$TEMPLATES/rejista-headers.conf" /etc/nginx/snippets/rejista-headers.conf
LOCATIONS=$(render "$TEMPLATES/nginx-app-locations.conf")
write_site() { # write_site TEMPLATE
  # Passed through the environment: awk -v rejects multi-line values on some systems.
  render "$1" | BLOCK="$LOCATIONS" awk '{ if ($0 ~ /__APP_LOCATIONS__/) print ENVIRON["BLOCK"]; else print }' > /etc/nginx/sites-available/rejista.conf
  ln -sfn /etc/nginx/sites-available/rejista.conf /etc/nginx/sites-enabled/rejista.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t -q && systemctl reload nginx
}
systemctl enable --now nginx >/dev/null 2>&1
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
  # Renewals run from certbot's timer; reload nginx after each so it serves the new certificate.
  install -d /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
else
  write_site "$TEMPLATES/nginx-http.conf"
  warn "Serving plain HTTP. Banks and payment providers will not send notifications until HTTPS is set up."
fi

if [[ $FIREWALL -eq 1 ]]; then
  log "Firewall"
  ufw allow OpenSSH >/dev/null
  # Keep the port this SSH session uses open too, in case SSH runs on a non-standard port.
  if [[ -n ${SSH_CONNECTION:-} ]]; then ufw allow "${SSH_CONNECTION##* }/tcp" >/dev/null; fi
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
  info "Open: SSH, HTTP, HTTPS. The API (port $API_PORT) and PostgreSQL stay private."
fi

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
    Roll back:   sudo $REPO_DIR/deploy/rollback.sh
EOF
if [[ $FIRST_INSTALL -eq 1 ]]; then
  cat <<EOF

    First-time setup: open $SCHEME://$DOMAIN and use this setup token when asked:
        $(env_get SETUP_TOKEN)
    (Also stored as SETUP_TOKEN in $ENV_FILE.)
EOF
fi
