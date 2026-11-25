use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};

struct TrayState {
    hide_on_close: AtomicBool,
    background_refresh: AtomicBool,
    show: MenuItem<Wry>,
    connect: MenuItem<Wry>,
    disconnect: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open Ploom", true, None::<&str>)?;
    let connect = MenuItem::with_id(
        app,
        "connect",
        "Connect to selected server",
        true,
        None::<&str>,
    )?;
    let disconnect = MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ploom", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &connect, &disconnect, &quit])?;
    let mut tray = TrayIconBuilder::with_id("ploom")
        .tooltip("Ploom")
        .menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "show" | "connect" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                if event.id().as_ref() == "connect" {
                    let _ = window.emit("ploom-connect-selected", ());
                }
            }
        }
        "disconnect" => {
            let _ = super::proxy_windows::proxy_stop();
        }
        "quit" => {
            let _ = super::proxy_windows::proxy_stop();
            app.exit(0);
        }
        _ => {}
    })
    .build(app)?;
    app.manage(TrayState {
        hide_on_close: AtomicBool::new(false),
        background_refresh: AtomicBool::new(false),
        show,
        connect,
        disconnect,
        quit,
    });
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("ploom-subscription-clock".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            if handle
                .state::<TrayState>()
                .background_refresh
                .load(Ordering::Relaxed)
            {
                if let Some(window) = handle.get_webview_window("main") {
                    if matches!(window.is_visible(), Ok(false)) {
                        let _ = window.emit("ploom-refresh-due", ());
                    }
                }
            }
        })?;
    Ok(())
}

pub fn handle_close(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main"
            && window
                .try_state::<TrayState>()
                .is_some_and(|s| s.hide_on_close.load(Ordering::Relaxed))
            && window.hide().is_ok()
        {
            api.prevent_close();
        }
    }
}

#[tauri::command]
pub fn tray_preferences(
    app: AppHandle,
    minimize: bool,
    background: bool,
    russian: bool,
) -> Result<(), String> {
    let state = app.try_state::<TrayState>().ok_or("tray unavailable")?;
    state.hide_on_close.store(minimize, Ordering::Relaxed);
    state
        .background_refresh
        .store(background, Ordering::Relaxed);
    for (item, en, ru) in [
        (&state.show, "Open Ploom", "Открыть Ploom"),
        (
            &state.connect,
            "Connect to selected server",
            "Подключить выбранный сервер",
        ),
        (&state.disconnect, "Disconnect", "Отключить"),
        (&state.quit, "Quit Ploom", "Выйти из Ploom"),
    ] {
        item.set_text(if russian { ru } else { en })
            .map_err(|_| "tray")?;
    }
    Ok(())
}
