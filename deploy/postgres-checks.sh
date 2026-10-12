#!/usr/bin/env bash
# Read-only checks, shared with the installer tests. Never install or start services here.
postgres_present() {
  local root=${1:-} packages directory entries
  packages=$(dpkg-query -W -f='${db:Status-Status} ${binary:Package}\n' 'postgresql*' 2>/dev/null || true)
  if grep -Eq '^installed postgresql(-[0-9]+)?(:[^ ]+)?$' <<< "$packages"; then return 0; fi
  command -v postgres >/dev/null 2>&1 && return 0
  for directory in "$root/etc/postgresql" "$root/var/lib/postgresql" "$root/usr/lib/postgresql"; do
    [[ -d $directory ]] || continue
    entries=$(find "$directory" -mindepth 1 -print -quit 2>/dev/null) || return 0
    [[ -z $entries ]] || return 0
  done
  pgrep -x postgres >/dev/null 2>&1 && return 0
  pgrep -x postmaster >/dev/null 2>&1 && return 0
  # A container or custom installation may not have packages or standard data directories.
  if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -E ':5432$' >/dev/null; then return 0; fi
  return 1
}

postgres_plan() {
  local first=$1 install_requested=$2 url=$3 tool
  if [[ $install_requested -eq 1 ]]; then
    [[ $first -eq 1 ]] || { echo "--install-postgres is only for a fresh installation. Updates never install PostgreSQL." >&2; return 1; }
    [[ -z $url ]] || { echo "Choose --db-url OR --install-postgres, not both." >&2; return 1; }
    for tool in dpkg-query find pgrep ss; do
      command -v "$tool" >/dev/null || { echo "Cannot safely detect PostgreSQL: missing $tool. Nothing was changed." >&2; return 1; }
    done
    if postgres_present; then
      echo "Existing PostgreSQL installation, files, process or port detected. Nothing was changed. Use a dedicated Rejista database with --db-url; do not install another server." >&2
      return 1
    fi
  else
    [[ -n $url ]] || { echo "No database selected. Supply --db-url for a dedicated Rejista database. Only on a fresh server, explicitly use --install-postgres." >&2; return 1; }
  fi
}

# Prisma-only URI options are not accepted by libpq. Keep the stored URL unchanged.
libpq_database_url() {
  local url=$1 base query item sep='?'
  base=${url%%\?*}
  printf '%s' "$base"
  [[ $url == *\?* ]] || return 0
  query=${url#*\?}
  local -a items
  IFS='&' read -r -a items <<< "$query"
  for item in "${items[@]}"; do
    case "${item%%=*}" in schema|connection_limit|pool_timeout|pgbouncer|statement_cache_size|socket_timeout) continue ;; esac
    printf '%s%s' "$sep" "$item"; sep='&'
  done
}

check_existing_database() {
  local url=$1 server dump major
  command -v psql >/dev/null && command -v pg_dump >/dev/null \
    || { echo "Install the PostgreSQL client tools matching your existing server (psql and pg_dump), then retry. The installer will not change PostgreSQL packages." >&2; return 1; }
  # Environment, not command arguments; suppress provider errors that could expose the URL.
  server=$(PGDATABASE="$(libpq_database_url "$url")" PGCONNECT_TIMEOUT=10 psql -X -w -Atqc 'SHOW server_version_num' 2>/dev/null) \
    || { echo "Cannot connect to the selected database. Check the database URL, access and installed client tools. No database changes were made." >&2; return 1; }
  [[ $server =~ ^[0-9]+$ ]] || { echo "Could not verify PostgreSQL server version." >&2; return 1; }
  dump=$(pg_dump --version 2>/dev/null) || return 1
  major=$(sed -nE 's/.*PostgreSQL\) ([0-9]+).*/\1/p' <<< "$dump")
  [[ $major =~ ^[0-9]+$ ]] && (( major >= server / 10000 )) \
    || { echo "pg_dump is older than the selected PostgreSQL server. Install a compatible client explicitly before continuing." >&2; return 1; }
}
