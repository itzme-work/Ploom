"""Exercise enrollment offline with ephemeral fixture keys and an in-memory GitHub API."""
import base64
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
            certpass = "fixture-android-password"
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
            def fixture(tool):
                store = wizard.WORK / "fixture.p12"
                original(["keytool","-genkeypair","-alias","ploom","-dname","CN=Temporary fixture",
                          "-keyalg","RSA","-storetype","PKCS12","-keystore",str(store),"-storepass",certpass])
                key = wizard.WORK / "fixture.key"
                original([tool,"signer","generate","--ci","-p",signpass,"-w",str(key)])
                return dict(zip(wizard.SECRET_NAMES,[certpass,base64.b64encode(store.read_bytes()).decode(),signpass,key.read_text().strip()]),UPDATER_PUBLIC_KEY=key.with_suffix(".key.pub").read_text().strip())
            def answer(prompt):
                if "Enter" in prompt:
                    shutil.copyfile(wizard.FILES / "ploom-release.gpg", wizard.FILES / "restore.gpg")
                return wizard.REPO
            mocks.enter_context(patch.dict(os.environ, {"CODESPACES":"true"}))
            mocks.enter_context(patch.dict(os.environ))
            os.environ.pop("GITHUB_ACTIONS", None)
            mocks.enter_context(patch.object(sys.stdin,"isatty",return_value=True))
            mocks.enter_context(patch.object(wizard,"run",side_effect=run))
            mocks.enter_context(patch.object(wizard,"signer",return_value=tool))
            generator = mocks.enter_context(patch.object(wizard,"generate",side_effect=fixture))
            mocks.enter_context(patch("builtins.input",side_effect=answer))
            mocks.enter_context(patch.object(wizard.getpass,"getpass",return_value="fixture backup passphrase"))
            wizard.main()
            self.assertFalse(wizard.WORK.exists())
            self.assertEqual(set(stored),set(wizard.SECRET_NAMES))
            self.assertEqual(len(bindings),2)
            wizard.main()
            self.assertFalse(wizard.WORK.exists())
            self.assertEqual(generator.call_count,1)


if __name__ == "__main__":
    unittest.main()
