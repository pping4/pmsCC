/**
 * contract-number.service.ts
 *
 * Generates contract numbers in the format `YYYY/NNNN`, resetting the
 * counter at the start of each calendar year.
 *
 *   - 2026/0001, 2026/0002, … → 2026/9999
 *   - On 1 Jan 2027 → 2027/0001
 *
 * Concurrency safety:
 *   Two requests racing to create a contract at the same instant must not
 *   receive duplicate numbers. We use a PostgreSQL **transaction-scoped
 *   advisory lock** (`pg_advisory_xact_lock`) keyed to a constant so any
 *   number of concurrent contract-number generators are serialized.
 *
 *   The lock is released automatically at transaction commit/rollback.
 *
 *   Why advisory lock (vs. a counter table)?
 *     - No schema change required (no extra migration, no extra model).
 *     - Lock is scoped to the Tx — if the outer transaction rolls back,
 *       the lock evaporates and the number is simply never consumed.
 *     - Counter tables duplicate state and add an UPSERT hot row; advisory
 *       locks are the textbook Postgres solution for this exact problem.
 *
 *   The actual counter is derived by taking MAX(contractNumber) for the
 *   current year inside the locked section, so gaps (from voided/deleted
 *   drafts) don't cause duplicates — the number is always >= max existing.
 *
 * Usage (inside a $transaction):
 *   await prisma.$transaction(async (tx) => {
 *     const contractNumber = await generateContractNumber(tx);
 *     await tx.contract.create({ data: { contractNumber, ... } });
 *   });
 */

import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Arbitrary constant used as the advisory-lock key.
 * Any bigint fits; this one is a hash-like literal so conflicts with other
 * advisory locks elsewhere in the codebase are effectively impossible.
 */
const CONTRACT_NUMBER_LOCK_KEY = 981273401;

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * Generate the next sequential contract number for the current calendar year.
 * MUST be called inside a Prisma $transaction — the advisory lock is
 * transaction-scoped and would otherwise have no effect.
 */
export async function generateContractNumber(tx: TxClient): Promise<string> {
  // 1. Acquire transaction-scoped advisory lock — serializes concurrent callers.
  //    Released automatically when the transaction commits or rolls back.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CONTRACT_NUMBER_LOCK_KEY})`;

  // 2. Determine current year using local time (which on our production
  //    servers runs Asia/Bangkok = UTC+7; this also matches how HotelSettings
  //    treats "today" elsewhere in the codebase).
  const year = new Date().getFullYear();
  const prefix = `${year}/`;

  // 3. Find the highest existing contract number for this year.
  //    We use MAX via orderBy desc (not COUNT) so deleted drafts don't
  //    cause us to reissue a number that already exists.
  const latest = await tx.contract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: 'desc' },
    select: { contractNumber: true },
  });

  let nextSeq = 1;
  if (latest) {
    const tail = latest.contractNumber.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      nextSeq = parsed + 1;
    }
  }

  return `${prefix}${pad4(nextSeq)}`;
}
