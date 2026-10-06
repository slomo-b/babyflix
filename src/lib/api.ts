// Typed client for the local BabyFlix backend (Rust/axum on 127.0.0.1:4523).

export const API_BASE = "http://127.0.0.1:4523";

export type Kind = "movie" | "series" | "live";

export interface MediaItem {
  id: string;
  kind: string;
  name: string;
  cover: string | null;
  category_id: string | null;
  extension: string | null;
  added: number | null;
  rating: number | null;
  epg_channel_id: string | null;
  tv_archive: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export interface DetailInfo {
  plot: string | null;
  cast: string[];
  director: string | null;
  genre: string | null;
  duration: string | null;
  release_date: string | null;
  trailer: string | null;
  backdrop: string | null;
  rating: number | null;
  container_extension: string | null;
  country: string | null;
  age: string | null;
}

export interface Episode {
  id: string;
  num: number;
  title: string;
  plot: string | null;
  cover: string | null;
  duration: string | null;
  rating: number | null;
  release_date: string | null;
  extension: string;
}

export interface Season {
  number: number;
  name: string;
  cover: string | null;
  episodes: Episode[];
}

export interface ImdbInfo {
  imdb_id: string | null;
  title: string | null;
  year: number | null;
  rating: number | null;
  votes: number | null;
  image: string | null;
  plot: string | null;
  genres: string[];
  runtime_minutes: number | null;
  cast: string[];
  director: string | null;
  kind: string | null;
}

export interface DetailResponse {
  item: MediaItem;
  detail: DetailInfo;
  seasons: Season[];
  imdb: ImdbInfo | null;
}

export interface HomeRow {
  title: string | null;
  category_id?: string;
  kind: string;
  items: MediaItem[];
}

export interface HomeResponse {
  hero: MediaItem[];
  rows: HomeRow[];
}

export interface BrowseResponse {
  items: MediaItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface EpgEntry {
  title: string;
  description: string;
  start: string | null;
  end: string | null;
  start_ts: number | null;
  stop_ts: number | null;
  now_playing: boolean;
  has_archive: number;
}

export interface SessionResponse {
  logged_in: boolean;
  source?: string;
  m3u_url?: string | null;
  user_info?: Record<string, unknown>;
  server_info?: Record<string, unknown>;
  allowed_exts?: string[];
}

export interface HealthResponse {
  ok: boolean;
  logged_in: boolean;
  catalog: Record<string, number>;
  ratings_loaded: boolean;
}

export interface DiagResult {
  base: string;
  ua: string;
  url: string;
  status: number | null;
  ok: boolean;
  content_type: string | null;
  snippet: string;
  elapsed_ms: number;
  error: string | null;
}

export interface DiagResponse {
  normalized_base: string;
  results: DiagResult[];
}

export interface StreamInfo {
  index: number | null;
  codec: string | null;
  lang: string | null;
  title: string | null;
  channels: number | null;
  width: number | null;
  height: number | null;
}

export interface StreamsResponse {
  audio: StreamInfo[];
  video: StreamInfo[];
  subtitle: StreamInfo[];
  duration: number | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  health: () => req<HealthResponse>("/api/health"),
  session: () => req<SessionResponse>("/api/session"),
  login: (base_url: string, username: string, password: string) =>
    req<{ ok: boolean }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ base_url, username, password }),
    }),
  loginM3u: (url: string) =>
    req<{ ok: boolean; source: string; counts: Record<string, number> }>("/api/login_m3u", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  logout: () => req<{ ok: boolean }>("/api/logout", { method: "POST" }),
  logoutSafe: () => req<{ ok: boolean }>("/api/logout", { method: "POST" }).catch(() => ({ ok: false })),
  diagnose: (base_url: string, username?: string, password?: string) =>
    req<DiagResponse>("/api/diagnose", {
      method: "POST",
      body: JSON.stringify({ base_url, username, password }),
    }),

  categories: (kind: Kind) => req<{ categories: Category[] }>(`/api/categories?kind=${kind}`),
  browse: (params: {
    kind: Kind;
    category?: string;
    q?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  }) => {
    const sp = new URLSearchParams({ kind: params.kind });
    if (params.category) sp.set("category", params.category);
    if (params.q) sp.set("q", params.q);
    if (params.sort) sp.set("sort", params.sort);
    if (params.page) sp.set("page", String(params.page));
    if (params.page_size) sp.set("page_size", String(params.page_size));
    return req<BrowseResponse>(`/api/browse?${sp.toString()}`);
  },
  home: () => req<HomeResponse>("/api/home"),
  detail: (kind: "movie" | "series", id: string) =>
    req<DetailResponse>(`/api/detail?kind=${kind}&id=${encodeURIComponent(id)}`),
  epg: (streamId: string, full = false, limit = 12, channelId?: string) => {
    const sp = new URLSearchParams({
      stream_id: streamId,
      full: String(full),
      limit: String(limit),
    });
    if (channelId) sp.set("channel_id", channelId);
    return req<{ epg: EpgEntry[] }>(`/api/epg?${sp.toString()}`);
  },
  enrich: (title: string, year?: number, kind?: string) => {
    const sp = new URLSearchParams({ title });
    if (year) sp.set("year", String(year));
    if (kind) sp.set("kind", kind);
    return req<{ imdb: ImdbInfo | null }>(`/api/enrich?${sp.toString()}`);
  },
  enrichBatch: (items: { title: string; year?: number; kind?: string }[]) =>
    req<{ results: (ImdbInfo | null)[] }>("/api/enrich_batch", {
      method: "POST",
      body: JSON.stringify(items),
    }),
  refresh: () => req<{ ok: boolean }>("/api/refresh", { method: "POST" }),
  remux: (kind: Kind, id: string, ext?: string, audio?: number) => {
    const sp = new URLSearchParams({ kind, id });
    if (ext) sp.set("ext", ext);
    if (audio != null) sp.set("audio", String(audio));
    return req<{ token: string; playlist: string; duration: number | null }>(
      `/api/remux?${sp.toString()}`
    );
  },
  remuxStop: (token: string) =>
    req<{ ok: boolean }>(`/api/remux/stop?token=${encodeURIComponent(token)}`).catch(() => ({ ok: false })),
  streams: (kind: Kind, id: string, ext?: string) => {
    const sp = new URLSearchParams({ kind, id });
    if (ext) sp.set("ext", ext);
    return req<StreamsResponse>(`/api/streams?${sp.toString()}`);
  },
};

export function imgUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  return `${API_BASE}/api/img?u=${encodeURIComponent(u)}`;
}

export function playerUrl(kind: Kind, id: string, ext?: string): string {
  const sp = new URLSearchParams({ kind, id });
  if (ext) sp.set("ext", ext);
  return `${API_BASE}/api/player?${sp.toString()}`;
}
