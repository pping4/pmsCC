/**
 * e2e-meter-flow.ts
 *
 * Phase 6.4 — Full meter reading data-flow (init at check-in → cycle 2 utility
 * → checkout with final reading).
 *
 * Scenario: monthly_short booking, 2.5 months.
 *   check-in:     2026-01-10  init reading: water=100, electric=2000
 *   cycle-1 end:  2026-02-09  reading:      water=200, electric=4000
 *   check-out:    2026-02-20  final reading: water=230, electric=4600
 *
 * Cycle 1 (2026-01-10 → 2026-02-09): rent only (no utility, first cycle)
 * Cycle 2 (2026-02-10 → 2026-02-20): rent (pro-rated for partial) + utility from cycle-1 end reading
 *
 * Utility cycle 2:
 *   waterUsage    = 200 - 100 = 100 units × 18 = 1800
 *   electricUsage = 4000 - 2000 = 2000 units × 8 = 16000
 *
 * Checkout with final reading → assert final UtilityReading row exists in DB.
 *
 * npx tsx scripts/e2e-meter-flow.ts
 */

import {
  prisma,
  ok,
  cleanupBookingFixture,
  finalize,
} from './_billing-e2e-helpers';
import { Prisma } from '@prisma/client';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';
import { recordReading } from '../src/services/utility.service';

const CHECK_IN  = new Date('2026-01-10T00:00:00.000Z');
const CHECK_OUT = new Date('2026-02-20T00:00:00.000Z');
const RATE      = 15000;

// Meter readings
const INIT_WATER      = 100;
const INIT_ELECTRIC   = 2000;
const CYCLE_END_WATER = 200;
const CYCLE_END_ELEC  = 4000;
const FINAL_WATER     = 230;
const FINAL_ELECTRIC  = 4600;

// Cycle 2 utility — billing.service computes (post Phase 6 baseline fix):
//   curr = latest reading before cycle-2 start (2026-02-10) → cycle-end reading at 2026-02-09
//   waterUsage    = curr.currWater    - curr.prevWater
//   electricUsage = curr.currElectric - curr.prevElectric
//
// curr.prevWater/prevElectric were auto-snapshotted from the init reading
// when the cycle-end reading was recorded. So:
//   waterUsage    = 200  - 100  = 100  → 100  × 18 = 1800
//   electricUsage = 4000 - 2000 = 2000 → 2000 × 8  = 16000
const WATER_RATE      = 18;
const ELECTRIC_RATE   = 8;
const WATER_USAGE_2   = CYCLE_END_WATER - INIT_WATER;       // 100
const ELEC_USAGE_2    = CYCLE_END_ELEC  - INIT_ELECTRIC;    // 2000
const WATER_CHARGE_2  = WATER_USAGE_2 * WATER_RATE;         // 1800
const ELEC_CHARGE_2   = ELEC_USAGE_2  * ELECTRIC_RATE;      // 16000

// Cycle 2 is partial: 2026-02-10 → 2026-02-19 (checkOut-1)
// February 2026 = 28 days. Cycle runs 10 ก.พ. → 09 มี.ค. but checkOut = 20 ก.พ. → partial.
// daysInCycle = 10 (10 ก.พ. to 19 ก.พ. inclusive); fullCycleDays = 28 (February)
// rent = 15000 × (10/28) = 5357.14 → rounded to cents
const CYCLE2_DAYS       = 10;  // 2026-02-10 to 2026-02-19
const CYCLE2_MONTH_DAYS = 28;  // February 2026
const CYCLE2_RENT = Math.round(RATE * (CYCLE2_DAYS / CYCLE2_MONTH_DAYS) * 100) / 100;
const EXPECTED_CYCLE2 = CYCLE2_RENT + WATER_CHARGE_2 + ELEC_CHARGE_2;

async function main() {
  console.log('\n🧪  e2e-meter-flow — full meter reading flow (Phase 6.4)\n');
  console.log(`    cycle 2 pro-rated rent: ${CYCLE2_RENT} (${CYCLE2_DAYS}/${CYCLE2_MONTH_DAYS} × 15000)`);
  console.log(`    water: ${CYCLE_END_WATER} - ${INIT_WATER} (init) = ${WATER_USAGE_2} units × ${WATER_RATE} = ${WATER_CHARGE_2}`);
  console.log(`    electric: ${CYCLE_END_ELEC} - ${INIT_ELECTRIC} (init) = ${ELEC_USAGE_2} units × ${ELECTRIC_RATE} = ${ELEC_CHARGE_2}`);
  console.log(`    expected cycle 2 total: ${EXPECTED_CYCLE2}\n`);

  const tag = `mflow-${Date.now().toString(36).slice(-6)}`;

  // Seed booking
  const fix = await prisma.$transaction(async (tx) => {
    const room = await tx.room.findFirstOrThrow({ select: { id: true, number: true } });
    const guest = await tx.guest.create({
      data: {
        firstName:   `E2E-${tag}`,
        lastName:    'MeterFlow',
        nationality: 'TH',
        idNumber:    `TEST-${tag}-${Date.now()}`,
      },
    });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${tag}`,
        guestId:       guest.id,
        roomId:        room.id,
        bookingType:   'monthly_short',
        checkIn:       CHECK_IN,
        checkOut:      CHECK_OUT,
        rate:          new Prisma.Decimal(RATE),
        status:        'checked_in',
        source:        'walkin',
        actualCheckIn: CHECK_IN,
      },
    });
    const folio = await tx.folio.create({
      data: {
        bookingId:   booking.id,
        folioNumber: `FLO-${tag}`,
        guestId:     guest.id,
      },
    });
    return {
      bookingId:  booking.id,
      guestId:    guest.id,
      folioId:    folio.id,
      roomId:     room.id,
      roomNumber: room.number,
    };
  });

  try {
    // ── Step 1: Record initial reading at check-in (simulates /api/checkin) ──
    console.log('Step 1 — Initial reading at check-in (water=100, electric=2000)');
    const initReading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:       fix.roomId,
        bookingId:    fix.bookingId,
        readingDate:  new Date('2026-01-10T00:00:00.000Z'),
        currWater:    INIT_WATER,
        currElectric: INIT_ELECTRIC,
        notes:        'Initial reading at check-in (e2e-meter-flow)',
        recordedBy:   'e2e-mflow',
      }),
    );
    ok(!!initReading.id,                              'init reading: row created');
    ok(Number(initReading.currWater)    === INIT_WATER,    `init: currWater=${INIT_WATER}`);
    ok(Number(initReading.currElectric) === INIT_ELECTRIC, `init: currElectric=${INIT_ELECTRIC}`);
    ok(Number(initReading.prevWater)    === 0,  'init: prevWater=0 (no prior reading)');

    // ── Step 2: Cycle 1 draft — rent only, no utility ─────────────────────────
    console.log('\nStep 2 — Cycle 1 draft (rent only)');
    const draft1 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 1, createdBy: 'e2e-mflow' }),
    );
    ok(draft1.status === 'draft',           'cycle 1: status=draft');
    ok(draft1.needsReading === false,       'cycle 1: needsReading=false');
    ok(Number(draft1.grandTotal) === RATE,  `cycle 1: grandTotal=${RATE} (rent only)`);

    // Approve cycle 1
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'e2e-mflow' }),
    );
    ok(true, 'cycle 1: approved');

    // ── Step 3: Record cycle-end reading @ 2026-02-09 ─────────────────────────
    console.log('\nStep 3 — Cycle-end reading @ 2026-02-09 (water=200, electric=4000)');
    const cycleEndReading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:       fix.roomId,
        bookingId:    fix.bookingId,
        readingDate:  new Date('2026-02-09T00:00:00.000Z'),
        currWater:    CYCLE_END_WATER,
        currElectric: CYCLE_END_ELEC,
        recordedBy:   'e2e-mflow',
      }),
    );
    ok(!!cycleEndReading.id,                                  'cycle-end reading: row created');
    // prevWater picks up the init reading (100) — audit trail confirms init was recorded
    ok(Number(cycleEndReading.prevWater)    === INIT_WATER,   `cycle-end: prevWater=${INIT_WATER} (audit: init reading captured)`);
    ok(Number(cycleEndReading.prevElectric) === INIT_ELECTRIC, `cycle-end: prevElectric=${INIT_ELECTRIC} (audit trail)`);
    ok(Number(cycleEndReading.currWater)    === CYCLE_END_WATER, `cycle-end: currWater=${CYCLE_END_WATER}`);

    // ── Step 4: Cycle 2 draft — pro-rated rent + utility ─────────────────────
    console.log('\nStep 4 — Cycle 2 draft (pro-rated rent + utility from init baseline)');
    const draft2 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 2, createdBy: 'e2e-mflow' }),
    );
    ok(draft2.status === 'draft',          'cycle 2: status=draft');
    ok(draft2.needsReading === false,      'cycle 2: needsReading=false');
    ok(draft2.isPartial === true,          'cycle 2: isPartial=true (partial month)');
    ok(
      Number(draft2.grandTotal) === EXPECTED_CYCLE2,
      `cycle 2: grandTotal=${draft2.grandTotal} (expected ${EXPECTED_CYCLE2})`,
    );

    // Verify utility line items
    const c2Lines = await prisma.folioLineItem.findMany({
      where:  { folioId: fix.folioId, billingStatus: 'DRAFT' as never },
      select: { chargeType: true, amount: true },
    });
    const waterLine = c2Lines.find(l => l.chargeType === 'UTILITY_WATER');
    const elecLine  = c2Lines.find(l => l.chargeType === 'UTILITY_ELECTRIC');
    ok(!!waterLine,                              'cycle 2: UTILITY_WATER exists');
    ok(!!elecLine,                               'cycle 2: UTILITY_ELECTRIC exists');
    ok(
      Number(waterLine?.amount) === WATER_CHARGE_2,
      `cycle 2: water amount=${WATER_CHARGE_2} (${WATER_USAGE_2} units × ${WATER_RATE}, got ${waterLine?.amount})`,
    );
    ok(
      Number(elecLine?.amount) === ELEC_CHARGE_2,
      `cycle 2: electric amount=${ELEC_CHARGE_2} (${ELEC_USAGE_2} units × ${ELECTRIC_RATE}, got ${elecLine?.amount})`,
    );

    // Approve cycle 2
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft2.invoiceId, approvedBy: 'e2e-mflow' }),
    );
    ok(true, 'cycle 2: approved');

    // ── Step 5: Checkout with final reading (simulates /api/checkout + finalReading) ─
    console.log('\nStep 5 — Checkout with final reading (water=230, electric=4600)');

    // Update booking status to simulate checkout (the TX in /api/checkout)
    await prisma.booking.update({
      where: { id: fix.bookingId },
      data:  { status: 'checked_out', actualCheckOut: new Date('2026-02-20T00:00:00.000Z') },
    });

    // Record the final reading (simulates recordReading inside /api/checkout tx)
    const finalReading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:       fix.roomId,
        bookingId:    fix.bookingId,
        readingDate:  new Date('2026-02-20T00:00:00.000Z'),
        currWater:    FINAL_WATER,
        currElectric: FINAL_ELECTRIC,
        notes:        'Final reading at checkout (e2e-meter-flow)',
        recordedBy:   'e2e-mflow',
      }),
    );
    ok(!!finalReading.id,                               'final reading: row created');
    ok(Number(finalReading.currWater)    === FINAL_WATER,    `final: currWater=${FINAL_WATER}`);
    ok(Number(finalReading.currElectric) === FINAL_ELECTRIC, `final: currElectric=${FINAL_ELECTRIC}`);
    ok(
      Number(finalReading.prevWater) === CYCLE_END_WATER,
      `final: prevWater=${CYCLE_END_WATER} (from cycle-end reading, not 0)`,
    );

    // Verify reading is queryable from DB by bookingId
    const allReadings = await prisma.utilityReading.findMany({
      where:   { bookingId: fix.bookingId },
      orderBy: { readingDate: 'asc' },
      select:  { id: true, readingDate: true, currWater: true, currElectric: true },
    });
    ok(allReadings.length === 3, `DB: 3 readings for this booking (init + cycle-end + final), got ${allReadings.length}`);
    ok(
      allReadings[0].readingDate?.toISOString().slice(0, 10) === '2026-01-10',
      'reading[0]: init at 2026-01-10',
    );
    ok(
      allReadings[1].readingDate?.toISOString().slice(0, 10) === '2026-02-09',
      'reading[1]: cycle-end at 2026-02-09',
    );
    ok(
      allReadings[2].readingDate?.toISOString().slice(0, 10) === '2026-02-20',
      'reading[2]: final at checkout 2026-02-20',
    );

    // Bonus: verify GET /api/bookings/[id]/readings shape by querying same data
    const readingsCheck = await prisma.utilityReading.findMany({
      where:   { bookingId: fix.bookingId },
      orderBy: { readingDate: 'desc' },
      select: {
        id: true, readingDate: true,
        prevWater: true, currWater: true,
        prevElectric: true, currElectric: true,
      },
    });
    ok(readingsCheck.length === 3, 'GET /readings shape: 3 rows returned');
    ok(
      Number(readingsCheck[0].currWater) === FINAL_WATER,
      `GET /readings shape: most recent currWater=${FINAL_WATER}`,
    );
    ok(
      Number(readingsCheck[0].currElectric) === FINAL_ELECTRIC,
      `GET /readings shape: most recent currElectric=${FINAL_ELECTRIC}`,
    );

    console.log('\n✅  Phase 6.4 meter flow assertions complete');

  } finally {
    console.log('\n🧹  Cleanup …');
    await cleanupBookingFixture(fix);
    console.log('    done');
  }

  finalize('e2e-meter-flow');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
