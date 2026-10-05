import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { api } from "../lib/api";
import { Row } from "../components/Row";
import { RowSkeleton } from "../components/Skeletons";
import { useOpen } from "../lib/useOpen";
import { useT } from "../lib/i18n";

export default function Search() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(params.get("q") ?? "");
  const { open, playItem } = useOpen();

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
  const movies = useQuery({
    queryKey: ["search", "movie", term],
    queryFn: () => api.browse({ kind: "movie", q: term, sort: "rating", page_size: 24 }),
    enabled,
  });
  const series = useQuery({
    queryKey: ["search", "series", term],
    queryFn: () => api.browse({ kind: "series", q: term, sort: "rating", page_size: 24 }),
    enabled,
  });
  const live = useQuery({
    queryKey: ["search", "live", term],
    queryFn: () => api.browse({ kind: "live", q: term, sort: "name", page_size: 24 }),
    enabled,
  });

  const nothing =
    enabled &&
    !movies.isLoading &&
    !series.isLoading &&
    !live.isLoading &&
    !(movies.data?.items.length || series.data?.items.length || live.data?.items.length);

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
          {movies.isLoading && series.isLoading && live.isLoading && (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          )}

          {nothing && (
            <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-10 text-center text-sm text-[var(--muted)]">
              {t("search.noResults", { q: term })}
            </div>
          )}

          {!movies.isLoading && (movies.data?.items.length ?? 0) > 0 && (
            <Row
              title={t("nav.movies")}
              kind="movie"
              items={movies.data!.items}
              onOpen={open}
              onPlay={playItem}
              enrich
            />
          )}
          {!series.isLoading && (series.data?.items.length ?? 0) > 0 && (
            <Row
              title={t("nav.series")}
              kind="series"
              items={series.data!.items}
              onOpen={open}
              onPlay={playItem}
            />
          )}
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
