import type { PlayerId } from "../types";
import type { NetBalances } from "../ledger";

export interface SuggestedPayment {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
}

export interface SettlementPlan {
  payments: SuggestedPayment[];
  /** Should always be 0 for a consistent ledger. */
  residualCents: number;
}

/**
 * Classic creditors/debtors matching. Greedy largest-first gives a near-minimal
 * payment count and never touches the underlying obligations.
 */
export function optimizeSettlement(balances: NetBalances): SettlementPlan {
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, remaining: -v }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, remaining: v }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));

  const payments: SuggestedPayment[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    const transfer = Math.min(debtor.remaining, creditor.remaining);
    if (transfer > 0) payments.push({ fromPlayerId: debtor.id, toPlayerId: creditor.id, amountCents: transfer });
    debtor.remaining -= transfer;
    creditor.remaining -= transfer;
    if (debtor.remaining === 0) d++;
    if (creditor.remaining === 0) c++;
  }
  const residualCents =
    debtors.reduce((a, x) => a + x.remaining, 0) - creditors.reduce((a, x) => a + x.remaining, 0);
  return { payments, residualCents };
}
