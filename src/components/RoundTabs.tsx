"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "", label: "Overview", icon: "M4 12l8-8 8 8M6 10v10h12V10" },
  { key: "score", label: "Score", icon: "M12 5v14M5 12h14" },
  { key: "games", label: "Games", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM4 6h3M17 6h3" },
  { key: "stats", label: "Stats", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
];

export function RoundTabs({ roundId }: { roundId: string }) {
  const path = usePathname();
  const base = `/rounds/${roundId}`;
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="Round">
      <ul className="mx-auto max-w-lg grid grid-cols-4">
        {TABS.map((t) => {
          const href = t.key ? `${base}/${t.key}` : base;
          const active = t.key === "" ? path === base : path.startsWith(href) || (t.key === "score" && path.startsWith(`${base}/scorecard`));
          return (
            <li key={t.key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${active ? "text-ink" : "text-muted"}`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
