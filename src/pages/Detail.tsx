import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, Heart, Info, Play, Star, X } from "lucide-react";
import { api, imgUrl, Episode } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtDuration, fmtTimeClock, fmtVotes, initials, initialsColor, yearOf } from "../lib/format";
import { useT } from "../lib/i18n";
import { Select } from "../components/Select";

export default function Detail({ kind }: { kind: "movie" | "series" }) {
  const t = useT();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const play = useStore((s) => s.play);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [resumeBanner, setResumeBanner] = useState(false);

  const favKey = `${kind}:${id}`;
  const isFav = favorites.some((f) => f.key === favKey);
  const history = useStore((s) => s.history);
  const autoResume = useStore((s) => s.autoResume);

  const query = useQuery({
    queryKey: ["detail", kind, id],
    queryFn: () => api.detail(kind, id),
    enabled: !!id,
  });

  const data = query.data;
  const item = data?.item;
  const detail = data?.detail;
  const imdb = data?.imdb;

  const poster = imgUrl(imdb?.image ?? item?.cover);
  const backdropImg = imgUrl(detail?.backdrop);

  const seasons = data?.seasons ?? [];
  const activeSeason = seasons[Math.min(seasonIdx, Math.max(0, seasons.length - 1))];
  const activeEpisodes = activeSeason?.episodes ?? [];

  const flatEpisodes = useMemo(
    () => seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.number }))),
    [seasons]
  );

  /** Zuletzt gesehene Folge dieser Serie (jüngster Verlaufseintrag einer Folge). */
  const lastWatched = useMemo(() => {
    const ids = new Set(flatEpisodes.map((e) => e.id));
    return history
      .filter((h) => h.kind === "series" && ids.has(h.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }, [history, flatEpisodes]);
  const lastWatchedEp = lastWatched
    ? flatEpisodes.find((e) => e.id === lastWatched.id)
    : undefined;

  /** Fortschritt einer Folge in Prozent (0 = unangetastet). */
  const progressOf = (epId: string): number => {
    const h = history.find((x) => x.key === `series:${epId}`);
    if (!h || h.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (h.position / h.duration) * 100));
  };

  /** Startposition beim Fortsetzen – mitten in der Folge, nicht am Anfang/Ende. */
  const resumeStartFor = (ep: Episode & { season: number }): number | undefined => {
    const h = history.find((x) => x.key === `series:${ep.id}`);
    if (!h || h.duration <= 0) return undefined;
    if (h.position <= 60 || h.position >= h.duration - 60) return undefined;
    return h.position;
  };

  // Beim Serienwechsel zurück auf die erste Staffel.
  useEffect(() => {
    setSeasonIdx(0);
    setResumeBanner(false);
  }, [id, kind]);

  // Serie öffnen: die Staffel der zuletzt gesehenen Folge zeigen.
  const positionedRef = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "series" || !lastWatchedEp || seasons.length === 0) return;
    if (positionedRef.current === id) return;
    const idx = seasons.findIndex((s) => s.number === lastWatchedEp.season);
    if (idx >= 0) setSeasonIdx(idx);
    positionedRef.current = id;
  }, [id, kind, lastWatchedEp, seasons]);

  useEffect(() => {
    // Nur Filme: ein begonnener Film bekommt beim Öffnen ein „Weiterschauen?"-Band.
    if (kind !== "movie") return;
    const h = history.find((x) => x.key === `movie:${id}`);
    if (!h || h.duration <= 0) return;
    if (h.position <= 60 || h.position >= h.duration - 60) return;
    setResumeBanner(true);
    if (!autoResume) return;
    const timer = setTimeout(() => {
      setResumeBanner(false);
      play({
        kind: "movie",
        id: h.id,
        ext: h.ext,
        title: h.title,
        poster: h.poster,
        subtitle: h.subtitle,
        historyKey: h.key,
        startAt: h.position,
      });
    }, 6000);
    return () => clearTimeout(timer);
  }, [id, kind, history, autoResume, play]);

  const rating = imdb?.rating ?? detail?.rating ?? item?.rating ?? null;
  const votes = imdb?.votes ?? null;
  const genres = (detail?.genre ?? imdb?.genres?.join(", ") ?? "")
    .split(/[,/]/)
    .map((g) => g.trim())
    .filter(Boolean);
  const year = yearOf(detail?.release_date);
  const duration = fmtDuration(detail?.duration);

  const playMovie = () => {
    if (!item) return;
    play({
      kind: "movie",
      id: item.id,
      ext: detail?.container_extension ?? item.extension ?? undefined,
      title: item.name,
      poster: item.cover ?? undefined,
      subtitle: year ?? undefined,
      historyKey: `movie:${item.id}`,
    });
  };

  /** Fortschritt eines begonnenen Films in Prozent (0 = nicht begonnen). */
  const historyResume = kind === "movie" ? history.find((x) => x.key === `movie:${id}`) : undefined;
  const movieProgress = (() => {
    if (!historyResume || historyResume.duration <= 0) return 0;
    const p = (historyResume.position / historyResume.duration) * 100;
    return p > 1 && p < 98 ? p : 0;
  })();

  /** Fortschritt der zuletzt gesehenen Folge (0 = nicht begonnen / durch). */
  const seriesProgress = (() => {
    if (!lastWatchedEp) return 0;
    const p = progressOf(lastWatchedEp.id);
    return p > 1 && p < 98 ? p : 0;
  })();

  const playEpisode = (ep: Episode & { season: number }, startAt?: number) => {
    if (!item) return;
    const idx = flatEpisodes.findIndex((e) => e.id === ep.id);
    const next = idx >= 0 ? flatEpisodes[idx + 1] : undefined;
    play({
      kind: "series",
      id: ep.id,
      ext: ep.extension,
      title: item.name,
      poster: ep.cover ?? item.cover ?? undefined,
      subtitle: `S${ep.season} · E${ep.num} – ${ep.title}`,
      historyKey: `series:${ep.id}`,
      seriesId: item.id,
      startAt,
      next: next
        ? {
            kind: "series",
            id: next.id,
            ext: next.extension,
            title: item.name,
            subtitle: `S${next.season} · E${next.num} – ${next.title}`,
          }
        : undefined,
    });
  };

  const firstEpisode = flatEpisodes[0];

  if (query.isLoading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton -mx-8 h-[420px]" />
        <div className="-mt-48 flex flex-col gap-10 lg:flex-row">
          <div className="skeleton mx-auto h-[330px] w-[190px] shrink-0 rounded-2xl lg:mx-0 lg:w-[250px]" />
          <div className="flex-1 space-y-4 lg:pt-8">
            <div className="skeleton h-12 w-2/3 rounded" />
            <div className="skeleton h-6 w-1/3 rounded" />
            <div className="skeleton h-28 w-full rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (query.isError || !item) {
    return (
      <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-sm text-red-300">
        {t("detail.loadError")} {(query.error as Error)?.message}
        <div className="mt-3">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12">
      {/* HERO */}
      <div className="relative -mx-8 h-[420px] overflow-hidden bg-[var(--surface-2)]">
        {poster && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-3xl"
          />
        )}
        {backdropImg && (
          <img
            src={backdropImg}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#08090d]/85 via-[#08090d]/25 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          aria-label={t("common.back")}
          className="absolute left-8 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur transition hover:bg-black/70"
        >
          <ArrowLeft />
        </button>
      </div>

      {/* CONTENT */}
      <div className="relative -mt-48 flex flex-col gap-10 lg:flex-row">
        {/* LEFT: poster + actions */}
        <aside className="w-full shrink-0 lg:w-[250px]">
          <div className="mx-auto w-[190px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl ring-1 ring-white/10 lg:mx-0 lg:w-full">
            <div className="aspect-[2/3] w-full">
              {poster ? (
                <img src={poster} alt={item.name} className="h-full w-full object-cover" />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-3xl font-black text-white"
                  style={{ background: `linear-gradient(150deg, ${initialsColor(item.name)}, #12141d)` }}
                >
                  {initials(item.name)}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            {resumeBanner && kind === "movie" && (
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3">
                <Info size={16} className="shrink-0 text-[var(--accent-2)]" />
                <span className="min-w-0 flex-1 text-xs leading-snug text-white/90">
                  {t("detail.resumeAsk", { time: fmtTimeClock(historyResume?.position ?? 0) })}
                </span>
                <button
                  className="btn btn-primary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => {
                    setResumeBanner(false);
                    const h = historyResume;
                    if (!h || !item) return;
                    play({
                      kind: "movie",
                      id: h.id,
                      ext: h.ext,
                      title: h.title,
                      poster: h.poster,
                      subtitle: h.subtitle,
                      historyKey: h.key,
                      startAt: h.position,
                    });
                  }}
                >
                  <Play size={14} fill="currentColor" /> {t("detail.resume")}
                </button>
                <button
                  className="shrink-0 rounded-full px-2 py-1 text-xs text-[var(--muted)] transition hover:text-white"
                  onClick={() => setResumeBanner(false)}
                  title={t("common.remove")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {kind === "movie" ? (
              <button
                className="btn btn-primary relative overflow-hidden py-3.5 text-base"
                onClick={playMovie}
              >
                {movieProgress > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 bg-white/25"
                    style={{ width: `${movieProgress}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  <Play size={20} fill="currentColor" /> {t("common.play")}
                </span>
              </button>
            ) : (
              <button
                className="btn btn-primary relative overflow-hidden py-3.5 text-base"
                onClick={() => {
                  if (lastWatchedEp) playEpisode(lastWatchedEp, resumeStartFor(lastWatchedEp));
                  else if (firstEpisode) playEpisode(firstEpisode);
                }}
                disabled={!firstEpisode}
              >
                {seriesProgress > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 bg-white/25"
                    style={{ width: `${seriesProgress}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  <Play size={20} fill="currentColor" />{" "}
                  {lastWatchedEp
                    ? t("detail.continueWith", {
                        ep: `S${lastWatchedEp.season} · E${lastWatchedEp.num}`,
                      })
                    : firstEpisode
                      ? t("detail.firstEpisode")
                      : t("detail.noEpisodes")}
                </span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {detail?.trailer && (
                <a
                  className="btn btn-ghost"
                  href={
                    detail.trailer.startsWith("http")
                      ? detail.trailer
                      : `https://www.youtube.com/watch?v=${detail.trailer}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <Film size={17} /> {t("detail.trailer")}
                </a>
              )}
              <button
                className={`btn btn-ghost ${detail?.trailer ? "" : "col-span-2"}`}
                onClick={() =>
                  toggleFavorite({
                    key: favKey,
                    kind,
                    id: item.id,
                    name: item.name,
                    poster: item.cover ?? imdb?.image ?? undefined,
                  })
                }
              >
                <Heart
                  size={17}
                  fill={isFav ? "#f43f5e" : "none"}
                  stroke={isFav ? "#f43f5e" : "currentColor"}
                />
                {isFav ? t("detail.inFavorites") : t("detail.addFavorite")}
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT: title + meta + overview + credits + episodes */}
        <div className="min-w-0 flex-1 lg:pt-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80 backdrop-blur">
              {kind === "series" ? t("common.serie") : t("common.movie")}
            </span>
            {detail?.age && (
              <span className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/80">
                {detail.age}
              </span>
            )}
          </div>

          <h1 className="break-words text-4xl font-black leading-[1.05] tracking-tight lg:text-5xl">
            <span className="text-gradient">{imdb?.title || item.name}</span>
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {rating != null && rating > 0 && (
              <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--imdb)]/30 bg-[var(--imdb)]/10 px-3 py-1.5 font-bold text-[#ffdd66]">
                <Star size={15} fill="#f5c518" stroke="#f5c518" />
                {rating.toFixed(1)}
                {votes ? <span className="font-medium text-white/50">({fmtVotes(votes)})</span> : null}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  IMDb
                </span>
              </span>
            )}
            {year && <span className="font-medium text-white/80">{year}</span>}
            {duration && <span className="font-medium text-white/80">{duration}</span>}
            {detail?.country && <span className="text-[var(--muted)]">{detail.country}</span>}
          </div>

          {genres.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-[var(--border)] bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/80"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {detail?.plot && (
            <div className="mt-7 max-w-3xl">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                {t("detail.overview")}
              </h2>
              <p className="text-[15px] leading-relaxed text-white/85">{detail.plot}</p>
            </div>
          )}

          {(detail?.director || (detail?.cast && detail.cast.length > 0)) && (
            <div className="mt-8 grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
              {detail?.director && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                    {t("detail.directorTitle")}
                  </h3>
                  <p className="text-sm font-semibold text-white/90">{detail.director}</p>
                </div>
              )}
              {detail?.cast && detail.cast.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                    {t("detail.castTitle")}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.cast.slice(0, 14).map((c) => (
                      <span key={c} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/75">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {kind === "series" && seasons.length > 0 && (
            <div className="mt-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-lg font-bold tracking-tight">{t("detail.episodes")}</h2>
                  {lastWatchedEp && (
                    <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-2)]">
                      {t("detail.lastWatched")}: S{lastWatchedEp.season} · E{lastWatchedEp.num}
                    </span>
                  )}
                </div>
                <Select
                  value={String(seasonIdx)}
                  onChange={(v) => setSeasonIdx(Number(v))}
                  ariaLabel={t("detail.episodes")}
                  className="w-48"
                  options={seasons.map((s, i) => ({
                    value: String(i),
                    label: t("detail.season", { n: s.number }),
                  }))}
                />
              </div>

              <div className="space-y-2.5">
                {activeEpisodes.map((ep) => {
                  const epWithSeason = { ...ep, season: activeSeason?.number ?? 1 };
                  const cover = imgUrl(ep.cover ?? item.cover);
                  const isLastWatched = lastWatchedEp?.id === ep.id;
                  const epProgress = progressOf(ep.id);
                  return (
                    <button
                      key={ep.id}
                      onClick={() => playEpisode(epWithSeason, resumeStartFor(epWithSeason))}
                      className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border p-3 text-left transition ${
                        isLastWatched
                          ? "border-[var(--accent)]/60 bg-[var(--accent)]/[0.12] ring-1 ring-[var(--accent)]/30"
                          : "border-[var(--border)] bg-white/[0.03] hover:border-[var(--accent)]/40 hover:bg-white/[0.07]"
                      }`}
                    >
                      <span className="relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--surface-2)] sm:w-40">
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="text-[var(--muted)]" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                          <Play size={22} fill="white" className="text-white" />
                        </span>
                        {epProgress > 0 && (
                          <span
                            className="absolute inset-x-0 bottom-0 h-1 bg-[var(--accent)]"
                            style={{ width: `${epProgress}%` }}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-[var(--accent-2)]">
                            {ep.num}
                          </span>
                          <span className="truncate text-sm font-semibold">{ep.title}</span>
                          {isLastWatched && (
                            <span className="shrink-0 rounded-full bg-[var(--accent)]/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-2)]">
                              {t("detail.lastWatched")}
                            </span>
                          )}
                        </span>
                        {ep.plot && (
                          <span className="mt-1 line-clamp-2 block text-xs text-[var(--muted)]">
                            {ep.plot}
                          </span>
                        )}
                      </span>
                      {ep.duration && (
                        <span className="shrink-0 self-start text-xs text-[var(--muted)] sm:self-center">
                          {ep.duration}
                        </span>
                      )}
                    </button>
                  );
                })}
                {activeEpisodes.length === 0 && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.03] p-5 text-sm text-[var(--muted)]">
                    <Info size={16} /> {t("detail.noSeasonEpisodes")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
