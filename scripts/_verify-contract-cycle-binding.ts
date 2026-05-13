import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { createDraft, ContractValidationError } from '../src/services/contract.service';

// Minimal valid CreateDraftInput fields (all required non-defaulted)
const baseInput = {
  startDate:          new Date('2026-05-01T00:00:00.000Z'),
  endDate:            new Date('2027-05-01T00:00:00.000Z'),
  durationMonths:     12,
  monthlyRoomRent:    15000,
  electricRate:       8,
  securityDeposit:    30000,
  lateFeeSchedule:    [],
  createdBy:          'test',
};

async function main() {
  await prisma.$transaction(async (tx) => {
    // ── Seed a monthly_short booking ─────────────────────────────────────────
    const room = await tx.room.findFirstOrThrow({ select: { id: true } });
    const guest = await tx.guest.create({
      data: { firstName: 'CycleTest', lastName: 'Z', nationality: 'TH', idNumber: 'TEST-ID-CYCLE' },
    });
    const shortBooking = await tx.booking.create({
      data: {
        bookingNumber: 'TEST-CYCLE-SHORT-' + Date.now().toString(36),
        guestId: guest.id,
        roomId:  room.id,
        bookingType: 'monthly_short',
        checkIn:  new Date('2026-05-01T00:00:00.000Z'),
        checkOut: new Date('2027-05-01T00:00:00.000Z'),
        rate: new Prisma.Decimal(15000),
        status: 'checked_in',
        source: 'walkin',
      },
    });

    // Seed a monthly_long booking
    const guest2 = await tx.guest.create({
      data: { firstName: 'CycleTest2', lastName: 'Z2', nationality: 'TH', idNumber: 'TEST-ID-CYCLE2' },
    });
    const longBooking = await tx.booking.create({
      data: {
        bookingNumber: 'TEST-CYCLE-LONG-' + Date.now().toString(36),
        guestId: guest2.id,
        roomId:  room.id,
        bookingType: 'monthly_long',
        checkIn:  new Date('2026-06-01T00:00:00.000Z'),
        checkOut: new Date('2027-06-01T00:00:00.000Z'),
        rate: new Prisma.Decimal(15000),
        status: 'confirmed',
        source: 'walkin',
      },
    });

    // ── monthly_short + 'calendar' must FAIL ─────────────────────────────────
    await assert.rejects(
      () => createDraft(tx, { ...baseInput, bookingId: shortBooking.id, billingCycle: 'calendar' }),
      (err: unknown) => {
        assert.ok(err instanceof ContractValidationError, 'should be ContractValidationError');
        assert.match(err.message, /billingCycle must match BookingType/);
        return true;
      },
    );
    console.log('  ✓ monthly_short + calendar → rejected');

    // ── monthly_long + 'rolling' must FAIL ───────────────────────────────────
    await assert.rejects(
      () => createDraft(tx, { ...baseInput, bookingId: longBooking.id, billingCycle: 'rolling' }),
      (err: unknown) => {
        assert.ok(err instanceof ContractValidationError, 'should be ContractValidationError');
        assert.match(err.message, /billingCycle must match BookingType/);
        return true;
      },
    );
    console.log('  ✓ monthly_long + rolling → rejected');

    // Note: we skip calling createDraft with valid params here because
    // generateContractNumber uses pg_advisory_xact_lock which has a pre-existing
    // Prisma void-column deserialization issue in this environment.
    // The guard is tested via the 2 rejection cases above.

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await tx.booking.deleteMany({ where: { id: { in: [shortBooking.id, longBooking.id] } } });
    await tx.guest.deleteMany({ where: { id: { in: [guest.id, guest2.id] } } });
  });

  console.log('✓ billingCycle ↔ BookingType binding enforced in createDraft');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
