mod embed;
mod imdb;
mod m3u;
mod mpv;
mod proxy;
mod ratings;
mod remux;
mod routes;
mod state;
mod xtream;

use std::sync::Arc;

use tauri::Manager;

#[tauri::command]
fn api_base() -> String {
    proxy::origin()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The embedded video surface needs a native window id; on Linux that means
    // X11 (`mpv --wid`), so a Wayland session is served through XWayland. Set
    // GDK_BACKEND=wayland to opt out - then MPV docks its own window instead.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let state = state::App::new(dir);

            // Native video surface: hand the window's raw handle to the MPV
            // engine so it can paint into a child window of the app.
            if let Some(window) = app.get_webview_window("main") {
                let host = crate::embed::host_handle(&window);
                match &host {
                    Some(h) => eprintln!(
                        "[babyflix] embed host {:?} {:#x}",
                        h.kind, h.native
                    ),
                    None => eprintln!(
                        "[babyflix] no native window handle - MPV will use its own window"
                    ),
                }
                state.set_host(window, host);
            }

            // Start the local HTTP API (streaming proxy + catalog + metadata).
            let api_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let router = routes::router(api_state);
                match tokio::net::TcpListener::bind(("127.0.0.1", proxy::PORT)).await {
                    Ok(listener) => {
                        eprintln!("[babyflix] API listening on {}", proxy::origin());
                        if let Err(e) = axum::serve(listener, router).await {
                            eprintln!("[babyflix] server error: {e}");
                        }
                    }
                    Err(e) => eprintln!("[babyflix] could not bind port {}: {e}", proxy::PORT),
                }
            });

            // Provision FFmpeg/FFprobe (VOD remux) when the system has none.
            let provision = state.clone();
            tauri::async_runtime::spawn(async move {
                provision.remux.ensure_binaries(&provision.client).await;
            });

            // Restore session + pre-load keyless IMDb ratings in the background.
            let boot_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = boot_state.autologin().await {
                    eprintln!("[babyflix] autologin skipped: {e}");
                }
                boot_state.ensure_ratings();
            });

            // Reap idle FFmpeg remux sessions and an idle MPV process.
            let reap_state = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    reap_state.remux.reap();
                    reap_state.mpv.reap();
                }
            });

            app.manage(state);
            Ok(())
        })
        // Keep the embedded video glued to the stage rectangle while the user
        // moves/resizes the window (and mirror focus for docked MPV windows).
        .on_window_event(|window, event| {
            use tauri::WindowEvent;
            let handle = window.app_handle();
            let Some(state) = handle.try_state::<Arc<state::App>>() else {
                return;
            };
            match event {
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. } => {
                    state.restage(window.is_focused().unwrap_or(true));
                }
                WindowEvent::Focused(on) => state.restage(*on),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![api_base])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Never leave an orphaned MPV window behind.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Arc<state::App>>() {
                    state.mpv.stop();
                }
            }
        });
}
