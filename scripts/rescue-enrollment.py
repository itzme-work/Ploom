#!/usr/bin/env python3
"""Transfer legacy enrollment files without running the old signer or changing its keys."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import base64

DIGESTS = {
    "x86_64": ("amd64", "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"),
    "aarch64": ("arm64", "6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4"),
}
NAMES = {"android-password", "android.p12", "updater.key", "updater.key.pub", "recovery.json"}
WORK = Path.home() / ".ploom-enrollment"
TRANSFER = Path.cwd() / ".ploom-release"


def age(folder):
    arch, digest = DIGESTS[platform.machine()]
    url = f"https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-{arch}.tar.gz"
    with urllib.request.urlopen(url, timeout=60) as response:
        blob = response.read(32 << 20)
    if hashlib.sha256(blob).hexdigest() != digest:
        sys.exit("Неверная контрольная сумма age.")
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        entry, = [m for m in archive if m.isfile() and Path(m.name).name == "age"]
        tool = folder / "age"
        tool.write_bytes(archive.extractfile(entry).read())
    tool.chmod(0o700)
    return tool


def main():
    os.umask(0o077)
    if sys.argv[1:] not in (["export"], ["import"]):
        sys.exit("Укажите export в старом Codespace или import в новом.")
    if TRANSFER.is_symlink() or WORK.is_symlink():
        sys.exit("Отказ: каталог является ссылкой.")
    TRANSFER.mkdir(mode=0o700, exist_ok=True)
    box = TRANSFER / "partial.age"
    if box.is_symlink():
        sys.exit("Отказ: файл является ссылкой.")
    with tempfile.TemporaryDirectory() as tmp:
        tool = age(Path(tmp))
        if sys.argv[1] == "export":
            files = {}
            for name in sorted(NAMES):
                path = WORK / name
                if path.is_symlink():
                    sys.exit("Ссылки в исходном комплекте недопустимы.")
                if path.is_file():
                    files[name] = base64.b64encode(path.read_bytes()).decode()
            if not files or box.exists():
                sys.exit("Нет исходных файлов либо архив уже существует. Перезапись запрещена.")
            payload = json.dumps(files).encode()
            print("Задайте пароль архива в запросе age и сохраните его отдельно.", flush=True)
            sealed = subprocess.run([tool,"-p"],input=payload,stdout=subprocess.PIPE,check=True).stdout
            check = subprocess.run([tool,"-d"],input=sealed,stdout=subprocess.PIPE,check=True).stdout
            if check != payload:
                sys.exit("Проверка архива не прошла.")
            with box.open("xb") as out:
                out.write(sealed)
            print("Скачайте .ploom-release/partial.age. Исходные файлы сохранены.")
        else:
            if WORK.exists():
                sys.exit("Каталог уже существует. Используйте новый чистый Codespace; ничего не перезаписано.")
            data = json.loads(subprocess.run([tool,"-d"],input=box.read_bytes(),stdout=subprocess.PIPE,check=True).stdout)
            if not isinstance(data, dict) or not data or set(data) - NAMES:
                sys.exit("Неподдерживаемый архив.")
            files = {k:base64.b64decode(v,validate=True) for k,v in data.items()}
            with tempfile.TemporaryDirectory(dir=WORK.parent) as stage:
                target = Path(stage) / "keys"
                target.mkdir(mode=0o700)
                for name, content in files.items():
                    (target / name).write_bytes(content)
                if WORK.exists():
                    sys.exit("Каталог занят.")
                target.rename(WORK)
            print("Комплект восстановлен. Запустите основной мастер.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        sys.exit(f"Перенос остановлен ({type(exc).__name__}). Исходный комплект сохранён.")
