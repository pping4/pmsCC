/**
 * Sprint 5 Phase 6.7 — Acceptance tests for Tax Invoice Module
 * Run:
 *   BASE=http://localhost:27110 node scripts/test-tax-invoice.mjs
 *
 * Scenarios:
 *  T1. no-session → 307|401
 *  T2. admin can list tax invoices
 *  T3. build tax invoice from 3 invoices → totals aggregate correctly
 *  T4. covering an already-covered invoice → 409
 *  T5. mixed customers (2 invoices, 2 guests) → 422 MIXED_CUSTOMERS
 *  T6. void ISSUED → VOIDED, gap preserved (number not reused)
 *  T7. void already-voided → 409 ALREADY_VOIDED
 *  T8. concurrent creation: 10 parallel creates → 10 unique monotonic numbers
 *  T9. Zod rejects bad input (non-uuid id, empty array, bad taxId) → 422
 *  T10. builder helper ?guestId=... excludes already-covered invoices
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

const makeGuest = async (tag) => prisma.guest.create({
  data: { firstName: 'TI', lastName: tag, idType: 'other', idNumber: `TI-${tag}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, phone: '0812345678' },
  select: { id: true },
});

const makeInvoice = async (guestId, amount) => prisma.invoice.create({
  data: {
    invoiceNumber: `INV-TI-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    guestId, issueDate: new Date(), dueDate: new Date(),
    subtotal: amount, vatAmount: +(amount * 0.07).toFixed(2), grandTotal: +(amount * 1.07).toFixed(2),
    paidAmount: 0, status: 'unpaid',
  },
  select: { id: true, subtotal: true, vatAmount: true, grandTotal: true, guestId: true },
});

async function main() {
  for (let i=0;i<60;i++) { try { const r=await fetch(`${BASE}/api/auth/csrf`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,1000)); if (i===59) { console.log(`${R}server not ready${X}`); process.exit(1); } }
  info(`server reachable at ${BASE}`);

  // T1: no-auth
  const t1 = await fetch(`${BASE}/api/tax-invoices`, { redirect:'manual' });
  ok(`T1 no-session → 307|401  (got ${t1.status})`, t1.status === 307 || t1.status === 401);

  const user = await signIn();
  ok('sign-in as admin', !!user);
  if (!user) process.exit(1);

  // T2: list
  const t2 = await fetch(`${BASE}/api/tax-invoices`, { headers:{Cookie:cookieHeader()} });
  ok(`T2 list → 200`, t2.status === 200);

  // ──────────────────────────────────────────────────────────────
  // T3: build from 3 invoices
  const g1 = await makeGuest('T3');
  const inv1 = await makeInvoice(g1.id, 100);
  const inv2 = await makeInvoice(g1.id, 200);
  const inv3 = await makeInvoice(g1.id, 300);
  const expectedSub   = 600;
  const expectedVat   = +(600 * 0.07).toFixed(2);
  const expectedTotal = +(600 * 1.07).toFixed(2);

  const r3 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({
      customerName: 'บริษัท ทดสอบ จำกัด',
      customerTaxId: '0105556123456',
      customerBranch: '00000',
      customerAddress: '123 ถ.สุขุมวิท กรุงเทพ 10110',
      coveredInvoiceIds: [inv1.id, inv2.id, inv3.id],
    }),
  });
  const d3 = await r3.json();
  ok(`T3 create → 201  (got ${r3.status})`, r3.status === 201);
  const ti = d3?.taxInvoice;
  ok(`T3 has number`, typeof ti?.number === 'string' && ti.number.startsWith('TI-'));
  ok(`T3 subtotal=${expectedSub}  (got ${ti?.subtotal})`, Math.abs((ti?.subtotal ?? 0) - expectedSub) < 0.01);
  ok(`T3 vatAmount≈${expectedVat}  (got ${ti?.vatAmount})`, Math.abs((ti?.vatAmount ?? 0) - expectedVat) < 0.01);
  ok(`T3 grandTotal≈${expectedTotal}  (got ${ti?.grandTotal})`, Math.abs((ti?.grandTotal ?? 0) - expectedTotal) < 0.01);
  ok(`T3 status=ISSUED`, ti?.status === 'ISSUED');
  ok(`T3 coveredInvoiceIds has 3`, ti?.coveredInvoiceIds?.length === 3);

  // T4: already-covered → 409
  const r4 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({
      customerName: 'บริษัท ทดสอบ จำกัด',
      coveredInvoiceIds: [inv1.id],
    }),
  });
  ok(`T4 already-covered → 409  (got ${r4.status})`, r4.status === 409);

  // ──────────────────────────────────────────────────────────────
  // T5: mixed customers → 422
  const g2a = await makeGuest('T5a');
  const g2b = await makeGuest('T5b');
  const invA = await makeInvoice(g2a.id, 100);
  const invB = await makeInvoice(g2b.id, 100);
  const r5 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ customerName: 'Mix', coveredInvoiceIds: [invA.id, invB.id] }),
  });
  ok(`T5 mixed customers → 422  (got ${r5.status})`, r5.status === 422);

  // ──────────────────────────────────────────────────────────────
  // T6: void
  const r6 = await fetch(`${BASE}/api/tax-invoices/${ti.id}`, {
    method:'PATCH',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ action:'void', reason:'ทดสอบ void' }),
  });
  const d6 = await r6.json();
  ok(`T6 void → 200  (got ${r6.status})`, r6.status === 200);
  ok(`T6 status=VOIDED`, d6?.taxInvoice?.status === 'VOIDED');

  // T6b: number preserved (row not deleted)
  const checkRow = await prisma.taxInvoice.findUnique({ where: { id: ti.id }, select: { number: true, status: true, voidReason: true } });
  ok(`T6b row preserved`, checkRow?.number === ti.number && checkRow?.status === 'VOIDED');
  ok(`T6b voidReason saved`, checkRow?.voidReason === 'ทดสอบ void');

  // T7: void again → 409
  const r7 = await fetch(`${BASE}/api/tax-invoices/${ti.id}`, {
    method:'PATCH',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ action:'void', reason:'double void' }),
  });
  ok(`T7 re-void → 409  (got ${r7.status})`, r7.status === 409);

  // T6c: can now re-issue using inv1 again (gap allowed)
  const reissue = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST',
    headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ customerName: 'Re-issued', coveredInvoiceIds: [inv1.id, inv2.id, inv3.id] }),
  });
  const dR = await reissue.json();
  ok(`T6c re-issue after void → 201  (got ${reissue.status})`, reissue.status === 201);
  ok(`T6c new number differs  (old=${ti.number} new=${dR?.taxInvoice?.number})`, dR?.taxInvoice?.number && dR.taxInvoice.number !== ti.number);

  // ──────────────────────────────────────────────────────────────
  // T8: concurrent creation — 10 parallel, each with its own guest+invoice
  info('T8: preparing 10 guest+invoice fixtures for concurrency...');
  const pairs = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    const g = await makeGuest(`T8-${i}`);
    const inv = await makeInvoice(g.id, 100 + i);
    return inv.id;
  }));
  const concurrentReqs = pairs.map((invId, i) =>
    fetch(`${BASE}/api/tax-invoices`, {
      method:'POST',
      headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
      body: JSON.stringify({ customerName: `Concurrent ${i}`, coveredInvoiceIds: [invId] }),
    }).then(async (r) => ({ status: r.status, body: await r.json() })),
  );
  const results = await Promise.all(concurrentReqs);
  const successes = results.filter((r) => r.status === 201);
  ok(`T8 all 10 created → 201  (got ${successes.length})`, successes.length === 10);
  const numbers = successes.map((r) => r.body.taxInvoice.number);
  const uniqueNumbers = new Set(numbers);
  ok(`T8 all numbers unique  (${uniqueNumbers.size}/10)`, uniqueNumbers.size === 10);

  // ──────────────────────────────────────────────────────────────
  // T9: Zod validation
  const z1 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST', headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ customerName: '', coveredInvoiceIds: [] }),
  });
  ok(`T9a empty → 422  (got ${z1.status})`, z1.status === 422);
  const z2 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST', headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ customerName: 'X', coveredInvoiceIds: ['not-a-uuid'] }),
  });
  ok(`T9b bad uuid → 422  (got ${z2.status})`, z2.status === 422);
  const z3 = await fetch(`${BASE}/api/tax-invoices`, {
    method:'POST', headers:{'Content-Type':'application/json', Cookie:cookieHeader()},
    body: JSON.stringify({ customerName: 'X', customerTaxId: '123', coveredInvoiceIds: [pairs[0]] }),
  });
  ok(`T9c bad taxId → 422  (got ${z3.status})`, z3.status === 422);

  // ──────────────────────────────────────────────────────────────
  // T10: builder helper excludes already-covered invoices
  // guest g1 had inv1/inv2/inv3 — they're now covered by `reissue` (ISSUED)
  const t10 = await fetch(`${BASE}/api/tax-invoices?guestId=${g1.id}`, { headers:{Cookie:cookieHeader()} });
  const d10 = await t10.json();
  ok(`T10 builder helper → 200`, t10.status === 200);
  const returnedIds = new Set((d10?.invoices ?? []).map((i) => i.id));
  const noCoveredReturned = ![inv1.id, inv2.id, inv3.id].some((id) => returnedIds.has(id));
  ok(`T10 covered invoices excluded`, noCoveredReturned);

  // ──────────────────────────────────────────────────────────────
  console.log(`\n${passed+failed} tests — ${G}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
  if (failed) { console.log(`\n${R}Failures:${X}`); fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
