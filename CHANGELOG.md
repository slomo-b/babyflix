# Changelog

## [1.0.1] — 2026-10-05

### Changed
- **Login screen:** replaced the diagnostics button with a **DE/EN language switch** that works
  before signing in.
- Moved the **connection diagnosis** into **Settings**.

## [1.0.0] — 2026-10-05

Initial release.

### Features
- **Xtream Codes** login (server URL + username + password) with automatic
  HTTP/HTTPS fallback, multiple user agents and a built-in connection diagnosis.
- **M3U playlist** login as a fallback for providers that block the Xtream API.
- **Movies, series and live TV** with categories, sorting and full-text search.
- **Automatic posters** (from the panel and from IMDb) and **key-free IMDb ratings**.
- **HLS player** with fullscreen, seeking, volume and keyboard shortcuts.
- **EPG** (now / next) for live channels.
- **Continue watching** (local watch progress).
- **German / English** interface with a language switch.
- Remembered login (cleared only when the account is removed).
- Windows installer (**NSIS `.exe`** and **MSI**); macOS and Linux via CI.
- **Automatic updates** from GitHub Releases (Tauri updater).

### Legal
BabyFlix provides no content. It is a player for your own authorized IPTV access.
IMDb data is used for personal, non-commercial purposes only.
