#!/usr/bin/env bash
# Run on the owner's trusted workstation, with an encrypted home directory.
set +x
set -euo pipefail
umask 077
[[ -t 0 && -t 1 && -z ${CI:-} ]] || { echo "Запустите мастер локально в интерактивном терминале."; exit 1; }
root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"
for tool in git gh npm keytool python3 base64; do command -v "$tool" >/dev/null || { echo "Требуется $tool"; exit 1; }; done
[[ -z $(git status --porcelain) ]] || { echo "Нужна чистая копия проверенного коммита."; exit 1; }
owner=$(gh api --hostname github.com user --jq .login)
repo="$owner/Ploom-rehearsal"
keys=${XDG_DATA_HOME:-$HOME/.local/share}/ploom-rehearsal
read -rp "DNS-имя закрытого HTTPS-стенда (без https://): " host
python3 - "$host" <<'PY'
import re, sys
if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",sys.argv[1]):
    sys.exit("Укажите DNS-имя без порта и пути")
PY
echo "Мастер отправит текущий коммит и тестовые секреты в личный закрытый репозиторий $repo и запустит четыре сборки."
read -rp "Введите полное имя репозитория для подтверждения: " confirmation
[[ "$confirmation" == "$repo" ]] || exit 1
if ! gh repo view "github.com/$repo" --json visibility >/dev/null 2>&1; then
  gh repo create "$repo" --private
fi
[[ $(gh repo view "github.com/$repo" --json visibility --jq .visibility) == PRIVATE ]] || { echo "Требуется private-репозиторий"; exit 1; }
if [[ ! -d "$keys" ]]; then
  (cd apps/client && npm ci)
  bash scripts/setup-signing.sh --test
fi
python3 - "$keys" <<'PYSECURE'
import os, stat, sys
from pathlib import Path
folder = Path(sys.argv[1])
for p in (folder, folder / "android.p12", folder / "updater.key"):
    info = p.lstat()
    if p.is_symlink() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        sys.exit("Проверьте владельца и права каталога (700) и приватных файлов (600).")
PYSECURE
for file in android.p12 updater.key updater.key.pub; do
  [[ -s "$keys/$file" && ! -L "$keys/$file" ]] || { echo "Неполный комплект ключей. Восстановите резервную копию."; exit 1; }
done
read -rp "Зашифрованная резервная копия ключей и паролей проверена? [yes]: " backup
[[ "$backup" == yes ]] || exit 1
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push "https://github.com/$repo.git" HEAD:refs/heads/native-completion
gh repo edit "$repo" --default-branch native-completion
gh variable set STAGING_HOST -R "$repo" --body "$host"
gh variable set TEST_UPDATER_PUBLIC_KEY -R "$repo" < "$keys/updater.key.pub"
gh secret set TEST_TAURI_KEY -R "$repo" < "$keys/updater.key"
base64 < "$keys/android.p12" | gh secret set TEST_ANDROID_P12_BASE64 -R "$repo"
echo "Введите пароль тестового ключа Tauri в скрытом запросе GitHub CLI."
gh secret set TEST_TAURI_PASSWORD -R "$repo"
echo "Введите пароль тестового контейнера Android."
gh secret set TEST_ANDROID_PASSWORD -R "$repo"
gh workflow run rehearsal.yml -R "$repo" --ref native-completion
echo "Прогресс: https://github.com/$repo/actions/workflows/rehearsal.yml"
