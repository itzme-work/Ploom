use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    channel: String,
    expected: String,
    progress: tauri::ipc::Channel<(String, u64, Option<u64>)>,
) -> Result<(), String> {
    let key = option_env!("PLOOM_UPDATER_PUBLIC_KEY").ok_or("Release signing is not configured")?;
    let version = semver::Version::parse(&expected).map_err(|_| "Invalid release version")?;
    if !matches!(channel.as_str(), "Stable" | "Beta")
        || (channel == "Stable" && !version.pre.is_empty())
        || !version.build.is_empty()
    {
        return Err("Invalid release channel or version".into());
    }
    let release_path = format!("/itzme-work/Ploom/releases/download/v{version}");
    let endpoint = format!("https://github.com{release_path}/latest.json");
    let updater = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![endpoint.parse().map_err(|_| "Invalid endpoint")?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;
    require_signature(&update.signature)?;
    if update.version != expected
        || update.download_url.scheme() != "https"
        || update.download_url.host_str() != Some("github.com")
        || update.download_url.path() != format!("{release_path}/Ploom.exe")
    {
        return Err("Unexpected update metadata".into());
    }
    const LIMIT: usize = 256 * 1024 * 1024;
    let mut response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && matches!(
                    attempt.url().host_str(),
                    Some("github.com" | "release-assets.githubusercontent.com")
                )
            {
                attempt.follow()
            } else {
                attempt.error("Untrusted redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())?
        .get(update.download_url.clone())
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Update download failed")?;
    let total = response.content_length();
    if total.unwrap_or(0) > LIMIT as u64 {
        return Err("Update exceeds size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Download interrupted")? {
        if chunk.len() > LIMIT - bytes.len() {
            return Err("Update exceeds size limit".into());
        }
        bytes.extend_from_slice(&chunk);
        let _ = progress.send(("download".into(), bytes.len() as u64, total));
    }
    let _ = progress.send(("verify".into(), bytes.len() as u64, total));
    update
        .verify(&bytes)
        .map_err(|_| "Update signature rejected")?;
    let _ = progress.send(("install".into(), bytes.len() as u64, total));
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}

fn require_signature(signature: &str) -> Result<(), String> {
    if signature.trim().is_empty() {
        return Err("Unsigned release".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsigned_release_before_download() {
        assert!(require_signature("").is_err());
        assert!(require_signature("  ").is_err());
    }
}
