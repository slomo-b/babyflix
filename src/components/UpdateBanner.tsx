import { Download, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../lib/i18n";
import { useUpdater } from "../lib/updater";

export function UpdateBanner() {
  const t = useT();
  const { status, version, progress, install, reset } = useUpdater();
  const [dismissed, setDismissed] = useState(false);

  const visible = !dismissed && (status === "available" || status === "downloading");
  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-[340px] animate-fade-in rounded-2xl border border-[var(--border)] bg-[#14161f]/95 p-4 shadow-2xl shadow-black/60 backdrop-blur">
      <button
        onClick={() => {
          setDismissed(true);
          reset();
        }}
        className="absolute right-3 top-3 text-[var(--muted)] transition hover:text-white"
        aria-label={t("common.close")}
      >
        <X size={16} />
      </button>

      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-3)]">
          <Sparkles size={18} className="text-white" />
        </span>
        <div className="min-w-0 pr-4">
          <div className="text-sm font-bold">{t("update.available", { v: version ?? "" })}</div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">{t("update.bannerHint")}</div>
        </div>
      </div>

      <div className="mt-3">
        {status === "downloading" ? (
          <div>
            <div className="mb-1 text-[11px] text-[var(--muted)]">
              {t("update.downloading", { p: progress })}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <button className="btn btn-primary w-full" onClick={() => install()}>
            <Download size={16} /> {t("update.install")}
          </button>
        )}
      </div>
    </div>
  );
}
