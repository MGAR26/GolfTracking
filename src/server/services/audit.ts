import type { Db } from "@/db/client";
import { schema as s } from "@/db/client";

export async function recordAudit(
  db: Db,
  input: { actorId: string | null; entityType: string; entityId: string; action: string; before?: unknown; after?: unknown },
) {
  await db.insert(s.auditEvents).values({
    id: crypto.randomUUID(),
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    beforeJson: input.before ?? null,
    afterJson: input.after ?? null,
  });
}
