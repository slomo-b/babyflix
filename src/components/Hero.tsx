import { useEffect, useState } from "react";
import { Play, Info, Star } from "lucide-react";
import { imgUrl, MediaItem } from "../lib/api";
import { fmtVotes } from "../lib/format";
import { useT } from "../lib/i18n";
import { useEnrichment } from "../lib/useEnrichment";

export function Hero({
  items,
  onPlay,
  onOpen,
}: {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
}) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const imdb = useEnrichment(items, true);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % items.length), 9000);
    return () => clearInterval(timer);
  }, [items.length]);

  useEffect(() => {
    setIdx(0);
  }, [items]);

  if (!items.length) return null;
  const item = items[Math.min(idx, items.length - 1)];
  const bg = imgUrl(item.cover);
  const info = imdb.get(item.id);
  const rating = info?.rating ?? item.rating;
  const votes = info?.votes;

  return (
    <section className="relative mb-10 overflow-hidden rounded-3xl border border-[var(--border)]">
      {bg && (
        <img
          key={item.id}
          src={bg}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-[2px]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/85 to-[#08090d]/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/60 to-transparent" />

      <div className="relative flex min-h-[430px] items-end gap-8 p-10">
        {bg && (
          <img
            src={bg}
            alt={item.name}
            className="hidden h-72 w-48 shrink-0 rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 lg:block"
          />
        )}
        <div className="max-w-2xl animate-fade-in" key={item.id}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80 backdrop-blur">
              {item.kind === "series" ? t("common.serie") : t("common.movie")}
            </span>
            {item.category_id && (
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                {t("hero.recommended")}
              </span>
            )}
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight lg:text-5xl">
            <span className="text-gradient">{item.name}</span>
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-white/80">
            {rating != null && rating > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Star size={15} fill="#f5c518" stroke="#f5c518" />
                {rating.toFixed(1)}
                {votes ? <span className="text-white/50">· {fmtVotes(votes)} Votes</span> : null}
              </span>
            )}
            <span className="rounded border border-white/20 px-1.5 py-0.5 text-[11px] font-bold">HD</span>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => onPlay(item)}>
              <Play size={18} fill="currentColor" /> {t("common.play")}
            </button>
            <button className="btn btn-ghost" onClick={() => onOpen(item)}>
              <Info size={18} /> {t("common.details")}
            </button>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-5 right-6 flex gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              aria-label={`Featured ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-6 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
