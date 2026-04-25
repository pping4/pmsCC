/**
 * Sprint 5 Phase 3.5 — Acceptance tests for Payment v2 collection flow
 * Run: node scripts/test-payment-sprint5.mjs
 *
 * Scenarios:
 *  T1. cash no-session → 307|401 (auth gate)
 *  T2. transfer missing receivingAccountId → 422 (Zod refine)
 *  T3. credit_card missing terminalId → 422 (Zod refine)
 *  T4. credit_card brand not in allowedBrands → 400 (service pre-check)
 *  T5. cash payment persisted with reconStatus=CLEARED + clearedAt
 *  T6. non-cash transfer payment persisted with reconStatus=RECEIVED + clearedAt=null
 *  T7. duplicate slipRefNo → 400 (service pre-check)
 */

import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE || 'http://localhost:3000';
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

async function postPayment(body, withAuth=true) {
  const headers = { 'Content-Type':'application/json' };
  if (withAuth) headers.Cookie = cookieHeader();
  const res = await fetch(`${BASE}/api/payments`, { method:'POST', body: JSON.stringify(body), headers, redirect:'manual' });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function findUnpaidInvoice(minRemaining = 100) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: 'voided' } },
    select: { id: true, guestId: true, grandTotal: true, paidAmount: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const inv of invoices) {
    const remaining = Number(inv.grandTotal) - Number(inv.paidAmount ?? 0);
    if (remaining >= minRemaining) return { ...inv, remaining };
  }
  return null;
}

async function main() {
  // Wait for server
  for (let i=0;i<60;i++) { try { const r=await fetch(`${BASE}/api/auth/csrf`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); if (i===59) { console.log(`${R}server not ready${X}`); process.exit(1); } }
  info('server reachable');

  // T1: no-session
  const t1 = await postPayment({
    idempotencyKey: crypto.randomUUID(),
    guestId: '00000000-0000-0000-0000-000000000000',
    amount: 1, paymentMethod: 'cash',
    allocations: [{ invoiceId: '00000000-0000-0000-0000-000000000000', amount: 1 }],
  }, false);
  ok(`T1 no-session → 307|401  (got ${t1.status})`, t1.status === 307 || t1.status === 401);

  const user = await signIn();
  ok('sign-in as admin@pms.com', !!user);
  if (!user) process.exit(1);

  const inv = await findUnpaidInvoice(100);
  if (!inv) { console.log(`${R}No invoice with remaining >= 100 THB — cannot run positive-path tests${X}`); await prisma.$disconnect(); process.exit(1); }
  info(`fixture invoice=${inv.id.slice(0,8)} remaining=${inv.remaining}`);

  // T2: transfer missing receivingAccountId
  const t2 = await postPayment({
    idempotencyKey: crypto.randomUUID(),
    guestId: inv.guestId, amount: 10, paymentMethod: 'transfer',
    allocations: [{ invoiceId: inv.id, amount: 10 }],
  });
  ok(`T2 transfer missing receivingAccountId → 422  (got ${t2.status})`, t2.status === 422);

  // T3: credit_card missing terminalId
  const t3 = await postPayment({
    idempotencyKey: crypto.randomUUID(),
    guestId: inv.guestId, amount: 10, paymentMethod: 'credit_card',
    allocations: [{ invoiceId: inv.id, amount: 10 }],
    cardBrand: 'VISA',
  });
  ok(`T3 credit_card missing terminalId → 422  (got ${t3.status})`, t3.status === 422);

  // T4: Temporarily restrict a terminal to VISA-only, then try MASTER
  const term = await prisma.edcTerminal.findFirst({ where: { isActive: true } });
  ok('EDC terminal fixture', !!term);
  if (term) {
    const originalBrands = term.allowedBrands;
    try {
      await prisma.edcTerminal.update({ where: { id: term.id }, data: { allowedBrands: ['VISA'] } });
      const t4 = await postPayment({
        idempotencyKey: crypto.randomUUID(),
        guestId: inv.guestId, amount: 10, paymentMethod: 'credit_card',
        allocations: [{ invoiceId: inv.id, amount: 10 }],
        terminalId: term.id, cardBrand: 'MASTER',
      });
      ok(`T4 disallowed brand (MASTER vs allowed=[VISA]) → 400  (got ${t4.status})`, t4.status === 400);
      ok(`T4 error message mentions ${term.code} / MASTER`,
         typeof t4.data?.error === 'string' && (t4.data.error.includes(term.code) || t4.data.error.includes('MASTER')));
    } finally {
      await prisma.edcTerminal.update({ where: { id: term.id }, data: { allowedBrands: originalBrands } });
    }
  }

  // T5: cash → reconStatus=CLEARED
  // Cash requires an open shift. If none, skip gracefully.
  const adminUserId = user.email ?? user.id;
  const openSession = await prisma.cashSession.findFirst({
    where: { status: 'OPEN', openedBy: adminUserId },
    select: { id: true },
  });
  if (!openSession) {
    info('T5 skipped — no open cash session for admin@pms.com. Run Close/Open Shift UI once then re-run.');
  } else {
    const t5 = await postPayment({
      idempotencyKey: crypto.randomUUID(),
      guestId: inv.guestId, amount: 10, paymentMethod: 'cash',
      allocations: [{ invoiceId: inv.id, amount: 10 }],
    });
    ok(`T5 cash payment creates 201  (got ${t5.status})`, t5.status === 201);
    if (t5.status === 201 && t5.data.paymentId) {
      const row = await prisma.payment.findUnique({
        where: { id: t5.data.paymentId },
        select: { reconStatus: true, clearedAt: true, clearedBy: true },
      });
      ok(`T5 cash reconStatus=CLEARED  (got ${row?.reconStatus})`, row?.reconStatus === 'CLEARED');
      ok(`T5 cash clearedAt set`, !!row?.clearedAt);
      ok(`T5 cash clearedBy set`, !!row?.clearedBy);
    }
  }

  // T6: transfer → reconStatus=RECEIVED (requires receivingAccount)
  const bankAcc = await prisma.financialAccount.findFirst({ where: { subKind: 'BANK', isActive: true }, select: { id: true } });
  ok('BANK financial account fixture', !!bankAcc);
  const slipRef = `TEST-SLIP-${Date.now()}`;
  if (bankAcc) {
    const t6 = await postPayment({
      idempotencyKey: crypto.randomUUID(),
      guestId: inv.guestId, amount: 10, paymentMethod: 'transfer',
      allocations: [{ invoiceId: inv.id, amount: 10 }],
      receivingAccountId: bankAcc.id,
      slipRefNo: slipRef,
    });
    ok(`T6 transfer payment creates 201  (got ${t6.status})`, t6.status === 201);
    if (t6.status === 201 && t6.data.paymentId) {
      const row = await prisma.payment.findUnique({
        where: { id: t6.data.paymentId },
        select: { reconStatus: true, clearedAt: true, slipRefNo: true, receivingAccountId: true },
      });
      ok(`T6 transfer reconStatus=RECEIVED  (got ${row?.reconStatus})`, row?.reconStatus === 'RECEIVED');
      ok(`T6 transfer clearedAt=null`, row?.clearedAt === null);
      ok(`T6 transfer slipRefNo persisted`, row?.slipRefNo === slipRef);
      ok(`T6 transfer receivingAccountId persisted`, row?.receivingAccountId === bankAcc.id);

      // T7: duplicate slipRefNo must be rejected
      const t7 = await postPayment({
        idempotencyKey: crypto.randomUUID(),
        guestId: inv.guestId, amount: 10, paymentMethod: 'transfer',
        allocations: [{ invoiceId: inv.id, amount: 10 }],
        receivingAccountId: bankAcc.id,
        slipRefNo: slipRef, // same ref — must clash
      });
      ok(`T7 duplicate slipRefNo → 400  (got ${t7.status})`, t7.status === 400);
      ok(`T7 error mentions slip`, typeof t7.data?.error === 'string' && t7.data.error.includes('slip'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed) { console.log('FAILURES:', fails); process.exit(1); }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
