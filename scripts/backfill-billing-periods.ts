/**
 * scripts/backfill-billing-periods.ts
 *
 * Backfill BillingPeriod rows for existing monthly invoices (invoiceType='MN'
 * / 'monthly_rent'). This script idempotently creates or updates BillingPeriod
 * rows by assigning cycleIndex 1..N in createdAt order per booking.
 *
 * Usage:
 *   npx tsx scripts/backfill-billing-periods.ts           # dry-run (default)
 *   npx tsx scripts/backfill-billing-periods.ts --apply   # commit to DB
 *
 * Output:
 *   "N invoices, M BillingPeriod rows created/updated, K skipped"
 *
 * Safety:
 *  - Dry-run is the default; pass --apply to write.
 *  - Idempotent: uses upsert on (bookingId, cycleIndex) so re-running is safe.
 *  - Skips invoices that have null bookingId or null billingPeriodStart/End.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const isApply = process.argv.includes('--apply');

async function main() {
  console.log(`[backfill-billing-periods] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`);

  // Load all monthly_rent invoices ordered by bookingId + createdAt
  const invoices = await prisma.invoice.findMany({
    where: {
      invoiceType: 'monthly_rent' as never,
      bookingId:   { not: null },
    },
    orderBy: [
      { bookingId:  'asc' },
      { createdAt:  'asc' },
    ],
    select: {
      id: true,
      bookingId: true,
      billingPeriodStart: true,
      billingPeriodEnd: true,
      createdAt: true,
    },
  });

  console.log(`[backfill-billing-periods] Found ${invoices.length} monthly_rent invoices`);

  // Group by bookingId and assign cycleIndex within each group
  const byBooking = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const bid = inv.bookingId!;
    if (!byBooking.has(bid)) byBooking.set(bid, []);
    byBooking.get(bid)!.push(inv);
  }

  let upserted = 0;
  let skipped  = 0;

  for (const [bookingId, group] of byBooking) {
    // Assign cycleIndex 1..N in createdAt order (already sorted)
    let cycleIndex = 0;
    for (const inv of group) {
      cycleIndex++;

      // Skip invoices without billing period dates — we can't create a valid row
      if (!inv.billingPeriodStart || !inv.billingPeriodEnd) {
        console.warn(
          `  SKIP invoice=${inv.id} (bookingId=${bookingId}, cycleIndex=${cycleIndex}) — null billingPeriod dates`,
        );
        skipped++;
        continue;
      }

      const row = {
        bookingId,
        cycleIndex,
        periodStart: inv.billingPeriodStart,
        periodEnd:   inv.billingPeriodEnd,
        isPartial:   false,  // conservative default — backfill doesn't know the contract type
        isFinal:     false,
        invoiceId:   inv.id,
      };

      if (isApply) {
        await prisma.billingPeriod.upsert({
          where: { bookingId_cycleIndex: { bookingId, cycleIndex } },
          update: {
            periodStart: row.periodStart,
            periodEnd:   row.periodEnd,
            invoiceId:   row.invoiceId,
          },
          create: row,
        });
      } else {
        // Dry-run: just print what would happen
        const existing = await prisma.billingPeriod.findUnique({
          where: { bookingId_cycleIndex: { bookingId, cycleIndex } },
          select: { id: true },
        });
        console.log(
          `  [DRY] ${existing ? 'UPDATE' : 'CREATE'} BillingPeriod` +
          ` bookingId=${bookingId} cycleIndex=${cycleIndex}` +
          ` period=${inv.billingPeriodStart.toISOString().slice(0, 10)}→${inv.billingPeriodEnd.toISOString().slice(0, 10)}`,
        );
      }

      upserted++;
    }
  }

  console.log(
    `\n[backfill-billing-periods] Summary:\n` +
    `  Invoices:         ${invoices.length}\n` +
    `  BillingPeriods ${isApply ? 'created/updated' : 'would create/update'}: ${upserted}\n` +
    `  Skipped (no dates): ${skipped}\n`,
  );

  if (!isApply) {
    console.log('  (dry-run — pass --apply to commit changes)');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
