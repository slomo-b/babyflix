import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MediaItem } from "./api";
import { useStore } from "./store";

export function useOpen() {
  const navigate = useNavigate();
  const play = useStore((s) => s.play);

  const open = useCallback(
    (item: MediaItem) => {
      if (item.kind === "live") {
        play({
          kind: "live",
          id: item.id,
          title: item.name,
          poster: item.cover ?? undefined,
          historyKey: `live:${item.id}`,
        });
        return;
      }
      navigate(item.kind === "series" ? `/series/${item.id}` : `/movie/${item.id}`);
    },
    [navigate, play]
  );

  const playItem = useCallback(
    (item: MediaItem) => {
      play({
        kind: item.kind as "movie" | "series" | "live",
        id: item.id,
        ext: item.extension ?? undefined,
        title: item.name,
        poster: item.cover ?? undefined,
        historyKey: `${item.kind}:${item.id}`,
      });
    },
    [play]
  );

  return { open, playItem };
}
