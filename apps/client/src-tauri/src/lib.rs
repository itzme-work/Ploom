#[cfg(target_os = "android")]
mod android;
#[cfg(windows)]
mod windows;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android::plugin())
        .invoke_handler(tauri::generate_handler![android::install_update, android::cancel_download, android::open_update_browser]);
    #[cfg(windows)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![windows::install_update])
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .run(tauri::generate_context!())
        .expect("Ploom startup failed");
}
