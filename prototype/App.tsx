import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { addPastPinehurstRounds, PAST_TRIP_ID, seedState, type State } from "./store";

/* ---------- routing ---------- */
export type RoundTab = "overview" | "score" | "scorecard" | "games" | "stats" | "finish";
export type Route =
  | { name: "home" }
  | { name: "newTrip" }
  | { name: "trip"; tripId: string }
  | { name: "newRound"; tripId: string }
  | { name: "money"; tripId: string }
  | { name: "round"; roundId: string; tab: RoundTab; hole?: number; player?: string };

interface Ctx {
  state: State;
  mutate: (fn: (s: State) => void) => string | null;
  route: Route;
  nav: (r: Route) => void;
  back: () => void;
  reset: () => void;
}
const AppContext = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppContext)!;

const STORAGE = "gto-proto:v3";
const NAV_STORAGE = "gto-proto:nav:v3";

function load(): State {
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (raw) {
      const saved = JSON.parse(raw) as State;
      // older saved demos predate last year's rounds; add them without touching anything else
      // demo Venmo usernames for saved demos made before payments existed (John stays blank on purpose)
      const demo: Record<string, string> = { p_matt: "GTO-Demo-Matt", p_marcus: "GTO-Demo-Marcus", p_ryan: "GTO-Demo-Ryan" };
      if (!(saved as State & { demoVenmo?: boolean }).demoVenmo) { for (const p of saved.players) if (demo[p.id] && !p.venmo) p.venmo = demo[p.id]; (saved as State & { demoVenmo?: boolean }).demoVenmo = true; try { window.localStorage.setItem(STORAGE, JSON.stringify(saved)); } catch { /* convenience only */ } }
      if (!saved.trips.some((t) => t.id === PAST_TRIP_ID)) { addPastPinehurstRounds(saved); try { window.localStorage.setItem(STORAGE, JSON.stringify(saved)); } catch { /* convenience only */ } }
      return saved;
    }
  } catch {
    /* fall through */
  }
  const fresh = seedState();
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(fresh));
  } catch {
    /* per-viewer convenience only */
  }
  return fresh;
}

/** A saved route is only usable if everything it points at still exists in the store. */
function routeIsValid(r: Route, s: State): boolean {
  switch (r.name) {
    case "home":
    case "newTrip":
      return true;
    case "trip":
    case "newRound":
    case "money":
      return s.trips.some((t) => t.id === r.tripId);
    case "round":
      return s.rounds.some((x) => x.id === r.roundId);
  }
}

/** Single mutable store for the prototype; React re-renders via a tick counter. */
let STORE: State = load();

export function AppProvider({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  const [stack, setStack] = useState<Route[]>(() => {
    try {
      const raw = window.localStorage.getItem(NAV_STORAGE);
      if (raw) {
        const saved = JSON.parse(raw) as Route[];
        if (Array.isArray(saved) && saved.length > 0 && saved[0].name === "home" && saved.every((r) => routeIsValid(r, STORE))) return saved;
      }
    } catch {
      /* fall through to the default stack */
    }
    const s = STORE;
    const live = s.rounds.find((r) => r.status === "LIVE");
    return [{ name: "home" }, ...(s.trips[0] ? [{ name: "trip", tripId: s.trips[0].id } as Route] : []), ...(live ? [{ name: "round", roundId: live.id, tab: "score" } as Route] : [])];
  });

  const persist = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify(STORE));
    } catch {
      /* per-viewer convenience only */
    }
  }, []);

  const mutate = useCallback(
    (fn: (s: State) => void): string | null => {
      try {
        fn(STORE);
        persist();
        setTick((t) => t + 1);
        return null;
      } catch (e) {
        setTick((t) => t + 1);
        return e instanceof Error ? e.message : String(e);
      }
    },
    [persist],
  );

  // Moving around inside one round (tabs, holes) replaces the entry, so Back always leaves the round.
  const nav = useCallback((r: Route) => {
    setStack((s) => {
      const top = s[s.length - 1];
      const sameRound = top?.name === "round" && r.name === "round" && top.roundId === r.roundId;
      return sameRound ? [...s.slice(0, -1), r] : [...s, r];
    });
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    window.scrollTo({ top: 0 });
  }, []);
  const reset = useCallback(() => {
    STORE = seedState();
    persist();
    const live = STORE.rounds[0];
    setStack([{ name: "home" }, { name: "trip", tripId: STORE.trips[0].id }, { name: "round", roundId: live.id, tab: "score" }]);
  }, [persist]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_STORAGE, JSON.stringify(stack));
    } catch {
      /* per-viewer convenience only */
    }
  }, [stack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  const value: Ctx = { state: STORE, mutate, route: stack[stack.length - 1], nav, back, reset };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* ---------- chrome ---------- */
export function AppHeader({ title, subtitle, showBack }: { title: string; subtitle?: string; showBack: boolean }) {
  const { state, mutate, back, reset } = useApp();
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-lg px-4 h-14 flex items-center gap-3">
        {showBack ? (
          <button type="button" onClick={back} className="tap -ml-2 inline-flex items-center justify-center text-accent font-semibold" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        ) : (
          <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[var(--bg)] font-display text-sm ring-1 ring-brass" aria-label="Menu">G</button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
        </div>
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <span className="sr-only">Acting as</span>
          <select aria-label="Acting as player" className="field !min-h-9 !py-0 !px-2 text-xs font-semibold" value={state.actorId} onChange={(e) => mutate((s) => { s.actorId = e.target.value; })}>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>You: {p.name}</option>
            ))}
          </select>
        </label>
      </div>
      {menu && (
        <div className="mx-auto max-w-lg px-4 pb-3 flex items-center justify-between text-xs text-muted">
          <span>Prototype: runs the app&apos;s real scoring, games and settlement logic in your browser.</span>
          <button type="button" className="btn btn-secondary !min-h-9 text-xs" onClick={() => { reset(); setMenu(false); }}>Reset demo</button>
        </div>
      )}
    </header>
  );
}

const TABS: { key: RoundTab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "M4 12l8-8 8 8M6 10v10h12V10" },
  { key: "score", label: "Score", icon: "M12 5v14M5 12h14" },
  { key: "games", label: "Games", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM4 6h3M17 6h3" },
  { key: "stats", label: "Stats", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
];

export function RoundTabs({ roundId, tab }: { roundId: string; tab: RoundTab }) {
  const { nav } = useApp();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="Round">
      <ul className="mx-auto max-w-lg grid grid-cols-4">
        {TABS.map((t) => {
          const active = t.key === tab || (t.key === "score" && tab === "scorecard");
          return (
            <li key={t.key}>
              <button type="button" onClick={() => nav({ name: "round", roundId, tab: t.key })} aria-current={active ? "page" : undefined} className={`tap w-full flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${active ? "text-ink" : "text-muted"}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
