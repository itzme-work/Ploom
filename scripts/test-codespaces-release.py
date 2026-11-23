"""Exercise enrollment offline with ephemeral fixture keys and an in-memory GitHub API."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("wizard", Path(__file__).with_name("codespaces-release.py"))
wizard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wizard)


class Enrollment(unittest.TestCase):
    def test_round_trip_and_repeat(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.ExitStack() as mocks:
            root = Path(temp)
            oldcwd = Path.cwd()
            self.addCleanup(os.chdir, oldcwd)
            for name, value in {"ROOT": root, "WORK": root / "work", "FILES": root / "transfer"}.items():
                mocks.enter_context(patch.object(wizard, name, value))
            stored, bindings = {}, {}
            signpass = "fixture-signer-password"
            tool = str(oldcwd / "apps/client/node_modules/.bin/tauri")
            original = wizard.run
            def run(args, data=None, extra=None):
                if args[0] == "git":
                    return {"remote": b"https://github.com/itzme-work/Ploom.git", "branch": b"main", "status": b"", "rev-parse": b"abc"}[args[1]]
                if args[0] != "gh":
                    return original(args,data,extra)
                if args[1] == "api":
                    if args[2] == "user": return b"itzme-work"
                    endpoint = " ".join(args)
                    if "/secrets" in endpoint: return "\n".join(stored).encode()
                    if "/variables/" in endpoint: return bindings[args[2].split("/")[-1]].encode()
                    if "/variables" in endpoint: return "\n".join(bindings).encode()
                    if "--paginate" in args: return b"ploom-release"
                    if "commits/main" in args[2]: return b"abc"
                    return b'{"default_branch":"main","owner":{"login":"itzme-work"}}'
                target = stored if args[1] == "secret" else bindings
                if args[2] == "set":
                    self.assertNotIn(args[3],target)
                    target[args[3]] = data.decode()
                    return b""
                if args[1] == "secret": return "\n".join(stored).encode()
                return json.dumps([dict(name=k,value=v) for k,v in bindings.items()]).encode()
            # Automate only the terminal password prompt of the real signer.
            wrapper = root / "fixture-signer"
            wrapper.write_text("""#!/bin/sh
if [ "$2" = generate ]; then
    exec "$FIXTURE_TOOL" "$@" --ci -p "$FIXTURE_PASSWORD"
fi
exec "$FIXTURE_TOOL" "$@"
""")
            wrapper.chmod(0o700)
            interrupted = True
            def answer(prompt):
                nonlocal interrupted
                if "Enter" in prompt:
                    if interrupted:
                        interrupted = False
                        raise KeyboardInterrupt
                    shutil.copyfile(wizard.FILES / "ploom-release.gpg", wizard.FILES / "restore.gpg")
                return wizard.REPO
            mocks.enter_context(patch.dict(os.environ, {"CODESPACES":"true","FIXTURE_TOOL":tool,"FIXTURE_PASSWORD":signpass}))
            os.environ.pop("GITHUB_ACTIONS", None)
            mocks.enter_context(patch.object(sys.stdin,"isatty",return_value=True))
            mocks.enter_context(patch.object(wizard,"run",side_effect=run))
            mocks.enter_context(patch.object(wizard,"signer",return_value=str(wrapper)))
            generator = mocks.enter_context(patch.object(wizard,"generate",wraps=wizard.generate))
            mocks.enter_context(patch("builtins.input",side_effect=answer))
            mocks.enter_context(patch.object(wizard.getpass,"getpass",side_effect=lambda prompt: signpass if "Tauri" in prompt else "fixture backup passphrase"))
            with self.assertRaises(KeyboardInterrupt):
                wizard.main()
            self.assertTrue((wizard.WORK / "updater.key").is_file())
            self.assertFalse(stored)
            shutil.copyfile(wizard.FILES / "ploom-release.gpg", wizard.FILES / "restore.gpg")
            wizard.main()
            self.assertFalse(wizard.WORK.exists())
            self.assertEqual(set(stored),set(wizard.SECRET_NAMES))
            self.assertEqual(len(bindings),2)
            wizard.main()
            self.assertFalse(wizard.WORK.exists())
            self.assertEqual(generator.call_count,1)
            saved = dict(stored)
            bindings["ANDROID_CERT_SHA256"] = "incorrect"
            with self.assertRaisesRegex(SystemExit,"идентификаторы"):
                wizard.main()
            self.assertEqual(stored,saved)


if __name__ == "__main__":
    unittest.main()
