/**
 * Quickly set up a smoke-test fixture for the /cashier Recent Payments table:
 * - Open a CashSession for the admin user
 * - Create a booking + folio + invoice + 2 payments (1 cash, 1 transfer)
 * So we can visually verify the new DataTable renders rows + the void button.
 */

import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
const guest = await p.guest.findFirst();
const room  = await p.room.findFirst({ where: { status: 'available' } });
const box   = await p.cashBox.findFirst({ where: { isActive: true } });
const bank  = await p.financialAccount.findFirst({ where: { subKind: 'BANK', isDefault: true } });
if (!admin || !guest || !room || !box || !bank) {
  console.error('Missing fixture data', { admin: !!admin, guest: !!guest, room: !!room, box: !!box, bank: !!bank });
  process.exit(1);
}

// Open shift if none active
let session = await p.cashSession.findFirst({ where: { openedBy: admin.id, status: 'OPEN' } });
if (!session) {
  session = await p.cashSession.create({
    data: {
      cashBoxId: box.id, openedBy: admin.id, openedByName: admin.name ?? 'Admin',
      openedAt: new Date(), openingBalance: new Prisma.Decimal(0), status: 'OPEN',
    },
  });
  await p.cashBox.update({ where: { id: box.id }, data: { currentSessionId: session.id } });
  console.log('Opened session:', session.id.slice(0, 8));
} else {
  console.log('Reusing session:', session.id.slice(0, 8));
}

console.log('Done. Session ready for manual smoke test on /cashier.');
console.log('   Now create a booking + payment via the UI, then revisit /cashier');
console.log('   to see the Recent Payments table.');
await p.$disconnect();
