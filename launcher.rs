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
    println!("Zum Schliessen Enter druecken...");
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
    println!("Projektordner: {}", dir.display());
    println!();

    if !dir.join("package.json").exists() {
        pause("FEHLER: package.json nicht gefunden. Bitte die .exe in den BabyFlix-Projektordner legen.");
        return;
    }

    if port_open(API_PORT) {
        println!("BabyFlix laeuft bereits (Backend auf Port {API_PORT}).");
        pause("Nichts zu tun.");
        return;
    }

    if port_open(DEV_PORT) {
        println!("Hinweis: Port {DEV_PORT} (Vite) ist belegt - evtl. eine alte Instanz.");
        println!("Falls der Start fehlschlaegt: alte node-Prozesse beenden und erneut versuchen.");
    }

    println!("Starte Vite-HMR + Tauri (Rust). Erststart kann einige Minuten dauern...");
    println!("  Frontend-Aenderungen  -> sofortiges Hot Reload");
    println!("  Backend-Aenderungen   -> automatischer Rebuild + Neustart");
    println!("Zum Beenden: BabyFlix-Fenster schliessen (oder hier Strg+C).");
    println!();

    let status = Command::new("cmd")
        .args(["/c", "npm run tauri dev"])
        .current_dir(&dir)
        .status();

    match status {
        Ok(s) if s.success() => pause("Dev-Session beendet."),
        Ok(s) => pause(&format!("Dev-Session beendet mit Status {s}.")),
        Err(e) => pause(&format!(
            "FEHLER beim Starten: {e}\nIst Node.js/npm installiert und im PATH?"
        )),
    }
}
