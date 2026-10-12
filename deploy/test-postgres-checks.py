"""Read-only regression tests. All host/database probes are mocked; no packages/services are changed."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


class PostgresSafetyTests(unittest.TestCase):
    def run_shell(self, code, ok=True):
        result = subprocess.run(
            ["bash", "-c", f'set -euo pipefail; source "{ROOT}/postgres-checks.sh";\npostgres_client() {{ "$@"; }}\n' + code],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def test_default_requires_choice(self):
        self.run_shell('postgres_plan 1 0 ""', ok=False)

    def test_existing_and_update_skip_detection(self):
        for first in (0, 1):
            self.run_shell(f'postgres_present() {{ exit 97; }}; postgres_plan {first} 0 "postgresql://example/rejista"')

    def test_new_install_requires_empty_server(self):
        probes = 'dpkg-query() { :; }; pgrep() { :; }; ss() { :; }; '
        self.run_shell(probes + 'postgres_present() { return 0; }; postgres_plan 1 1 ""', ok=False)
        self.run_shell(probes + 'postgres_present() { return 1; }; postgres_plan 1 1 ""')

    def test_conflicting_options_and_update_install_refused(self):
        self.run_shell('postgres_plan 1 1 "postgresql://example/rejista"', ok=False)
        self.run_shell('postgres_plan 0 1 ""', ok=False)

    def test_detection(self):
        with tempfile.TemporaryDirectory() as root:
            base = """
command() { if [[ $1 == -v && $2 == postgres ]]; then return 1; else builtin command "$@"; fi; }
dpkg-query() { :; }
pgrep() { return 1; }
ss() { :; }
"""
            self.run_shell(base + f'postgres_present "{root}"', ok=False)
            for mock in (
                'dpkg-query() { echo "installed postgresql-14"; }',
                'pgrep() { [[ $2 == postgres ]]; }',
                'ss() { echo "LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*"; }',
                'ss() { return 1; }',
                'command() { return 0; }',
            ):
                self.run_shell(base + mock + f'; postgres_present "{root}"')
            data = pathlib.Path(root) / "var/lib/postgresql/14/main"
            data.mkdir(parents=True)
            self.run_shell(base + f'postgres_present "{root}"')

    def test_clients_and_connection(self):
        self.run_shell('command() { return 1; }; check_existing_database "postgresql://example/rejista"', ok=False)
        self.run_shell('psql() { return 2; }; pg_dump() { :; }; check_existing_database "postgresql://example/rejista"', ok=False)
        for version, ok in ((14, False), (16, True), (17, True)):
            self.run_shell(f'''psql() {{ echo 160010; }}
pg_dump() {{ echo "pg_dump (PostgreSQL) {version}.4"; }}
check_existing_database "postgresql://example/rejista"''', ok=ok)

    def test_prisma_options_removed_only_for_connection_probe(self):
        self.run_shell('''psql() {
[[ $PGDATABASE == 'postgresql://example/rejista?sslmode=require&connect_timeout=5' ]] || return 2
[[ "$*" == "-X -w -Atqc SHOW server_version_num" ]] || return 3
echo 160010
}
pg_dump() { echo "pg_dump (PostgreSQL) 16.4"; }
check_existing_database 'postgresql://example/rejista?schema=public&sslmode=require&connection_limit=5&connect_timeout=5'
''')

    def test_unsupported_server_refused_before_backup(self):
        result = self.run_shell('''psql() { echo 120022; }
pg_dump() { echo SHOULD_NOT_RUN; return 99; }
check_existing_database 'postgresql://example/rejista'
''', ok=False)
        self.assertIn("requires PostgreSQL 13", result.stderr)
        self.assertNotIn("SHOULD_NOT_RUN", result.stdout)

    def test_installer_safety_order(self):
        source = (ROOT / "install.sh").read_text()
        self.assertLess(source.index('postgres_plan "$FIRST_INSTALL"'), source.index("apt-get update"))
        self.assertNotIn("ALTER ROLE", source)
        self.assertNotIn("apt.postgresql.org", source)
        self.assertNotIn("postgresql-$PG_MAJOR", source)
        self.assertIn('[[ ${COLLISIONS//[[:space:]]/} == 0 ]] || die', source)


if __name__ == "__main__":
    unittest.main()
