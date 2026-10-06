import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Radio, Search as SearchIcon } from "lucide-react";
import { api, imgUrl, MediaItem } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtTime, initials, initialsColor } from "../lib/format";
import { useT } from "../lib/i18n";
import { GridSkeleton } from "../components/Skeletons";
import { Select } from "../components/Select";

export default function Live() {
  const t = useT();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const play = useStore((s) => s.play);

  const cats = useQuery({
    queryKey: ["cats", "live"],
    queryFn: () => api.categories("live"),
    staleTime: 1000 * 60 * 30,
  });

  const channels = useQuery({
    queryKey: ["browse", "live", category, search],
    queryFn: () =>
      api.browse({
        kind: "live",
        category: category || undefined,
        q: search || undefined,
        sort: "name",
        page_size: 300,
      }),
    staleTime: 1000 * 60 * 10,
  });

  const list = channels.data?.items ?? [];

  useEffect(() => {
    if (!selected && list.length) setSelected(list[0]);
  }, [list, selected]);

  const epg = useQuery({
    queryKey: ["epg", selected?.id],
    queryFn: () => api.epg(selected!.id, false, 14, selected!.epg_channel_id ?? undefined),
    enabled: !!selected,
    refetchInterval: 60_000,
  });

  const playChannel = (item: MediaItem) => {
    setSelected(item);
    play({
      kind: "live",
      id: item.id,
      title: item.name,
      poster: item.cover ?? undefined,
      historyKey: `live:${item.id}`,
    });
  };

  const nowEntry = epg.data?.epg.find((e) => e.now_playing);

  return (
    <div className="animate-fade-in pt-6">
      <div className="mb-6">
        <h1 className="text-3xl font-black tracking-tight">{t("live.title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("live.channels", { n: list.length.toLocaleString() })}
          {nowEntry ? ` · ${t("live.nowPlaying")} ${nowEntry.title}` : ""}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select
          value={category}
          onChange={setCategory}
          ariaLabel={t("live.allCategories")}
          className="w-56"
          searchable
          options={[
            { value: "", label: t("live.allCategories") },
            ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <div className="relative">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("live.searchPlaceholder")}
            className="w-56 rounded-xl border border-[var(--border)] bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {channels.isLoading ? (
            <GridSkeleton count={12} />
          ) : (
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-white/[0.02] p-2">
              {list.map((c) => {
                const active = selected?.id === c.id;
                const logo = imgUrl(c.cover);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    onDoubleClick={() => playChannel(c)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      active ? "bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]/40" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-2)]">
                      {logo ? (
                        <img src={logo} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                      ) : (
                        <span
                          className="flex h-full w-full items-center justify-center text-xs font-bold text-white"
                          style={{ background: initialsColor(c.name) }}
                        >
                          {initials(c.name)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      {active && nowEntry && (
                        <span className="block truncate text-[11px] text-[var(--accent-2)]">
                          {nowEntry.title}
                        </span>
                      )}
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        playChannel(c);
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100 hover:bg-[var(--accent)] hover:text-white"
                      title={t("live.watchNow")}
                    >
                      <Play size={15} fill="currentColor" />
                    </span>
                  </button>
                );
              })}
              {!list.length && (
                <div className="p-8 text-center text-sm text-[var(--muted)]">{t("live.none")}</div>
              )}
            </div>
          )}
        </div>

        <div className="w-full lg:w-[420px]">
          {selected ? (
            <div className="glass sticky top-2 rounded-2xl p-5">
              <div className="mb-4 flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--surface-2)] p-2">
                  {imgUrl(selected.cover) ? (
                    <img src={imgUrl(selected.cover)} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <Radio className="text-[var(--muted)]" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{selected.name}</h2>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ok)]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--ok)]" /> {t("common.live")}
                  </div>
                </div>
              </div>

              <button className="btn btn-primary w-full" onClick={() => playChannel(selected)}>
                <Play size={18} fill="currentColor" /> {t("live.watchNow")}
              </button>

              <div className="mt-5">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  {t("live.program")}
                </h3>
                {epg.isLoading ? (
                  <div className="skeleton h-24 rounded-xl" />
                ) : epg.data?.epg.length ? (
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {epg.data.epg.map((e, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border px-3 py-2 ${
                          e.now_playing
                            ? "border-[var(--accent)]/50 bg-[var(--accent)]/15"
                            : "border-transparent bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                          <span>
                            {fmtTime(e.start_ts)} – {fmtTime(e.stop_ts)}
                          </span>
                          {e.now_playing && (
                            <span className="font-bold uppercase text-[var(--accent-2)]">
                              {t("live.now")}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-sm font-semibold">{e.title}</div>
                        {e.description && (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">
                            {e.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-white/[0.03] p-3 text-xs text-[var(--muted)]">
                    {t("live.noEpg")}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass flex h-64 items-center justify-center rounded-2xl text-sm text-[var(--muted)]">
              {t("live.selectChannel")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
