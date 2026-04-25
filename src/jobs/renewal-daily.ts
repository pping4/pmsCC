/**
 * Daily renewal cron (Sprint 3B / T20).
 *
 * Runs at 06:00 server time — picks up contracts whose next period
 * starts today or earlier and posts their folio/invoice.
 *
 * Invocation: not yet wired. This is a STUB intended to be called by
 * whatever scheduler the project adopts (Vercel Cron, node-cron, BullMQ).
 * A future T22/T23 will add the actual scheduler registration.
 */
import { prisma } from '@/lib/prisma';
import { runBulkRenewal } from '@/services/renewal.service';

export async function runDailyRenewalJob(asOfDate: Date = new Date()) {
  const userRef = 'system:cron';
  const result = await runBulkRenewal(prisma, {
    asOfDate,
    dryRun: false,
    userRef,
  });
  // Also log a single summary activity log entry for operator visibility.
  // Keeps the timeline cleaner than per-contract entries (those already log).
  if (result.processed > 0) {
    // TODO (T22): call logActivity(prisma, {...}) once a system-scoped context exists
    console.info('[cron.renewal]', {
      processed: result.processed,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
    });
  }
  return result;
}

// Allow direct invocation: `npx tsx src/jobs/renewal-daily.ts`
if (require.main === module) {
  runDailyRenewalJob().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.failed.length > 0 ? 1 : 0);
  }).catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
