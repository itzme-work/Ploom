#[cfg(target_os = "android")]
mod android;
mod connection;
#[cfg(windows)]
mod proxy_windows;
mod subscriptions;
#[cfg(windows)]
mod system_proxy;
#[cfg(windows)]
mod tray;
#[cfg(windows)]
mod windows;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        if std::env::args_os().nth(1).as_deref()
            == Some(std::ffi::OsStr::new("--system-proxy-guard"))
        {
            if system_proxy::guard().is_err() {
                std::process::exit(1);
            }
            return;
        }
        system_proxy::recover();
    }
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android::plugin())
        .invoke_handler(tauri::generate_handler![
            subscriptions::library_site,
            android::traffic_summary,
            android::clear_traffic,
            android::tunnel_probe,
            android::scan_qr,
            android::library_export,
            android::tunnel_start,
            android::tunnel_stop,
            android::tunnel_state,
            android::library_key,
            android::install_update,
            android::cancel_download,
            android::open_update_browser,
            subscriptions::subscription_fetch,
            subscriptions::subscription_dns,
            subscriptions::subscription_probe
        ]);
    #[cfg(windows)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            subscriptions::library_site,
            tray::tray_preferences,
            windows::library_export,
            proxy_windows::proxy_probe,
            proxy_windows::proxy_start,
            proxy_windows::proxy_stop,
            proxy_windows::proxy_state,
            windows::library_key,
            windows::install_update,
            subscriptions::subscription_fetch,
            subscriptions::subscription_dns,
            subscriptions::subscription_probe
        ])
        .setup(|app| {
            if tray::setup(app).is_err() {
                eprintln!("System tray unavailable");
            }
            Ok(())
        })
        .on_window_event(tray::handle_close)
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
