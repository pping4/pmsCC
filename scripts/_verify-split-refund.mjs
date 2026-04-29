import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const refund = await p.refundRecord.findFirst({
  orderBy: { createdAt: 'desc' },
  include: { guestCredit: true, reversalAllocations: true },
});
if (!refund) { console.log('no refund'); process.exit(0); }

console.log('Refund:', refund.refundNumber);
console.log('  status:        ', refund.status);
console.log('  mode:          ', refund.mode);
console.log('  amount:        ', refund.amount.toString());
console.log('  cashAmount:    ', refund.cashAmount?.toString());
console.log('  creditAmount:  ', refund.creditAmount?.toString());
console.log('  method:        ', refund.method);
console.log('  guestCreditId: ', refund.guestCreditId);

if (refund.guestCredit) {
  console.log('\nIssued GuestCredit:', refund.guestCredit.creditNumber);
  console.log('  amount:          ', refund.guestCredit.amount.toString());
  console.log('  remainingAmount: ', refund.guestCredit.remainingAmount.toString());
  console.log('  status:          ', refund.guestCredit.status);
}

console.log('\nReversal allocations:', refund.reversalAllocations.length);
for (const a of refund.reversalAllocations) {
  console.log(`  paymentId=${a.paymentId.slice(0,8)} invoiceId=${a.invoiceId.slice(0,8)} amount=${a.amount} kind=${a.kind}`);
}

const ledger = await p.ledgerEntry.findMany({
  where: { referenceType: { in: ['RefundRecord', 'GuestCredit'] }, referenceId: { in: [refund.id, refund.guestCreditId ?? ''].filter(Boolean) } },
  orderBy: { date: 'asc' },
});
console.log('\nLedger entries posted:', ledger.length);
for (const e of ledger) {
  console.log(`  ${e.type.padEnd(7)} ${e.account.padEnd(25)} ฿${e.amount}  ${e.description}`);
}

await p.$disconnect();
