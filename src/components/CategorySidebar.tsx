import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search as SearchIcon } from "lucide-react";
import type { Category } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";

/**
 * Kategorie-Sidebar für Filme, Serien und Live-TV.
 *
 * Ersetzt die frühere Chip-Reihe bzw. das Dropdown: Suchfeld oben, darunter die
 * Kategorien untereinander. Sie bleibt beim Scrollen stehen (`sticky`) und lässt
 * sich einklappen – der Zustand liegt im Store und überlebt so einen Neustart.
 */
export function CategorySidebar({
  categories,
  value,
  onChange,
  allLabel,
  loading = false,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  allLabel: string;
  loading?: boolean;
}) {
  const t = useT();
  const open = useStore((s) => s.categorySidebarOpen);
  const setOpen = useStore((s) => s.setCategorySidebarOpen);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  const zeile = (id: string, label: string) => {
    const active = value === id;
    return (
      <button
        key={id || "__all"}
        onClick={() => onChange(id)}
        title={label}
        className={`block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition ${
          active
            ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-3)] font-semibold text-white"
            : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]"
        }`}
      >
        {label}
      </button>
    );
  };

  // Eingeklappt bleibt nur ein schmaler Griff stehen.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={t("catalog.showCategories")}
        aria-label={t("catalog.showCategories")}
        className="sticky top-0 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/[0.04] text-[var(--muted)] transition hover:text-white"
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <aside className="sticky top-0 flex h-[calc(100vh-8rem)] w-56 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.03]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
          {t("catalog.categories")}
        </span>
        <button
          onClick={() => setOpen(false)}
          title={t("catalog.hideCategories")}
          aria-label={t("catalog.hideCategories")}
          className="rounded-full p-1 text-[var(--muted)] transition hover:text-white"
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="relative shrink-0 p-3">
        <SearchIcon
          size={14}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("catalog.searchCategories")}
          className="w-full rounded-xl border border-[var(--border)] bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {zeile("", allLabel)}
        {filtered.map((c) => zeile(c.id, c.name))}
        {!loading && filtered.length === 0 && (
          <span className="block px-3 py-2 text-xs text-[var(--muted)]">—</span>
        )}
      </div>
    </aside>
  );
}
