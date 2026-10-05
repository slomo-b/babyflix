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

  favorites: string[];
  toggleFavorite: (key: string) => void;
  isFavorite: (key: string) => boolean;

  history: HistoryItem[];
  saveHistory: (h: HistoryItem) => void;
  removeHistory: (key: string) => void;
  clearHistory: () => void;

  autoplayNext: boolean;
  setAutoplayNext: (v: boolean) => void;

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
      toggleFavorite: (key) =>
        set((s) => ({
          favorites: s.favorites.includes(key)
            ? s.favorites.filter((k) => k !== key)
            : [...s.favorites, key],
        })),
      isFavorite: (key) => get().favorites.includes(key),

      history: [],
      saveHistory: (h) =>
        set((s) => {
          const rest = s.history.filter((x) => x.key !== h.key);
          return { history: [h, ...rest].slice(0, 60) };
        }),
      removeHistory: (key) => set((s) => ({ history: s.history.filter((x) => x.key !== key) })),
      clearHistory: () => set({ history: [] }),

      autoplayNext: true,
      setAutoplayNext: (v) => set({ autoplayNext: v }),

      savedLogin: null,
      setSavedLogin: (v) => set({ savedLogin: v }),
    }),
    {
      name: "babyflix-store",
      partialize: (s) => ({
        history: s.history,
        favorites: s.favorites,
        autoplayNext: s.autoplayNext,
        savedLogin: s.savedLogin,
      }),
    }
  )
);
