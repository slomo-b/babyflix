import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Lang = "de" | "en";

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLang = create<LangStore>()(
  persist(
    (set, get) => ({
      lang: "de",
      setLang: (l) => set({ lang: l }),
      toggle: () => set({ lang: get().lang === "de" ? "en" : "de" }),
    }),
    { name: "babyflix-lang" }
  )
);

/** BCP-47 locale for dates/numbers. */
export function localeOf(lang: Lang): string {
  return lang === "de" ? "de-DE" : "en-US";
}

const de: Record<string, string> = {
  // app
  "app.loading": "BabyFlix wird geladen…",
  "common.play": "Abspielen",
  "common.details": "Details",
  "common.back": "Zurück",
  "common.close": "Schließen",
  "common.remove": "Entfernen",
  "common.movie": "Film",
  "common.serie": "Serie",
  "common.live": "Live",
  "common.all": "Alle",
  "common.retry": "Erneut versuchen",

  // nav / sidebar
  "nav.home": "Start",
  "nav.movies": "Filme",
  "nav.series": "Serien",
  "nav.live": "Live-TV",
  "nav.search": "Suche",
  "nav.settings": "Einstellungen",
  "sidebar.tagline": "Streaming",
  "sidebar.notSignedIn": "Nicht angemeldet",

  // topbar
  "topbar.searchPlaceholder": "Filme, Serien, Sender suchen…",
  "topbar.library": "Katalog",
  "topbar.update": "Update",
  "topbar.ratingsReady": "IMDb-Daten bereit",
  "topbar.ratingsLoading": "IMDb-Daten werden geladen…",
  "topbar.switchLang": "Sprache wechseln",

  // login
  "login.title": "Melde dich mit deinem IPTV-Zugang an (Xtream Codes oder M3U-Playlist)",
  "login.tab.xtream": "Xtream Codes",
  "login.tab.m3u": "M3U-Playlist",
  "login.serverUrl": "Server-URL",
  "login.username": "Benutzername",
  "login.password": "Passwort",
  "login.m3uUrl": "M3U-Playlist-URL",
  "login.m3uHint":
    "Füge die komplette Playlist-URL deines Anbieters ein (beginnt meist mit …/get.php? oder endet auf .m3u/.m3u8). BabyFlix liest daraus Sender, Filme und Serien. Tipp: output=hls liefert abspielbare Streams.",
  "login.connect": "Verbinde…",
  "login.signIn": "Anmelden",
  "login.diagnoseTitle": "Verbindung zum Server testen",
  "login.failed": "Login fehlgeschlagen.",
  "login.diagFailed": "Diagnose fehlgeschlagen.",
  "login.diagResults": "Diagnose · erkannte URL:",
  "login.diagNoHttp": "kein HTTP",
  "login.savedHint": "Gespeicherte Anmeldung geladen – du bleibst angemeldet, bis du das Konto entfernst.",
  "login.needProtocol": "Bitte die vollständige Server-Adresse inkl. http:// oder https:// eingeben.",
  "update.title": "Updates",
  "update.check": "Nach Updates suchen",
  "update.checking": "Suche…",
  "update.upToDate": "Du hast die neueste Version.",
  "update.available": "Version {v} verfügbar",
  "update.bannerHint": "Ein Update ist verfügbar. BabyFlix wird nach der Installation neu gestartet.",
  "update.install": "Jetzt aktualisieren",
  "update.downloading": "Wird heruntergeladen… {p}%",
  "update.currentVersion": "Aktuelle Version: {v}",
  "update.error": "Update fehlgeschlagen: {e}",
  "login.privacy":
    "Deine Zugangsdaten bleiben lokal auf diesem Gerät. BabyFlix stellt keine Inhalte bereit – du nutzt deinen eigenen, autorisierten Zugang.",

  // home
  "home.continue": "Weiterschauen",
  "home.loadError": "Inhalte konnten nicht geladen werden:",

  // row
  "row.seeAll": "Alle anzeigen",
  "row.prev": "Zurück",
  "row.next": "Weiter",

  // hero
  "hero.recommended": "Empfohlen",

  // catalog
  "catalog.filter": "Filtern…",
  "catalog.sort.added": "Zuletzt hinzugefügt",
  "catalog.sort.name": "Name (A–Z)",
  "catalog.sort.rating": "Bewertung",
  "catalog.items": "{n} Einträge",
  "catalog.empty": "Keine Einträge gefunden.",
  "catalog.loadingMore": "Lädt weitere…",
  "catalog.scrollMore": "Weiter scrollen…",
  "catalog.end": "Ende der Liste",
  "movies.title": "Filme",
  "movies.subtitle": "Deine Film-Bibliothek mit Covern und Bewertungen",
  "series.title": "Serien",
  "series.subtitle": "Serien mit Staffeln und Episoden",

  // cards
  "card.catchup": "Catch-up",

  // live
  "live.title": "Live-TV",
  "live.channels": "{n} Sender",
  "live.nowPlaying": "Jetzt läuft:",
  "live.allCategories": "Alle Kategorien",
  "live.searchPlaceholder": "Sender suchen…",
  "live.watchNow": "Jetzt ansehen",
  "live.program": "Programm",
  "live.now": "Jetzt",
  "live.noEpg": "Keine Programminformationen für diesen Sender.",
  "live.selectChannel": "Sender auswählen",
  "live.none": "Keine Sender gefunden.",

  // search
  "search.title": "Suche",
  "search.placeholder": "Suche nach Filmen, Serien oder Sendern…",
  "search.hint": "Gib mindestens zwei Zeichen ein, um den gesamten Katalog zu durchsuchen.",
  "search.noResults": "Keine Treffer für „{q}“.",

  // detail
  "detail.firstEpisode": "Erste Folge",
  "detail.noEpisodes": "Keine Folgen",
  "detail.addFavorite": "Zur Merkliste",
  "detail.inFavorites": "In Merkliste",
  "detail.trailer": "Trailer",
  "detail.director": "Regie:",
  "detail.cast": "Besetzung:",
  "detail.season": "Staffel {n}",
  "detail.noSeasonEpisodes": "Für diese Staffel sind keine Episoden hinterlegt.",
  "detail.loadError": "Details konnten nicht geladen werden:",
  "detail.overview": "Handlung",
  "detail.directorTitle": "Regie",
  "detail.castTitle": "Besetzung",
  "detail.episodes": "Folgen",

  // settings
  "settings.title": "Einstellungen",
  "settings.account": "Konto & Server",
  "settings.source": "Quelle",
  "settings.sourceXtream": "Xtream Codes",
  "settings.sourceM3u": "M3U-Playlist",
  "settings.user": "Benutzer",
  "settings.status": "Status",
  "settings.expires": "Läuft ab",
  "settings.connections": "Verbindungen",
  "settings.server": "Server",
  "settings.formats": "Formate",
  "settings.unlimited": "unbegrenzt",
  "settings.catalog": "Katalog",
  "settings.movies": "Filme",
  "settings.series": "Serien",
  "settings.channels": "Sender",
  "settings.reload": "Katalog neu laden",
  "settings.reloading": "Aktualisiere…",
  "settings.playback": "Wiedergabe",
  "settings.language": "Sprache",
  "settings.languageHint": "Sprache der Oberfläche.",
  "settings.autoplay": "Nächste Folge automatisch abspielen",
  "settings.autoplayHint": "Startet bei Serien automatisch die folgende Episode.",
  "settings.history": "Wiedergabeverlauf",
  "settings.historyCount": "{n} Einträge",
  "settings.clearHistory": "Verlauf löschen",
  "settings.about": "Über BabyFlix",
  "settings.aboutText":
    "BabyFlix ist ein Plex-artiger Player für deine eigenen, autorisierten IPTV-Zugänge (Xtream Codes API). Cover, Beschreibungen und Bewertungen werden aus deinem Panel sowie aus öffentlichen, schlüsselfreien IMDb-Daten angereichert. BabyFlix stellt selbst keine Inhalte bereit. IMDb-Daten dienen ausschließlich der persönlichen, nicht-kommerziellen Nutzung.",
  "settings.logout": "Abmelden",
  "settings.diagnosis": "Verbindungsdiagnose",
  "settings.diagnosisHint": "Prüft die Erreichbarkeit deines Xtream-Servers (HTTP/HTTPS und verschiedene User-Agents).",
  "settings.diagnosisM3u": "Für M3U-Playlists ist keine Diagnose verfügbar – die Playlist wird beim Anmelden direkt geladen.",
  "settings.diagnose": "Diagnose starten",
  "settings.diagnosing": "Prüfe…",

  // player
  "player.live": "Live",
  "player.close": "Schließen",
  "player.streamError":
    "Stream konnte nicht geladen werden. Der Sender/Film ist evtl. gerade nicht verfügbar.",

  // rating badge
  "rating.imdb": "IMDb-Bewertung",
  "rating.panel": "Panel-Bewertung",
};

const en: Record<string, string> = {
  "app.loading": "Loading BabyFlix…",
  "common.play": "Play",
  "common.details": "Details",
  "common.back": "Back",
  "common.close": "Close",
  "common.remove": "Remove",
  "common.movie": "Movie",
  "common.serie": "Series",
  "common.live": "Live",
  "common.all": "All",
  "common.retry": "Try again",

  "nav.home": "Home",
  "nav.movies": "Movies",
  "nav.series": "Series",
  "nav.live": "Live TV",
  "nav.search": "Search",
  "nav.settings": "Settings",
  "sidebar.tagline": "Streaming",
  "sidebar.notSignedIn": "Not signed in",

  "topbar.searchPlaceholder": "Search movies, series, channels…",
  "topbar.library": "Library",
  "topbar.update": "Update",
  "topbar.ratingsReady": "IMDb data ready",
  "topbar.ratingsLoading": "Loading IMDb data…",
  "topbar.switchLang": "Switch language",

  "login.title": "Sign in with your IPTV access (Xtream Codes or M3U playlist)",
  "login.tab.xtream": "Xtream Codes",
  "login.tab.m3u": "M3U playlist",
  "login.serverUrl": "Server URL",
  "login.username": "Username",
  "login.password": "Password",
  "login.m3uUrl": "M3U playlist URL",
  "login.m3uHint":
    "Paste your provider's full playlist URL (usually starts with …/get.php? or ends in .m3u/.m3u8). BabyFlix reads channels, movies and series from it. Tip: output=hls gives playable streams.",
  "login.connect": "Connecting…",
  "login.signIn": "Sign in",
  "login.diagnoseTitle": "Test server connection",
  "login.failed": "Sign-in failed.",
  "login.diagFailed": "Diagnosis failed.",
  "login.diagResults": "Diagnosis · detected URL:",
  "login.diagNoHttp": "no HTTP",
  "login.savedHint": "Saved sign-in loaded – you stay signed in until you remove the account.",
  "login.needProtocol": "Please enter the full server address including http:// or https://.",
  "update.title": "Updates",
  "update.check": "Check for updates",
  "update.checking": "Checking…",
  "update.upToDate": "You are on the latest version.",
  "update.available": "Version {v} available",
  "update.bannerHint": "An update is available. BabyFlix will restart after installing.",
  "update.install": "Update now",
  "update.downloading": "Downloading… {p}%",
  "update.currentVersion": "Current version: {v}",
  "update.error": "Update failed: {e}",
  "login.privacy":
    "Your credentials stay local on this device. BabyFlix provides no content – you use your own authorized access.",

  "home.continue": "Continue watching",
  "home.loadError": "Could not load content:",

  "row.seeAll": "See all",
  "row.prev": "Previous",
  "row.next": "Next",

  "hero.recommended": "Recommended",

  "catalog.filter": "Filter…",
  "catalog.sort.added": "Recently added",
  "catalog.sort.name": "Name (A–Z)",
  "catalog.sort.rating": "Rating",
  "catalog.items": "{n} items",
  "catalog.empty": "No items found.",
  "catalog.loadingMore": "Loading more…",
  "catalog.scrollMore": "Scroll for more…",
  "catalog.end": "End of list",
  "movies.title": "Movies",
  "movies.subtitle": "Your movie library with posters and ratings",
  "series.title": "Series",
  "series.subtitle": "Series with seasons and episodes",

  "card.catchup": "Catch-up",

  "live.title": "Live TV",
  "live.channels": "{n} channels",
  "live.nowPlaying": "Now playing:",
  "live.allCategories": "All categories",
  "live.searchPlaceholder": "Search channels…",
  "live.watchNow": "Watch now",
  "live.program": "Schedule",
  "live.now": "Now",
  "live.noEpg": "No programme information for this channel.",
  "live.selectChannel": "Select a channel",
  "live.none": "No channels found.",

  "search.title": "Search",
  "search.placeholder": "Search movies, series or channels…",
  "search.hint": "Enter at least two characters to search the whole library.",
  "search.noResults": "No results for “{q}”.",

  "detail.firstEpisode": "First episode",
  "detail.noEpisodes": "No episodes",
  "detail.addFavorite": "Add to watchlist",
  "detail.inFavorites": "In watchlist",
  "detail.trailer": "Trailer",
  "detail.director": "Director:",
  "detail.cast": "Cast:",
  "detail.season": "Season {n}",
  "detail.noSeasonEpisodes": "No episodes available for this season.",
  "detail.loadError": "Could not load details:",
  "detail.overview": "Overview",
  "detail.directorTitle": "Director",
  "detail.castTitle": "Cast",
  "detail.episodes": "Episodes",

  "settings.title": "Settings",
  "settings.account": "Account & server",
  "settings.source": "Source",
  "settings.sourceXtream": "Xtream Codes",
  "settings.sourceM3u": "M3U playlist",
  "settings.user": "User",
  "settings.status": "Status",
  "settings.expires": "Expires",
  "settings.connections": "Connections",
  "settings.server": "Server",
  "settings.formats": "Formats",
  "settings.unlimited": "unlimited",
  "settings.catalog": "Library",
  "settings.movies": "Movies",
  "settings.series": "Series",
  "settings.channels": "Channels",
  "settings.reload": "Reload library",
  "settings.reloading": "Refreshing…",
  "settings.playback": "Playback",
  "settings.language": "Language",
  "settings.languageHint": "Interface language.",
  "settings.autoplay": "Autoplay next episode",
  "settings.autoplayHint": "Automatically plays the next episode for series.",
  "settings.history": "Watch history",
  "settings.historyCount": "{n} entries",
  "settings.clearHistory": "Clear history",
  "settings.about": "About BabyFlix",
  "settings.aboutText":
    "BabyFlix is a Plex-like player for your own authorized IPTV access (Xtream Codes API). Posters, descriptions and ratings are enriched from your panel and from public, key-free IMDb data. BabyFlix provides no content itself. IMDb data is for personal, non-commercial use only.",
  "settings.logout": "Sign out",
  "settings.diagnosis": "Connection diagnosis",
  "settings.diagnosisHint": "Checks reachability of your Xtream server (HTTP/HTTPS and different user agents).",
  "settings.diagnosisM3u": "No diagnosis is available for M3U playlists – the playlist is loaded directly when signing in.",
  "settings.diagnose": "Run diagnosis",
  "settings.diagnosing": "Checking…",

  "player.live": "Live",
  "player.close": "Close",
  "player.streamError": "Stream could not be loaded. The channel/movie may be unavailable right now.",

  "rating.imdb": "IMDb rating",
  "rating.panel": "Panel rating",
};

const translations: Record<Lang, Record<string, string>> = { de, en };

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = translations[lang]?.[key] ?? translations.de[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** React hook: returns a `t` function bound to the current language. */
export function useT() {
  const lang = useLang((s) => s.lang);
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}
