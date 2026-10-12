"""Real, isolated PostgreSQL integration test. Never uses the workspace database."""
import importlib.util
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import quote

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("client", HERE / "postgres-client.py")
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class ClientTests(unittest.TestCase):
    def test_password_encoding_and_query_options(self):
        env = client.connection_env("postgresql://rejista:p%40ss%3A%25@127.0.0.1:5434/rejista?schema=public&sslmode=require", {})
        self.assertEqual(env["PGPASSWORD"], "p@ss:%")
        self.assertEqual(env["PGDATABASE"], "rejista")
        self.assertEqual(env["PGPORT"], "5434")
        self.assertEqual(env["PGSSLMODE"], "require")

    def test_reject_unknown_option(self):
        with self.assertRaises(ValueError):
            client.connection_env("postgresql://host/db?unexpected=1", {})

    def test_real_database_probe_backup_and_restore(self):
        postgres = shutil.which("postgres")
        if not postgres or os.geteuid() == 0:
            self.skipTest("Requires local PostgreSQL binaries and a non-root test user")
        bin_dir = pathlib.Path(postgres).parent
        env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        with tempfile.TemporaryDirectory(prefix="rejista-pg-") as directory:
            root = pathlib.Path(directory)
            data = root / "data"
            def run(args, **kwargs):
                return subprocess.run(args, env=env, capture_output=True, text=True, check=True, **kwargs)
            run([str(bin_dir / "initdb"), "-D", str(data), "-U", "fixtureadmin", "--auth=trust", "--no-locale"])
            try:
                # Unix socket only, private temporary directory; no TCP listener.
                run([str(bin_dir / "pg_ctl"), "-D", str(data), "-l", str(root / "log"),
                     "-o", f"-k {root} -h ''", "-w", "start"])
                run([str(bin_dir / "psql"), "-h", str(root), "-U", "fixtureadmin", "-d", "postgres",
                     "-c", "CREATE DATABASE rejista"])
                uri = f"postgresql://fixtureadmin@/rejista?host={quote(str(root), safe='')}"
                old = subprocess.run([str(bin_dir / "psql"), "-X", "-w", "-Atqc", "SELECT current_database()"],
                                     env=dict(env, PGDATABASE=uri), capture_output=True, text=True)
                self.assertNotEqual(old.returncode, 0, "Regression premise changed: raw PGDATABASE URL now works")
                command = f'''set -euo pipefail
source "{HERE}/postgres-checks.sh"
check_existing_database "$PGDATABASE"
postgres_client psql -X -w -v ON_ERROR_STOP=1 -c "CREATE TABLE proof (value text); INSERT INTO proof VALUES ('verified')"
postgres_client pg_dump --lock-wait-timeout=30s --format=custom --file="{root}/backup.dump"
'''
                result = subprocess.run(["bash", "-c", command], env=dict(env, PGDATABASE=uri),
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                run([str(bin_dir / "psql"), "-h", str(root), "-U", "fixtureadmin", "-d", "postgres", "-c", "CREATE DATABASE restored"])
                run([str(bin_dir / "pg_restore"), "-h", str(root), "-U", "fixtureadmin", "-d", "restored", str(root / "backup.dump")])
                result = run([str(bin_dir / "psql"), "-h", str(root), "-U", "fixtureadmin", "-d", "restored", "-Atqc", "SELECT value FROM proof"])
                self.assertEqual(result.stdout.strip(), "verified")
            finally:
                subprocess.run([str(bin_dir / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"],
                               env=env, capture_output=True)


if __name__ == "__main__":
    unittest.main()
