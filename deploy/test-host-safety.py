"""Mocked shared-host regression tests: no real services, ports or root files modified."""
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


class HostSafety(unittest.TestCase):
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
recover_on_exit''')
        self.assertIn("SERVICE stop rejista-api", out)
        self.assertNotIn("SERVICE start rejista-api", out)
        self.assertNotIn("SERVICE restart rejista-api", out)


if __name__ == "__main__":
    unittest.main()
