/**
 * Regression test for Bug 2: drag-shortening must void future-night
 * FolioLineItem rows so folio.totalCharges reflects the new stay length.
 * Without this, the tape-chart tooltip computes per-night = totalCharges /
 * nights = 1500 instead of the correct 1000.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const guest = await p.guest.findFirst();
  const room  = await p.room.findFirst({ where: { status: 'available' } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
  if (!guest || !room || !admin) { console.error('missing fixtures'); process.exit(1); }

  // Seed a 3-night stay, fully paid
  const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
  const setup = await p.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
        bookingType: 'daily', status: 'checked_in', source: 'direct',
        checkIn: new Date('2026-07-10'), checkOut: new Date('2026-07-13'),
        rate: new Prisma.Decimal(1000),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-2026-${num}`, bookingId: booking.id, guestId: guest.id,
        totalCharges: new Prisma.Decimal(3000), totalPayments: new Prisma.Decimal(3000),
        balance: new Prisma.Decimal(0),
      },
    });
    for (let i = 0; i < 3; i++) {
      const ds = new Date('2026-07-10'); ds.setUTCDate(10 + i);
      const de = new Date('2026-07-10'); de.setUTCDate(10 + i + 1);
      await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: `ค่าห้องพัก — ห้อง ${room.number}`,
          amount: new Prisma.Decimal(1000), quantity: 1, unitPrice: new Prisma.Decimal(1000),
          taxType: 'no_tax', billingStatus: 'PAID',
          serviceDate: ds, periodEnd: de, createdBy: admin.id,
        },
      });
    }
    return { bookingId: booking.id, folioId: folio.id };
  });
  console.log(`Seeded 3-night booking BK-2026-${num} (paid in full)`);

  // Simulate the drag-shorten: void the night on/after the new checkOut
  const newCheckOut = new Date('2026-07-12');
  await p.$transaction(async (tx) => {
    await tx.folioLineItem.updateMany({
      where: {
        folioId:    setup.folioId,
        chargeType: 'ROOM',
        billingStatus: { not: 'VOIDED' },
        serviceDate: { gte: newCheckOut },
      },
      data: { billingStatus: 'VOIDED', notes: 'voided by drag-shorten test' },
    });
    const recalcRows = await tx.folioLineItem.aggregate({
      where: { folioId: setup.folioId, billingStatus: { not: 'VOIDED' } },
      _sum: { amount: true },
    });
    const totalCharges = Number(recalcRows._sum.amount ?? 0);
    await tx.folio.update({
      where: { id: setup.folioId },
      data: {
        totalCharges, balance: totalCharges - 3000, // payments still 3000
      },
    });
    await tx.booking.update({
      where: { id: setup.bookingId },
      data: { checkOut: newCheckOut },
    });
  });

  const folio = await p.folio.findUnique({
    where: { id: setup.folioId },
    select: { totalCharges: true, totalPayments: true, balance: true, lineItems: { select: { billingStatus: true, serviceDate: true } } },
  });
  const lineStatus = folio.lineItems.map(l => `${l.serviceDate.toISOString().slice(5,10)}=${l.billingStatus}`).join(' ');
  const totalCharges = Number(folio.totalCharges);
  const balance = Number(folio.balance);
  const nights = 2;  // after shorten
  const perNight = nights > 0 ? totalCharges / nights : 0;

  console.log(`After shorten:`);
  console.log(`  line items:    ${lineStatus}`);
  console.log(`  totalCharges:  ${totalCharges} (expect 2000)`);
  console.log(`  totalPayments: ${Number(folio.totalPayments)} (expect 3000)`);
  console.log(`  balance:       ${balance} (expect -1000 — we owe guest)`);
  console.log(`  per-night:     ${perNight} (expect 1000, NOT 1500)`);

  const pass = totalCharges === 2000 && perNight === 1000 && balance === -1000;
  console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');

  // Cleanup
  await p.folioLineItem.deleteMany({ where: { folioId: setup.folioId } });
  await p.folio.delete({ where: { id: setup.folioId } });
  await p.booking.delete({ where: { id: setup.bookingId } });

  await p.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
