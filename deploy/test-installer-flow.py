"""Execute the installer control flow in a disposable filesystem.

Root paths are redirected and host/service/provider commands are simulated.
Real Bash, file copying, permissions, traps and symlink operations are exercised.
This is not a substitute for a real systemd/nginx/PostgreSQL deployment test.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent

DISPATCH = r'''
import os, sys, pathlib, json, shutil
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ["FIXTURE_ROOT"])
stage = os.environ.get("FAIL_STAGE", "")
with (root / "commands").open("a") as log:
    log.write(name + " " + " ".join(args) + "\n")
active = root / "service-active"
if name == "sudo":
    while args and args[0] in ("-u", "-H"):
        args = args[2:] if args[0] == "-u" else args[1:]
    os.execvp(args[0], args)
elif name == "install":
    directory = "-d" in args
    paths, mode = [], 0o755
    while args:
        item = args.pop(0)
        if item in ("-o", "-g", "-m"):
            value = args.pop(0)
            if item == "-m": mode = int(value, 8)
        elif item != "-d": paths.append(item)
    if directory:
        for p in paths: pathlib.Path(p).mkdir(parents=True, exist_ok=True); os.chmod(p, mode)
    else:
        shutil.copyfile(*paths); os.chmod(paths[-1], mode)
elif name == "id":
    sys.exit(0 if (root / "user-created").exists() else 1)
elif name == "useradd":
    (root / "user-created").touch()
elif name == "chown":
    pass
elif name == "rsync":
    pathlib.Path(args[-1], "artifacts/api-server").mkdir(parents=True, exist_ok=True)
elif name == "openssl":
    print("ab" * int(args[-1]))
elif name == "node":
    print("24")
elif name == "pnpm":
    if args == ["-v"]: print("10.32.1")
    if "migrate" in args:
        (root / "migration-started").touch()
        if stage == "migration": sys.exit(1)
    if "build" in args:
        if stage == "build": sys.exit(1)
        for p in ("artifacts/api-server/dist/index.mjs", "artifacts/school-management/dist/public/index.html"):
            target = pathlib.Path(p); target.parent.mkdir(parents=True, exist_ok=True); target.write_text("built")
elif name == "psql":
    text = " ".join(args)
    print("160010" if "server_version_num" in text else "1" if "_prisma_migrations" in text else "0")
elif name == "pg_dump":
    if "--version" in args: print("pg_dump (PostgreSQL) 16.4")
    else:
        target = next(a.split("=", 1)[1] for a in args if a.startswith("--file="))
        pathlib.Path(target).write_text("synthetic backup")
elif name == "pg_restore":
    if stage == "backup": sys.exit(1)
elif name == "systemctl":
    action, unit = args[0], args[-1]
    if action == "is-enabled": sys.exit(1)
    if action == "is-active": sys.exit(0 if unit == "nginx" or active.exists() else 1)
    if unit == "rejista-api":
        if action == "stop": active.unlink(missing_ok=True)
        if action in ("start", "restart"):
            if stage == "restart": sys.exit(1)
            active.touch()
elif name == "nginx":
    site = root / "etc/nginx/sites-available/rejista.conf"
    if stage == "nginx" and site.exists(): sys.exit(1)
elif name == "curl":
    print('{"ok":true}')
else:
    sys.exit("Unimplemented fake command: " + name)
'''


class InstallerFlow(unittest.TestCase):
    def run_flow(self, failure="", update=False):
        with tempfile.TemporaryDirectory(prefix="rejista-flow-") as directory:
            root = pathlib.Path(directory)
            repo = root / "repo"
            deploy = repo / "deploy"
            shutil.copytree(HERE, deploy, ignore=shutil.ignore_patterns("__pycache__"))
            (repo / "artifacts/api-server").mkdir(parents=True)
            (repo / "pnpm-workspace.yaml").write_text("packages: []")
            for path in ("etc/nginx/sites-available", "etc/nginx/sites-enabled", "etc/nginx/snippets",
                         "etc/systemd/system", "var/tmp", "run", "bin"):
                (root / path).mkdir(parents=True, exist_ok=True)
            (root / "etc/os-release").write_text("ID=ubuntu\nVERSION_CODENAME=jammy\n")
            neighbor = root / "etc/nginx/sites-enabled/other-app.conf"
            neighbor.write_text("other app must survive")
            for path in deploy.glob("*.sh"):
                text = path.read_text()
                for prefix in ("/etc/", "/opt/", "/var/", "/run/"):
                    text = text.replace(prefix, str(root) + prefix)
                if path.name == "install.sh":
                    text = text.replace('[[ $EUID -eq 0 ]]', '[[ 1 -eq 1 ]]')
                    text = text.replace("\nhost_preflight\n", "\n: # preflight tested separately\n")
                if path.name == "host-safety.sh":
                    text += '\nport_listeners() { :; }\nown_listeners() { return 0; }\nrejista_pid() { return 0; }\n'
                path.write_text(text)
            dispatcher = root / "bin/dispatcher"
            dispatcher.write_text(f"#!{sys.executable}\n" + DISPATCH)
            dispatcher.chmod(0o755)
            for command in ("sudo", "install", "id", "useradd", "chown", "rsync", "openssl", "node",
                            "pnpm", "psql", "pg_dump", "pg_restore", "systemctl", "nginx", "curl"):
                (root / "bin" / command).symlink_to(dispatcher)
            env = dict(os.environ, FIXTURE_ROOT=str(root), FAIL_STAGE=failure,
                       PATH=str(root / "bin") + ":" + os.environ["PATH"])
            if update:
                first = subprocess.run(["bash", str(deploy / "install.sh"), "--yes", "--no-ssl",
                                        "--db-url", "postgresql://fixture/rejista"],
                                       env=dict(env, FAIL_STAGE=""), capture_output=True, text=True, timeout=30)
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                old_env = (root / "etc/rejista/rejista.env").read_bytes()
                old_release = os.readlink(root / "opt/rejista/current")
                (root / "migration-started").unlink()
            result = subprocess.run(["bash", str(deploy / "install.sh"), "--yes", "--no-ssl",
                                     "--db-url", "postgresql://fixture/rejista"], env=env,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode == 0, not failure, result.stdout + result.stderr)
            self.assertEqual(neighbor.read_text(), "other app must survive")
            migrated = (root / "migration-started").exists()
            self.assertEqual(migrated, failure not in ("build", "backup"))
            marker = root / "etc/rejista/deploy-in-progress"
            self.assertEqual(marker.exists(), bool(failure))
            if failure:
                if update:
                    self.assertEqual((root / "etc/rejista/rejista.env").read_bytes(), old_env)
                    self.assertEqual(os.readlink(root / "opt/rejista/current"), old_release)
                    self.assertEqual((root / "service-active").exists(), failure in ("build", "backup"))
                else:
                    self.assertFalse((root / "etc/rejista/rejista.env").exists())
                    self.assertFalse((root / "etc/nginx/sites-available/rejista.conf").exists())
                    self.assertFalse((root / "service-active").exists())
                self.assertIn("Configuration restored", result.stderr)
            else:
                self.assertTrue((root / "opt/rejista/current").is_symlink())
                self.assertIn("HOST=127.0.0.1", (root / "etc/rejista/rejista.env").read_text())

    def test_success(self): self.run_flow()
    def test_build_failure(self): self.run_flow("build")
    def test_backup_failure(self): self.run_flow("backup")
    def test_migration_failure(self): self.run_flow("migration")
    def test_restart_failure(self): self.run_flow("restart")
    def test_nginx_failure(self): self.run_flow("nginx")
    def test_update_backup_failure_recovers_old_app(self): self.run_flow("backup", update=True)
    def test_update_migration_failure_preserves_settings_leaves_stopped(self): self.run_flow("migration", update=True)


if __name__ == "__main__":
    unittest.main()
