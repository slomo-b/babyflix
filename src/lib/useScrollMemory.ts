import { useEffect } from "react";

/**
 * Merkt sich die Scrollposition der Seite pro Route.
 *
 * Ohne das springt die Liste (Filme/Serien/Suche/Live) bei jedem Rückweg aus
 * der Detailansicht wieder ganz nach oben – bei 60er-Seiten mit Endlos-Nachladen
 * verliert man so jedes Mal die Stelle. Die Position wird gedrosselt (100 ms)
 * geschrieben und beim erneuten Betreten der Route nach dem Aufbau der Liste
 * wiederhergestellt.
 */
export function useScrollMemory(key: string) {
  // Beim Verlassen die aktuelle Position sichern.
  useEffect(() => {
    const onLeave = () => {
      try {
        sessionStorage.setItem(`babyflix-scroll:${key}`, String(window.scrollY));
      } catch {
        /* Speicher voll oder gesperrt – dann eben ohne */
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      onLeave();
    };
  }, [key]);

  // Beim Betreten wiederherstellen – mehrfach, weil die Liste nach dem
  // Nachladen wächst und den zuvor berechneten Wert sonst wegwirft.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`babyflix-scroll:${key}`);
    } catch {
      return;
    }
    if (!raw) return;
    const ziel = Number(raw);
    if (!Number.isFinite(ziel) || ziel < 40) return;

    let abbruch = false;
    const versuche = [0, 120, 320, 700];
    const timer = versuche.map((ms) =>
      setTimeout(() => {
        if (abbruch) return;
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.min(ziel, max) });
      }, ms)
    );
    return () => {
      abbruch = true;
      timer.forEach(clearTimeout);
    };
  }, [key]);
}

/** Position vergessen (z. B. wenn ein Filter oder die Suche alles umstellt). */
export function resetScrollMemory(key: string) {
  try {
    sessionStorage.removeItem(`babyflix-scroll:${key}`);
  } catch {
    /* egal */
  }
}
