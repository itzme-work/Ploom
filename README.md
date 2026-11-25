# Ploom

[Менеджер подписок 0.2.0](docs/subscriptions-0.2.md) · [Сравнение сетевых ядер](docs/engines-0.3.md)

Открытый клиент для Windows и Android. В ветке 0.2.0 доступны предварительный просмотр конфигураций, локальная зашифрованная библиотека подписок, выбор сервера и диагностика DNS/TCP. Подключение через VPN-ядро запланировано на следующий этап.

## Разработка
В каталоге apps/client выполните npm ci и npm run dev. Команды npm test и npm run build проверяют модели и собирают интерфейс. Для браузерных тестов выполните npx playwright install chromium и npx playwright test.

## Обновления и выпуск
Клиент получает обновления из официальных [GitHub Releases](https://github.com/itzme-work/Ploom/releases). Владелец однократно настраивает ключи и затем выпускает новую версию через **Actions → Publish Ploom**. [Выпуск из браузера и резервная копия ключей](docs/browser-release.md)
