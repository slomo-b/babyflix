import { NavLink } from "react-router-dom";
import { Film, Heart, Home, Radio, Search, Settings, Tv, Wifi } from "lucide-react";
import { useT } from "../lib/i18n";

const nav = [
  { to: "/", key: "nav.home", icon: Home },
  { to: "/movies", key: "nav.movies", icon: Film },
  { to: "/series", key: "nav.series", icon: Tv },
  { to: "/live", key: "nav.live", icon: Radio },
  { to: "/search", key: "nav.search", icon: Search },
  { to: "/watchlist", key: "nav.watchlist", icon: Heart },
  { to: "/settings", key: "nav.settings", icon: Settings },
];

export function Sidebar({ user, status }: { user?: string | null; status?: string | null }) {
  const t = useT();
  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col border-r border-[var(--border)] bg-[#0a0c12]/80 px-4 py-6 backdrop-blur">
      <div className="mb-9 flex items-center gap-2.5 px-2">
        <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl shadow-lg" />
        <div className="leading-none">
          <div className="text-lg font-black tracking-tight">
            Baby<span className="text-gradient">Flix</span>
          </div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
            {t("sidebar.tagline")}
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {nav.map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? "bg-gradient-to-r from-[var(--accent)]/25 to-transparent text-white"
                  : "text-[var(--muted)] hover:bg-white/5 hover:text-white"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? "text-[var(--accent-2)]" : ""} />
                {t(key)}
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent-2)] shadow-[0_0_10px_var(--accent-2)]" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-[var(--border)] bg-white/5 p-3.5">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Wifi size={13} className="text-[var(--ok)]" />
          <span className="font-semibold text-white/90">{user || t("sidebar.notSignedIn")}</span>
        </div>
        {status && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ok)]">
            {status}
          </div>
        )}
      </div>
    </aside>
  );
}
