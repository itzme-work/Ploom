use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, channel: String, expected: String) -> Result<(), String> {
    let feed = match channel.as_str() {
        "Stable" => "stable",
        "Beta" => "beta",
        _ => return Err("Invalid channel".into()),
    };
    let key = option_env!("PLOOM_UPDATER_PUBLIC_KEY").ok_or("Release signing is not configured")?;
    let endpoint = format!("https://github.com/itzme-work/Ploom/releases/download/{feed}-feed/latest.json");
    let updater = app.updater_builder().pubkey(key)
        .endpoints(vec![endpoint.parse().map_err(|_| "Invalid endpoint")?])
        .map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("No update available")?;
    if update.version != expected || update.download_url.scheme() != "https"
        || update.download_url.host_str() != Some("github.com")
        || !update.download_url.path().starts_with("/itzme-work/Ploom/releases/download/") {
        return Err("Unexpected update metadata".into());
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}
