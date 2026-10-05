import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status = "idle" | "checking" | "available" | "downloading" | "uptodate" | "error";

interface UpdaterStore {
  status: Status;
  version: string | null;
  notes: string | null;
  progress: number;
  error: string | null;
  update: Update | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  reset: () => void;
}

export const useUpdater = create<UpdaterStore>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: 0,
  error: null,
  update: null,

  check: async () => {
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, notes: update.body ?? null, update });
      } else {
        set({ status: "uptodate", update: null });
      }
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  install: async () => {
    const update = get().update;
    if (!update) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          set({ progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0 });
        } else if (event.event === "Finished") {
          set({ progress: 100 });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  reset: () => set({ status: "idle", version: null, notes: null, progress: 0, error: null, update: null }),
}));
