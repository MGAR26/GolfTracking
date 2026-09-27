import Link from "next/link";
import type { ReactNode } from "react";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-lg px-4 pb-28 pt-4 flex flex-col gap-4 ${className}`}>{children}</main>;
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between mb-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "gold" | "red" }) {
  const cls = {
    neutral: "bg-surface-2 text-ink-2",
    green: "bg-tint text-ink",
    gold: "bg-brass-soft text-brass",
    red: "bg-neg-soft text-neg",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function ToPar({ value, className = "" }: { value: number; className?: string }) {
  const text = value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`;
  const tone = value < 0 ? "text-neg" : value === 0 ? "text-ink" : "text-ink";
  return <span className={`${tone} ${className}`}>{text}</span>;
}

export function LinkButton({ href, children, variant = "primary", className = "" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </Link>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="card p-6 text-center flex flex-col items-center gap-3">
      <p className="font-display text-xl">{title}</p>
      {body && <p className="text-sm text-muted max-w-xs">{body}</p>}
      {children}
    </div>
  );
}

export function StrokeDots({ n }: { n: number }) {
  if (n === 0) return null;
  const abs = Math.min(Math.abs(n), 3);
  return (
    <span className="inline-flex gap-0.5 align-middle ml-1" title={`${n > 0 ? "receives" : "gives"} ${Math.abs(n)} stroke${Math.abs(n) === 1 ? "" : "s"}`}>
      {Array.from({ length: abs }).map((_, i) => (
        <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${n > 0 ? "bg-accent" : "bg-neg"}`} />
      ))}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-tint text-ink font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}
