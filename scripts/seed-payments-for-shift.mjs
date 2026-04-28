/**
 * Create one fully-paid booking + payment so the cashier shift's Recent
 * Payments table has at least one row to look at.  Uses the admin user's
 * open shift (run setup-shift-fixture.mjs first).
 */

import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
const guest = await p.guest.findFirst();
const room  = await p.room.findFirst({ where: { status: 'available' } });
const session = await p.cashSession.findFirst({ where: { openedBy: admin.id, status: 'OPEN' } });
const cashAccount = await p.financialAccount.findFirst({ where: { code: '1110-01' } });

// Minimal: create a booking + folio + invoice + payment (cash)
const result = await p.$transaction(async (tx) => {
  const bookingNumber = `BK-2026-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
  const booking = await tx.booking.create({
    data: {
      bookingNumber, guestId: guest.id, roomId: room.id,
      bookingType: 'daily', status: 'confirmed', source: 'direct',
      checkIn: new Date('2026-05-10'), checkOut: new Date('2026-05-11'),
      rate: new Prisma.Decimal(1500),
    },
  });

  const folioNumber = `FLO-2026-TEST-${booking.id.slice(0, 4)}`;
  const folio = await tx.folio.create({
    data: { folioNumber, bookingId: booking.id, guestId: guest.id, totalCharges: 0, totalPayments: 0, balance: 0 },
  });
  const item = await tx.folioLineItem.create({
    data: {
      folioId: folio.id, chargeType: 'ROOM',
      description: `ค่าห้องพัก — ห้อง ${room.number}`, amount: new Prisma.Decimal(1500),
      quantity: 1, unitPrice: new Prisma.Decimal(1500), taxType: 'no_tax',
      billingStatus: 'BILLED', serviceDate: new Date('2026-05-10'),
      periodEnd: new Date('2026-05-11'), createdBy: admin.id,
    },
  });

  const invoiceNumber = `INV-CI-2026-TEST-${booking.id.slice(0, 4)}`;
  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber, bookingId: booking.id, guestId: guest.id, folioId: folio.id,
      issueDate: new Date(), dueDate: new Date('2026-05-11'), invoiceType: 'daily_stay',
      subtotal: new Prisma.Decimal(1500), grandTotal: new Prisma.Decimal(1500), paidAmount: new Prisma.Decimal(1500),
      status: 'paid',
      items: {
        create: [{ description: item.description, amount: new Prisma.Decimal(1500), folioLineItemId: item.id, taxType: 'no_tax' }],
      },
    },
  });

  const num = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  const payment = await tx.payment.create({
    data: {
      paymentNumber:  `PAY-2026-${num}`,
      receiptNumber:  `RCP-2026-${num}`,
      bookingId:      booking.id,
      guestId:        guest.id,
      amount:         new Prisma.Decimal(1500),
      paymentMethod:  'cash',
      paymentDate:    new Date(),
      cashSessionId:  session.id,
      cashBoxId:      session.cashBoxId,
      financialAccountId: cashAccount.id,
      status:         'ACTIVE',
      reconStatus:    'CLEARED',
      idempotencyKey: `test-${booking.id}`,
      receivedBy:     admin.id,
      createdBy:      admin.id,
      allocations: { create: [{ invoiceId: invoice.id, amount: new Prisma.Decimal(1500) }] },
    },
  });

  return { bookingNumber, paymentNumber: payment.paymentNumber, receiptNumber: payment.receiptNumber };
});

console.log('Created:', result);
await p.$disconnect();
