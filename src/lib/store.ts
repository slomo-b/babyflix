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
  /** Bei Serien: ID der Serie (nicht der Folge) - gruppiert alle Folgen zu einem Regal-Eintrag. */
  seriesId?: string;
  title: string;
  poster?: string;
  subtitle?: string;
  position: number;
  duration: number;
  updatedAt: number;
}

/** Titel -> Serien-ID, für Einträge, die schon eine ID tragen. */
export function seriesIdsByTitle(history: HistoryItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of history) if (h.seriesId) map.set(h.title, h.seriesId);
  return map;
}

/**
 * Gruppenschlüssel eines Verlaufs-Eintrags: alle Folgen einer Serie teilen sich
 * einen Schlüssel, Filme und Sender bleiben jeweils für sich.
 *
 * Ältere Einträge kennen noch keine `seriesId` – sie werden über den Titel
 * zugeordnet, damit auch bereits vorhandene Verläufe gruppiert werden.
 */
export function historyGroupKey(h: HistoryItem, idsByTitle: Map<string, string>): string {
  if (h.kind !== "series") return h.key;
  return `series:${h.seriesId ?? idsByTitle.get(h.title) ?? h.title}`;
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
  /** Alle Folgen einer Serie (bzw. den Eintrag selbst) aus dem Verlauf entfernen. */
  removeHistoryGroup: (h: HistoryItem) => void;
  clearHistory: () => void;

  autoResume: boolean;
  setAutoResume: (v: boolean) => void;

  autoplayNext: boolean;
  setAutoplayNext: (v: boolean) => void;

  /** Erwachsenen-Kategorien (Adult/XXX/Erotik …) ausblenden. Standard: an. */
  hideAdult: boolean;
  setHideAdult: (v: boolean) => void;

  /** Kategorie-Sidebar (Filme/Serien/Live) aufgeklappt? Standard: ja. */
  categorySidebarOpen: boolean;
  setCategorySidebarOpen: (v: boolean) => void;

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
  /**
   * Ganze Gruppe entfernen: bei einer Serie also alle Folgen. Sonst würde nach
   * dem Entfernen sofort die vorherige Folge im Regal auftauchen.
   */
  removeHistoryGroup: (h) =>
    set((s) => {
      const ids = seriesIdsByTitle(s.history);
      const gruppe = historyGroupKey(h, ids);
      return { history: s.history.filter((x) => historyGroupKey(x, ids) !== gruppe) };
    }),
      clearHistory: () => set({ history: [] }),

      autoResume: true,
      setAutoResume: (v) => set({ autoResume: v }),

      autoplayNext: true,
      setAutoplayNext: (v) => set({ autoplayNext: v }),

      hideAdult: true,
      setHideAdult: (v) => set({ hideAdult: v }),

      categorySidebarOpen: true,
      setCategorySidebarOpen: (v) => set({ categorySidebarOpen: v }),

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
        return state as AppStore;
      },
      partialize: (s) => ({
        history: s.history,
        favorites: s.favorites,
        autoplayNext: s.autoplayNext,
        autoResume: s.autoResume,
        hideAdult: s.hideAdult,
        categorySidebarOpen: s.categorySidebarOpen,
        savedLogin: s.savedLogin,
      }),
    }
  )
);
