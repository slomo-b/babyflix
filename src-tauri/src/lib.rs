mod imdb;
mod m3u;
mod proxy;
mod ratings;
mod remux;
mod routes;
mod state;
mod xtream;

use tauri::Manager;

#[tauri::command]
fn api_base() -> String {
    proxy::origin()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

            // Restore session + pre-load keyless IMDb ratings in the background.
            let boot_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = boot_state.autologin().await {
                    eprintln!("[babyflix] autologin skipped: {e}");
                }
                boot_state.ensure_ratings();
            });

            // Reap idle FFmpeg remux sessions.
            let reap_state = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    reap_state.remux.reap();
                }
            });

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_base])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
