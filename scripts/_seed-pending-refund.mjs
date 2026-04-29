import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();
const guest = await p.guest.findFirst();
const room  = await p.room.findFirst();
if (!guest || !room) process.exit(1);

const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
const booking = await p.booking.create({
  data: {
    bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
    bookingType: 'daily', status: 'checked_in', source: 'direct',
    checkIn: new Date('2026-09-01'), checkOut: new Date('2026-09-03'),
    rate: new Prisma.Decimal(1500),
  },
});

const today = new Date();
const refundNumber = `RFD-${today.toISOString().slice(0,10).replace(/-/g,'')}-${num}`;
const refund = await p.refundRecord.create({
  data: {
    refundNumber,
    bookingId: booking.id,
    guestId:   guest.id,
    amount:    new Prisma.Decimal(1500),
    source:    'rate_adjustment',
    reason:    'ลดวันพัก 1 คืน (สำหรับทดสอบ Phase 3)',
    status:    'pending',
    createdBy: 'admin@pms.com',
  },
  select: { id: true, refundNumber: true },
});
console.log(`Created pending refund ${refund.refundNumber} (id=${refund.id})`);
console.log(`Booking ${booking.bookingNumber}, Guest ${guest.firstName ?? ''} ${guest.lastName ?? ''}`);
await p.$disconnect();
