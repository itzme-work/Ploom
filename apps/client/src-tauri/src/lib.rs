#[cfg(windows)]
mod windows;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.invoke_handler(tauri::generate_handler![windows::install_update]).plugin(tauri_plugin_updater::Builder::new().build());
    builder.run(tauri::generate_context!()).expect("Ploom startup failed");
}
