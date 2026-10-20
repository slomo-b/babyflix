import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { api, ImdbInfo, MediaItem } from "../lib/api";
import { Row } from "../components/Row";
import { GridSkeleton, RowSkeleton } from "../components/Skeletons";
import { MediaCard } from "../components/MediaCard";
import { useOpen } from "../lib/useOpen";
import { useScrollMemory } from "../lib/useScrollMemory";
import { useEnrichment } from "../lib/useEnrichment";
import { useT } from "../lib/i18n";

/**
 * Treffer pro Seite. Vorher waren es 24 in einem horizontalen Regal, von dem nur
 * eine Handvoll gleichzeitig sichtbar war - jetzt ein Raster mit 60.
 */
const PAGE_SIZE = 60;

/** Nächste Seite, solange noch nicht alle Treffer geladen sind. */
function nextPage(
  last: { page: number; page_size: number; total: number },
  pages: unknown[]
): number | undefined {
  return pages.length * last.page_size < last.total ? last.page + 1 : undefined;
}

function PosterGrid({
  items,
  imdb,
  onOpen,
}: {
  items: MediaItem[];
  imdb: Map<string, ImdbInfo | null>;
  onOpen: (item: MediaItem) => void;
}) {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill,minmax(158px,1fr))" }}
    >
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          width="100%"
          ratingOverride={imdb.get(item.id)?.rating ?? undefined}
          onClick={() => onOpen(item)}
        />
      ))}
    </div>
  );
}

export default function Search() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(params.get("q") ?? "");
  const { open, playItem } = useOpen();
  useScrollMemory("search");

  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const cur = params.get("q") ?? "";
    if (cur !== term) setParams(term ? { q: term } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    const cur = params.get("q") ?? "";
    if (cur !== q && cur !== term) setQ(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const enabled = term.length > 1;

  const movies = useInfiniteQuery({
    queryKey: ["search-grid", "movie", term],
    queryFn: ({ pageParam }) =>
      api.browse({
        kind: "movie",
        q: term,
        sort: "rating",
        page: pageParam as number,
        page_size: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled,
  });

  const series = useInfiniteQuery({
    queryKey: ["search-grid", "series", term],
    queryFn: ({ pageParam }) =>
      api.browse({
        kind: "series",
        q: term,
        sort: "rating",
        page: pageParam as number,
        page_size: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled,
  });

  const live = useQuery({
    queryKey: ["search", "live", term],
    queryFn: () => api.browse({ kind: "live", q: term, sort: "name", page_size: 24 }),
    enabled,
  });

  const movieItems = useMemo(() => movies.data?.pages.flatMap((p) => p.items) ?? [], [movies.data]);
  const seriesItems = useMemo(
    () => series.data?.pages.flatMap((p) => p.items) ?? [],
    [series.data]
  );

  // Der Batch-Endpunkt verkraftet 60 Titel pro Aufruf - genug für ein Raster.
  const movieImdb = useEnrichment(movieItems, enabled, PAGE_SIZE);
  const seriesImdb = useEnrichment(seriesItems, enabled, PAGE_SIZE);

  const movieTotal = movies.data?.pages[0]?.total ?? 0;
  const seriesTotal = series.data?.pages[0]?.total ?? 0;

  const loading = movies.isLoading || series.isLoading || live.isLoading;
  const nothing =
    enabled && !loading && !movieItems.length && !seriesItems.length && !live.data?.items.length;

  const section = (
    title: string,
    items: MediaItem[],
    total: number,
    imdb: Map<string, ImdbInfo | null>,
    more: { hasNext: boolean; busy: boolean; load: () => void }
  ) => {
    if (!items.length) return null;
    return (
      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <span className="text-xs text-[var(--muted)]">
            {t("catalog.items", { n: total.toLocaleString() })}
          </span>
        </div>

        <PosterGrid items={items} imdb={imdb} onOpen={open} />

        {more.hasNext && (
          <div className="mt-6 flex justify-center">
            <button className="btn btn-ghost" onClick={more.load} disabled={more.busy}>
              {more.busy ? t("catalog.loadingMore") : t("search.loadMore")}
            </button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="animate-fade-in pt-6">
      <h1 className="mb-5 text-3xl font-black tracking-tight">{t("search.title")}</h1>
      <div className="relative mb-8 max-w-2xl">
        <SearchIcon
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search.placeholder")}
          className="w-full rounded-2xl border border-[var(--border)] bg-white/5 py-4 pl-12 pr-4 text-base outline-none transition focus:border-[var(--accent)] focus:bg-white/10"
        />
      </div>

      {!enabled && (
        <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-10 text-center text-sm text-[var(--muted)]">
          {t("search.hint")}
        </div>
      )}

      {enabled && (
        <>
          {loading && (
            <>
              <GridSkeleton count={12} />
              <div className="h-10" />
              <RowSkeleton />
            </>
          )}

          {nothing && (
            <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-10 text-center text-sm text-[var(--muted)]">
              {t("search.noResults", { q: term })}
            </div>
          )}

          {!loading &&
            section(t("nav.movies"), movieItems, movieTotal, movieImdb, {
              hasNext: !!movies.hasNextPage,
              busy: movies.isFetchingNextPage,
              load: () => void movies.fetchNextPage(),
            })}

          {!loading &&
            section(t("nav.series"), seriesItems, seriesTotal, seriesImdb, {
              hasNext: !!series.hasNextPage,
              busy: series.isFetchingNextPage,
              load: () => void series.fetchNextPage(),
            })}

          {/* Sender bleiben ein Regal - das sind Kanäle, keine Poster. */}
          {!live.isLoading && (live.data?.items.length ?? 0) > 0 && (
            <Row
              title={t("nav.live")}
              kind="live"
              items={live.data!.items}
              onOpen={open}
              onPlay={playItem}
            />
          )}
        </>
      )}
    </div>
  );
}
