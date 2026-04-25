/**
 * Sprint 5 Phase 4.5 — Acceptance tests for Close Shift summary
 * Run:
 *   BASE=http://localhost:27110 node scripts/test-shift-summary.mjs
 *
 * Scenarios:
 *  T1. no-session → 307|401
 *  T2. admin can GET own shift summary → 200 + structure
 *  T3. Shift with only cash → nonCash totals empty, grandTotal = cash.expectedTotal
 *  T4. Shift with mixed payments (transfer + credit_card) → breakdown per account+brand
 *  T5. pendingRecon counts non-CLEARED non-cash payments correctly
 *  T6. cash payment flows through as CLEARED (recon complete for cash)
 *  T7. 404 for non-existent session id
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

async function getSummary(sessionId, withAuth=true) {
  const headers = withAuth ? { Cookie: cookieHeader() } : {};
  const res = await fetch(`${BASE}/api/cash-sessions/${sessionId}/summary`, { headers, redirect:'manual' });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  // Wait for server
  for (let i=0;i<60;i++) { try { const r=await fetch(`${BASE}/api/auth/csrf`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); if (i===59) { console.log(`${R}server not ready${X}`); process.exit(1); } }
  info(`server reachable at ${BASE}`);

  // T1: no-session
  const t1 = await getSummary('00000000-0000-0000-0000-000000000000', false);
  ok(`T1 no-session → 307|401  (got ${t1.status})`, t1.status === 307 || t1.status === 401);

  const user = await signIn();
  ok('sign-in as admin@pms.com', !!user);
  if (!user) process.exit(1);

  // T7: 404 non-existent
  const t7 = await getSummary('00000000-0000-0000-0000-000000000000');
  ok(`T7 unknown session id → 404  (got ${t7.status})`, t7.status === 404);

  // Fixture: create an OPEN shift for admin, create 2 payments (cash + transfer)
  const box = await prisma.cashBox.findFirst({ select: { id: true } });
  if (!box) throw new Error('No cashBox — seed first');
  let invoice = await prisma.invoice.findFirst({ where: { status: { not: 'voided' } }, select: { id: true, guestId: true } });
  if (!invoice) {
    info('no invoice found — creating guest+invoice fixture');
    const g = await prisma.guest.create({
      data: {
        firstName: 'Test', lastName: 'ShiftSummary',
        idType: 'other', idNumber: `TEST-${Date.now()}`,
        phone: '0812345678',
      },
      select: { id: true },
    });
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-TEST-${Date.now()}`,
        guestId: g.id,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 1000, grandTotal: 1000, paidAmount: 0,
        status: 'unpaid',
      },
      select: { id: true, guestId: true },
    });
    invoice = inv;
  }
  const bankAcc = await prisma.financialAccount.findFirst({ where: { subKind: 'BANK', isActive: true }, select: { id: true, name: true, code: true } });
  if (!bankAcc) throw new Error('No BANK account — seed first');

  // Close any existing OPEN shift for admin first (cleanup)
  await prisma.cashSession.updateMany({ where: { openedBy: 'admin@pms.com', status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date(), closingBalance: 0, systemCalculatedCash: 0 } });
  await prisma.cashBox.updateMany({ where: { currentSessionId: { not: null } }, data: { currentSessionId: null } });

  // Open fresh shift
  const sess = await prisma.cashSession.create({
    data: {
      cashBoxId: box.id, openedBy: 'admin@pms.com', openedByName: 'Admin (test)',
      openedAt: new Date(), openingBalance: 5000, status: 'OPEN',
    },
    select: { id: true },
  });
  await prisma.cashBox.update({ where: { id: box.id }, data: { currentSessionId: sess.id } });
  info(`fresh OPEN session=${sess.id.slice(0,8)}`);

  // T3: pre-payment — only cash section should be empty, nonCash empty
  const t3 = await getSummary(sess.id);
  ok(`T3a empty shift → 200`, t3.status === 200);
  ok(`T3b cash.expectedTotal=0 on empty shift`, t3.data?.cash?.expectedTotal === 0);
  ok(`T3c nonCash.transfer=[] on empty shift`, Array.isArray(t3.data?.nonCash?.transfer) && t3.data.nonCash.transfer.length === 0);
  ok(`T3d pendingRecon=0 on empty shift`, t3.data?.pendingRecon === 0);
  ok(`T3e grandTotal=0 on empty shift`, t3.data?.grandTotal === 0);
  ok(`T3f openingFloat=5000`, t3.data?.session?.openingFloat === 5000);

  // Create a cash payment via API
  const cashRes = await fetch(`${BASE}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      guestId: invoice.guestId,
      amount: 500,
      paymentMethod: 'cash',
      allocations: [{ invoiceId: invoice.id, amount: 500 }],
    }),
  });
  ok(`cash payment 201  (got ${cashRes.status})`, cashRes.status === 201);

  // Create a transfer payment
  const slipRef = `SHIFT-TEST-${Date.now()}`;
  const transRes = await fetch(`${BASE}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      guestId: invoice.guestId,
      amount: 300,
      paymentMethod: 'transfer',
      allocations: [{ invoiceId: invoice.id, amount: 300 }],
      receivingAccountId: bankAcc.id,
      slipRefNo: slipRef,
    }),
  });
  ok(`transfer payment 201  (got ${transRes.status})`, transRes.status === 201);

  // Link the non-cash payment to this shift (the payment flow only auto-links cash).
  // For summary to include it, we must attach its cashSessionId. The plan says
  // "Non-cash does not affect cash count — just displayed for awareness", so the
  // summary groups by the cashSessionId if set. Non-cash payments created through
  // normal flow do NOT set cashSessionId. That means the shift summary will show
  // ONLY cash by default. To exercise the non-cash breakdown we manually link here.
  const transPayId = (await transRes.json())?.paymentId;
  if (transPayId) {
    await prisma.payment.update({ where: { id: transPayId }, data: { cashSessionId: sess.id } });
    info('linked transfer payment to shift for breakdown exercise');
  }

  // T4: mixed shift summary
  const t4 = await getSummary(sess.id);
  ok(`T4a cash.expectedTotal=500  (got ${t4.data?.cash?.expectedTotal})`, t4.data?.cash?.expectedTotal === 500);
  ok(`T4b cash.paymentCount=1`, t4.data?.cash?.paymentCount === 1);
  ok(`T4c transfer.length=1`, t4.data?.nonCash?.transfer?.length === 1);
  ok(`T4d transfer[0].total=300`, t4.data?.nonCash?.transfer?.[0]?.total === 300);
  ok(`T4e transfer[0].accountName includes bank code`,
     typeof t4.data?.nonCash?.transfer?.[0]?.accountName === 'string' &&
     t4.data.nonCash.transfer[0].accountName.includes(bankAcc.code));
  ok(`T4f grandTotal=800`, t4.data?.grandTotal === 800);

  // T5: pendingRecon counts non-cash that are not CLEARED
  ok(`T5 pendingRecon=1 (transfer RECEIVED)`, t4.data?.pendingRecon === 1);

  // T6: cash payment reconStatus check
  const cashPayId = (await cashRes.json())?.paymentId;
  if (cashPayId) {
    const cashRow = await prisma.payment.findUnique({ where: { id: cashPayId }, select: { reconStatus: true } });
    ok(`T6 cash.reconStatus=CLEARED`, cashRow?.reconStatus === 'CLEARED');
  }

  // Cleanup — close session so we don't leave open shifts behind
  await prisma.cashSession.update({
    where: { id: sess.id },
    data: { status: 'CLOSED', closedAt: new Date(), closingBalance: 5500, systemCalculatedCash: 5500 },
  });
  await prisma.cashBox.update({ where: { id: box.id }, data: { currentSessionId: null } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed) { console.log('FAILURES:', fails); process.exit(1); }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
