import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Play, X } from "lucide-react";
import { api, imgUrl, MediaItem } from "../lib/api";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { HeroSkeleton, RowSkeleton } from "../components/Skeletons";
import { useOpen } from "../lib/useOpen";
import { useStore, HistoryItem } from "../lib/store";
import { useT } from "../lib/i18n";

function ContinueCard({
  h,
  onPlay,
  onRemove,
}: {
  h: HistoryItem;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const cover = imgUrl(h.poster ?? null);
  const pct = h.duration > 0 ? Math.min(100, (h.position / h.duration) * 100) : 0;
  return (
    <div className="card group w-[240px] shrink-0" style={{ width: 240 }} onClick={onPlay}>
      <div className="relative aspect-video w-full bg-[var(--surface-2)]">
        {cover ? (
          <img src={cover} alt={h.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[var(--surface-2)] to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 transition group-hover:opacity-100 hover:bg-black/90"
          title={t("common.remove")}
        >
          <X size={14} />
        </button>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black">
            <Play size={20} fill="currentColor" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-[13px] font-semibold">{h.title}</div>
        {h.subtitle && <div className="truncate text-[11px] text-[var(--muted)]">{h.subtitle}</div>}
      </div>
    </div>
  );
}

export default function Home() {
  const t = useT();
  const navigate = useNavigate();
  const home = useQuery({ queryKey: ["home"], queryFn: api.home });
  const cats = useQuery({ queryKey: ["cats", "movie"], queryFn: () => api.categories("movie") });
  const { open, playItem } = useOpen();
  const history = useStore((s) => s.history);
  const removeHistory = useStore((s) => s.removeHistory);
  const play = useStore((s) => s.play);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    cats.data?.categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [cats.data]);

  if (home.isLoading) {
    return (
      <div className="animate-fade-in pt-6">
        <HeroSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  if (home.isError) {
    return (
      <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
        {t("home.loadError")} {(home.error as Error).message}
        <div className="mt-3">
          <button className="btn btn-ghost" onClick={() => home.refetch()}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  const data = home.data!;

  return (
    <div className="animate-fade-in pt-6">
      <Hero items={data.hero} onPlay={playItem} onOpen={open} />

      {history.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-4 text-lg font-bold tracking-tight">{t("home.continue")}</h2>
          <div className="scroll-x no-scrollbar">
            {history.slice(0, 12).map((h) => (
              <ContinueCard
                key={h.key}
                h={h}
                onPlay={() =>
                  play({
                    kind: h.kind,
                    id: h.id,
                    ext: h.ext,
                    title: h.title,
                    poster: h.poster,
                    subtitle: h.subtitle,
                    historyKey: h.key,
                  })
                }
                onRemove={() => removeHistory(h.key)}
              />
            ))}
          </div>
        </section>
      )}

      {data.rows.map((row, i) => {
        const title =
          row.title ?? (row.category_id ? catName.get(row.category_id) ?? t("movies.title") : t("movies.title"));
        return (
          <Row
            key={`${row.kind}-${row.category_id ?? row.title ?? i}`}
            title={title}
            kind={row.kind}
            items={row.items as MediaItem[]}
            onOpen={open}
            onPlay={playItem}
            enrich={i === 0}
            onSeeAll={
              row.kind === "live"
                ? () => navigate("/live")
                : () =>
                    navigate(
                      row.kind === "series"
                        ? "/series"
                        : row.category_id
                        ? `/movies?category=${encodeURIComponent(row.category_id)}`
                        : "/movies"
                    )
            }
          />
        );
      })}
    </div>
  );
}
