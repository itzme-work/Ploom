fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    }
    let manifest = tauri_build::AppManifest::new().commands(&[
        "install_update",
        "library_key",
        "traffic_summary",
        "clear_traffic",
        "scan_qr",
        "library_export",
        "tunnel_start",
        "tunnel_probe",
        "proxy_probe",
        "tray_preferences",
        "proxy_start",
        "proxy_stop",
        "proxy_state",
        "tunnel_stop",
        "request_vpn_notification",
        "tunnel_state",
        "library_site",
        "subscription_fetch",
        "subscription_dns",
        "subscription_probe",
        "cancel_download",
        "open_update_browser",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("build Ploom with the local updater capability");
}
