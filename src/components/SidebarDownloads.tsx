import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ChevronRight } from "lucide-react";
import { api, DownloadInfo } from "../lib/api";
import { useT } from "../lib/i18n";

/** How many entries fit into the small sidebar block. */
const MAX_ROWS = 3;

function pct(d: DownloadInfo): number {
  if (d.state === "done") return 100;
  if (!d.total) return 0;
  return Math.min(100, Math.round((d.done / d.total) * 100));
}

/**
 * Compact download activity in the sidebar: what is being fetched right now and
 * what is still waiting in the queue. Clicking opens the Downloads page.
 */
export function SidebarDownloads() {
  const t = useT();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.state === "running" || i.state === "queued")
        ? 1200
        : 20000,
  });

  const all = data?.items ?? [];
  const active = all.filter((i) => i.state === "running" || i.state === "queued");
  const pending = all.filter(
    (i) => i.state === "paused" || i.state === "stopped" || i.state === "error"
  );

  if (active.length === 0 && pending.length === 0) return null;

  // Running first (progress is interesting), then the waiting queue.
  const rows = [...active].sort((a, b) => (a.state === "running" ? -1 : 1) - (b.state === "running" ? -1 : 1));
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <button
      onClick={() => navigate("/downloads")}
      className="w-full rounded-2xl border border-[var(--border)] bg-white/5 p-3 text-left transition hover:border-[var(--accent)]/40 hover:bg-white/[0.08]"
      title={t("downloads.title")}
    >
      <div className="flex items-center gap-2 text-xs">
        <ArrowDownToLine size={13} className="text-[var(--accent-2)]" />
        <span className="font-semibold text-white/90">{t("nav.downloads")}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent-2)]">
          {active.length}
          <ChevronRight size={12} className="text-[var(--muted)]" />
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {shown.map((d) => {
          const p = pct(d);
          const waiting = d.state === "queued";
          return (
            <div key={d.id} className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                  {/* Bei Serien ist der Untertitel ("S1 · E2 – …") die einzige
                      Unterscheidung, sonst stehen dort drei identische Titel. */}
                  {d.subtitle ?? d.title}
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-[var(--muted)]">
                  {waiting ? t("downloads.state.queued") : `${p}%`}
                </span>
              </div>
              <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                  style={{ width: waiting ? "4%" : `${Math.max(2, p)}%` }}
                />
              </div>
            </div>
          );
        })}

        {hidden > 0 && (
          <span className="text-[10px] text-[var(--muted)]">
            {t("downloads.widget.more", { n: hidden })}
          </span>
        )}

        {pending.length > 0 && (
          <span className="text-[10px] text-[var(--muted)]">
            {t("downloads.widget.pending", { n: pending.length })}
          </span>
        )}
      </div>
    </button>
  );
}
