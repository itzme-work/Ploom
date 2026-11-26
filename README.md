# Ploom

[Менеджер подписок 0.2.0](docs/subscriptions-0.2.md) · [Сравнение сетевых ядер](docs/engines-0.3.md)

В версии 0.3.0 Android-клиент использует VpnService и libbox. На Windows доступны Local Proxy и System Proxy. Системный прокси действует в приложениях, которые учитывают настройки Windows. Для проверки изменений используйте пакеты PR с сетевым ядром. [Проверки и ограничения](docs/acceptance-0.3.md)


## Разработка
В каталоге apps/client выполните npm ci и npm run dev. Команды npm test и npm run build проверяют модели и собирают интерфейс. Для браузерных тестов выполните npx playwright install chromium и npx playwright test.

## Обновления и выпуск
Клиент получает обновления из официальных [GitHub Releases](https://github.com/itzme-work/Ploom/releases). Владелец однократно настраивает ключи и затем выпускает новую версию через **Actions → Publish Ploom**. [Выпуск из браузера и резервная копия ключей](docs/browser-release.md)

### Системные требования Android 0.3.0

Целевые устройства — телефоны и планшеты Android 9 и новее с 64-битной ARM-системой и обновлённым Android System WebView. Для эмулятора предусмотрен APK x86_64. Для ARMv7 подтверждена экспериментальная сборка APK. Испытания на 32-битном устройстве ещё предстоят. [Матрица версий и статус проверок](docs/android-compatibility.md)
