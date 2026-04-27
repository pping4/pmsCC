#!/usr/bin/env node
/**
 * set-default-bank.mjs
 *
 * Ensures EXACTLY one BANK-subKind FinancialAccount is flagged isDefault=true.
 * The ReceivingAccountPicker auto-selects the default, so without this set
 * the cashier has to pick a bank account every time -- annoying when most
 * properties only ever transfer to one account.
 *
 * Run once after a fresh financial-accounts seed, or whenever you want to
 * change which bank is preferred.
 *
 * Usage:
 *   node scripts/set-default-bank.mjs              # use the first BANK account
 *   node scripts/set-default-bank.mjs <code>       # set a specific one (e.g. "1120-01")
 *
 * Idempotent.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const targetCode = process.argv[2];

const banks = await prisma.financialAccount.findMany({
  where:  { isActive: true, subKind: 'BANK' },
  orderBy: { code: 'asc' },
  select: { id: true, code: true, name: true, isDefault: true },
});

if (banks.length === 0) {
  console.error('❌  No active BANK FinancialAccount found.');
  console.error('    Open /settings/accounts and create at least one.');
  process.exit(2);
}

console.log('🏦  Active BANK accounts:');
for (const b of banks) {
  console.log(`    ${b.isDefault ? '★' : ' '} ${b.code.padEnd(10)} ${b.name}`);
}

const target = targetCode
  ? banks.find(b => b.code === targetCode)
  : banks.find(b => b.isDefault) ?? banks[0];

if (!target) {
  console.error(`❌  No bank account matched code "${targetCode}".`);
  process.exit(3);
}

if (target.isDefault && banks.filter(b => b.isDefault).length === 1) {
  console.log(`\n✅  Already set: ${target.code} — ${target.name}`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  // Clear any existing defaults in BANK
  await tx.financialAccount.updateMany({
    where: { subKind: 'BANK', isDefault: true },
    data:  { isDefault: false },
  });
  // Set the chosen one
  await tx.financialAccount.update({
    where: { id: target.id },
    data:  { isDefault: true },
  });
});

console.log(`\n🎉  Default BANK set: ${target.code} — ${target.name}`);
console.log('    ReceivingAccountPicker will auto-select this from now on.');

await prisma.$disconnect();
