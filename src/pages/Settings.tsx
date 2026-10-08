import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  Database,
  Download,
  Languages,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { api, DiagResponse } from "../lib/api";
import { useStore } from "../lib/store";
import { useUpdater } from "../lib/updater";
import { Lang, localeOf, useLang, useT } from "../lib/i18n";
import { Select } from "../components/Select";

function fmtDate(lang: Lang, ts: unknown): string | null {
  const n = typeof ts === "string" ? parseInt(ts, 10) : typeof ts === "number" ? ts : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleDateString(localeOf(lang), {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function Settings() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [diag, setDiag] = useState<DiagResponse | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const savedLogin = useStore((s) => s.savedLogin);

  const upStatus = useUpdater((s) => s.status);
  const upVersion = useUpdater((s) => s.version);
  const upProgress = useUpdater((s) => s.progress);
  const upError = useUpdater((s) => s.error);
  const checkUpdates = useUpdater((s) => s.check);
  const installUpdate = useUpdater((s) => s.install);

  const autoplayNext = useStore((s) => s.autoplayNext);
  const setAutoplayNext = useStore((s) => s.setAutoplayNext);
  const clearHistory = useStore((s) => s.clearHistory);
  const historyCount = useStore((s) => s.history.length);
  const setSavedLogin = useStore((s) => s.setSavedLogin);

  const ui = (session.data?.user_info ?? {}) as Record<string, unknown>;
  const si = (session.data?.server_info ?? {}) as Record<string, unknown>;

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refresh();
      qc.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api.logoutSafe();
      clearHistory();
      setSavedLogin(null);
      qc.clear();
      qc.invalidateQueries({ queryKey: ["session"] });
    } finally {
      setBusy(false);
    }
  };

  const runDiagnose = async () => {
    const server = savedLogin?.baseUrl;
    if (!server) return;
    setDiag(null);
    setDiagError(null);
    setDiagLoading(true);
    try {
      const res = await api.diagnose(
        server,
        savedLogin?.username || undefined,
        savedLogin?.password || undefined
      );
      setDiag(res);
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : t("login.diagFailed"));
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-3xl pt-6">
      <h1 className="mb-6 text-3xl font-black tracking-tight">{t("settings.title")}</h1>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          <BadgeCheck size={16} /> {t("settings.account")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Info
            label={t("settings.source")}
            value={session.data?.source === "m3u" ? t("settings.sourceM3u") : t("settings.sourceXtream")}
          />
          <Info label={t("settings.user")} value={String(ui.username ?? "–")} />
          <Info
            label={t("settings.status")}
            value={String(ui.status ?? "–")}
            tone={ui.status === "Active" ? "ok" : "warn"}
          />
          <Info
            label={t("settings.expires")}
            value={fmtDate(lang, ui.exp_date) ?? t("settings.unlimited")}
            icon={<CalendarClock size={14} />}
          />
          <Info
            label={t("settings.connections")}
            value={`${ui.active_cons ?? 0} / ${ui.max_connections ?? "?"}`}
            icon={<Users size={14} />}
          />
          <Info label={t("settings.server")} value={String(si.url ?? si.url_port ?? "–")} />
          <Info label={t("settings.formats")} value={(session.data?.allowed_exts ?? []).join(", ") || "–"} />
        </div>
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          <Database size={16} /> {t("settings.catalog")}
        </h2>
        <div className="mb-5 flex flex-wrap gap-3">
          {health.data &&
            Object.entries(health.data.catalog).map(([k, v]) => (
              <span
                key={k}
                className="rounded-xl border border-[var(--border)] bg-white/5 px-3 py-2 text-sm"
              >
                <b className="font-bold">{v.toLocaleString(localeOf(lang))}</b>{" "}
                <span className="text-[var(--muted)]">
                  {k === "vod"
                    ? t("settings.movies")
                    : k === "series"
                    ? t("settings.series")
                    : t("settings.channels")}
                </span>
              </span>
            ))}
        </div>
        {health.data && !health.data.ffmpeg && (
          <p className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("settings.ffmpegMissing")}
          </p>
        )}
        {health.data?.ffmpeg && (
          <p className="mb-5 truncate text-xs text-[var(--muted)]">
            {t("settings.ffmpegPath", { path: health.data.ffmpeg })}
          </p>
        )}
        <button className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? t("settings.reloading") : t("settings.reload")}
        </button>
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          <Stethoscope size={16} /> {t("settings.diagnosis")}
        </h2>
        {savedLogin?.mode === "m3u" ? (
          <p className="text-sm text-[var(--muted)]">{t("settings.diagnosisM3u")}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--muted)]">{t("settings.diagnosisHint")}</p>
            <button
              className="btn btn-ghost"
              onClick={runDiagnose}
              disabled={diagLoading || !savedLogin}
            >
              <Stethoscope size={16} className={diagLoading ? "animate-pulse" : ""} />
              {diagLoading ? t("settings.diagnosing") : t("settings.diagnose")}
            </button>

            {diagError && <div className="mt-3 text-xs text-red-300">{diagError}</div>}

            {diag && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/30 p-3 text-xs">
                <div className="mb-2 font-semibold text-[var(--muted)]">
                  {t("login.diagResults")}{" "}
                  <span className="text-white/90">{diag.normalized_base}</span>
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {diag.results.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                            r.ok ? "bg-[var(--ok)]" : r.status ? "bg-[var(--imdb)]" : "bg-red-500"
                          }`}
                        />
                        <span className="font-semibold">
                          {r.status ? `HTTP ${r.status}` : t("login.diagNoHttp")}
                        </span>
                        <span className="text-[var(--muted)]">
                          {r.ua} · {r.elapsed_ms}ms
                        </span>
                        <span className="ml-auto truncate text-[10px] text-[var(--muted)]">
                          {r.content_type || r.error || ""}
                        </span>
                      </div>
                      {r.snippet && (
                        <div className="mt-1 line-clamp-2 text-[11px] text-white/70">{r.snippet}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          <Download size={16} /> {t("update.title")}
        </h2>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-[var(--muted)]">
            {t("update.currentVersion", { v: appVersion || "–" })}
          </span>
          {upStatus === "uptodate" && (
            <span className="text-[var(--ok)]">{t("update.upToDate")}</span>
          )}
          {upStatus === "available" && (
            <span className="text-[var(--accent-2)]">{t("update.available", { v: upVersion ?? "" })}</span>
          )}
        </div>

        {upStatus === "error" && (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {t("update.error", { e: upError ?? "" })}
          </div>
        )}

        {upStatus === "downloading" ? (
          <div>
            <div className="mb-1 text-[11px] text-[var(--muted)]">
              {t("update.downloading", { p: upProgress })}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-all"
                style={{ width: `${upProgress}%` }}
              />
            </div>
          </div>
        ) : upStatus === "available" ? (
          <button className="btn btn-primary" onClick={() => installUpdate()}>
            <Download size={16} /> {t("update.install")}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => checkUpdates()} disabled={upStatus === "checking"}>
            <RefreshCw size={16} className={upStatus === "checking" ? "animate-spin" : ""} />
            {upStatus === "checking" ? t("update.checking") : t("update.check")}
          </button>
        )}
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          {t("settings.playback")}
        </h2>

        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3">
          <span className="flex items-center gap-2 text-sm">
            <Languages size={16} />
            <span>
              {t("settings.language")}
              <span className="block text-xs text-[var(--muted)]">{t("settings.languageHint")}</span>
            </span>
          </span>
          <Select
            value={lang}
            onChange={(v) => setLang(v as Lang)}
            ariaLabel={t("settings.language")}
            className="w-40"
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
          />
        </div>

        <label className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm">
            {t("settings.autoplay")}
            <span className="block text-xs text-[var(--muted)]">{t("settings.autoplayHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={autoplayNext}
            onChange={(e) => setAutoplayNext(e.target.checked)}
            className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-white/20 transition-all checked:bg-[var(--accent)] relative before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-all checked:before:left-[18px]"
          />
        </label>

        <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4">
          <span className="text-sm">
            {t("settings.history")}
            <span className="block text-xs text-[var(--muted)]">
              {t("settings.historyCount", { n: historyCount })}
            </span>
          </span>
          <button className="btn btn-ghost" onClick={clearHistory} disabled={historyCount === 0}>
            {t("settings.clearHistory")}
          </button>
        </div>
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
          <ShieldCheck size={16} /> {t("settings.about")}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t("settings.aboutText")}</p>
        <button
          className="btn btn-ghost mt-5 !border-red-500/30 !text-red-300 hover:!bg-red-500/10"
          onClick={logout}
          disabled={busy}
        >
          <LogOut size={16} /> {t("settings.logout")}
        </button>
      </section>
    </div>
  );
}

function Info({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/[0.03] p-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {icon}
        {label}
      </div>
      <div
        className={`truncate text-sm font-semibold ${
          tone === "ok" ? "text-[var(--ok)]" : tone === "warn" ? "text-[var(--imdb)]" : ""
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
