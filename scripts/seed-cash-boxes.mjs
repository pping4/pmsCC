#!/usr/bin/env node
/**
 * seed-cash-boxes.mjs
 *
 * Creates default CashBox rows so cashiers can open shifts.
 *
 * The CashBox table is empty in this environment (data-clear preserved the
 * table but it was never populated to begin with). Each CashBox needs a
 * FinancialAccount with subKind=CASH; we look one up by code "1110-01" or
 * fall back to the first CASH-class account.
 *
 * Run once after a fresh data-clear:
 *   node scripts/seed-cash-boxes.mjs
 *
 * Idempotent — uses upsert on `code`.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default counters to create — adjust to your property's needs
const COUNTERS = [
  { code: 'COUNTER-1', name: 'เคาน์เตอร์หลัก',  location: 'Lobby front desk',   displayOrder: 1 },
  { code: 'COUNTER-2', name: 'เคาน์เตอร์สำรอง', location: 'Lobby front desk 2', displayOrder: 2 },
];

async function main() {
  console.log('💼  Seeding CashBox rows…\n');

  // 1) Find a CASH FinancialAccount to link
  // Try by code first, then fall back to any subKind=CASH
  let cashAccount = await prisma.financialAccount.findFirst({
    where: { code: '1110-01' },
    select: { id: true, code: true, name: true },
  });
  if (!cashAccount) {
    cashAccount = await prisma.financialAccount.findFirst({
      where: { subKind: 'CASH' },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  if (!cashAccount) {
    console.error('❌  No FinancialAccount with subKind=CASH found.');
    console.error('    Open the chart-of-accounts page and create a cash account first,');
    console.error('    or seed financial accounts before running this script.');
    process.exit(2);
  }
  console.log(`🔗  Linking to FinancialAccount: ${cashAccount.code} — ${cashAccount.name}`);
  console.log('');

  // 2) Upsert each counter
  for (const c of COUNTERS) {
    const result = await prisma.cashBox.upsert({
      where:  { code: c.code },
      create: {
        code:               c.code,
        name:               c.name,
        location:           c.location,
        displayOrder:       c.displayOrder,
        financialAccountId: cashAccount.id,
        isActive:           true,
      },
      update: {
        // Idempotent: keep linked account & active flag in sync
        name:               c.name,
        location:           c.location,
        financialAccountId: cashAccount.id,
        isActive:           true,
      },
      select: { id: true, code: true, name: true },
    });
    console.log(`✅  ${result.code.padEnd(12)} ${result.name}`);
  }

  // 3) Final tally
  const total = await prisma.cashBox.count();
  console.log(`\n🎉  Done. ${total} cash boxes ready.`);
}

main()
  .catch((e) => {
    console.error('\n❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
