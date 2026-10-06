import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A fully styled dropdown. Native <select> renders with OS styling in the webview,
 * which looks out of place in a dark theme. Set `searchable` for long option lists.
 */
export function Select({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  searchable = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  className?: string;
  ariaLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const focus = setTimeout(() => searchRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focus);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white/5 px-3 py-2 text-sm outline-none transition hover:bg-white/10 focus:border-[var(--accent)]"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-1.5 max-h-80 min-w-[15rem] overflow-y-auto rounded-xl border border-[var(--border)] bg-[#14161f] p-1.5 shadow-2xl shadow-black/60"
        >
          {searchable && (
            <div className="sticky top-0 mb-1 bg-[#14161f] pb-1">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="…"
                  className="w-full rounded-lg border border-[var(--border)] bg-white/5 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
          )}

          {filtered.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                o.value === value ? "bg-[var(--accent)]/25 text-white" : "text-white/85 hover:bg-white/10"
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={14} className="shrink-0 text-[var(--accent-2)]" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-[var(--muted)]">—</div>
          )}
        </div>
      )}
    </div>
  );
}
