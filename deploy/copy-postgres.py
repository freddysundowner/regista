"""Offline, one-way database copy. Source is read-only; never drops anything."""
import importlib.util
import os
import pathlib
import subprocess
import sys

spec = importlib.util.spec_from_file_location("pgclient", pathlib.Path(__file__).with_name("postgres-client.py"))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


def run(args, env):
    return subprocess.run(args, env=env, check=True, capture_output=True, text=True).stdout.strip()


def counts(env):
    # Query generates quoted identifiers from the catalog, never from user input.
    query = """SELECT format('SELECT %L, count(*) FROM %I.%I;', table_schema||'.'||table_name, table_schema, table_name)
FROM information_schema.tables WHERE table_type='BASE TABLE'
AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name"""
    statements = run(["psql", "-X", "-w", "-Atqc", query], env)
    if not statements:
        return ""
    return run(["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-Atqc", statements], env)


def copy_database(root, source, target):
    root = pathlib.Path(root)
    # Never overwrite a previous dump or a partly restored target.
    if run(["psql", "-X", "-w", "-Atqc", "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"], target) != "0":
        raise RuntimeError("Target database is not empty; manual inspection required")
    import tempfile
    directory = pathlib.Path(tempfile.mkdtemp(prefix="source-backup.", dir=root))
    archive = directory / "database.dump"
    before = counts(source)
    run(["pg_dump", "--format=custom", "--compress=0", "--lock-wait-timeout=30s", "--file=" + str(archive)], source)
    run(["pg_restore", "--list", str(archive)], target)
    run(["pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
         "--dbname=" + target["PGDATABASE"], str(archive)], target)
    after = counts(source)
    copied = counts(target)
    if before != after or before != copied:
        raise RuntimeError("Source changed or row counts differ; database connection was not switched")
    (directory / "row-counts").write_text(copied)
    (root / "migration-verified").write_text(str(archive) + "\n")


if __name__ == "__main__":
    try:
        source = client.connection_env(os.environ["SOURCE_DATABASE_URL"], os.environ)
        target = client.connection_env(os.environ["TARGET_DATABASE_URL"], os.environ)
        copy_database(sys.argv[1], source, target)
    except Exception as error:
        # Raw libpq errors can contain credentials or application records.
        log = pathlib.Path(sys.argv[1]) / "copy-error.log"
        descriptor = os.open(log, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write(getattr(error, "stderr", None) or str(error))
        sys.exit("Database copy failed. Preserve the source and private backup directory for inspection.")
