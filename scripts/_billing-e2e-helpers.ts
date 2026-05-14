/**
 * _billing-e2e-helpers.ts
 *
 * Shared seed / cleanup helpers for Phase 4 E2E harnesses.
 * Import from individual e2e-*.ts scripts.
 *
 * Pattern: seed inside a prisma.$transaction so any assertion failure
 * rolls back automatically. Cleanup is explicit (deleteMany in FK order)
 * at the end of each test.
 */

import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// ─── Assertion helpers ────────────────────────────────────────────────────────

export const failures: string[] = [];

export function ok(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`    ✓ ${msg}`);
  } else {
    console.error(`    ✗ ${msg}`);
    failures.push(msg);
  }
}

/** Hard-assert: throw if false (stops the test immediately). */
export function mustBe(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`    ✓ ${msg}`);
}

// ─── Fixture types ────────────────────────────────────────────────────────────

export interface SeededBooking {
  bookingId:  string;
  guestId:    string;
  folioId:    string;
  roomId:     string;
  roomNumber: string;
}

// ─── Seed a monthly booking ───────────────────────────────────────────────────

export async function seedMonthlyBooking(opts: {
  tag:            string;
  bookingType:    'monthly_short' | 'monthly_long';
  checkIn:        Date;
  checkOut:       Date;
  rate:           number;
  excludeRoomIds?: string[];
}): Promise<SeededBooking> {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findFirstOrThrow({
      where:  opts.excludeRoomIds?.length ? { id: { notIn: opts.excludeRoomIds } } : undefined,
      select: { id: true, number: true },
    });
    const guest = await tx.guest.create({
      data: {
        firstName:   `E2E-${opts.tag}`,
        lastName:    'Billing',
        nationality: 'TH',
        idNumber:    `TEST-${opts.tag}-${Date.now()}`,
      },
    });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${opts.tag}`,
        guestId:       guest.id,
        roomId:        room.id,
        bookingType:   opts.bookingType,
        checkIn:       opts.checkIn,
        checkOut:      opts.checkOut,
        rate:          new Prisma.Decimal(opts.rate),
        status:        'checked_in',
        source:        'walkin',
      },
    });
    const folio = await tx.folio.create({
      data: {
        bookingId:   booking.id,
        folioNumber: `FLO-${opts.tag}`,
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
}

// ─── Cleanup a fixture (FK-safe order) ───────────────────────────────────────

export async function cleanupBookingFixture(f: SeededBooking): Promise<void> {
  // Gather all invoices for this booking
  const allInvoices = await prisma.invoice.findMany({
    where:  { bookingId: f.bookingId },
    select: { id: true },
  });
  const allInvoiceIds = allInvoices.map((i) => i.id);

  if (allInvoiceIds.length) {
    await prisma.ledgerEntry.deleteMany({
      where: { referenceType: 'Invoice', referenceId: { in: allInvoiceIds } },
    });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: allInvoiceIds } } });
    await prisma.billingPeriod.deleteMany({ where: { invoiceId: { in: allInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: allInvoiceIds } } });
  }
  // Remaining billing periods (invoiceId=null from rejected drafts)
  await prisma.billingPeriod.deleteMany({ where: { bookingId: f.bookingId } });
  // Utility readings
  await prisma.utilityReading.deleteMany({ where: { bookingId: f.bookingId } });
  await prisma.utilityReading.deleteMany({ where: { roomId: f.roomId, recordedBy: { startsWith: 'e2e-' } } });
  // Folio items and folio
  await prisma.folioLineItem.deleteMany({ where: { folioId: f.folioId } });
  await prisma.folio.deleteMany({ where: { id: f.folioId } });
  await prisma.booking.deleteMany({ where: { id: f.bookingId } });
  await prisma.guest.deleteMany({ where: { id: f.guestId } });
}

// ─── Finish helper: prints summary and exits ──────────────────────────────────

export function finalize(scriptName: string): void {
  if (failures.length) {
    console.error(`\n❌  ${failures.length} assertion(s) failed in ${scriptName}:`);
    failures.forEach((f) => console.error(`    • ${f}`));
    process.exit(1);
  }
  console.log(`\n✅  All assertions passed — ${scriptName}\n`);
}
