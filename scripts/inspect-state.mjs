import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const bookings = await p.booking.findMany({
  orderBy: { createdAt: 'desc' },
  take: 3,
  select: {
    id: true, bookingNumber: true, status: true, bookingType: true,
    checkIn: true, checkOut: true, rate: true,
    folio: { select: { id: true, folioNumber: true, balance: true } },
    invoices: { select: { invoiceNumber: true, invoiceType: true, status: true, grandTotal: true } },
  },
});
console.log('🏨  Latest bookings:');
for (const b of bookings) {
  console.log(`\n  ${b.bookingNumber}  [${b.status}]  ${b.bookingType}`);
  console.log(`    Folio: ${b.folio?.folioNumber ?? '(none)'}  balance=${b.folio?.balance ?? 0}`);
  console.log(`    Invoices: ${b.invoices.map(i => `${i.invoiceNumber}(${i.invoiceType},${i.status})`).join(' | ') || '(none)'}`);
  if (b.folio) {
    const items = await p.folioLineItem.findMany({
      where: { folioId: b.folio.id },
      orderBy: { createdAt: 'asc' },
      select: { description: true, chargeType: true, billingStatus: true, quantity: true, unitPrice: true, amount: true, serviceDate: true, periodEnd: true },
    });
    console.log(`    LineItems (${items.length}):`);
    for (const i of items) {
      const sd = i.serviceDate ? i.serviceDate.toISOString().slice(0,10) : '-';
      const pe = i.periodEnd ? i.periodEnd.toISOString().slice(0,10) : '-';
      console.log(`      [${i.billingStatus}] ${i.chargeType.padEnd(8)} ${i.description.padEnd(40)} ${sd}→${pe}  qty=${i.quantity} unit=${i.unitPrice} amt=${i.amount}`);
    }
  }
}

const payments = await p.payment.findMany({
  orderBy: { createdAt: 'desc' },
  take: 3,
  select: { paymentNumber: true, receiptNumber: true, amount: true, paymentMethod: true, status: true, bookingId: true },
});
console.log('\n💰 Latest payments:');
for (const pm of payments) {
  console.log(`  ${pm.paymentNumber} ${pm.receiptNumber}  ${pm.paymentMethod}  ฿${pm.amount}  [${pm.status}]  booking=${pm.bookingId?.slice(0,8)}`);
}

await p.$disconnect();
