"""Private runtime tests: real archive/hash/file operations, simulated downloads/npm."""
import hashlib
import io
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent


class RuntimeTests(unittest.TestCase):
    def test_real_npm_uses_distinct_private_config_files(self):
        if not shutil.which("npm"):
            self.skipTest("npm is not available")
        with tempfile.TemporaryDirectory() as directory:
            stage = pathlib.Path(directory)
            # Real npm, no download/install: validate the same configuration
            # loader and global prefix used by the production installation.
            script = f'''set -euo pipefail
source "{HERE}/runtime.sh"
private_npm {shlex.quote(directory)} {shlex.quote(directory + "/cache")} \
--prefix {shlex.quote(directory)} --global config get userconfig globalconfig prefix
'''
            result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual([line.split("=", 1)[-1] for line in result.stdout.strip().splitlines()], [
                str(stage / "user.npmrc"), str(stage / "global.npmrc"), directory])
            self.assertEqual((stage / "user.npmrc").read_text(), "")
            self.assertEqual((stage / "global.npmrc").read_text(), "")

    def scenario(self, mismatch=False):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            fake = base / "bin"
            fake.mkdir()
            archive = base / "node-v24.0.0-linux-x64.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for name, text in {
                    "bin/node": "#!/bin/sh\nif [ \"$1\" = -e ]; then exit 0; fi\necho 24\n",
                    "bin/npm": f"#!{sys.executable}\nimport pathlib,sys\nargs=sys.argv\np=pathlib.Path(args[args.index('--prefix')+1])/'bin/pnpm'\np.parent.mkdir(parents=True)\np.write_text('#!/bin/sh\\necho 10.32.1\\n')\np.chmod(0o755)\n",
                }.items():
                    payload = text.encode()
                    entry = tarfile.TarInfo("node-v24.0.0-linux-x64/" + name)
                    entry.mode, entry.size = 0o755, len(payload)
                    tar.addfile(entry, io.BytesIO(payload))
            digest = "0" * 64 if mismatch else hashlib.sha256(archive.read_bytes()).hexdigest()
            manifest = base / "SHASUMS256.txt"
            manifest.write_text(f"{digest}  {archive.name}\n")
            curl = fake / "curl"
            curl.write_text(f"""#!{sys.executable}
import pathlib,shutil,sys
args=sys.argv[1:]
target=args[args.index('-o')+1]
source={str(manifest)!r} if any('SHASUMS256' in a for a in args) else {str(archive)!r}
shutil.copyfile(source,target)
""")
            curl.chmod(0o755)
            for name, content in (("node", "#!/bin/sh\necho 18\n"), ("pnpm", "#!/bin/sh\necho 8\n"),
                                  ("uname", "#!/bin/sh\necho x86_64\n")):
                path = fake / name
                path.write_text(content)
                path.chmod(0o755)
            root = base / "private"
            script = f'''set -euo pipefail
source "{HERE}/runtime.sh"
die() {{ echo "$*" >&2; exit 1; }}
info() {{ :; }}
# Ownership is simulated; all test files belong to the unprivileged test runner.
stat() {{ echo 0; }}
install() {{ mkdir -p "${{@: -1}}"; }}
NODE_MAJOR=24; PNPM_VERSION=10.32.1
ensure_runtime {shlex.quote(str(root))}
[[ $NODE_BIN == {shlex.quote(str(root))}/node-24/bin/node ]]
[[ $(node -p anything) == 24 && $(pnpm -v) == 10.32.1 ]]
ensure_runtime {shlex.quote(str(root))}
'''
            result = subprocess.run(["bash", "-c", script], env=dict(os.environ, PATH=str(fake) + ":" + os.environ["PATH"]),
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode == 0, not mismatch, result.stdout + result.stderr)
            self.assertEqual((fake / "node").read_text(), "#!/bin/sh\necho 18\n")
            self.assertEqual((fake / "pnpm").read_text(), "#!/bin/sh\necho 8\n")
            if mismatch:
                self.assertFalse((root / "node-24").exists())
            else:
                self.assertEqual((root / "node-24").stat().st_mode & 0o777, 0o755)
                self.assertEqual((root / "pnpm-10.32.1").stat().st_mode & 0o777, 0o755)

    def test_private_install_reuse_and_global_versions_unchanged(self): self.scenario()
    def test_bad_checksum_never_installed(self): self.scenario(mismatch=True)

    def test_product_name_not_overwritten_by_os(self):
        source = (HERE / "install.sh").read_text()
        line = next(line for line in source.splitlines() if line.startswith("OS_SUPPORTED="))
        result = subprocess.run(["bash", "-c", 'NAME=SkulTab\n' + line + '\n[[ $NAME == SkulTab ]]'],
                                capture_output=True)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
