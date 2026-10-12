/**
 * The pull-up sheet under the hole picture. Collapsed it shows one row (the caddie's line and
 * the one thing to do next) and the tab strip; pulled up it shows everything else about the hole.
 * Tap the handle or swipe it to switch.
 */
import { useRef, type ReactNode } from "react";

export function Sheet({ open, onOpenChange, summary, children, tabs }: { open: boolean; onOpenChange: (open: boolean) => void; summary: ReactNode; children: ReactNode; tabs: ReactNode }) {
  const start = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => { start.current = e.clientY; };
  const onUp = (e: React.PointerEvent) => {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    start.current = null;
    if (dy < -24) onOpenChange(true);
    else if (dy > 24) onOpenChange(false);
    else onOpenChange(!open);
  };
  return (
    <section className={`absolute inset-x-0 bottom-0 z-30 flex flex-col bg-surface rounded-t-[22px] shadow-[0_-12px_40px_rgba(27,42,65,.18)] transition-[height] duration-200 ${open ? "h-[82%]" : "h-auto"}`} data-testid="sheet" data-open={open}>
      <button type="button" onPointerDown={onDown} onPointerUp={onUp} className="w-full pt-2 pb-1 flex justify-center touch-none" aria-label={open ? "Close the sheet" : "Open the sheet"} aria-expanded={open} data-testid="sheet-handle">
        <span className="block h-1 w-9 rounded-full bg-line-strong" />
      </button>
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 flex flex-col gap-3" data-testid="sheet-body">{children}</div>
      ) : (
        <div className="px-4 pb-1" data-testid="sheet-summary">{summary}</div>
      )}
      <div className="shrink-0 border-t border-line pb-[max(10px,env(safe-area-inset-bottom))]">{tabs}</div>
    </section>
  );
}

/** The three tabs under the sheet: Play, Money, You. */
export function SheetTabs({ active, onPick }: { active: "score" | "money" | "stats"; onPick: (t: "score" | "money" | "stats") => void }) {
  const tabs: { key: "score" | "money" | "stats"; label: string }[] = [{ key: "score", label: "Play" }, { key: "money", label: "Money" }, { key: "stats", label: "You" }];
  return (
    <nav className="grid grid-cols-3 pt-2" aria-label="Round">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onPick(t.key)} aria-current={active === t.key ? "page" : undefined} className={`tap !min-h-8 text-[11px] uppercase tracking-[.08em] ${active === t.key ? "font-bold text-ink" : "font-semibold text-muted"}`}>{t.label}</button>
      ))}
    </nav>
  );
}
