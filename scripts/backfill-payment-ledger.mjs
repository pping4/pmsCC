// Backfill script: find ACTIVE payments with zero ledger entries and post
// the missing DEBIT Money / CREDIT Revenue pair. Safe to run repeatedly.
//
// Why needed: several API routes historically created Payment rows without
// calling postPaymentReceived. This script walks payments, checks whether any
// ledger entry references them, and posts the missing pair when absent.
//
// Run:  node scripts/backfill-payment-ledger.mjs
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SUBKIND_FOR_METHOD = (m) => {
  const s = String(m).toLowerCase();
  if (s === 'cash') return { subKind: 'CASH', legacy: 'CASH' };
  if (s === 'credit_card') return { subKind: 'CARD_CLEARING', legacy: 'BANK' };
  return { subKind: 'BANK', legacy: 'BANK' };
};

async function resolveDefault(subKind) {
  return prisma.financialAccount.findFirst({
    where: { subKind, isActive: true, isDefault: true },
  });
}

async function main() {
  const payments = await prisma.payment.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, paymentNumber: true, amount: true, paymentMethod: true, paymentDate: true, createdBy: true, feeAmount: true },
  });
  console.log(`Scanning ${payments.length} ACTIVE payments…`);

  const revenueAcc = await resolveDefault('ROOM_REVENUE');
  if (!revenueAcc) {
    console.error('ROOM_REVENUE default account not found — run seed first');
    process.exit(1);
  }

  let posted = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of payments) {
    const existing = await prisma.ledgerEntry.count({
      where: { referenceType: 'Payment', referenceId: p.id },
    });
    if (existing > 0) { skipped++; continue; }

    const { subKind, legacy } = SUBKIND_FOR_METHOD(p.paymentMethod);
    const moneyAcc = await resolveDefault(subKind);
    if (!moneyAcc) {
      console.warn(`  [skip] ${p.paymentNumber}: no default account for ${subKind}`);
      errors++;
      continue;
    }

    const { randomUUID } = await import('crypto');
    const batchId = randomUUID();
    const date = p.paymentDate ?? new Date();
    const amount = p.amount;

    try {
      await prisma.ledgerEntry.createMany({
        data: [
          {
            date, type: 'DEBIT', account: legacy, financialAccountId: moneyAcc.id,
            batchId, amount, referenceType: 'Payment', referenceId: p.id,
            description: `[backfill] Payment received via ${p.paymentMethod}`,
            createdBy: p.createdBy ?? 'backfill',
          },
          {
            date, type: 'CREDIT', account: 'REVENUE', financialAccountId: revenueAcc.id,
            batchId, amount, referenceType: 'Payment', referenceId: p.id,
            description: `[backfill] Payment received via ${p.paymentMethod}`,
            createdBy: p.createdBy ?? 'backfill',
          },
        ],
      });
      posted++;
      console.log(`  [ok]   ${p.paymentNumber}  ${p.paymentMethod}  amt=${amount}  → ${moneyAcc.code}`);
    } catch (e) {
      errors++;
      console.error(`  [err]  ${p.paymentNumber}:`, e.message);
    }
  }

  console.log(`\nDone. posted=${posted}  skipped(already-ok)=${skipped}  errors=${errors}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
