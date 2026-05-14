/**
 * scripts/cron/generate-monthly-drafts.ts
 *
 * Standalone CLI wrapper for the billing-drafts daily job.
 * The core logic lives in src/jobs/billing-drafts-daily.ts (shared with the
 * HTTP endpoint at /api/cron/billing-draft).
 *
 * Usage:
 *   npx tsx scripts/cron/generate-monthly-drafts.ts           # dry-run
 *   npx tsx scripts/cron/generate-monthly-drafts.ts --apply   # commit to DB
 *
 * TODO: wire into render.yaml / railway.toml schedule (02:00 daily).
 */

import { PrismaClient } from '@prisma/client';
import { generateDraftInvoice, resolveNextPeriod } from '../../src/services/billing.service';

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`[cron.billing-draft] Starting draft generation (dry-run=${isDryRun}) …`);

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const bookings = await prisma.booking.findMany({
    where: {
      bookingType: { in: ['monthly_short', 'monthly_long'] as never[] },
      status:      { in: ['checked_in', 'confirmed'] as never[] },
    },
    select: {
      id: true,
      bookingNumber: true,
      bookingType: true,
      checkIn: true,
      checkOut: true,
      contract: { select: { status: true } },
      billingPeriods: {
        orderBy: { cycleIndex: 'desc' },
        take: 1,
        select: { cycleIndex: true },
      },
    },
  });

  console.log(`[cron.billing-draft] ${bookings.length} eligible bookings found`);

  let generated = 0;
  let skipped   = 0;
  let errored   = 0;

  for (const booking of bookings) {
    // Skip terminated contracts
    if (booking.contract?.status === 'terminated') {
      console.log(`  SKIP booking=${booking.bookingNumber} reason=contract_terminated`);
      skipped++;
      continue;
    }

    const maxCycleIndex  = booking.billingPeriods[0]?.cycleIndex ?? 0;
    const nextCycleIndex = maxCycleIndex + 1;

    let period: ReturnType<typeof resolveNextPeriod>;
    try {
      period = resolveNextPeriod({
        bookingType: booking.bookingType as 'monthly_short' | 'monthly_long',
        checkIn:  booking.checkIn,
        checkOut: booking.checkOut,
        cycleIndex: nextCycleIndex,
      });
    } catch (err) {
      console.error(`  ERROR booking=${booking.bookingNumber} reason=${err}`);
      errored++;
      continue;
    }

    if (period.start > todayUTC) {
      console.log(
        `  SKIP booking=${booking.bookingNumber} cycle=${nextCycleIndex}` +
        ` reason=period_not_started (${period.start.toISOString().slice(0, 10)})`,
      );
      skipped++;
      continue;
    }

    if (isDryRun) {
      console.log(
        `  [DRY] WOULD generate booking=${booking.bookingNumber} cycle=${nextCycleIndex}` +
        ` period=${period.start.toISOString().slice(0, 10)}→${period.end.toISOString().slice(0, 10)}`,
      );
      generated++;
      continue;
    }

    try {
      const draft = await prisma.$transaction((tx) =>
        generateDraftInvoice(tx, {
          bookingId:  booking.id,
          cycleIndex: nextCycleIndex,
          createdBy:  'system:cron',
        }),
      );
      console.log(
        `  GENERATED booking=${booking.bookingNumber} cycle=${nextCycleIndex}` +
        ` invoice=${draft.invoiceId}`,
      );
      generated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR booking=${booking.bookingNumber} cycle=${nextCycleIndex} reason=${msg}`);
      // Log to ActivityLog
      try {
        await prisma.activityLog.create({
          data: {
            action:      'billing_draft_error',
            category:    'billing',
            description: `generateDraftInvoice failed for booking ${booking.bookingNumber} cycle ${nextCycleIndex}: ${msg}`,
            bookingId:   booking.id,
            severity:    'error',
          },
        });
      } catch { /* non-fatal */ }
      errored++;
    }
  }

  console.log(
    `\n[cron.billing-draft] Summary:\n` +
    `  Processed: ${bookings.length}\n` +
    `  Generated${isDryRun ? ' (would)' : ''}:  ${generated}\n` +
    `  Skipped:   ${skipped}\n` +
    `  Errors:    ${errored}\n`,
  );
  if (isDryRun) console.log('  (dry-run — pass --apply to commit changes)');

  // Exit non-zero only if all eligible bookings failed with no successes
  const allFailed = errored > 0 && generated === 0;
  process.exit(allFailed ? 1 : 0);
}

main()
  .catch((e) => { console.error(e); process.exit(2); })
  .finally(() => prisma.$disconnect());
