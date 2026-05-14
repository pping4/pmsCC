/**
 * e2e-reading-missing.ts
 *
 * Task 4.3 — Missing reading gate.
 *
 * 1. Seed monthly_short booking.
 * 2. Cycle 1 draft → needsReading=false (cycle 1 has no utility).
 * 3. Approve cycle 1 → success.
 * 4. Cycle 2 draft WITHOUT recording a reading → needsReading=true.
 * 5. Call bulk-approve API-level check with cycle 2 invoice → assert
 *    it appears in `skipped` with reason 'NEEDS_READING'.
 * 6. Service-level approveDraft still succeeds (gate is API-only);
 *    grandTotal = rent only (no utility).
 * 7. Record a reading, generate cycle 3 → utility flows.
 *
 * All dates in the past relative to today 2026-05-14.
 *
 * npx tsx scripts/e2e-reading-missing.ts
 */

import {
  prisma,
  ok,
  seedMonthlyBooking,
  cleanupBookingFixture,
  finalize,
} from './_billing-e2e-helpers';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';
import { recordReading } from '../src/services/utility.service';

async function checkNeedsReadingForInvoice(invoiceId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      billingPeriod: { select: { cycleIndex: true } },
      items: { select: { folioLineItem: { select: { chargeType: true } } } },
    },
  });
  if (!inv) return false;
  const cycleIndex = inv.billingPeriod?.cycleIndex ?? 1;
  if (cycleIndex < 2) return false;
  const hasUtility = inv.items.some(
    (i) =>
      i.folioLineItem?.chargeType === 'UTILITY_WATER' ||
      i.folioLineItem?.chargeType === 'UTILITY_ELECTRIC',
  );
  return !hasUtility;
}

async function main() {
  console.log('\n🧪  e2e-reading-missing — bulk approve gated on reading present\n');

  const tag = `missing-${Date.now().toString(36).slice(-6)}`;
  const fix = await seedMonthlyBooking({
    tag,
    bookingType: 'monthly_short',
    checkIn:     new Date('2026-01-10T00:00:00.000Z'),
    checkOut:    new Date('2026-04-10T00:00:00.000Z'),
    rate:        15000,
  });

  try {
    // ── Step 2: Cycle 1 draft — no utility ───────────────────────────────────
    console.log('Step 2 — Cycle 1 draft (needsReading=false)');
    const draft1 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 1, createdBy: 'e2e-missing' }),
    );
    ok(draft1.needsReading === false, 'cycle 1: needsReading=false');
    ok(draft1.status === 'draft',     'cycle 1: status=draft');

    const needsC1 = await checkNeedsReadingForInvoice(draft1.invoiceId);
    ok(needsC1 === false, 'cycle 1 API check: needsReading=false');

    // ── Step 3: Approve cycle 1 ───────────────────────────────────────────────
    console.log('Step 3 — Approve cycle 1');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'e2e-missing' }),
    );
    const inv1 = await prisma.invoice.findUniqueOrThrow({
      where:  { id: draft1.invoiceId },
      select: { status: true },
    });
    ok(inv1.status === 'unpaid', 'cycle 1 approved: status=unpaid');

    // ── Step 4: Cycle 2 WITHOUT reading → needsReading=true ──────────────────
    console.log('Step 4 — Cycle 2 draft WITHOUT reading (needsReading=true)');
    const draft2 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 2, createdBy: 'e2e-missing' }),
    );
    ok(draft2.status === 'draft',     'cycle 2: status=draft');
    ok(draft2.needsReading === true,  'cycle 2: needsReading=true (no reading)');
    ok(Number(draft2.grandTotal) === 15000,
      `cycle 2: grandTotal=15000 (rent only, got ${draft2.grandTotal})`);

    // ── Step 5: API-level bulk-approve gate ───────────────────────────────────
    console.log('Step 5 — Bulk-approve API gate: cycle 2 must be in skipped');
    const needsC2 = await checkNeedsReadingForInvoice(draft2.invoiceId);
    ok(needsC2 === true, 'cycle 2 API check: needsReading=true');

    const approved: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    if (needsC2) {
      skipped.push({ id: draft2.invoiceId, reason: 'NEEDS_READING' });
    } else {
      approved.push(draft2.invoiceId);
    }
    ok(approved.length === 0,                        'bulk-approve: 0 approved');
    ok(skipped.length === 1,                         'bulk-approve: 1 skipped');
    ok(skipped[0].id === draft2.invoiceId,           'skipped[0].id = cycle 2 invoice');
    ok(skipped[0].reason === 'NEEDS_READING',        'skipped[0].reason = NEEDS_READING');

    // ── Step 5b: Service-level approve works without reading ──────────────────
    console.log('Step 5b — Service-level approveDraft: succeeds without reading');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft2.invoiceId, approvedBy: 'e2e-missing' }),
    );
    const inv2 = await prisma.invoice.findUniqueOrThrow({
      where:  { id: draft2.invoiceId },
      select: { status: true, grandTotal: true },
    });
    ok(inv2.status === 'unpaid',          'cycle 2 service-approved: status=unpaid');
    ok(Number(inv2.grandTotal) === 15000, 'cycle 2 service-approved: grandTotal=15000 (rent only)');

    // ── Step 6: Record reading @ 2026-02-09 ──────────────────────────────────
    console.log('Step 6 — Record reading @ 2026-02-09 (end of cycle 1)');
    const readingDate = new Date('2026-02-09T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: readingDate } });
    const reading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: readingDate,
        currWater:   120,
        currElectric: 2400,
        recordedBy:  'e2e-missing',
      }),
    );
    ok(!!reading.id,                       'reading recorded');
    ok(Number(reading.currWater) === 120,  'currWater=120');

    // ── Step 7: Record 2nd reading + generate cycle 3 with utility ───────────
    console.log('Record reading @ 2026-03-09 (for cycle 3 utility)');
    const readingDate2 = new Date('2026-03-09T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: readingDate2 } });
    await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: readingDate2,
        currWater:   160,    // usage from baseline(120) = 40
        currElectric: 2800,  // usage from baseline(2400) = 400
        recordedBy:  'e2e-missing',
      }),
    );

    console.log('Step 7 — Cycle 3 draft (utility flows from readings)');
    const draft3 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 3, createdBy: 'e2e-missing' }),
    );
    ok(draft3.status === 'draft',     'cycle 3: status=draft');
    ok(draft3.needsReading === false, 'cycle 3: needsReading=false (reading @ 09 มี.ค. found)');
    ok(Number(draft3.grandTotal) > 15000,
      `cycle 3: grandTotal=${draft3.grandTotal} > 15000 (includes utility)`);

    const needsC3 = await checkNeedsReadingForInvoice(draft3.invoiceId);
    ok(needsC3 === false, 'cycle 3 API check: needsReading=false');

    // Verify utility line items exist in cycle 3
    const cycle3Items = await prisma.invoiceItem.findMany({
      where:  { invoiceId: draft3.invoiceId },
      select: { folioLineItem: { select: { chargeType: true, amount: true } } },
    });
    const hasWater = cycle3Items.some(i => i.folioLineItem?.chargeType === 'UTILITY_WATER');
    const hasElec  = cycle3Items.some(i => i.folioLineItem?.chargeType === 'UTILITY_ELECTRIC');
    ok(hasWater || hasElec, 'cycle 3: has UTILITY line items (utility flows from reading)');

  } finally {
    console.log('\n🧹  Cleanup …');
    await cleanupBookingFixture(fix);
    console.log('    done');
  }

  finalize('e2e-reading-missing');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
