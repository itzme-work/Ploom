# Ploom

[Менеджер подписок 0.2.0](docs/subscriptions-0.2.md) · [Сравнение сетевых ядер](docs/engines-0.3.md)

Открытый клиент для Windows и Android. В Foundation доступны настройки, четыре оформления и просмотр официальных релизов. VPN и импорт подписок запланированы. Ссылка из формы существует только до ухода с экрана.

## Разработка
В каталоге apps/client выполните npm ci и npm run dev. Команды npm test и npm run build проверяют модели и собирают интерфейс. Для браузерных тестов выполните npx playwright install chromium и npx playwright test.

## Обновления и выпуск
Клиент получает обновления из официальных [GitHub Releases](https://github.com/itzme-work/Ploom/releases). Владелец однократно настраивает ключи и затем выпускает новую версию через **Actions → Publish Ploom**. [Выпуск из браузера и резервная копия ключей](docs/browser-release.md)
