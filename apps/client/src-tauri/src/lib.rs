#[cfg(target_os = "android")]
mod android;
mod subscriptions;
#[cfg(windows)]
mod windows;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_deep_link::init());
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android::plugin())
        .invoke_handler(tauri::generate_handler![
            android::library_export,
            android::library_key,
            android::install_update,
            android::cancel_download,
            android::open_update_browser,
            subscriptions::subscription_fetch,
            subscriptions::subscription_probe
        ]);
    #[cfg(windows)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            windows::library_export,
            windows::library_key,
            windows::install_update,
            subscriptions::subscription_fetch,
            subscriptions::subscription_probe
        ])
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .run(tauri::generate_context!())
        .expect("Ploom startup failed");
}

fn valid_export(name: &str, text: &str) -> bool {
    matches!(
        name,
        "ploom-config.txt" | "ploom-backup.json" | "ploom-settings.json"
    ) && text.len() <= 45 * 1024 * 1024
}
