#!/usr/bin/env bash
# Create only Rejista's database/account on an EXISTING local PostgreSQL server.
# Does not install packages, edit pg_hba.conf, reset passwords or restart services.
set -Eeuo pipefail
umask 077
PORT=5432
SOCKET=/var/run/postgresql
OUTPUT=/root/rejista-db-url
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT=${2:?}; shift 2 ;;
    --socket-dir) SOCKET=${2:?}; shift 2 ;;
    -h|--help) echo "Usage: sudo bash deploy/create-database.sh [--port 5432] [--socket-dir /var/run/postgresql]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID == 0 ]] || die "Run as root."
[[ $PORT =~ ^[1-9][0-9]{0,4}$ && $PORT -le 65535 ]] || die "Invalid PostgreSQL port."
[[ $SOCKET == /* && -d $SOCKET ]] || die "Socket directory is missing. Supply the existing server's --socket-dir."
for tool in psql sudo openssl flock; do command -v "$tool" >/dev/null || die "Required existing tool missing: $tool"; done
[[ ! -e $OUTPUT && ! -L $OUTPUT ]] || die "$OUTPUT already exists. Nothing was changed. Use it with install.sh --db-url-file if it belongs to this installation."
[[ ! -L /run/rejista-installer ]] || die "Unsafe installer lock directory."
install -d -o root -g root -m 700 /run/rejista-installer
exec 9>/run/rejista-installer/deploy.lock
flock -n 9 || die "Another Rejista installer or database setup is running."
[[ ! -e $OUTPUT && ! -L $OUTPUT ]] || die "Connection file appeared while acquiring the lock."
admin() { sudo -u postgres env PGCONNECT_TIMEOUT=10 psql -X -w -v ON_ERROR_STOP=1 -h "$SOCKET" -p "$PORT" -d postgres "$@"; }
admin -Atqc 'SELECT 1' >/dev/null 2>&1 || die "Cannot reach existing PostgreSQL through the local postgres account. No database changes were made."
COLLISIONS=$(admin -Atqc "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='rejista') + (SELECT count(*) FROM pg_database WHERE datname='rejista')") || die "Could not inspect existing names."
[[ ${COLLISIONS//[[:space:]]/} == 0 ]] || die "The rejista login or database already exists. Refusing to overwrite it or reset its password."

PASSWORD=$(openssl rand -hex 32)
MARKER="rejista-$(openssl rand -hex 16)"
PENDING=$(mktemp /root/rejista-db-url.pending.XXXXXXXX)
printf 'postgresql://rejista:%s@127.0.0.1:%s/rejista\n' "$PASSWORD" "$PORT" > "$PENDING"
LOG="$PENDING.log"
trap 'echo "Setup did not finish. Credentials are preserved in $PENDING; private details are in $LOG. Do not delete an existing database or reset its password to retry." >&2' ERR
# One admin session holds a cooperative lock and rechecks names before any writes.
# No password is passed as a command argument or printed to the terminal.
admin > /dev/null 2>"$LOG" <<SQL
SELECT pg_advisory_lock(174912, 5432);
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rejista')
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname='rejista') THEN
    RAISE EXCEPTION 'Rejista role or database already exists; refusing to overwrite';
  END IF;
END;
\$\$;
CREATE ROLE rejista WITH LOGIN PASSWORD '$PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE DATABASE rejista OWNER rejista ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE rejista FROM PUBLIC;
COMMENT ON DATABASE rejista IS '$MARKER';
\connect rejista
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO rejista;
SQL

VERIFIED=$(PGPASSWORD="$PASSWORD" PGCONNECT_TIMEOUT=10 psql -X -w -h 127.0.0.1 -p "$PORT" -U rejista -d rejista -Atqc \
  "SELECT current_user || ':' || shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()" 2>>"$LOG")
if [[ $VERIFIED != "rejista:$MARKER" ]]; then
  echo "TCP verification failed. Credentials remain in $PENDING. Inspect the existing authentication settings; this script will not change them." >&2
  exit 1
fi
# Hard link publishes without ever replacing an existing file.
ln -T "$PENDING" "$OUTPUT"
rm -f "$PENDING" "$LOG"
unset PASSWORD
trap - ERR
echo "Created and verified the dedicated Rejista database and login."
echo "Connection saved in $OUTPUT (root-only). Other databases and services were not changed."
echo "Next: bash deploy/install.sh --db-url-file $OUTPUT"
