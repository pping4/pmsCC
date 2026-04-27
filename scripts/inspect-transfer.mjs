import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

console.log('🔎  Recent payments (10):\n');
const payments = await p.payment.findMany({
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: {
    paymentNumber: true, receiptNumber: true,
    paymentMethod: true, amount: true, status: true,
    receivingAccountId: true, cashSessionId: true, cashBoxId: true,
    receivingAccount: { select: { code: true, name: true } },
  },
});
for (const pm of payments) {
  console.log(`  ${pm.paymentNumber}  ${pm.paymentMethod.padEnd(12)}  ฿${pm.amount}  [${pm.status}]`);
  console.log(`    receivingAccount: ${pm.receivingAccount?.code ?? '-'} ${pm.receivingAccount?.name ?? ''}`);
  console.log(`    cashSession: ${pm.cashSessionId?.slice(0,8) ?? '-'}  cashBox: ${pm.cashBoxId?.slice(0,8) ?? '-'}`);
}

console.log('\n💰  Recent ledger entries (15):\n');
const ledger = await p.ledgerEntry.findMany({
  orderBy: { createdAt: 'desc' },
  take: 15,
  select: {
    account: true, type: true, amount: true,
    description: true, financialAccountId: true,
    financialAccount: { select: { code: true, name: true } },
    referenceType: true, referenceId: true, createdAt: true,
  },
});
for (const e of ledger) {
  const fa = e.financialAccount ? `${e.financialAccount.code} ${e.financialAccount.name}` : '(no FA)';
  console.log(`  ${e.type.padEnd(7)} ฿${String(e.amount).padStart(8)}  ${e.account.padEnd(28)} ${fa}`);
  console.log(`    "${e.description}"  ${e.referenceType}=${e.referenceId?.slice(0,8) ?? '-'}`);
}

console.log('\n🏦  Bank account balances (subKind=BANK):\n');
const banks = await p.financialAccount.findMany({
  where: { subKind: 'BANK', isActive: true },
  orderBy: { code: 'asc' },
  select: { id: true, code: true, name: true, openingBalance: true },
});
for (const b of banks) {
  const agg = await p.ledgerEntry.aggregate({
    where: { financialAccountId: b.id },
    _sum: { amount: true },
  });
  // Net balance: DEBITS - CREDITS for asset accounts
  const debits = await p.ledgerEntry.aggregate({
    where: { financialAccountId: b.id, type: 'DEBIT' },
    _sum: { amount: true },
  });
  const credits = await p.ledgerEntry.aggregate({
    where: { financialAccountId: b.id, type: 'CREDIT' },
    _sum: { amount: true },
  });
  const dr = Number(debits._sum.amount ?? 0);
  const cr = Number(credits._sum.amount ?? 0);
  const open = Number(b.openingBalance);
  const balance = open + dr - cr;
  console.log(`  ${b.code}  ${b.name.padEnd(30)}  open=${open}  DR=${dr}  CR=${cr}  net=${balance}`);
}

await p.$disconnect();
