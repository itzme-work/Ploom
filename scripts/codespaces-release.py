#!/usr/bin/env python3
"""Interactive release enrollment. Run in a fresh personal GitHub Codespace."""
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import sys
import tempfile

REPO = "itzme-work/Ploom"
ENV = "ploom-release"
ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / ".ploom-release"
WORK = Path.home() / ".ploom-enrollment"
SECRET_NAMES = ("RELEASE_ANDROID_PASSWORD", "RELEASE_ANDROID_P12_BASE64", "RELEASE_TAURI_PASSWORD", "RELEASE_TAURI_KEY")


def run(args, data=None, extra=None):
    return subprocess.run(args, input=data, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE if args[0] == "gh" else None,
                          env={**os.environ, **(extra or {})}).stdout


def encrypted(data, password, home, decrypt=False):
    # GnuPG gets the passphrase on a separate anonymous pipe, never in argv.
    read, write = os.pipe()
    try:
        os.write(write, password.encode() + b"\n")
        os.close(write)
        args = ["gpg", "--homedir", str(home), "--batch", "--quiet", "--no-symkey-cache",
                "--pinentry-mode", "loopback", "--passphrase-fd", str(read), "--output", "-"]
        args += ["--decrypt"] if decrypt else ["--symmetric", "--cipher-algo", "AES256"]
        return subprocess.run(args, pass_fds=(read,), input=data, stdout=subprocess.PIPE,
                              check=True).stdout
    finally:
        os.close(read)


def preflight():
    distro = platform.freedesktop_os_release().get("ID")
    if distro not in ("debian", "ubuntu") or platform.machine() != "x86_64" or not os.confstr("CS_GNU_LIBC_VERSION").startswith("glibc "):
        sys.exit("Нужен Debian/Ubuntu x86_64 с glibc. Для старого Alpine сначала сохраните комплект по docs/browser-release.md. Не перестраивайте старый Codespace.")
    for cmd in (["git","--version"], ["gh","--version"], ["gh","variable","set","--help"],
                ["keytool","-help"], ["minisign","-v"], ["gpg","--version"],
                ["gpgconf","--version"], ["cargo-tauri","--version"],
                ["cargo-tauri","signer","generate","--help"], ["cargo-tauri","signer","sign","--help"]):
        try:
            result = subprocess.run(cmd, capture_output=True, check=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            sys.exit(f"Не запускается {cmd[0]}. Используйте новый Codespace с конфигурацией Ploom Release — Debian 12. Существующие ключи сохранены.")
        if cmd == ["cargo-tauri","--version"] and result.stdout.strip() != b"tauri-cli 2.12.6":
            sys.exit("Требуется проверенный cargo-tauri 2.12.6 из devcontainer.")


def signer():
    return shutil.which("cargo-tauri")


def generate(tool):
    passfile = WORK / "android-password"
    if not passfile.exists():
        if (WORK / "android.p12").exists():
            sys.exit("Отсутствует исходный пароль Android.")
        passfile.write_text(secrets.token_urlsafe(36))
    android = passfile.read_text()
    if not (WORK / "android.p12").exists():
        run(["keytool", "-genkeypair", "-keystore", str(WORK / "android.p12"), "-storetype", "PKCS12",
         "-alias", "ploom", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
         "-dname", "CN=Ploom Release", "-storepass:env", "PLOOM_PASS"], extra={"PLOOM_PASS": android})
    if (WORK / "updater.key").exists() != (WORK / "updater.key.pub").exists():
        sys.exit("Неполная пара Tauri: восстановите исходные файлы. Перезапись заблокирована.")
    if not (WORK / "updater.key").exists():
        print("Задайте пароль нового ключа Tauri в скрытом запросе.", flush=True)
        subprocess.run([tool, "signer", "generate", "-w", str(WORK / "updater.key")], check=True,
                   stdout=subprocess.DEVNULL)
    password = getpass.getpass("Повторите пароль Tauri для проверки: ")
    if not password:
        sys.exit("Требуется непустой пароль. Сохраните незавершённый каталог ключей.")
    return dict(zip(SECRET_NAMES, [android, base64.b64encode((WORK / "android.p12").read_bytes()).decode(),
                                   password, (WORK / "updater.key").read_text().strip()]),
                UPDATER_PUBLIC_KEY=(WORK / "updater.key.pub").read_text().strip())


def identities(bundle, tool):
    store = WORK / "verify.p12"
    store.write_bytes(base64.b64decode(bundle[SECRET_NAMES[1]], validate=True))
    # A certificate entry alone cannot sign an APK. Requesting a CSR exercises the private key.
    run(["keytool","-certreq","-alias","ploom","-keystore",str(store),
         "-storepass:env","PLOOM_PASS"], extra={"PLOOM_PASS":bundle[SECRET_NAMES[0]]})
    cert = run(["keytool", "-exportcert", "-keystore", str(store), "-alias", "ploom",
                "-storepass:env", "PLOOM_PASS"], extra={"PLOOM_PASS": bundle[SECRET_NAMES[0]]})
    probe = WORK / "probe"
    probe.write_bytes(secrets.token_bytes(64))
    run([tool, "signer", "sign", str(probe)], extra={
        "TAURI_SIGNING_PRIVATE_KEY": bundle[SECRET_NAMES[3]],
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD": bundle[SECRET_NAMES[2]]})
    pub = WORK / "public"
    sig = WORK / "sig"
    pub.write_bytes(base64.b64decode(bundle["UPDATER_PUBLIC_KEY"], validate=True))
    sig.write_bytes(base64.b64decode((WORK / "probe.sig").read_bytes().strip(), validate=True))
    run(["minisign", "-Vm", str(probe), "-p", str(pub), "-x", str(sig)])
    return {"UPDATER_PUBLIC_KEY": bundle["UPDATER_PUBLIC_KEY"],
            "ANDROID_CERT_SHA256": hashlib.sha256(cert).hexdigest()}


def main():
    os.umask(0o077)
    if os.getenv("CODESPACES") != "true" or os.getenv("GITHUB_REPOSITORY", "").lower() != REPO.lower() or os.getenv("GITHUB_ACTIONS") or not sys.stdin.isatty():
        sys.exit("Запустите мастер в личном интерактивном Codespace.")
    preflight()
    os.chdir(ROOT)
    os.environ["GH_HOST"] = "github.com"
    os.environ.pop("GH_DEBUG", None)
    def gh(*args, data=None):
        try:
            return run(["gh", *args], data).decode().strip()
        except subprocess.CalledProcessError as exc:
            status = next((code for code in ("401","403","404") if code.encode() in (exc.stderr or b"")), str(exc.returncode))
            sys.exit(f"GitHub ({status}). GitHub CLI не выполнил запрос. При HTTP 401/403 проверьте аккаунт и права Actions: read, Contents: read, Environments: read and write. Если Environment отсутствует, создайте ploom-release в Settings. Инструкция по скрытому вводу токена: docs/browser-release.md. Ключи не заменялись.")
    def git(*args):
        return run(["git", *args]).decode().strip()
    meta = json.loads(gh("api", f"repos/{REPO}"))
    branch = meta["default_branch"]
    remote = git("remote", "get-url", "origin").removesuffix(".git")
    if remote not in (f"https://github.com/{REPO}", f"git@github.com:{REPO}") or git("branch", "--show-current") != branch or git("status", "--porcelain") or git("rev-parse", "HEAD") != gh("api", f"repos/{REPO}/commits/{branch}", "--jq", ".sha"):
        sys.exit("Нужна чистая актуальная основная ветка официального репозитория.")
    if gh("api", "user", "--jq", ".login").lower() != meta["owner"]["login"].lower():
        sys.exit("Войдите как владелец официального репозитория.")
    envs = gh("api","--paginate",f"repos/{REPO}/environments","--jq",".environments[].name").splitlines()
    if ENV not in envs:
        gh("api","--method","PUT",f"repos/{REPO}/environments/{ENV}")
    scope = ("--repo",REPO,"--env",ENV)
    api = f"repos/{REPO}/environments/{ENV}"
    def secret_names():
        return set(gh("api","--paginate",f"{api}/secrets","--jq",".secrets[].name").splitlines())
    def public_values():
        names = gh("api","--paginate",f"{api}/variables","--jq",".variables[].name").splitlines()
        return {name: gh("api",f"{api}/variables/{name}","--jq",".value")
                for name in ("UPDATER_PUBLIC_KEY","ANDROID_CERT_SHA256") if name in names}
    existing = secret_names()
    bindings = public_values()
    print("Android PKCS#12 подписывает APK. Ключ Tauri подписывает установщик Windows. Закрытые значения получит только выбранное окружение Actions и ваша зашифрованная копия.")
    if FILES.is_symlink() or WORK.is_symlink():
        sys.exit("Redirected storage is not allowed")
    FILES.mkdir(mode=0o700, exist_ok=True)
    backup = FILES / "ploom-release.gpg"
    returned = FILES / "restore.gpg"
    pending = WORK.exists()
    if pending and (WORK.is_symlink() or WORK.stat().st_uid != os.getuid() or WORK.stat().st_mode & 0o077):
        sys.exit("Unsafe recovery directory")
    if pending and any(p.is_symlink() for p in WORK.rglob("*")):
        sys.exit("Ссылки в каталоге восстановления недопустимы.")
    if pending and not (WORK / "android-password").exists():
        sys.exit("Незавершённое восстановление. Проверьте наличие сохранённой внешней копии перед очисткой.")
    if backup.exists() and not returned.exists():
        sys.exit("Загрузите сохранённую копию обратно как restore.gpg.")
    if not returned.exists() and not pending and (existing.intersection(SECRET_NAMES) or {"UPDATER_PUBLIC_KEY","ANDROID_CERT_SHA256"}.intersection(bindings)):
        sys.exit("Привязки уже существуют. Загрузите исходную копию как .ploom-release/restore.gpg.")
    if pending:
        print("Обнаружен предыдущий комплект. Существующие ключи будут использованы повторно; мастер создаст только отсутствующую пару.")
    if input(f"Для продолжения введите {REPO}: ") != REPO:
        return
    # A token may be able to list bindings while lacking permission to create them.
    # Use a unique disposable name; never probe against a signing credential.
    probe_name = "PLOOM_PREFLIGHT_" + secrets.token_hex(12).upper()
    for kind in ("variable","secret"):
        gh(kind,"set",probe_name,*scope,data=b"permission check")
        try:
            gh(kind,"delete",probe_name,*scope)
        except SystemExit as exc:
            sys.exit(f"{exc} Проверьте и удалите временную запись {probe_name} в ploom-release.")
    WORK.mkdir(mode=0o700, exist_ok=True)
    home = WORK / "gpg"
    home.mkdir(mode=0o700, exist_ok=True)
    verified = False
    bundle = None
    generated = pending
    try:
        tool = signer()
        password = getpass.getpass("Пароль резервной копии (из менеджера паролей): ")
        if not returned.exists():
            if len(password) < 16 or password != getpass.getpass("Повторите пароль копии: "):
                sys.exit("Требуется совпадающий пароль длиной от 16 символов.")
            generated = True
            bundle = generate(tool)
            # Preserve the recovery material during interrupted enrollment.
            (WORK / "recovery.json").write_text(json.dumps(bundle))
            ids = identities(bundle, tool)
            ciphertext = encrypted(json.dumps(bundle).encode(), password, home)
            with tempfile.NamedTemporaryFile(dir=FILES) as out:
                out.write(ciphertext)
                out.flush()
                os.fsync(out.fileno())
                os.link(out.name, backup)  # Publish only a complete archive; never replace one.
            print("Explorer → .ploom-release/ploom-release.gpg → Download. Сохраните офлайн. Через Upload загрузите скачанный файл сюда как restore.gpg.")
            input("Нажмите Enter после обратной загрузки: ")
        if pending and returned.exists() and bundle is None:
            bundle = json.loads((WORK / "recovery.json").read_text())
            ids = identities(bundle, tool)
        if returned.is_symlink() or (backup.exists() and returned.samefile(backup)):
            sys.exit("Нужен загруженный обратно отдельный файл резервной копии.")
        restored = json.loads(encrypted(returned.read_bytes(),password,home,True))
        restored_ids = identities(restored,tool)
        if generated and (ids != restored_ids or bundle != restored):
            sys.exit("Возвращённая копия отличается. Исходный комплект сохранён.")
        verified = True
        if any(name in bindings and bindings[name] != value for name,value in restored_ids.items()):
            sys.exit("Публичные идентификаторы отличаются. Настройки GitHub сохранены.")
        if existing.intersection(SECRET_NAMES) and not restored_ids.keys() <= bindings.keys():
            sys.exit("Невозможно связать существующие секреты с резервной копией.")
        for name,value in restored_ids.items():
            if name not in bindings:
                gh("variable","set",name,*scope,data=value.encode())
        for name in SECRET_NAMES:
            if name not in existing:
                gh("secret","set",name,*scope,data=restored[name].encode())
        actual = secret_names()
        saved = public_values()
        if any(saved.get(name) != value for name,value in restored_ids.items()):
            sys.exit("Проверка публичных привязок не прошла.")
        if not set(SECRET_NAMES) <= actual:
            sys.exit("Неполная настройка. Повторите восстановление.")
        print("Четыре имени секретов подтверждены. Выполните Build only для проверки значений в Actions.")
    finally:
        subprocess.run(["gpgconf","--homedir",str(home),"--kill","gpg-agent"], check=False)
        if verified or not generated:
            if not pending or input("Резервная копия проверена. Введите CLEAN для удаления исходного каталога, Enter — сохранить: ") == "CLEAN":
                shutil.rmtree(WORK)
        else:
            print(f"Исходный комплект сохранён в {WORK}. Не удаляйте Codespace до восстановления.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, EOFError) as error:
        sys.exit(f"Настройка остановлена ({type(error).__name__}). Проверьте окружение, пароль и комплект файлов. См. docs/browser-release.md.")
