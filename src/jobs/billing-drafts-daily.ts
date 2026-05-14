/**
 * src/jobs/billing-drafts-daily.ts
 *
 * Daily cron job: walk every active monthly booking and generate the next-due
 * draft invoice via generateDraftInvoice().
 *
 * Invocation shapes:
 *   1. Via HTTP: POST /api/cron/billing-draft (bearer-token gated)
 *   2. Via CLI:  npx tsx scripts/cron/generate-monthly-drafts.ts
 *
 * TODO: wire into render.yaml / railway.toml schedule (02:00 daily, UTC+7):
 *   # render.yaml example
 *   crons:
 *     - type: cron
 *       name: billing-draft-generation
 *       command: curl -X POST $RENDER_EXTERNAL_URL/api/cron/billing-draft \
 *                    -H "Authorization: Bearer $CRON_SECRET"
 *       schedule: "0 19 * * *"   # 02:00 ICT = 19:00 UTC
 *
 * Logic:
 *  1. Find all bookings with bookingType IN (monthly_short, monthly_long)
 *     and status IN (checked_in, confirmed).
 *  2. For each booking, find the maximum cycleIndex already in BillingPeriod.
 *     Next cycleIndex = max + 1 (or 1 if none yet).
 *  3. Skip bookings whose active Contract.status = 'terminated'.
 *  4. Skip if the next period hasn't started yet (periodStart > today).
 *  5. Call generateDraftInvoice() inside a per-booking $transaction with
 *     SELECT booking FOR UPDATE to prevent concurrent cron double-fire.
 *  6. On error: log to ActivityLog(severity='error') and continue.
 *  7. Returns { processed, generated, skipped, errors }.
 */

import { prisma } from '@/lib/prisma';
import { generateDraftInvoice, resolveNextPeriod } from '@/services/billing.service';

export interface DraftJobResult {
  bookingId:     string;
  bookingNumber: string;
  outcome:       'generated' | 'skipped' | 'error';
  cycleIndex?:   number;
  invoiceId?:    string;
  reason?:       string;
}

export interface DraftJobSummary {
  processed: number;
  generated: DraftJobResult[];
  skipped:   DraftJobResult[];
  errors:    DraftJobResult[];
}

export async function runBillingDraftsDaily(
  asOf: Date = new Date(),
  options: { dryRun?: boolean } = {},
): Promise<DraftJobSummary> {
  const { dryRun = false } = options;
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const generated: DraftJobResult[] = [];
  const skipped:   DraftJobResult[] = [];
  const errors:    DraftJobResult[] = [];

  // Load all eligible active monthly bookings
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
      // Contract is 1:1
      contract: { select: { status: true } },
      billingPeriods: {
        orderBy: { cycleIndex: 'desc' },
        take: 1,
        select: { cycleIndex: true },
      },
    },
  });

  for (const booking of bookings) {
    const base: Omit<DraftJobResult, 'outcome'> = {
      bookingId:     booking.id,
      bookingNumber: booking.bookingNumber,
    };

    // Skip bookings with a terminated contract
    if (booking.contract?.status === 'terminated') {
      skipped.push({ ...base, outcome: 'skipped', reason: 'contract_terminated' });
      continue;
    }

    // Determine next cycleIndex
    const maxCycleIndex  = booking.billingPeriods[0]?.cycleIndex ?? 0;
    const nextCycleIndex = maxCycleIndex + 1;

    // Compute the period so we can gate on periodStart <= today
    let period: ReturnType<typeof resolveNextPeriod>;
    try {
      period = resolveNextPeriod({
        bookingType: booking.bookingType as 'monthly_short' | 'monthly_long',
        checkIn:  booking.checkIn,
        checkOut: booking.checkOut,
        cycleIndex: nextCycleIndex,
      });
    } catch (err) {
      errors.push({ ...base, outcome: 'error', reason: String(err) });
      continue;
    }

    // Skip if the next period hasn't started yet
    if (period.start > today) {
      skipped.push({
        ...base,
        outcome:    'skipped',
        cycleIndex: nextCycleIndex,
        reason:     `period_not_started (starts ${period.start.toISOString().slice(0, 10)})`,
      });
      continue;
    }

    if (dryRun) {
      generated.push({
        ...base,
        outcome:    'generated',
        cycleIndex: nextCycleIndex,
        reason:     'dry-run (not written)',
      });
      continue;
    }

    // Generate the draft inside a per-booking transaction
    try {
      const draft = await prisma.$transaction((tx) =>
        generateDraftInvoice(tx, {
          bookingId:  booking.id,
          cycleIndex: nextCycleIndex,
          createdBy:  'system:cron',
        }),
      );
      generated.push({
        ...base,
        outcome:    'generated',
        cycleIndex: nextCycleIndex,
        invoiceId:  draft.invoiceId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ ...base, outcome: 'error', cycleIndex: nextCycleIndex, reason: msg });

      // Log to ActivityLog for operator visibility
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
      } catch (logErr) {
        // ActivityLog failure is non-fatal
        console.error('[cron.billing-draft] ActivityLog write failed:', logErr);
      }
    }
  }

  return { processed: bookings.length, generated, skipped, errors };
}
