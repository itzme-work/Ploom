use tauri::{plugin::PluginHandle, Manager};
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("android-update")
        .setup(|app, api| {
            app.manage(api.register_android_plugin("work.itzme.ploom", "AndroidUpdateAdapter")?);
            Ok(())
        })
        .build()
}
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    expected: String,
    progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async(
            "install",
            serde_json::json!({"expected":expected,"progress":progress}),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_download(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("cancel", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_update_browser(app: tauri::AppHandle, expected: String) -> Result<(), String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("openBrowser", serde_json::json!({"expected":expected}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn library_key(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("libraryKey", serde_json::json!({}))
        .await
        .map_err(|_| "Secure storage unavailable".into())
}

#[tauri::command]
pub async fn library_export(
    app: tauri::AppHandle,
    name: String,
    text: String,
) -> Result<(), String> {
    if !super::valid_export(&name, &text) {
        return Err("Invalid export".into());
    }
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async(
            "exportDocument",
            serde_json::json!({"name":name,"text":text}),
        )
        .await
        .map_err(|_| "Export canceled or failed".into())
}

#[tauri::command]
pub async fn tunnel_start(
    app: tauri::AppHandle,
    raw: String,
    lan_endpoint: Option<String>,
) -> Result<(), String> {
    let config = super::connection::tun(super::connection::outbound(&raw, lan_endpoint).await?);
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async(
            "tunnelStart",
            serde_json::json!({"config":config.to_string()}),
        )
        .await
        .map_err(|_| "permission or startup".into())
}
#[tauri::command]
pub async fn tunnel_stop(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("tunnelStop", serde_json::json!({}))
        .await
        .map_err(|_| "stop".into())
}
#[tauri::command]
pub async fn tunnel_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("tunnelState", serde_json::json!({}))
        .await
        .map_err(|_| "state".into())
}

#[tauri::command]
pub async fn scan_qr(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("scanQr", serde_json::json!({}))
        .await
        .map_err(|_| "camera".into())
}

#[tauri::command]
pub async fn traffic_summary(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("trafficSummary", serde_json::json!({}))
        .await
        .map_err(|_| "statistics".into())
}

#[tauri::command]
pub async fn clear_traffic(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("clearTraffic", serde_json::json!({}))
        .await
        .map_err(|_| "statistics".into())
}
