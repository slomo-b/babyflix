import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PlayNext {
  kind: "movie" | "series" | "live";
  id: string;
  ext?: string;
  title: string;
  subtitle?: string;
}

export interface PlayRequest {
 kind: "movie" | "series" | "live";
 id: string;
 ext?: string;
 title: string;
 poster?: string;
 subtitle?: string;
 historyKey: string;
 next?: PlayNext;
 /** Bei Serien: ID der Serie (nicht der Folge) - erlaubt dem Player, selbst die
  *  nächste Folge nachzuladen und so endlos weiterzuspielen. */
 seriesId?: string;
 /** Fortsetzen-Angebot: erst ab dieser Sekunde statt bei 0 starten. */
 startAt?: number;
 }

export interface HistoryItem {
  key: string;
  kind: "movie" | "series" | "live";
  id: string;
  ext?: string;
  title: string;
  poster?: string;
  subtitle?: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface FavoriteItem {
  key: string;
  kind: "movie" | "series" | "live";
  id: string;
  name: string;
  poster?: string;
}

export interface SavedLogin {
  mode: "xtream" | "m3u";
  baseUrl: string;
  username: string;
  password: string;
  m3uUrl: string;
}

interface AppStore {
  current: PlayRequest | null;
  play: (r: PlayRequest) => void;
  stop: () => void;

  favorites: FavoriteItem[];
  toggleFavorite: (item: FavoriteItem) => void;
  isFavorite: (key: string) => boolean;

  history: HistoryItem[];
  saveHistory: (h: HistoryItem) => void;
  removeHistory: (key: string) => void;
  clearHistory: () => void;

  autoResume: boolean;
  setAutoResume: (v: boolean) => void;

  autoplayNext: boolean;
  setAutoplayNext: (v: boolean) => void;

  /** Erwachsenen-Kategorien (Adult/XXX/Erotik …) ausblenden. Standard: an. */
  hideAdult: boolean;
  setHideAdult: (v: boolean) => void;

  /** Wiedergabe-Engine: "mpv" = native MPV-Engine (Hauptweg, im App-Fenster
   *  eingebettet), "web" = hls.js-Webview als Rückfallebene ohne MPV. */
  playerEngine: "web" | "mpv";
  setPlayerEngine: (v: "web" | "mpv") => void;

  /** Remembered login, so the user stays signed in until the account is removed. */
  savedLogin: SavedLogin | null;
  setSavedLogin: (v: SavedLogin | null) => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      current: null,
      play: (r) => set({ current: r }),
      stop: () => set({ current: null }),

      favorites: [],
      toggleFavorite: (item) =>
        set((s) => ({
          favorites: s.favorites.some((f) => f.key === item.key)
            ? s.favorites.filter((f) => f.key !== item.key)
            : [item, ...s.favorites],
        })),
      isFavorite: (key) => get().favorites.some((f) => f.key === key),

      history: [],
      saveHistory: (h) =>
        set((s) => {
          const rest = s.history.filter((x) => x.key !== h.key);
          return { history: [h, ...rest].slice(0, 60) };
        }),
      removeHistory: (key) => set((s) => ({ history: s.history.filter((x) => x.key !== key) })),
      clearHistory: () => set({ history: [] }),

      autoResume: true,
      setAutoResume: (v) => set({ autoResume: v }),

      autoplayNext: true,
      setAutoplayNext: (v) => set({ autoplayNext: v }),

      hideAdult: true,
      setHideAdult: (v) => set({ hideAdult: v }),

      playerEngine: "mpv",
      setPlayerEngine: (v) => set({ playerEngine: v }),

      savedLogin: null,
      setSavedLogin: (v) => set({ savedLogin: v }),
    }),
    {
      name: "babyflix-store",
      version: 3,
      migrate: (state, version) => {
        // v0/v1 stored favorites as a string[]; reset them to objects.
        if (version < 2) {
          return { ...(state as Record<string, unknown>), favorites: [] } as unknown as AppStore;
        }
        // v2 -> v3: MPV ist jetzt die Haupt-Engine (Video läuft im App-Fenster).
        if (version < 3) {
          return { ...(state as Record<string, unknown>), playerEngine: "mpv" } as unknown as AppStore;
        }
        return state as AppStore;
      },
      partialize: (s) => ({
        history: s.history,
        favorites: s.favorites,
        autoplayNext: s.autoplayNext,
        autoResume: s.autoResume,
        hideAdult: s.hideAdult,
        playerEngine: s.playerEngine,
        savedLogin: s.savedLogin,
      }),
    }
  )
);
