# BabyFlix

Eine **Plex-artige Desktop-Streaming-App** für Filme, Serien und Live-TV – gebaut auf der
**Xtream Codes API** (dein eigener IPTV-Zugang) mit **automatischen Covern** und **echten
IMDb-Bewertungen**. Läuft als native Windows-Desktop-App (**Tauri 2 + React + Rust**).

> BabyFlix stellt **keine** Inhalte bereit. Du nutzt deinen eigenen, autorisierten Xtream-Zugang.

---

## Features

- 🎬 **Filme / Serien / Live-TV** mit Kategorien, Suche und Sortierung
- 🖼️ **Automatische Cover** – aus deinem Panel und (keyless) von IMDb
- ⭐ **Echte IMDb-Bewertungen + Stimmen** – komplett **ohne API-Key**
- ▶️ **HLS/TSt-Player** (hls.js) mit Fullscreen, Spulen, Lautstärke, Tastenkürzeln
- 📺 **Live-TV** mit Sender-Logos und **EPG** („Jetzt / Danach“)
- 📚 **Serien** mit Staffeln und Episoden, Autoplay der nächsten Folge
- ⏱️ **Weiterschauen** (Fortschritt wird lokal gespeichert)
- 🎨 Dunkles Premium-UI mit Hero-Banner, Hover-Effekten, Skeletons

## So funktioniert die Keyless-Metadaten-Anreicherung

1. **Cover** kommen primär direkt vom Xtream-Panel (`stream_icon`, `movie_image`, `cover`).
2. **Titel → IMDb-ID** über die öffentliche IMDb-Suggestion-API (kein Key, kein WAF).
3. **IMDb-Rating + Anzahl Stimmen** aus dem offiziellen IMDb-Dataset
   `title.ratings.tsv.gz` – wird einmalig geladen und als kompakter Index gecacht.
4. Zusätzlich: IMDb-Poster und Top-Cast aus der Suggestion-API.

Alles wird lokal aggressiv gecacht. Es wird **kein** API-Key benötigt.

---

## Starten (Entwicklung)

```powershell
npm install
npm run tauri dev
```

Beim ersten Start werden die Rust-Abhängigkeiten kompiliert (dauert einige Minuten) und die
IMDb-Daten einmalig heruntergeladen (~9 MB).

### Dev-Launcher als `.exe` (mit Hot Reload) — `BabyFlix-Dev.exe`

Für den Doppelklick-Workflow liegt im Projektordner eine kleine native Windows-`.exe`, die den
kompletten Dev-Stack startet:

- **Vite dev server** → Hot Module Replacement (HMR) für das React-Frontend
- **`tauri dev`** → überwacht das Rust-Backend und baut/startet bei Änderungen automatisch neu

Einfach **`BabyFlix-Dev.exe`** doppelklicken. Sie ermittelt den Projektordner selbst (Ordner der
`.exe`), erkennt bereits laufende Instanzen und hält offene Ausgaben in `dev.out.log` /
`dev.err.log`.

Neu bauen (falls sich der Launcher ändert):

```powershell
rustc -O launcher.rs -o BabyFlix-Dev.exe
```

> Hinweis: Der Dev-Build lädt die App aus dem Vite-Dev-Server (deshalb HMR). Er ist **nicht**
> als eigenständige Einzeldatei nutzbar. Für eine eigenständige `.exe` ohne Dev-Server:
> `npm run tauri build` (Release, kein Hot Reload).

## Installer / Builds

BabyFlix ist für **Windows, macOS und Linux** vorbereitet.
Wichtig: Ein **macOS-Build ist von Windows aus nicht möglich** – er entsteht auf einem Mac oder
über die mitgelieferte **GitHub-Actions-CI** (`.github/workflows/build.yml`).

### Windows
```powershell
npm install
npm run tauri build
```
Ergebnisse in `src-tauri/target/release/bundle/`:
- `nsis/BabyFlix_*_x64-setup.exe` (Installer)
- `msi/BabyFlix_*_x64_en-US.msi` (MSI, sofern WiX verfügbar)

### macOS (auf einem Mac)
```bash
npm install
npm run tauri build                                   # .app + .dmg
npm run tauri build -- --target aarch64-apple-darwin  # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin   # Intel
```
Ergebnisse unter `src-tauri/target/**/release/bundle/macos/BabyFlix.app` und
`.../dmg/BabyFlix_*.dmg`. Voraussetzung: `xcode-select --install` und Rust.

### Linux
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
npm install && npm run tauri build
```

### CI: alle Plattformen auf einmal
Tag pushen oder den Workflow manuell starten:
```bash
git tag v0.1.0 && git push origin v0.1.0
```
Die Artefakte (`.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb`) werden als Build-Artifacts hochgeladen.

## Erste Schritte in der App

Beim Login gibt es **zwei Modi** (Umschalter oben im Formular):

**A) Xtream Codes** (JSON-API)
1. **Server-URL** deines Xtream-Panels eingeben (z. B. `http://server.tv:8080`).
2. **Benutzername** und **Passwort** eintragen → *Anmelden*.
3. Katalog wird geladen, Cover/IMDb-Ratings automatisch angereichert.

**B) M3U-Playlist** (Fallback)
1. Reiter **M3U-Playlist** wählen.
2. Die **komplette Playlist-URL** einfügen, z. B.
   `http://server:8080/get.php?username=USER&password=PASS&type=m3u_plus&output=hls`.
3. *Anmelden* → BabyFlix parst Sender, Filme und Serien aus der Playlist.
   `output=hls` liefert abspielbare Streams (`.m3u8`); bei `.ts`-Links versucht
   BabyFlix automatisch die HLS-Variante.

> Tipp: Die M3U-Route funktioniert oft, wenn die Xtream-API vom Anbieter geblockt wird.

Die Zugangsdaten werden lokal gespeichert (App-Data-Ordner) und beim nächsten Start
automatisch verwendet.

### Bedienung im Player

| Taste | Aktion |
|---|---|
| `Space` | Play / Pause |
| `←` / `→` | 10 s zurück / vor |
| `↑` / `↓` | Lautstärke |
| `F` | Vollbild |
| `M` | Stumm |
| `Esc` | Player schließen |

---

## Architektur

```
Tauri-Fenster (WebView2)
 ├─ React + Vite + Tailwind  (src/)            UI, Router, Player (hls.js)
 └─ Rust-Backend (src-tauri/src/)              läuft als lokaler HTTP-Server auf :4523
     ├─ xtream.rs   Xtream-Codes-Client (Login, Katalog, Details, EPG)
     ├─ imdb.rs     keyless IMDb (Suggestion-API)
     ├─ ratings.rs  IMDb-Ratings-Index aus title.ratings.tsv.gz
     ├─ proxy.rs    Stream-/HLS-/Bild-Proxy (Range, m3u8-Rewrite)
     ├─ state.rs    Session, Katalog-Cache, Enrichment-Cache
     └─ routes.rs   HTTP-API (axum)
```

**Warum ein lokaler Server im Rust-Prozess?** So gibt es keine CORS-/Mixed-Content-Probleme,
HLS-Playback läuft zuverlässig, Seeking funktioniert per HTTP-Range, und die Zugangsdaten
bleiben im Backend (nie im Frontend-Code). Der Server bindet ausschließlich an `127.0.0.1`.

### API-Endpunkte (lokal)
`/api/health` · `/api/login` · `/api/logout` · `/api/session` · `/api/categories` ·
`/api/browse` · `/api/home` · `/api/detail` · `/api/epg` · `/api/enrich` ·
`/api/enrich_batch` · `/api/refresh` · `/api/player` · `/api/proxy` · `/api/img`

---

## Hinweise

- **Toolchain:** Der Rechner nutzt die Rust-**GNU**-Toolchain. Für eine reine Desktop-App ist
  `crate-type = ["rlib"]` gesetzt (die Standard-`cdylib`/`staticlib`-Typen überschreiten unter
  Windows-GNU das Export-Limit → „export ordinal too large“). Für Mobile-Builds ggf. `staticlib`
  und `cdylib` wieder ergänzen und eine MSVC-Toolchain verwenden.
- **Rechtliches:** Nutze ausschließlich autorisierte Zugänge. IMDb-Daten sind für persönliche,
  nicht-kommerzielle Nutzung vorgesehen. BabyFlix hostet und liefert keine Inhalte.
