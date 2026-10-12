#!/usr/bin/env python3
"""Run PostgreSQL clients with URI credentials in environment, not command arguments."""
import os
import sys
from urllib.parse import parse_qsl, unquote, urlsplit


def connection_env(uri, base):
    parsed = urlsplit(uri)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ValueError("Expected a PostgreSQL connection URL")
    mapping = {
        "host": "PGHOST", "hostaddr": "PGHOSTADDR", "port": "PGPORT",
        "user": "PGUSER", "password": "PGPASSWORD", "dbname": "PGDATABASE",
        "sslmode": "PGSSLMODE", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY",
        "sslrootcert": "PGSSLROOTCERT", "sslcrl": "PGSSLCRL",
        "connect_timeout": "PGCONNECT_TIMEOUT", "application_name": "PGAPPNAME",
        "options": "PGOPTIONS", "target_session_attrs": "PGTARGETSESSIONATTRS",
        "channel_binding": "PGCHANNELBINDING", "sslpassword": "PGSSLPASSWORD",
    }
    env = dict(base)
    for key in ("PGDATABASE", "PGHOST", "PGHOSTADDR", "PGPORT", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE"):
        env.pop(key, None)
    values = {"host": unquote(parsed.hostname or ""), "port": str(parsed.port or 5432),
              "user": unquote(parsed.username or ""), "password": unquote(parsed.password or ""),
              "dbname": unquote(parsed.path.lstrip("/"))}
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key in ("schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size", "socket_timeout"):
            continue
        if key not in mapping:
            raise ValueError("Unsupported PostgreSQL URL option: " + key)
        values[key] = value
    for key, value in values.items():
        if value:
            env[mapping[key]] = value
    env.setdefault("PGCONNECT_TIMEOUT", "10")
    return env


if __name__ == "__main__":
    try:
        env = connection_env(os.environ["PGDATABASE"], os.environ)
    except (ValueError, KeyError):
        sys.exit("Invalid or unsupported PostgreSQL connection URL; credentials were not printed.")
    os.execvpe(sys.argv[1], sys.argv[1:], env)
