/**
 * numberSequence.service.ts — Sprint 5 Phase 6.2
 *
 * Atomic, gap-free running-number allocator for Revenue-compliant documents
 * (TAX_INVOICE, RECEIPT). Correctness relies on:
 *   1. `SELECT ... FOR UPDATE` — row-level lock held until the transaction
 *      commits, so concurrent allocators serialize at this row.
 *   2. Caller MUST be inside a `prisma.$transaction` and pass the tx client.
 *   3. Number allocation is the **last step** before the document is created;
 *      if the caller rolls back, `nextSeq` rolls back with it → no gaps.
 *
 * Format: `{prefix}-{periodTag}-{seq:05d}`
 *   - resetEvery=MONTHLY  → periodTag="YYYYMM"   (TI-202604-00001)
 *   - resetEvery=YEARLY   → periodTag="YYYY"     (RC-2026-00001)
 *   - resetEvery=DAILY    → periodTag="YYYYMMDD"
 *   - resetEvery=NEVER    → periodTag omitted    (TI-00001)
 *
 * Void handling: voided rows keep their number → next allocation still
 * increments `nextSeq`. Gaps are expected in the series with VOIDED status.
 */

import { Prisma, type ResetPeriod } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export type SequenceKind = 'TAX_INVOICE' | 'RECEIPT';

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function periodTag(reset: ResetPeriod, d: Date): string {
  const y  = d.getFullYear();
  const m  = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  switch (reset) {
    case 'MONTHLY': return `${y}${m}`;
    case 'YEARLY':  return `${y}`;
    case 'DAILY':   return `${y}${m}${dd}`;
    case 'NEVER':   return '';
  }
}

/**
 * Decide whether the sequence crossed a reset boundary since `lastResetAt`.
 * First call (lastResetAt=null) is NOT treated as needing a reset — seq stays
 * at whatever the row has (default 1) and `lastResetAt` gets stamped.
 */
function needsReset(reset: ResetPeriod, lastResetAt: Date | null, now: Date): boolean {
  if (reset === 'NEVER') return false;
  if (!lastResetAt) return false; // first allocation — row defaults apply
  const prev = periodTag(reset, lastResetAt);
  const curr = periodTag(reset, now);
  return prev !== curr;
}

export async function nextSequenceNumber(
  tx: TxClient,
  kind: SequenceKind,
  now: Date = new Date(),
): Promise<string> {
  // Row-level lock — serialize concurrent allocators. If the surrounding
  // transaction aborts, the lock + the nextSeq update both roll back.
  const rows = await tx.$queryRaw<Array<{
    id: string; prefix: string; next_seq: number;
    reset_every: ResetPeriod; last_reset_at: Date | null;
  }>>`
    SELECT id, prefix, next_seq, reset_every, last_reset_at
    FROM number_sequences
    WHERE kind = ${kind}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error(`NumberSequence[${kind}] not found — seed first`);

  const reset = row.reset_every;
  const shouldReset = needsReset(reset, row.last_reset_at, now);
  const seq = shouldReset ? 1 : row.next_seq;

  const tag = periodTag(reset, now);
  const number = tag
    ? `${row.prefix}-${tag}-${String(seq).padStart(5, '0')}`
    : `${row.prefix}-${String(seq).padStart(5, '0')}`;

  // Stamp lastResetAt on the *first* allocation too, so subsequent calls
  // have a reference point for the next reset boundary.
  await tx.numberSequence.update({
    where: { id: row.id },
    data: {
      nextSeq: seq + 1,
      lastResetAt: shouldReset || row.last_reset_at === null ? now : row.last_reset_at,
    },
  });

  return number;
}
