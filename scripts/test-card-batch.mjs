/**
 * Sprint 5 Phase 5.4 — Acceptance tests for EDC Batch Close
 * Run:
 *   BASE=http://localhost:27110 node scripts/test-card-batch.mjs
 *
 * Scenarios:
 *  T1. no-session → 307|401
 *  T2. admin can list batches
 *  T3. preview (PMS-side totals for terminal+date)
 *  T4. POST /api/card-batches (matching EDC total) → variance=0, all payments stamped
 *  T5. POST with variance ≠ 0 → 201, varianceAmount persisted
 *  T6. Duplicate (terminalId, batchNo) → 409
 *  T7. Re-preview excludes already-batched payments
 *  T8. Zod rejects bad input → 422
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

async function main() {
  for (let i=0;i<60;i++) { try { const r=await fetch(`${BASE}/api/auth/csrf`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); if (i===59) { console.log(`${R}server not ready${X}`); process.exit(1); } }
  info(`server reachable at ${BASE}`);

  // T1: no-auth
  const t1 = await fetch(`${BASE}/api/card-batches`, { redirect:'manual' });
  ok(`T1 no-session → 307|401  (got ${t1.status})`, t1.status === 307 || t1.status === 401);

  const user = await signIn();
  ok('sign-in as admin', !!user);
  if (!user) process.exit(1);

  // T2: list
  const t2 = await fetch(`${BASE}/api/card-batches`, { headers:{Cookie:cookieHeader()} });
  ok(`T2 list → 200`, t2.status === 200);

  // Fixture: terminal + 2 card payments today
  const terminal = await prisma.edcTerminal.findFirst({ where: { isActive: true }, select: { id: true, code: true, allowedBrands: true } });
  if (!terminal) throw new Error('No active EDC terminal — seed first');

  // Ensure terminal allows VISA for test payments
  if (!terminal.allowedBrands.includes('VISA')) {
    info(`patching terminal ${terminal.code} allowedBrands to include VISA`);
    await prisma.edcTerminal.update({ where: { id: terminal.id }, data: { allowedBrands: [...terminal.allowedBrands, 'VISA'] } });
  }

  let invoice = await prisma.invoice.findFirst({ where: { status: { not: 'voided' } }, select: { id: true, guestId: true } });
  if (!invoice) {
    info('creating guest+invoice fixture');
    const g = await prisma.guest.create({
      data: { firstName: 'Test', lastName: 'Batch', idType: 'other', idNumber: `BATCH-${Date.now()}`, phone: '0812345678' },
      select: { id: true },
    });
    invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-BATCH-${Date.now()}`, guestId: g.id,
        issueDate: new Date(), dueDate: new Date(),
        subtotal: 10000, grandTotal: 10000, paidAmount: 0, status: 'unpaid',
      },
      select: { id: true, guestId: true },
    });
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const pad = (n) => String(n).padStart(2,'0');
  const ymd = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;

  // Clear any existing payments for this terminal today to keep the test deterministic
  await prisma.payment.updateMany({
    where: { terminalId: terminal.id, paymentDate: { gte: today, lt: new Date(today.getTime()+86400000) } },
    data:  { batchNo: 'LEGACY-TEST' },
  });
  // And clear any prior batch rows for this terminal today
  await prisma.cardBatchReport.deleteMany({ where: { terminalId: terminal.id, closeDate: today } });

  // Create 2 card payments (500 + 700 = 1200)
  const mk = async (amount) => {
    const res = await fetch(`${BASE}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        guestId: invoice.guestId,
        amount,
        paymentMethod: 'credit_card',
        allocations: [{ invoiceId: invoice.id, amount }],
        terminalId: terminal.id,
        cardBrand: 'VISA',
        cardType: 'NORMAL',
        cardLast4: '1234',
        authCode: 'AUTH' + Math.floor(Math.random() * 100000),
      }),
    });
    const data = await res.json();
    return { status: res.status, id: data?.paymentId };
  };

  const p1 = await mk(500);
  const p2 = await mk(700);
  ok(`created card payment p1 500 → 201  (got ${p1.status})`, p1.status === 201);
  ok(`created card payment p2 700 → 201  (got ${p2.status})`, p2.status === 201);

  // T3: preview
  const prevRes = await fetch(`${BASE}/api/card-batches?preview=1&terminalId=${terminal.id}&closeDate=${ymd}`, { headers:{Cookie:cookieHeader()} });
  const prev = await prevRes.json();
  ok(`T3 preview → 200`, prevRes.status === 200);
  ok(`T3 pmsTotal=1200  (got ${prev.pmsTotal})`, prev.pmsTotal === 1200);
  ok(`T3 pmsTxCount=2`,   prev.pmsTxCount === 2);

  // T4: close batch with matching total → variance=0
  const batchNo1 = `T4-${Date.now()}`;
  const r4 = await fetch(`${BASE}/api/card-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ terminalId: terminal.id, batchNo: batchNo1, closeDate: ymd, edcTotalAmount: 1200, edcTxCount: 2 }),
  });
  const d4 = await r4.json();
  ok(`T4 POST batch (match) → 201  (got ${r4.status})`, r4.status === 201);
  ok(`T4 variance.amount=0`, d4?.variance?.amount === 0);
  ok(`T4 variance.ok=true`, d4?.variance?.ok === true);
  ok(`T4 matchedPayments=2  (got ${d4?.matchedPayments})`, d4?.matchedPayments === 2);

  // Verify payments got stamped
  const stamped = await prisma.payment.count({ where: { id: { in: [p1.id, p2.id] }, batchNo: batchNo1 } });
  ok(`T4 both payments stamped with batchNo`, stamped === 2);

  // T5: variance ≠ 0 — create another card payment, close with edc=600 but pms=300
  const p3 = await mk(300);
  ok(`created card payment p3 300 → 201`, p3.status === 201);
  const batchNo2 = `T5-${Date.now()}`;
  const r5 = await fetch(`${BASE}/api/card-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ terminalId: terminal.id, batchNo: batchNo2, closeDate: ymd, edcTotalAmount: 600, edcTxCount: 1 }),
  });
  const d5 = await r5.json();
  ok(`T5 POST (variance) → 201`, r5.status === 201);
  ok(`T5 variance.amount=300  (got ${d5?.variance?.amount})`, d5?.variance?.amount === 300);
  ok(`T5 variance.ok=false`, d5?.variance?.ok === false);

  // T6: duplicate batch no → 409
  const r6 = await fetch(`${BASE}/api/card-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ terminalId: terminal.id, batchNo: batchNo1, closeDate: ymd, edcTotalAmount: 1200, edcTxCount: 2 }),
  });
  ok(`T6 duplicate (terminalId, batchNo) → 409  (got ${r6.status})`, r6.status === 409);

  // T7: re-preview — unbatched=0, alreadyBatched>=3
  const r7res = await fetch(`${BASE}/api/card-batches?preview=1&terminalId=${terminal.id}&closeDate=${ymd}`, { headers:{Cookie:cookieHeader()} });
  const r7 = await r7res.json();
  ok(`T7 re-preview pmsTotal=0  (got ${r7.pmsTotal})`, r7.pmsTotal === 0);
  ok(`T7 re-preview alreadyBatchedCount>=3  (got ${r7.alreadyBatchedCount})`, r7.alreadyBatchedCount >= 3);

  // T8: zod rejects bad input
  const r8 = await fetch(`${BASE}/api/card-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ terminalId: 'not-uuid', batchNo: '', closeDate: 'bad', edcTotalAmount: -1, edcTxCount: -1 }),
  });
  ok(`T8 bad input → 422  (got ${r8.status})`, r8.status === 422);

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed) { console.log('FAILURES:', fails); process.exit(1); }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
