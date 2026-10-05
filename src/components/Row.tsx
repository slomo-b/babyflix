import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MediaItem } from "../lib/api";
import { useT } from "../lib/i18n";
import { MediaCard, ChannelCard } from "./MediaCard";
import { PosterSkeleton } from "./Skeletons";
import { useEnrichment } from "../lib/useEnrichment";

export function Row({
  title,
  kind,
  items,
  loading,
  onOpen,
  onPlay,
  enrich = false,
  onSeeAll,
}: {
  title: string;
  kind: string;
  items: MediaItem[];
  loading?: boolean;
  onOpen: (item: MediaItem) => void;
  onPlay?: (item: MediaItem) => void;
  enrich?: boolean;
  onSeeAll?: () => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const imdb = useEnrichment(items, enrich);

  const scrollBy = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * 720, behavior: "smooth" });
  };

  if (loading) {
    return (
      <section className="mb-9">
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        <div className="flex gap-3.5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <PosterSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section
      className="group/row relative mb-9"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="text-xs font-semibold text-[var(--muted)] transition hover:text-white"
          >
            {t("row.seeAll")}
          </button>
        )}
      </div>

      <div className="scroll-x no-scrollbar" ref={scroller}>
        {items.map((item) =>
          kind === "live" ? (
            <ChannelCard
              key={item.id}
              item={item}
              onClick={() => (onPlay ? onPlay(item) : onOpen(item))}
            />
          ) : (
            <MediaCard
              key={item.id}
              item={item}
              ratingOverride={imdb.get(item.id)?.rating ?? undefined}
              onClick={() => onOpen(item)}
            />
          )
        )}
      </div>

      {hover && (
        <>
          <button
            aria-label={t("row.prev")}
            onClick={() => scrollBy(-1)}
            className="absolute -left-4 top-1/2 z-10 hidden h-24 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/70 text-white backdrop-blur transition hover:bg-black/90 md:flex"
            style={{ top: "calc(50% + 14px)" }}
          >
            <ChevronLeft />
          </button>
          <button
            aria-label={t("row.next")}
            onClick={() => scrollBy(1)}
            className="absolute -right-4 top-1/2 z-10 hidden h-24 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/70 text-white backdrop-blur transition hover:bg-black/90 md:flex"
            style={{ top: "calc(50% + 14px)" }}
          >
            <ChevronRight />
          </button>
        </>
      )}
    </section>
  );
}
