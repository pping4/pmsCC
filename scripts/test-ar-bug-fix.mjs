/**
 * Phase A/B verification — confirm the AR bug is fixed.
 *
 * Bug (parked then fixed): when paying for an invoice, the system was posting
 *   DR Cash / CR Revenue (which double-counts revenue and leaves AR inflated)
 * The fix: every `createPayment()` now posts
 *   DR Cash / CR AR (because the invoice already accrued DR AR / CR Revenue)
 *
 * Test: create a 1,000-baht invoice, pay it in full via /api/payments, and
 * verify the ledger nets to:
 *   AR = 0  (accrued +1000 then collected -1000)
 *   Revenue credit = 1000  (only credited once, at accrual)
 *   Cash debit = 1000
 *
 * Failing this test would mean we're back to the old broken pattern.
 */

import { PrismaClient } from '@prisma/client';

const BASE  = process.env.BASE || 'http://localhost:3000';
const EMAIL = 'admin@pms.com';
const PASS  = 'admin123';
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';

const prisma = new PrismaClient();
let passed=0, failed=0; const fails=[];
const ok = (label, v) => { if (v) { console.log(`  ${G}OK${X} ${label}`); passed++; } else { console.log(`  ${R}FAIL${X} ${label}`); failed++; fails.push(label); } };
const info = m => console.log(`  ${Y}..${X} ${m}`);

let cookies = {};
const cookieHeader = () => Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; ');
function absorb(res) {
  const sc = res.headers.get('set-cookie'); if (!sc) return;
  sc.split(',').forEach(c => { const [p]=c.trim().split(';'); const eq=p.indexOf('='); if (eq>0) cookies[p.slice(0,eq).trim()]=p.slice(eq+1).trim(); });
}
async function signIn() {
  const r1 = await fetch(`${BASE}/api/auth/csrf`); absorb(r1);
  const { csrfToken } = await r1.json();
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method:'POST', redirect:'manual',
    headers:{'Content-Type':'application/x-www-form-urlencoded', Cookie:cookieHeader()},
    body:new URLSearchParams({ csrfToken, email:EMAIL, password:PASS, redirect:'false', json:'true' }),
  });
  absorb(r2);
  const r3 = await fetch(`${BASE}/api/auth/session`, { headers:{Cookie:cookieHeader()} });
  return (await r3.json())?.user ?? null;
}

const sumLedger = (rows, type, account) =>
  rows.filter((r) => r.type === type && r.account === account).reduce((s, r) => s + Number(r.amount), 0);

async function main() {
  for (let i=0;i<60;i++) { try { const r=await fetch(`${BASE}/api/auth/csrf`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); if (i===59) { console.log(`${R}server not ready${X}`); process.exit(1); } }
  info(`server reachable at ${BASE}`);

  const user = await signIn();
  ok('sign-in as admin', !!user);
  if (!user) process.exit(1);

  // Fixture: guest + invoice (1,000 baht, no VAT for simplicity)
  const tag = `ARFIX-${Date.now()}`;
  const guest = await prisma.guest.create({
    data: { firstName: 'AR', lastName: tag, idType: 'other', idNumber: tag, phone: '0812345678' },
    select: { id: true },
  });
  info(`guest ${guest.id}`);

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${tag}`,
      guestId: guest.id,
      issueDate: new Date(),
      dueDate:   new Date(),
      subtotal:    1000,
      vatAmount:   0,
      grandTotal:  1000,
      paidAmount:  0,
      status:     'unpaid',
    },
    select: { id: true },
  });
  info(`invoice ${invoice.id}`);

  // Manually call the same accrual function that booking/checkin flows use
  // (simulates "DR AR / CR Revenue" at invoice creation time).
  // We can't import services from .mjs, so we use raw SQL via prisma.$queryRaw
  // — alternative: just check that NO AR or Revenue exists yet, then create
  // a real payment which WILL trigger the proper accrual via folio.service if
  // wired up. For this test we use the API path that does accrual+payment.
  // Easier: post a ledger pair manually.
  const accrualBatch = crypto.randomUUID();
  const accrualDate  = new Date();
  await prisma.ledgerEntry.createMany({
    data: [
      { date: accrualDate, type: 'DEBIT',  account: 'AR',      batchId: accrualBatch, amount: 1000, referenceType: 'Invoice', referenceId: invoice.id, description: `${tag} accrual`, createdBy: 'test' },
      { date: accrualDate, type: 'CREDIT', account: 'REVENUE', batchId: accrualBatch, amount: 1000, referenceType: 'Invoice', referenceId: invoice.id, description: `${tag} accrual`, createdBy: 'test' },
    ],
  });
  info('manually posted DR AR / CR Revenue 1000 (simulating invoice accrual)');

  // Now collect payment via /api/payments — this should post DR Cash / CR AR
  const idempotencyKey = crypto.randomUUID();
  const payRes = await fetch(`${BASE}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({
      idempotencyKey,
      guestId: guest.id,
      amount: 1000,
      paymentMethod: 'transfer',  // any non-cash; cash needs an open shift
      receivingAccountId: (await prisma.financialAccount.findFirst({ where: { subKind: 'BANK' }, select: { id: true } }))?.id,
      slipRefNo: `SLIP-${tag}`,
      allocations: [{ invoiceId: invoice.id, amount: 1000 }],
    }),
  });
  const payJson = await payRes.json();
  ok(`payment created → 200|201  (got ${payRes.status})`, payRes.status === 200 || payRes.status === 201);
  if (payRes.status !== 200) { console.log(payJson); }
  const paymentId = payJson.paymentId;

  // Now assert the ledger
  const allEntries = await prisma.ledgerEntry.findMany({
    where: {
      OR: [
        { referenceType: 'Invoice', referenceId: invoice.id },
        { referenceType: 'Payment', referenceId: paymentId },
      ],
    },
    select: { type: true, account: true, amount: true, description: true, referenceType: true },
  });
  console.log('\n  Ledger entries for this test:');
  allEntries.forEach((e) => {
    console.log(`    ${e.referenceType.padEnd(8)} ${e.type.padEnd(6)} ${e.account.padEnd(20)} ${Number(e.amount).toFixed(2).padStart(10)}  ${e.description ?? ''}`);
  });

  const arDebits   = sumLedger(allEntries, 'DEBIT',  'AR');
  const arCredits  = sumLedger(allEntries, 'CREDIT', 'AR');
  const arNet      = arDebits - arCredits;
  ok(`AR debit total = 1000`, Math.abs(arDebits - 1000) < 0.01);
  ok(`AR credit total = 1000`, Math.abs(arCredits - 1000) < 0.01);
  ok(`AR net = 0  (was the bug — should clear)`, Math.abs(arNet) < 0.01);

  const revDebits  = sumLedger(allEntries, 'DEBIT',  'REVENUE');
  const revCredits = sumLedger(allEntries, 'CREDIT', 'REVENUE');
  ok(`Revenue debit = 0`, Math.abs(revDebits) < 0.01);
  ok(`Revenue credit = 1000  (NOT 2000 — the bug used to credit twice)`, Math.abs(revCredits - 1000) < 0.01);

  const cashDebits  = sumLedger(allEntries, 'DEBIT',  'CASH') + sumLedger(allEntries, 'DEBIT', 'BANK');
  ok(`Cash/Bank debit = 1000`, Math.abs(cashDebits - 1000) < 0.01);

  // Cleanup
  info('cleaning up test data...');
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ referenceType: 'Invoice', referenceId: invoice.id }, ...(paymentId ? [{ referenceType: 'Payment', referenceId: paymentId }] : [])] } });
  if (paymentId) {
    await prisma.paymentAllocation.deleteMany({ where: { paymentId } });
    await prisma.paymentAuditLog.deleteMany({ where: { paymentId } });
    await prisma.payment.delete({ where: { id: paymentId } });
  }
  await prisma.invoice.delete({ where: { id: invoice.id } });
  await prisma.guest.delete({ where: { id: guest.id } });

  console.log(`\n${passed+failed} tests — ${G}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
  if (failed) { console.log(`\n${R}Failures:${X}`); fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
