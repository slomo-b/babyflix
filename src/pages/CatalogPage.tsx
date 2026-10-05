import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { api, Category, Kind, MediaItem } from "../lib/api";
import { useT } from "../lib/i18n";
import { MediaCard } from "../components/MediaCard";
import { GridSkeleton } from "../components/Skeletons";
import { Select } from "../components/Select";
import { useOpen } from "../lib/useOpen";

export function CatalogPage({
  kind,
  title,
  subtitle,
}: {
  kind: Kind;
  title: string;
  subtitle: string;
}) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [sort, setSort] = useState("added");
  const [search, setSearch] = useState("");
  const { open } = useOpen();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCategory(params.get("category") ?? "");
  }, [params]);

  const cats = useQuery({
    queryKey: ["cats", kind],
    queryFn: () => api.categories(kind),
    staleTime: 1000 * 60 * 30,
  });

  const query = useInfiniteQuery({
    queryKey: ["browse", kind, category, sort, search],
    queryFn: ({ pageParam }) =>
      api.browse({
        kind,
        category: category || undefined,
        sort,
        q: search || undefined,
        page: pageParam as number,
        page_size: 60,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      pages.length * last.page_size < last.total ? last.page + 1 : undefined,
  });

  const items: MediaItem[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data]
  );
  const total = query.data?.pages[0]?.total ?? 0;

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "600px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query]);

  const pickCategory = (id: string) => {
    setCategory(id);
    if (id) setParams({ category: id });
    else setParams({});
  };

  return (
    <div className="animate-fade-in pt-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {subtitle}
            {total > 0 && (
              <span className="ml-1">· {t("catalog.items", { n: total.toLocaleString() })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("catalog.filter")}
              className="w-48 rounded-xl border border-[var(--border)] bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <Select
            value={sort}
            onChange={setSort}
            ariaLabel={t("catalog.sort.added")}
            className="w-52"
            options={[
              { value: "added", label: t("catalog.sort.added") },
              { value: "name", label: t("catalog.sort.name") },
              { value: "rating", label: t("catalog.sort.rating") },
            ]}
          />
        </div>
      </div>

      <div className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        <button className="chip" data-active={category === ""} onClick={() => pickCategory("")}>
          {t("common.all")}
        </button>
        {cats.data?.categories.map((c: Category) => (
          <button
            key={c.id}
            className="chip"
            data-active={category === c.id}
            onClick={() => pickCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-white/5 p-10 text-center text-sm text-[var(--muted)]">
          {t("catalog.empty")}
        </div>
      ) : (
        <>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill,minmax(158px,1fr))" }}
          >
            {items.map((item) => (
              <MediaCard key={item.id} item={item} width="100%" onClick={() => open(item)} />
            ))}
          </div>

          <div ref={sentinel} className="py-10 text-center text-xs text-[var(--muted)]">
            {query.isFetchingNextPage
              ? t("catalog.loadingMore")
              : query.hasNextPage
              ? t("catalog.scrollMore")
              : t("catalog.end")}
          </div>
        </>
      )}
    </div>
  );
}
