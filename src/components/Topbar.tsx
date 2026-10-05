import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Languages, RefreshCw, Search as SearchIcon } from "lucide-react";
import { api, HealthResponse } from "../lib/api";
import { useLang, useT } from "../lib/i18n";

export function Topbar({ health }: { health?: HealthResponse }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const toggle = useLang((s) => s.toggle);
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-[var(--border)] bg-[#0a0c12]/70 px-8 py-4 backdrop-blur-xl">
      <form onSubmit={submit} className="relative w-full max-w-md">
        <SearchIcon
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("topbar.searchPlaceholder")}
          className="w-full rounded-xl border border-[var(--border)] bg-white/5 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)] focus:bg-white/10"
        />
      </form>

      <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted)]">
        {health && (
          <span className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-white/5 px-3 py-1.5 font-medium sm:inline-flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health.ratings_loaded ? "bg-[var(--ok)]" : "bg-[var(--imdb)]"
              }`}
            />
            {health.ratings_loaded ? t("topbar.ratingsReady") : t("topbar.ratingsLoading")}
          </span>
        )}

        <button
          onClick={toggle}
          title={t("topbar.switchLang")}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white/5 px-2.5 py-2 font-bold uppercase text-white/80 transition hover:bg-white/10"
        >
          <Languages size={15} />
          {lang}
        </button>

        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/5 px-3 py-2 font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">{t("topbar.library")}</span>
        </button>
      </div>
    </header>
  );
}
