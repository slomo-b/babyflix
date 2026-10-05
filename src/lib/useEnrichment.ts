import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ImdbInfo, MediaItem } from "./api";

function yearNum(item: MediaItem): number | undefined {
  const y = item.added ? undefined : undefined;
  return y;
}

/** Enrich a small list of movie/series items with keyless IMDb data (rating/poster/cast). */
export function useEnrichment(items: MediaItem[], enabled: boolean) {
  const payload = useMemo(
    () =>
      items
        .filter((i) => i.kind !== "live")
        .slice(0, 24)
        .map((i) => ({ id: i.id, title: i.name, year: yearNum(i), kind: i.kind })),
    [items]
  );

  const signature = payload.map((p) => `${p.id}:${p.title}`).join("|");

  const query = useQuery({
    queryKey: ["enrich", signature],
    queryFn: () => api.enrichBatch(payload.map(({ title, year, kind }) => ({ title, year, kind }))),
    enabled: enabled && payload.length > 0,
    staleTime: 1000 * 60 * 60 * 6,
  });

  return useMemo(() => {
    const map = new Map<string, ImdbInfo | null>();
    const results = query.data?.results ?? [];
    payload.forEach((p, idx) => map.set(p.id, results[idx] ?? null));
    return map;
  }, [query.data, payload]);
}
