"""Mocked shared-host regression tests: no real services, ports or root files modified."""
import pathlib
import subprocess
import tempfile
import shlex
import os
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


class HostSafety(unittest.TestCase):
    def test_private_build_shows_progress_and_preserves_failures(self):
        source = (ROOT / "private-postgres.sh").read_text()
        start = source.index('    sudo -u "$account" bash -c')
        end = source.index('\n    chown -R root:root', start)
        build = source[start:end]
        for status in (0, 7):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                script = f'''set -euo pipefail
account=fixture; version=16.15; root=/unused
stage={shlex.quote(directory)}
sudo() {{ echo "compiler progress"; return {status}; }}
die() {{ echo "$*" >&2; exit 1; }}
{build}
'''
                result = subprocess.run(["bash", "-c", script], text=True, capture_output=True)
                self.assertIn("compiler progress", result.stdout)
                self.assertIn("compiler progress", (pathlib.Path(directory) / "build.log").read_text())
                self.assertEqual(result.returncode, 0 if status == 0 else 1)
                if status:
                    self.assertIn("Private PostgreSQL build failed", result.stderr)

    def test_service_gets_private_database_client_path(self):
        source = (ROOT / "install.sh").read_text()
        render = "render() {" + source.split("render() {", 1)[1].split("\n}", 1)[0] + "\n}"
        out = self.shell(render + f'''
DOMAIN=fixture.example; APP_ROOT=/opt/rejista; API_PORT=8083
NODE_BIN=/opt/rejista-toolchain/node-24/bin/node
RUNTIME_PATH=/opt/rejista-postgres/pgsql/bin:/usr/bin
render "{ROOT}/templates/rejista-api.service"
''')
        self.assertIn('Environment="PATH=/opt/rejista-postgres/pgsql/bin:/usr/bin"', out)
        self.assertNotIn("__RUNTIME_PATH__", out)

    def shell(self, code, ok=True):
        result = subprocess.run(["bash", "-c", f'set -euo pipefail; source "{ROOT}/host-safety.sh";\n' + code],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result.stdout

    def test_free_port(self):
        out = self.shell('port_listeners() { :; }; select_api_port 8080')
        self.assertEqual(out.strip(), "8080")

    def test_other_app_next_port_no_kill(self):
        out = self.shell('''port_listeners() { if [[ $1 == 8080 ]]; then echo 'LISTEN pid=42'; fi; }
rejista_pid() { return 1; }
systemctl() { exit 99; }
select_api_port 8080''')
        self.assertEqual(out.strip(), "8081")

    def test_own_app_reuses_port(self):
        out = self.shell('''port_listeners() { echo 'LISTEN pid=42'; }
rejista_pid() { [[ $1 == 42 ]]; }
select_api_port 8080''')
        self.assertEqual(out.strip(), "8080")

    def test_only_owned_service_is_stopped(self):
        self.shell('''stopped=0
port_listeners() { [[ $stopped == 1 ]] || echo 'LISTEN pid=42'; return 0; }
rejista_pid() { [[ $1 == 42 ]]; }
systemctl() { [[ "$*" == 'stop rejista-api' ]] || exit 99; stopped=1; }
stop_owned_port 8080
[[ $stopped == 1 ]]''')

    def test_race_and_unknown_ownership_never_killed(self):
        for text in ('LISTEN pid=99', 'LISTEN unknown', 'LISTEN pid=42\nLISTEN unknown', 'LISTEN pid=42 pid=99'):
            self.shell(f'''port_listeners() {{ printf '%s\\n' '{text}'; }}
rejista_pid() {{ [[ $1 == 42 ]]; }}
systemctl() {{ echo UNSAFE; exit 99; }}
stop_owned_port 8080''', ok=False)

    def test_exhausted_and_invalid_ports(self):
        for port in ("abc", "65536", "0", "65535"):
            self.shell(f'''port_listeners() {{ echo 'LISTEN pid=99'; }}
rejista_pid() {{ return 1; }}
select_api_port {port}''', ok=False)

    def test_probe_failure_stops(self):
        self.shell('port_listeners() { return 1; }; select_api_port 8080', ok=False)

    def test_no_shared_host_mutations_or_cleanup(self):
        source = (ROOT / "install.sh").read_text()
        for forbidden in ("ufw --force", "mkswap", "fallocate", "setup_${NODE_MAJOR}", "npm install -g",
                          "rm -f /etc/nginx/sites-enabled/default", "rm -rf", "rsync -a --delete"):
            self.assertNotIn(forbidden, source)
        self.assertLess(source.index('host_preflight'), source.index('apt-get update'))
        self.assertLess(source.index('pg_restore --list'), source.index('as_app pnpm --filter @workspace/db exec prisma migrate deploy'))
        self.assertIn('begin_recovery', source)
        self.assertIn('own_listeners "$(port_listeners "$API_PORT")"', source)

    def test_failed_migration_restores_config_but_keeps_api_stopped(self):
        out = self.shell('''RECOVERY=/nonexistent-recovery; PREVIOUS=""; APP_ROOT=/opt/rejista
MIGRATIONS_STARTED=1; CUTOVER_STARTED=1; DEPLOY_SUCCESS=0
systemctl() { echo "SERVICE $*"; }
nginx() { :; }; rm() { :; }; cp() { :; }; ln() { :; }
recover_on_exit''', ok=False)
        self.assertIn("SERVICE stop rejista-api", out)
        self.assertNotIn("SERVICE start rejista-api", out)
        self.assertNotIn("SERVICE restart rejista-api", out)

    def test_failed_second_port_probe_does_not_claim_free(self):
        self.shell('''stopped=0
port_listeners() { if [[ $stopped == 1 ]]; then return 2; fi; echo 'LISTEN pid=42'; }
rejista_pid() { [[ $1 == 42 ]]; }
systemctl() { stopped=1; }
stop_owned_port 8080''', ok=False)

    def test_recovery_survives_inherited_error_trap(self):
        out = self.shell('''RECOVERY=/nonexistent-recovery; PREVIOUS=""; APP_ROOT=/opt/rejista
MIGRATIONS_STARTED=1; CUTOVER_STARTED=1; DEPLOY_SUCCESS=0
trap 'echo RECURSIVE_TRAP; exit 97' ERR
systemctl() { echo "SERVICE $*"; [[ "$*" != "stop rejista-api" ]]; }
restore_snapshot_file() { echo RESTORING; return 1; }
nginx() { :; }; rm() { :; }; ln() { :; }
recover_on_exit''', ok=False)
        self.assertNotIn("RECURSIVE_TRAP", out)
        self.assertEqual(out.count("RESTORING"), 5)
        self.assertNotIn("SERVICE start rejista-api", out)

    def test_restore_actual_file_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = pathlib.Path(directory) / "settings"
            snapshot = pathlib.Path(directory) / "snapshot"
            saved = pathlib.Path(str(snapshot) + str(dest))
            saved.parent.mkdir(parents=True)
            saved.write_text("old settings\n")
            saved.chmod(0o640)
            dest.write_text("new settings\n")
            self.shell(f'restore_snapshot_file {shlex.quote(str(snapshot))} {shlex.quote(str(dest))}')
            self.assertEqual(dest.read_text(), "old settings\n")
            self.assertEqual(dest.stat().st_mode & 0o777, 0o640)
            self.assertFalse(list(dest.parent.glob(".rejista-restore.*")))

    def test_restore_actual_symlink_without_modifying_target(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = pathlib.Path(directory) / "enabled-site"
            target = pathlib.Path(directory) / "other-site"
            target.write_text("do not touch")
            dest.write_text("new configuration")
            snapshot = pathlib.Path(directory) / "snapshot"
            saved = pathlib.Path(str(snapshot) + str(dest))
            saved.parent.mkdir(parents=True)
            saved.symlink_to(target)
            self.shell(f'restore_snapshot_file {shlex.quote(str(snapshot))} {shlex.quote(str(dest))}')
            self.assertTrue(dest.is_symlink())
            self.assertEqual(os.readlink(dest), str(target))
            self.assertEqual(target.read_text(), "do not touch")

    def test_copy_failure_preserves_live_file(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = pathlib.Path(directory) / "settings"
            snapshot = pathlib.Path(directory) / "snapshot"
            saved = pathlib.Path(str(snapshot) + str(dest))
            saved.parent.mkdir(parents=True)
            saved.write_text("backup")
            dest.write_text("keep current until backup copied")
            self.shell(f'cp() {{ return 1; }}; restore_snapshot_file {shlex.quote(str(snapshot))} {shlex.quote(str(dest))}', ok=False)
            self.assertEqual(dest.read_text(), "keep current until backup copied")
            self.assertFalse(list(dest.parent.glob(".rejista-restore.*")))

    def test_new_file_removed_without_touching_neighbor(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = pathlib.Path(directory) / "new-site"
            neighbor = pathlib.Path(directory) / "unrelated-site"
            dest.write_text("new")
            neighbor.write_text("other app")
            self.shell(f'restore_snapshot_file {shlex.quote(directory + "/empty-snapshot")} {shlex.quote(str(dest))}')
            self.assertFalse(dest.exists())
            self.assertEqual(neighbor.read_text(), "other app")

    def test_atomic_settings_preserves_permissions_and_removes_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings"
            path.write_text("PORT=8080\nOTHER=keep\nPORT=9999\n")
            path.chmod(0o640)
            self.shell(f'atomic_env_set {shlex.quote(str(path))} PORT 8081')
            self.assertEqual(path.read_text(), "PORT=8081\nOTHER=keep\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_atomic_settings_write_failure_keeps_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings"
            path.write_text("PORT=8080\n")
            self.shell(f'awk() {{ return 1; }}; atomic_env_set {shlex.quote(str(path))} PORT 8081', ok=False)
            self.assertEqual(path.read_text(), "PORT=8080\n")
            self.assertFalse(list(path.parent.glob(".rejista-env.*")))

    def test_atomic_settings_rejects_multiline_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings"
            path.write_text("PORT=8080\n")
            self.shell(f"atomic_env_set {shlex.quote(str(path))} PORT $'8081\\nHOST=0.0.0.0'", ok=False)
            self.assertEqual(path.read_text(), "PORT=8080\n")

    def test_first_install_recovery_does_not_stop_nonexistent_unit(self):
        out = self.shell('''RECOVERY=/nonexistent-recovery; PREVIOUS=""; APP_ROOT=/opt/rejista
MIGRATIONS_STARTED=1; CUTOVER_STARTED=0; DEPLOY_SUCCESS=0; WAS_ENABLED=0
systemctl() {
  if [[ $1 == show ]]; then echo not-found; return; fi
  echo "SERVICE $*"
  [[ $1 != stop && $1 != disable ]]
}
restore_snapshot_file() { :; }
nginx() { :; }; rm() { :; }; ln() { :; }
recover_on_exit''', ok=False)
        self.assertNotIn("SERVICE stop", out)
        self.assertNotIn("SERVICE disable", out)
        self.assertIn("SERVICE daemon-reload", out)


if __name__ == "__main__":
    unittest.main()
