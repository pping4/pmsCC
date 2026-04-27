import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const b = await p.booking.findFirst({
  where: { status: 'confirmed' },
  orderBy: { createdAt: 'desc' },
  include: {
    room: true,
    guest: true,
    folio: { include: { lineItems: true } },
    invoices: true,
  },
});

if (!b) {
  console.log('No confirmed booking found');
  process.exit(0);
}

console.log('Booking:', b.bookingNumber, b.status, b.bookingType);
console.log('Room:', b.room.number, 'Guest:', b.guest.firstName, b.guest.lastName);
console.log('Dates:', b.checkIn, '→', b.checkOut, 'rate:', b.rate);
console.log('Folio:', b.folio?.folioNumber, 'balance:', b.folio?.balance);
console.log('Folio items:', b.folio?.lineItems.length ?? 0);
console.log('Invoices:', b.invoices.length);
for (const inv of b.invoices) {
  console.log('  -', inv.invoiceNumber, inv.invoiceType, inv.status, '฿' + inv.grandTotal);
}

await p.$disconnect();
