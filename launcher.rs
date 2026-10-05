// BabyFlix Dev Launcher
// Double-clickable .exe that starts the BabyFlix dev environment:
//   - Vite dev server  -> Hot Module Replacement (HMR) for the React UI
//   - `tauri dev`      -> watches the Rust backend and rebuilds/restarts on change
//
// Build:  rustc -O launcher.rs -o BabyFlix-Dev.exe
// Usage:  double-click BabyFlix-Dev.exe (or run it from a terminal)
use std::io::Read;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const API_PORT: u16 = 4523; // BabyFlix backend (Rust/axum)
const DEV_PORT: u16 = 1420; // Vite dev server (HMR)

fn port_open(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    match addr.parse() {
        Ok(a) => TcpStream::connect_timeout(&a, Duration::from_millis(400)).is_ok(),
        Err(_) => false,
    }
}

fn pause(msg: &str) {
    println!("\n{msg}");
    println!("Press Enter to close...");
    let mut buf = String::new();
    let _ = std::io::stdin().read_to_string(&mut buf);
}

fn main() {
    // Project dir = folder containing this exe.
    let dir: PathBuf = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    println!("==============================================");
    println!("  BabyFlix - Dev Launcher (Hot Reload)");
    println!("==============================================");
    println!("Project folder: {}", dir.display());
    println!();

    if !dir.join("package.json").exists() {
        pause("ERROR: package.json not found. Please place the .exe in the BabyFlix project folder.");
        return;
    }

    if port_open(API_PORT) {
        println!("BabyFlix is already running (backend on port {API_PORT}).");
        pause("Nothing to do.");
        return;
    }

    if port_open(DEV_PORT) {
        println!("Note: port {DEV_PORT} (Vite) is in use - possibly a stale instance.");
        println!("If the start fails: kill old node processes and try again.");
    }

    println!("Starting Vite HMR + Tauri (Rust). The first start can take a few minutes...");
    println!("  Frontend changes -> instant hot reload");
    println!("  Backend changes  -> automatic rebuild + restart");
    println!("To stop: close the BabyFlix window (or press Ctrl+C here).");
    println!();

    let status = Command::new("cmd")
        .args(["/c", "npm run tauri dev"])
        .current_dir(&dir)
        .status();

    match status {
        Ok(s) if s.success() => pause("Dev session ended."),
        Ok(s) => pause(&format!("Dev session ended with status {s}.")),
        Err(e) => pause(&format!(
            "ERROR while starting: {e}\nIs Node.js/npm installed and on PATH?"
        )),
    }
}
