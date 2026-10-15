import { useEffect } from "react";

/**
 * ID des scrollenden Containers (siehe `App.tsx`).
 *
 * Die App scrollt **nicht** im Fenster, sondern in einem inneren `<div>` mit
 * `overflow-y-auto`. `window.scrollY` ist dort immer 0 und `window.scrollTo`
 * wirkungslos - deshalb muss die Position am Container gelesen und gesetzt
 * werden.
 */
export const SCROLL_CONTAINER_ID = "app-scroll";

/** Das scrollende Element - oder `null`, wenn doch das Fenster scrollt. */
function scroller(): HTMLElement | null {
  return document.getElementById(SCROLL_CONTAINER_ID);
}

function scrollPosition(): number {
  const el = scroller();
  return el ? el.scrollTop : window.scrollY;
}

function maxScroll(): number {
  const el = scroller();
  return el
    ? Math.max(0, el.scrollHeight - el.clientHeight)
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function scrollToY(top: number) {
  const el = scroller();
  if (el) el.scrollTo({ top });
  else window.scrollTo({ top });
}

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
  // Fortlaufend sichern – bewusst **nicht** erst beim Verlassen: Beim Wechsel
  // in die Detailansicht schrumpft der Inhalt der Liste, und der Browser
  // klemmt `scrollTop` schon vor dem Aufräumen nach oben. Ein erst dann
  // gelesener Wert wäre also längst falsch.
  useEffect(() => {
    const slot = `babyflix-scroll:${key}`;
    let letzteSchreibung = 0;
    let timer: number | null = null;

    const schreiben = () => {
      letzteSchreibung = Date.now();
      try {
        sessionStorage.setItem(slot, String(scrollPosition()));
      } catch {
        /* Speicher voll oder gesperrt – dann eben ohne */
      }
    };

    // Gedrosselt auf 100 ms, aber immer mit dem letzten Wert (Trailing).
    const onScroll = () => {
      const warten = 100 - (Date.now() - letzteSchreibung);
      if (warten <= 0) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        schreiben();
      } else if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          schreiben();
        }, warten);
      }
    };

    // Beim Drücken steht die Liste noch – der letzte Moment für eine exakte
    // Position, bevor der Klick in die Detailansicht navigiert.
    const onPointerDown = () => schreiben();

    const ziel = scroller() ?? window;
    ziel.addEventListener("scroll", onScroll, { passive: true });
    ziel.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("beforeunload", schreiben);

    return () => {
      // Keinen Nachzügler mehr schreiben lassen – der liefe gegen den bereits
      // geschrumpften Inhalt der nächsten Seite.
      if (timer !== null) clearTimeout(timer);
      ziel.removeEventListener("scroll", onScroll);
      ziel.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("beforeunload", schreiben);
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
        scrollToY(Math.min(ziel, maxScroll()));
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
