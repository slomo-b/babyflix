import { useState } from "react";
import { Link2, Lock, LogIn, Stethoscope, User } from "lucide-react";
import { api, DiagResponse } from "../lib/api";
import { useT } from "../lib/i18n";
import { useStore } from "../lib/store";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const saved = useStore((s) => s.savedLogin);
  const setSavedLogin = useStore((s) => s.setSavedLogin);

  const [mode, setMode] = useState<"xtream" | "m3u">(saved?.mode ?? "xtream");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [m3uUrl, setM3uUrl] = useState(saved?.m3uUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagResponse | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "m3u") {
        await api.loginM3u(m3uUrl);
      } else {
        await api.login(baseUrl, username, password);
      }
      // Remember the login until the account is explicitly removed.
      setSavedLogin({ mode, baseUrl, username, password, m3uUrl });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setLoading(false);
    }
  };

  const runDiagnose = async () => {
    setDiag(null);
    setDiagLoading(true);
    try {
      const res = await api.diagnose(baseUrl, username || undefined, password || undefined);
      setDiag(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.diagFailed"));
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[var(--accent)]/20 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-180px] right-[-120px] h-[460px] w-[460px] rounded-full bg-[var(--accent-2)]/15 blur-[120px]" />

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="BabyFlix" className="mb-4 h-16 w-16 rounded-2xl shadow-2xl" />
          <h1 className="text-4xl font-black tracking-tight">
            Baby<span className="text-gradient">Flix</span>
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("login.title")}</p>
        </div>

        <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-6">
          {saved && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--ok)]/25 bg-[var(--ok)]/10 px-3 py-2 text-[11px] text-[var(--ok)]">
              <Lock size={13} /> {t("login.savedHint")}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-white/5 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("xtream");
                setError(null);
                setDiag(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "xtream"
                  ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-3)] text-white"
                  : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {t("login.tab.xtream")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("m3u");
                setError(null);
                setDiag(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "m3u"
                  ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-3)] text-white"
                  : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {t("login.tab.m3u")}
            </button>
          </div>

          {mode === "xtream" ? (
            <>
              <Field
                icon={<Link2 size={16} />}
                label={t("login.serverUrl")}
                placeholder="http://server:port"
                value={baseUrl}
                onChange={setBaseUrl}
                autoFocus
              />
              <Field
                icon={<User size={16} />}
                label={t("login.username")}
                placeholder="username"
                value={username}
                onChange={setUsername}
              />
              <Field
                icon={<Lock size={16} />}
                label={t("login.password")}
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={setPassword}
              />
            </>
          ) : (
            <>
              <Field
                icon={<Link2 size={16} />}
                label={t("login.m3uUrl")}
                placeholder="http://server:port/get.php?username=…&password=…&type=m3u_plus&output=hls"
                value={m3uUrl}
                onChange={setM3uUrl}
                autoFocus
              />
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">{t("login.m3uHint")}</p>
            </>
          )}

          {error && (
            <div className="max-h-52 overflow-y-auto whitespace-pre-line rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className={`grid gap-2 ${mode === "xtream" ? "grid-cols-[1fr_auto]" : "grid-cols-1"}`}>
            <button type="submit" disabled={loading} className="btn btn-primary py-3">
              {loading ? (
                t("login.connect")
              ) : (
                <>
                  <LogIn size={18} /> {t("login.signIn")}
                </>
              )}
            </button>
            {mode === "xtream" && (
              <button
                type="button"
                onClick={runDiagnose}
                disabled={diagLoading || !baseUrl}
                className="btn btn-ghost px-4"
                title={t("login.diagnoseTitle")}
              >
                <Stethoscope size={18} className={diagLoading ? "animate-pulse" : ""} />
              </button>
            )}
          </div>

          {diag && (
            <div className="rounded-xl border border-[var(--border)] bg-black/30 p-3 text-xs">
              <div className="mb-2 font-semibold text-[var(--muted)]">
                {t("login.diagResults")} <span className="text-white/90">{diag.normalized_base}</span>
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

          <p className="pt-1 text-center text-[11px] leading-relaxed text-[var(--muted)]">
            {t("login.privacy")}
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  autoFocus,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required
          className="w-full rounded-xl border border-[var(--border)] bg-white/5 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)] focus:bg-white/10"
        />
      </span>
    </label>
  );
}
