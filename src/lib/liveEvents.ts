import type { RoundChange } from "@/server/realtime/bus";

type Listener = (change: RoundChange) => void;

/** Tiny client-side fan-out so components (e.g. hole entry) can react to live changes. */
class LiveEvents {
  private listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(change: RoundChange): void {
    for (const l of this.listeners) l(change);
  }
}

export const liveEvents = new LiveEvents();
