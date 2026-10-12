"""Isolated provisioning flow tests; PostgreSQL and sudo are simulated."""
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name("create-database.sh")
FAKE = r'''
import os, pathlib, re, sys
root = pathlib.Path(os.environ["FIXTURE_ROOT"])
mode = os.environ["SCENARIO"]
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "sudo":
    os.execvp(args[2], args[2:])
elif name == "install":
    pathlib.Path(args[-1]).mkdir(parents=True, exist_ok=True)
elif name == "openssl":
    print("ab" * int(args[-1]))
elif name == "psql":
    if "-Atqc" in args:
        sql = args[-1]
        if sql == "SELECT 1":
            if mode == "unreachable": sys.exit(1)
            print("1")
        elif sql == "SHOW server_version_num":
            print("120022" if mode == "unsupported" else "160010")
        elif "count(*)" in sql:
            print("1" if mode == "collision" else "0")
        else:
            if mode == "tcp-failure": sys.exit(1)
            marker = (root / "marker").read_text()
            print("rejista:" + ("wrong-server" if mode == "wrong-server" else marker))
    else:
        sql = sys.stdin.read()
        assert "END;\n$$;" in sql
        assert "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT" in sql
        assert "REVOKE ALL ON DATABASE rejista FROM PUBLIC" in sql
        assert not re.search(r"\b(DROP|ALTER)\b", sql)
        (root / "creation-attempted").touch()
        if mode == "create-failure": sys.exit(1)
        (root / "marker").write_text(re.search(r"COMMENT ON DATABASE rejista IS '([^']+)'", sql)[1])
else:
    sys.exit(99)
'''


class CreateDatabase(unittest.TestCase):
    def run_case(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for part in ("root", "run", "socket", "bin"):
                (root / part).mkdir()
            script = root / "create.sh"
            text = SOURCE.read_text().replace('[[ $EUID == 0 ]]', '[[ 1 == 1 ]]')
            text = text.replace("/root/", str(root / "root") + "/")
            text = text.replace("/run/rejista-installer", str(root / "run/installer"))
            script.write_text(text)
            dispatch = root / "bin/dispatch"
            dispatch.write_text(f"#!{sys.executable}\n" + FAKE)
            dispatch.chmod(0o755)
            for name in ("sudo", "install", "openssl", "psql"):
                (root / "bin" / name).symlink_to(dispatch)
            output = root / "root/rejista-db-url"
            if mode == "existing-file":
                output.write_text("keep unchanged")
            env = dict(os.environ, FIXTURE_ROOT=directory, SCENARIO=mode,
                       PATH=str(root / "bin") + ":" + os.environ["PATH"])
            result = subprocess.run(["bash", str(script), "--socket-dir", str(root / "socket")],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode == 0, mode == "success", result.stdout + result.stderr)
            self.assertNotIn("ab" * 32, result.stdout + result.stderr)
            pending = list((root / "root").glob("*.pending.*"))
            if mode == "success":
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                self.assertTrue(output.read_text().startswith("postgresql://rejista:"))
                self.assertFalse(pending)
            elif mode in ("collision", "unreachable", "existing-file", "unsupported"):
                self.assertFalse((root / "creation-attempted").exists())
                self.assertFalse(pending)
                if mode == "existing-file":
                    self.assertEqual(output.read_text(), "keep unchanged")
            else:
                self.assertFalse(output.exists())
                self.assertTrue(pending)
                for file in pending:
                    self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_success(self): self.run_case("success")
    def test_existing_name(self): self.run_case("collision")
    def test_existing_connection_file(self): self.run_case("existing-file")
    def test_unreachable_server(self): self.run_case("unreachable")
    def test_partial_creation(self): self.run_case("create-failure")
    def test_tcp_failure(self): self.run_case("tcp-failure")
    def test_tcp_wrong_server(self): self.run_case("wrong-server")
    def test_unsupported_server_does_not_create_anything(self): self.run_case("unsupported")


if __name__ == "__main__":
    unittest.main()
