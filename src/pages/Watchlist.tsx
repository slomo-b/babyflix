import { Heart } from "lucide-react";
import { MediaItem } from "../lib/api";
import { useStore, FavoriteItem } from "../lib/store";
import { useT } from "../lib/i18n";
import { useOpen } from "../lib/useOpen";
import { MediaCard } from "../components/MediaCard";

function toItem(f: FavoriteItem): MediaItem {
  return {
    id: f.id,
    kind: f.kind,
    name: f.name,
    cover: f.poster ?? null,
    category_id: null,
    extension: null,
    added: null,
    rating: null,
    epg_channel_id: null,
    tv_archive: false,
  };
}

export default function Watchlist() {
  const t = useT();
  const favorites = useStore((s) => s.favorites);
  const { open } = useOpen();

  return (
    <div className="animate-fade-in pt-6">
      <h1 className="text-3xl font-black tracking-tight">{t("watchlist.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--muted)]">
        {t("watchlist.subtitle")}
        {favorites.length > 0 ? ` · ${favorites.length}` : ""}
      </p>

      {favorites.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-12 text-center text-sm text-[var(--muted)]">
          <Heart size={30} className="text-[var(--muted)]" />
          <span className="max-w-md">{t("watchlist.empty")}</span>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(158px,1fr))" }}
        >
          {favorites.map((f) => (
            <MediaCard key={f.key} item={toItem(f)} width="100%" onClick={() => open(toItem(f))} />
          ))}
        </div>
      )}
    </div>
  );
}
