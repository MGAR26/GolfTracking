import { subscribeRound, type RoundChange } from "@/server/realtime/bus";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

/** Server-sent events stream of changes for one round. */
export async function GET(request: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const encoder = new TextEncoder();
  const cleanupRef: { current: (() => void) | null } = { current: null };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };
      send("hello", { roundId, at: new Date().toISOString() });
      const unsubscribe = subscribeRound(roundId, (change: RoundChange) => send("change", change));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS);
      // When the phone navigates away the request aborts; the stream is already torn
      // down by the runtime, so only release our resources here.
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener("abort", cleanup);
      cleanupRef.current = cleanup;
    },
    cancel() {
      cleanupRef.current?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
