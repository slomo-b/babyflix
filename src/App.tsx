import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { useT } from "./lib/i18n";
import { useUpdater } from "./lib/updater";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Player } from "./components/Player";
import { UpdateBanner } from "./components/UpdateBanner";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Movies from "./pages/Movies";
import Series from "./pages/Series";
import Live from "./pages/Live";
import Search from "./pages/Search";
import Detail from "./pages/Detail";
import Settings from "./pages/Settings";

function Splash() {
  const t = useT();
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <img src="/icon.svg" alt="" className="h-16 w-16 animate-pulse rounded-2xl shadow-2xl" />
        <div className="text-sm text-[var(--muted)]">{t("app.loading")}</div>
      </div>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, staleTime: 5000 });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    enabled: !!session.data?.logged_in,
    refetchInterval: 15000,
  });

  // Check for updates shortly after launch (packaged app only).
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const check = () => useUpdater.getState().check();
    const timer = setTimeout(check, 6000);
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  if (session.isLoading) return <Splash />;

  if (!session.data?.logged_in) {
    return (
      <>
        <Login
          onSuccess={() => {
            qc.invalidateQueries();
          }}
        />
        <UpdateBanner />
      </>
    );
  }

  const ui = (session.data.user_info ?? {}) as Record<string, unknown>;
  return (
    <div className="flex h-full w-full">
      <Sidebar user={(ui.username as string) ?? null} status={(ui.status as string) ?? null} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar health={health.data} />
        <div className="flex-1 overflow-y-auto px-8 pb-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movies" element={<Movies />} />
            <Route path="/series" element={<Series />} />
            <Route path="/live" element={<Live />} />
            <Route path="/search" element={<Search />} />
            <Route path="/movie/:id" element={<Detail kind="movie" />} />
            <Route path="/series/:id" element={<Detail kind="series" />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </div>
      </main>
      <Player />
      <UpdateBanner />
    </div>
  );
}
