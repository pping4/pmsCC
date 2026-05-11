import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const entries = await p.ledgerEntry.findMany({
  orderBy: { date: 'desc' },
  take: 8,
  select: {
    type: true, account: true, amount: true,
    referenceType: true,
    financialAccount: { select: { code: true, subKind: true } },
  },
});
for (const e of entries) {
  console.log(`${e.type.padEnd(7)} ${e.account.padEnd(15)} ฿${e.amount}  ${e.financialAccount?.code ?? '-'} (${e.financialAccount?.subKind ?? '-'})  [${e.referenceType}]`);
}
await p.$disconnect();
