use tauri::{Manager,plugin::PluginHandle};
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("android-update").setup(|app, api| {
        app.manage(api.register_android_plugin("work.itzme.ploom", "AndroidUpdateAdapter")?);
        Ok(())
    }).build()
}
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, expected: String) -> Result<(),String> {
    app.state::<PluginHandle<tauri::Wry>>().run_mobile_plugin_async("install",serde_json::json!({"expected":expected})).await.map_err(|e|e.to_string())
}
