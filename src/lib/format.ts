export function money(cents: number, { sign = false }: { sign?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const dollars = abs % 100 === 0 ? `$${abs / 100}` : `$${(abs / 100).toFixed(2)}`;
  if (cents < 0) return `-${dollars}`;
  return sign && cents > 0 ? `+${dollars}` : dollars;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return "";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
