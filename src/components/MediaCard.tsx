import { Play } from "lucide-react";
import { imgUrl, MediaItem } from "../lib/api";
import { RatingBadge } from "./RatingBadge";
import { initials, initialsColor } from "../lib/format";
import { useT } from "../lib/i18n";

function Placeholder({ name }: { name: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center text-2xl font-black tracking-tight text-white/90"
      style={{ background: `linear-gradient(150deg, ${initialsColor(name)}, #12141d)` }}
    >
      {initials(name) || "?"}
    </div>
  );
}

export function MediaCard({
  item,
  width = 168,
  ratingOverride,
  onClick,
  badge,
}: {
  item: MediaItem;
  width?: number | string;
  ratingOverride?: number | null;
  onClick?: () => void;
  badge?: string;
}) {
  const cover = imgUrl(item.cover);
  const rating = ratingOverride ?? item.rating;
  return (
    <div
      className="group card shrink-0"
      style={{ width }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-[var(--surface-2)]">
        {cover ? (
          <img
            src={cover}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <Placeholder name={item.name} />
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-transparent opacity-90" />

        {rating != null && rating > 0 && (
          <div className="absolute left-2 top-2">
            <RatingBadge value={rating} />
          </div>
        )}
        {badge && (
          <div className="absolute right-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur">
            {badge}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <div className="text-[13px] font-semibold leading-tight line-clamp-2 drop-shadow">
            {item.name}
          </div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
            <Play size={20} fill="currentColor" />
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChannelCard({
  item,
  width = 190,
  onClick,
}: {
  item: MediaItem;
  width?: number;
  onClick?: () => void;
}) {
  const t = useT();
  const logo = imgUrl(item.cover);
  return (
    <div
      className="card shrink-0 p-3"
      style={{ width }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
    >
      <div className="mb-2.5 flex h-16 items-center justify-center rounded-lg bg-[var(--surface-2)] p-2">
        {logo ? (
          <img src={logo} alt={item.name} loading="lazy" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-lg font-black text-white/70">{initials(item.name)}</span>
        )}
      </div>
      <div className="truncate text-[13px] font-semibold" title={item.name}>
        {item.name}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" /> {t("common.live")}
        </span>
        {item.tv_archive && <span className="opacity-70">• {t("card.catchup")}</span>}
      </div>
    </div>
  );
}
