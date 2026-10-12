"""Real PG12→PG16 copy and actual job installer, using private temporary clusters."""
import importlib.util
import os
import pathlib
import shutil
import subprocess
import socket
import sys
import getpass
import shlex
import tempfile
import unittest
from urllib.parse import quote

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("copydb", HERE / "copy-postgres.py")
copydb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copydb)


class PrivatePostgresTests(unittest.TestCase):
    def test_real_legacy_copy_and_job_installation(self):
        old = os.environ.get("REJISTA_TEST_PG12_BIN")
        current = shutil.which("postgres")
        if not old or not current or os.geteuid() == 0:
            self.skipTest("Requires non-root user and PostgreSQL 12/16 binaries")
        env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        bin16 = pathlib.Path(current).parent
        env["PATH"] = str(bin16) + ":" + env["PATH"]
        started = []
        with tempfile.TemporaryDirectory(prefix="rejista-copy-") as directory:
            root = pathlib.Path(directory)
            try:
                connections = []
                for label, binary in (("source", pathlib.Path(old)), ("target", bin16)):
                    home = root / label
                    home.mkdir()
                    def cmd(args):
                        return subprocess.run(args, env=env, check=True, capture_output=True, text=True).stdout.strip()
                    cmd([str(binary / "initdb"), "-D", str(home / "data"), "-U", "fixtureadmin", "--auth=trust", "--no-locale"])
                    cmd([str(binary / "pg_ctl"), "-D", str(home / "data"), "-l", str(home / "log"),
                         "-o", f"-k {home} -h ''", "-w", "start"])
                    started.append((binary, home))
                    for sql in ("CREATE ROLE rejista LOGIN NOSUPERUSER", "CREATE DATABASE rejista OWNER rejista"):
                        cmd([str(binary / "psql"), "-h", str(home), "-U", "fixtureadmin", "-d", "postgres", "-c", sql])
                    uri = f"postgresql://rejista@/rejista?host={quote(str(home), safe='')}"
                    connections.append((uri, copydb.client.connection_env(uri, env)))
                source_uri, source = connections[0]
                target_uri, target = connections[1]
                copydb.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-c",
                            "CREATE TABLE proof(id int primary key, note text); INSERT INTO proof VALUES(1,'keep'),(2,'unchanged');"], source)
                jobs = ["pnpm", "--filter", "@workspace/api-server", "run", "jobs:install"]
                legacy = subprocess.run(jobs, cwd=HERE.parent, env=dict(env, DATABASE_URL=source_uri),
                                        capture_output=True, text=True, timeout=60)
                self.assertNotEqual(legacy.returncode, 0)
                self.assertIn("gen_random_uuid", legacy.stderr + legacy.stdout)
                copydb.copy_database(root, source, target)
                self.assertTrue((root / "migration-verified").exists())
                self.assertEqual(copydb.counts(source), copydb.counts(target))
                result = subprocess.run(jobs, cwd=HERE.parent, env=dict(env, DATABASE_URL=target_uri),
                                        capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertEqual(copydb.run(["psql", "-X", "-Atqc", "SELECT count(*) FROM pgboss.schedule"], target), "9")
                self.assertEqual(copydb.run(["psql", "-X", "-Atqc", "SELECT count(*) FROM proof"], source), "2")
                with self.assertRaises(RuntimeError):
                    copydb.copy_database(root, source, target)
                self.bootstrap_resume(root / "bootstrap", bin16, source_uri, env)
            finally:
                for binary, home in reversed(started):
                    subprocess.run([str(binary / "pg_ctl"), "-D", str(home / "data"), "-m", "immediate", "-w", "stop"],
                                   env=env, capture_output=True)

    def bootstrap_resume(self, root, binaries, source_uri, env):
        """Exercise the actual bootstrap/resume logic; only OS user/systemd calls are simulated."""
        pg = root / "pg"
        snapshot = root / "var/tmp/rejista-recovery.fixture"
        settings = root / "etc/rejista"
        for path in (pg / "pgsql/bin", snapshot, settings, root / "home", root / "units", root / "fake"):
            path.mkdir(parents=True, exist_ok=True)
        (pg / "installer-owned").touch()
        for binary in binaries.iterdir():
            if binary.is_file(): (pg / "pgsql/bin" / binary.name).symlink_to(binary)
        for directory in ("share", "lib"):
            (pg / "pgsql" / directory).symlink_to(binaries.parent / directory)
        (snapshot / "proposed.env").write_text(f"DATABASE_URL={source_uri}\nAPP_NAME=Fixture\nENCRYPTION_KEY=fixture-only\n")
        (snapshot / "previous-release").write_text(str(root / "app/current") + "\n")
        (settings / "deploy-in-progress").write_text(str(snapshot))
        (settings / "installer-owned").touch()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        fixture = (HERE / "private-postgres.sh").read_text()
        for old, new in (("/opt/rejista-postgres", str(pg)), ("/etc/systemd/system", str(root / "units")),
                         ("/var/tmp/rejista-recovery.", str(root / "var/tmp/rejista-recovery.")),
                         ("/root/", str(root / "home") + "/")):
            fixture = fixture.replace(old, new)
        fixture = fixture.replace("== 0 &&", f"== {os.getuid()} &&").replace("== 0 ]]", f"== {os.getuid()} ]]")
        # Undo UID substitution in the database-name count guard.
        fixture = fixture.replace('pg_database WHERE datname=\'rejista\')") == ' + str(os.getuid()), 'pg_database WHERE datname=\'rejista\')") == 0')
        fixture = fixture.replace("port=5433", f"port={port}")
        script = root / "bootstrap.sh"
        script.write_text(fixture)
        fake = root / "fake"
        commands = {
            "sudo": '#!/bin/bash\nshift 2\nexec "$@"\n',
            "id": "#!/bin/sh\nexit 0\n", "chown": "#!/bin/sh\nexit 0\n", "ss": "#!/bin/sh\nexit 0\n",
            "systemctl": f'''#!/bin/bash
case "$1" in
is-active) exit 1;;
daemon-reload) exit 0;;
enable) [[ "$*" == "enable --now rejista-postgres" ]] || exit 99
exec {shlex.quote(str(binaries / "pg_ctl"))} -D {shlex.quote(str(pg / "data"))} -l {shlex.quote(str(pg / "server.log"))} -w start;;
*) exit 99;;
esac
''',
            "install": f'''#!{sys.executable}
import os,pathlib,shutil,sys
args=sys.argv[1:]; paths=[]; mode=0o755; directory=False
while args:
    arg=args.pop(0)
    if arg in ("-o","-g","-m"):
        value=args.pop(0)
        if arg=="-m": mode=int(value,8)
    elif arg=="-d": directory=True
    else: paths.append(arg)
if directory:
    for p in paths: pathlib.Path(p).mkdir(parents=True,exist_ok=True); os.chmod(p,mode)
else: shutil.copyfile(*paths); os.chmod(paths[-1],mode)
''',
        }
        for name, content in commands.items():
            (fake / name).write_text(content)
            (fake / name).chmod(0o755)
        bash = f'''set -euo pipefail
umask 077
die() {{ echo "$*" >&2; exit 1; }}
info() {{ :; }}
source "{HERE}/postgres-checks.sh"
source "{HERE}/host-safety.sh"
source "{script}"
REPO_DIR="{HERE.parent}"
APP_ROOT="{root}/app"
APP_USER="{getpass.getuser()}"
ENV_DIR="{settings}"
ENV_FILE="$ENV_DIR/rejista.env"
setup_private_postgres
'''
        try:
            result = subprocess.run(["bash", "-c", bash], env=dict(env, PATH=str(fake)+":"+env["PATH"]),
                                    capture_output=True, text=True, timeout=90)
            diagnostic = result.stdout + result.stderr
            if result.returncode and (pg / "initdb.log").exists():
                diagnostic += (pg / "initdb.log").read_text()
            self.assertEqual(result.returncode, 0, diagnostic)
            self.assertFalse((settings / "deploy-in-progress").exists())
            self.assertTrue((snapshot / "resumed-by-private-postgres").exists())
            self.assertIn("ENCRYPTION_KEY=fixture-only", (settings / "rejista.env").read_text())
            self.assertTrue((pg / "migration-verified").exists())
            url = (root / "home/rejista-db-url").read_text().strip()
            target = copydb.client.connection_env(url, env)
            self.assertEqual(copydb.run(["psql", "-X", "-Atqc", "SELECT count(*) FROM proof"], target), "2")
        finally:
            if (pg / "data/PG_VERSION").exists():
                subprocess.run([str(binaries / "pg_ctl"), "-D", str(pg / "data"), "-m", "immediate", "-w", "stop"],
                               env=env, capture_output=True)


if __name__ == "__main__":
    unittest.main()
