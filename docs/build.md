Windows x64 требует Rust MSVC, Visual Studio Build Tools C++, WebView2 и Node. В apps/client выполните npm ci и npm run tauri -- build --debug. Выбран NSIS для установки в профиле пользователя и поддержки официальным Tauri Updater.

Android требует JDK 17, Android SDK, NDK и Rust target aarch64-linux-android. В apps/client выполните npm ci, npm run tauri -- android init, затем npm run tauri -- android build --debug --apk --target aarch64. Стабильный идентификатор приложения — work.itzme.ploom.
