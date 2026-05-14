/**
 * e2e-bulk-approve.ts
 *
 * Task 4.4 — Bulk approve partial success path.
 *
 * Seed 3 monthly bookings:
 *   A: monthly_short, reading recorded → ready
 *   B: monthly_long,  reading recorded → ready
 *   C: monthly_short, NO reading for cycle 2 → skipped (NEEDS_READING)
 *
 * Generate cycle 2 drafts for all 3.
 * Simulate bulk POST /api/billing/drafts/approve with all 3 invoiceIds.
 * Assert: { approved: [A, B], skipped: [{ id: C, reason: 'NEEDS_READING' }] }
 * Verify folio.totalCharges advanced for A and B, NOT for C.
 *
 * All dates in the past relative to today 2026-05-14.
 *
 * npx tsx scripts/e2e-bulk-approve.ts
 */

import {
  prisma,
  ok,
  seedMonthlyBooking,
  cleanupBookingFixture,
  finalize,
  SeededBooking,
} from './_billing-e2e-helpers';
import { generateDraftInvoice, approveDraft, BillingStateError } from '../src/services/billing.service';
import { recordReading } from '../src/services/utility.service';

// ─── checkNeedsReading — same logic as the approve route ─────────────────────

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

// ─── Simulate the bulk-approve route logic ────────────────────────────────────

async function simulateBulkApprove(
  invoiceIds: string[],
  approvedBy: string,
): Promise<{ approved: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const approved: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const invoiceId of invoiceIds) {
    try {
      const needsReading = await checkNeedsReadingForInvoice(invoiceId);
      if (needsReading) {
        skipped.push({ id: invoiceId, reason: 'NEEDS_READING' });
        continue;
      }
      await prisma.$transaction((tx) => approveDraft(tx, { invoiceId, approvedBy }));
      approved.push(invoiceId);
    } catch (err) {
      if (err instanceof BillingStateError) {
        skipped.push({ id: invoiceId, reason: err.code });
      } else {
        console.error(`Unexpected error for ${invoiceId}:`, err);
        skipped.push({ id: invoiceId, reason: 'UNEXPECTED_ERROR' });
      }
    }
  }

  return { approved, skipped };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪  e2e-bulk-approve — 3 drafts: 2 approved, 1 skipped (NEEDS_READING)\n');

  const ts = Date.now().toString(36).slice(-6);

  let fixA!: SeededBooking;
  let fixB!: SeededBooking;
  let fixC!: SeededBooking;
  let seededA = false;
  let seededB = false;
  let seededC = false;

  try {
    // ── Seed 3 bookings (all past dates) ─────────────────────────────────────
    console.log('Seed 3 bookings (A=rolling, B=calendar, C=rolling-no-reading)');

    fixA = await seedMonthlyBooking({
      tag:         `ba-${ts}`,
      bookingType: 'monthly_short',
      checkIn:     new Date('2026-01-01T00:00:00.000Z'),
      checkOut:    new Date('2026-04-01T00:00:00.000Z'),
      rate:        10000,
    });
    seededA = true;

    // Use different rooms so utility readings don't bleed between bookings.
    // Utility lookup is room-scoped; sharing a room would make booking C
    // "find" booking A's reading and incorrectly set needsReading=false.
    fixB = await seedMonthlyBooking({
      tag:            `bb-${ts}`,
      bookingType:    'monthly_long',
      checkIn:        new Date('2026-01-01T00:00:00.000Z'),
      checkOut:       new Date('2026-04-25T00:00:00.000Z'),
      rate:           12000,
      excludeRoomIds: [fixA.roomId],
    });
    seededB = true;

    fixC = await seedMonthlyBooking({
      tag:            `bc-${ts}`,
      bookingType:    'monthly_short',
      checkIn:        new Date('2026-01-01T00:00:00.000Z'),
      checkOut:       new Date('2026-04-01T00:00:00.000Z'),
      rate:           9000,
      excludeRoomIds: [fixA.roomId, fixB.roomId],
    });
    seededC = true;

    ok(!!fixA.bookingId, 'Booking A seeded');
    ok(!!fixB.bookingId, 'Booking B seeded');
    ok(!!fixC.bookingId, 'Booking C seeded');

    // ── Generate cycle 1 drafts and approve ──────────────────────────────────
    console.log('\nGenerate + approve cycle 1 for all 3 bookings');
    for (const [label, fix] of [['A', fixA], ['B', fixB], ['C', fixC]] as [string, SeededBooking][]) {
      const d1 = await prisma.$transaction((tx) =>
        generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 1, createdBy: 'e2e-bulk' }),
      );
      await prisma.$transaction((tx) =>
        approveDraft(tx, { invoiceId: d1.invoiceId, approvedBy: 'e2e-bulk' }),
      );
      ok(true, `Booking ${label}: cycle 1 approved`);
    }

    // ── Record readings for A and B (not C) ──────────────────────────────────
    console.log('\nRecord readings for A and B');
    // Bookings A & B: checkIn=Jan01, cycle1=Jan01–Jan31; cycle2 starts Feb01
    // Record reading at end of January (past date)
    const readDate = new Date('2026-01-31T00:00:00.000Z');

    await prisma.utilityReading.deleteMany({ where: { roomId: fixA.roomId, readingDate: readDate } });
    await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fixA.roomId,
        bookingId:   fixA.bookingId,
        readingDate: readDate,
        currWater:   50,
        currElectric: 1000,
        recordedBy:  'e2e-bulk',
      }),
    );
    ok(true, 'Booking A: reading @ 2026-01-31 recorded');

    await prisma.utilityReading.deleteMany({ where: { roomId: fixB.roomId, readingDate: readDate } });
    await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fixB.roomId,
        bookingId:   fixB.bookingId,
        readingDate: readDate,
        currWater:   70,
        currElectric: 1400,
        recordedBy:  'e2e-bulk',
      }),
    );
    ok(true, 'Booking B: reading @ 2026-01-31 recorded');

    // Booking C: NO reading recorded

    // ── Generate cycle 2 drafts ───────────────────────────────────────────────
    console.log('\nGenerate cycle 2 drafts for A, B, C');
    const draft2A = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fixA.bookingId, cycleIndex: 2, createdBy: 'e2e-bulk' }),
    );
    ok(draft2A.needsReading === false, 'Booking A cycle 2: needsReading=false');

    const draft2B = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fixB.bookingId, cycleIndex: 2, createdBy: 'e2e-bulk' }),
    );
    ok(draft2B.needsReading === false, 'Booking B cycle 2: needsReading=false');

    const draft2C = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fixC.bookingId, cycleIndex: 2, createdBy: 'e2e-bulk' }),
    );
    ok(draft2C.needsReading === true, 'Booking C cycle 2: needsReading=true (no reading)');

    // ── Bulk approve [A, B, C] ────────────────────────────────────────────────
    console.log('\nBulk approve [A, B, C]');
    const result = await simulateBulkApprove(
      [draft2A.invoiceId, draft2B.invoiceId, draft2C.invoiceId],
      'e2e-bulk',
    );

    ok(result.approved.length === 2,                     `approved: ${result.approved.length} (expected 2)`);
    ok(result.skipped.length === 1,                      `skipped: ${result.skipped.length} (expected 1)`);
    ok(result.approved.includes(draft2A.invoiceId),      'Booking A: in approved list');
    ok(result.approved.includes(draft2B.invoiceId),      'Booking B: in approved list');
    ok(!result.approved.includes(draft2C.invoiceId),     'Booking C: NOT in approved list');
    ok(result.skipped[0].id === draft2C.invoiceId,       'skipped[0].id = Booking C invoice');
    ok(result.skipped[0].reason === 'NEEDS_READING',     'skipped[0].reason = NEEDS_READING');

    // ── Verify folio charges ──────────────────────────────────────────────────
    console.log('\nVerify folio.totalCharges');
    const folioA = await prisma.folio.findUniqueOrThrow({ where: { id: fixA.folioId } });
    ok(Number(folioA.totalCharges) > 10000,
      `Booking A: folio.totalCharges advanced (got ${folioA.totalCharges})`);

    const folioB = await prisma.folio.findUniqueOrThrow({ where: { id: fixB.folioId } });
    ok(Number(folioB.totalCharges) > 12000,
      `Booking B: folio.totalCharges advanced (got ${folioB.totalCharges})`);

    // Booking C: cycle 2 draft NOT approved → folio at cycle 1 total only
    const invC1 = await prisma.invoice.findFirst({
      where:  { bookingId: fixC.bookingId, status: 'unpaid' as never },
      select: { grandTotal: true },
    });
    ok(!!invC1, 'Booking C: cycle 1 unpaid invoice found');
    const folioC = await prisma.folio.findUniqueOrThrow({ where: { id: fixC.folioId } });
    ok(
      Math.abs(Number(folioC.totalCharges) - Number(invC1?.grandTotal ?? 0)) < 1,
      `Booking C: folio.totalCharges=${folioC.totalCharges} = cycle1 only`,
    );

    // Cycle 2 invoice for C still draft
    const invC2 = await prisma.invoice.findUniqueOrThrow({
      where:  { id: draft2C.invoiceId },
      select: { status: true },
    });
    ok(invC2.status === 'draft', 'Booking C cycle 2: still draft after skipped');

  } finally {
    console.log('\n🧹  Cleanup …');
    if (seededA) await cleanupBookingFixture(fixA);
    if (seededB) await cleanupBookingFixture(fixB);
    if (seededC) await cleanupBookingFixture(fixC);
    console.log('    done');
  }

  finalize('e2e-bulk-approve');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
