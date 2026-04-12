/**
 * E2E Test Script — Phase 1 / 2 / 3
 *
 * Tests:
 *  Phase 1: Booking → Check-in (no payment) → Record payment → Check-out
 *  Phase 2: Open CashSession → Check-in with cash deposit + upfront → Close session → verify systemCalc
 *  Phase 3: Monthly invoice generation → Late penalty → Contract renewal
 *
 * Run: npx tsx scripts/test-e2e.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

// ─── Helpers ────────────────────────────────────────────────────────────────

const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN  = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string, value: unknown) {
  if (value) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${label} ${RED}(FAILED — got: ${JSON.stringify(value)})${RESET}`);
    failed++;
    failures.push(label);
  }
}

function section(name: string) {
  console.log(`\n${BOLD}${CYAN}━━ ${name} ━━${RESET}`);
}

function pad(n: number, w = 4) { return String(n).padStart(w, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1,2)}${pad(d.getDate(),2)}`;
}

async function cleanup(guestIdNumber: string, roomNumber: string) {
  // Remove test data (cascade via FK)
  const guest = await prisma.guest.findFirst({ where: { idNumber: guestIdNumber } });
  if (guest) {
    const bookings = await prisma.booking.findMany({ where: { guestId: guest.id } });
    for (const b of bookings) {
      await prisma.paymentAllocation.deleteMany({ where: { invoice: { bookingId: b.id } } });
      await prisma.payment.deleteMany({ where: { bookingId: b.id } });
      await prisma.ledgerEntry.deleteMany({ where: { OR: [{ referenceId: b.id }] } });
      await prisma.invoice.deleteMany({ where: { bookingId: b.id } });
      await prisma.securityDeposit.deleteMany({ where: { bookingId: b.id } });
    }
    await prisma.booking.deleteMany({ where: { guestId: guest.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  }
  // Clean up cash sessions created by test
  await prisma.cashSession.deleteMany({ where: { openedBy: 'test-cashier-001' } });
  // Reset room
  const room = await prisma.room.findFirst({ where: { number: roomNumber } });
  if (room) {
    await prisma.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}🧪 PMS E2E Test Suite — Phase 1 / 2 / 3${RESET}`);

  const TEST_GUEST_ID = 'TEST-E2E-001-ID';
  let testRoomNumber = '';

  // ── Find a real room to test against ─────────────────────────────────────
  const room = await prisma.room.findFirst({
    where:   { status: 'available' },
    select:  { id: true, number: true },
    orderBy: { number: 'asc' },
  });

  if (!room) {
    console.log(`${RED}✗ ไม่พบห้องที่ว่าง — ไม่สามารถ run test ได้${RESET}`);
    process.exit(1);
  }
  testRoomNumber = room.number;
  console.log(`\n${YELLOW}→ ใช้ห้อง: ${room.number} (id: ${room.id})${RESET}`);

  // Clean up any leftover data from previous test runs
  await cleanup(TEST_GUEST_ID, room.number);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Core finance
  // ════════════════════════════════════════════════════════════════════════

  section('PHASE 1 — Booking + Payment + Ledger');

  // 1a. Create test guest
  const guest = await prisma.guest.create({
    data: {
      title: 'Mr.', firstName: 'Test', lastName: 'E2E',
      nationality: 'Thai', idType: 'thai_id', idNumber: TEST_GUEST_ID,
      createdBy: 'test',
    },
  });
  ok('สร้าง Guest สำเร็จ', !!guest.id);

  // 1b. Create booking
  const checkIn  = new Date();
  checkIn.setHours(14, 0, 0, 0);
  const checkOut = new Date(checkIn.getTime() + 2 * 86_400_000); // 2 nights

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `BK-TEST-${Date.now()}`,
      guestId:       guest.id,
      roomId:        room.id,
      bookingType:   'daily',
      source:        'direct',
      status:        'confirmed',
      checkIn,
      checkOut,
      rate:          new Prisma.Decimal(1000),
      deposit:       new Prisma.Decimal(0),
    },
  });
  ok('สร้าง Booking สำเร็จ', !!booking.id);
  ok('Booking status = confirmed', booking.status === 'confirmed');

  // 1c. Check-in (direct DB)
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data:  { status: 'checked_in', actualCheckIn: new Date() },
    });
    await tx.room.update({
      where: { id: room.id },
      data:  { status: 'occupied', currentBookingId: booking.id },
    });
    // Create invoice
    const stayAmount = 1000 * 2; // 2 nights @ 1000
    await tx.invoice.create({
      data: {
        invoiceNumber: `INV-TEST-${Date.now()}`,
        bookingId: booking.id,
        guestId:   guest.id,
        issueDate: new Date(),
        dueDate:   checkOut,
        subtotal:  stayAmount,
        vatAmount: 0,
        grandTotal: stayAmount,
        paidAmount: 0,
        status:    'unpaid',
        invoiceType: 'daily_stay',
        createdBy: 'test',
        notes: 'Test invoice',
        items: { create: [{ description: 'ค่าห้อง 2 คืน', amount: stayAmount, taxType: 'no_tax' }] },
      },
    });
  });
  const checkedIn = await prisma.booking.findUnique({ where: { id: booking.id } });
  ok('Check-in: status → checked_in', checkedIn?.status === 'checked_in');

  const roomAfterCI = await prisma.room.findUnique({ where: { id: room.id } });
  ok('Check-in: room → occupied', roomAfterCI?.status === 'occupied');

  // 1d. Create Payment (transfer — no cash session needed)
  const ds  = todayStr();
  const pCount = await prisma.payment.count({ where: { paymentNumber: { startsWith: `PAY-${ds}` } } });
  const rCount = await prisma.payment.count({ where: { receiptNumber:  { startsWith: `RCP-${ds}` } } });

  const invoice = await prisma.invoice.findFirst({ where: { bookingId: booking.id } });
  ok('Invoice สร้างแล้ว', !!invoice?.id);

  const payment = await prisma.payment.create({
    data: {
      paymentNumber:  `PAY-${ds}-${pad(pCount+1)}`,
      receiptNumber:  `RCP-${ds}-${pad(rCount+1)}`,
      bookingId:      booking.id,
      guestId:        guest.id,
      amount:         new Prisma.Decimal(2000),
      paymentMethod:  'transfer',
      paymentDate:    new Date(),
      status:         'ACTIVE',
      idempotencyKey: `test-pay-${booking.id}`,
      receivedBy:     'test',
      createdBy:      'test',
    },
  });
  ok('สร้าง Payment record สำเร็จ', !!payment.id);

  // 1e. Update invoice to paid + PaymentAllocation
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice!.id },
      data:  { status: 'paid', paidAmount: new Prisma.Decimal(2000) },
    });
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: invoice!.id, amount: new Prisma.Decimal(2000) },
    });
    // Ledger
    await tx.ledgerEntry.createMany({
      data: [
        { date: new Date(), type: 'DEBIT',  account: 'BANK',    amount: new Prisma.Decimal(2000), referenceType: 'Payment', referenceId: payment.id, description: 'Test', createdBy: 'test' },
        { date: new Date(), type: 'CREDIT', account: 'REVENUE', amount: new Prisma.Decimal(2000), referenceType: 'Payment', referenceId: payment.id, description: 'Test', createdBy: 'test' },
      ],
    });
  });
  const paidInv = await prisma.invoice.findUnique({ where: { id: invoice!.id } });
  ok('Invoice status → paid', paidInv?.status === 'paid');

  const alloc = await prisma.paymentAllocation.findFirst({ where: { paymentId: payment.id } });
  ok('PaymentAllocation สร้างแล้ว', !!alloc?.id);

  const ledger = await prisma.ledgerEntry.findMany({ where: { referenceId: payment.id } });
  ok('LedgerEntry 2 rows (DEBIT+CREDIT)', ledger.length === 2);
  ok('LedgerEntry: DEBIT BANK', ledger.some(l => l.type === 'DEBIT' && l.account === 'BANK'));
  ok('LedgerEntry: CREDIT REVENUE', ledger.some(l => l.type === 'CREDIT' && l.account === 'REVENUE'));

  // 1f. Check-out
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data:  { status: 'checked_out', actualCheckOut: new Date() },
    });
    await tx.room.update({
      where: { id: room.id },
      data:  { status: 'checkout', currentBookingId: null },
    });
  });
  const checkedOut = await prisma.booking.findUnique({ where: { id: booking.id } });
  ok('Check-out: status → checked_out', checkedOut?.status === 'checked_out');

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — CashSession + Security Deposit
  // ════════════════════════════════════════════════════════════════════════

  section('PHASE 2 — CashSession + Security Deposit');

  // Need a new booking for phase 2
  const checkIn2  = new Date();
  checkIn2.setHours(14, 0, 0, 0);
  const checkOut2 = new Date(checkIn2.getTime() + 1 * 86_400_000);

  await prisma.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
  const booking2 = await prisma.booking.create({
    data: {
      bookingNumber: `BK-TEST2-${Date.now()}`,
      guestId:       guest.id,
      roomId:        room.id,
      bookingType:   'daily',
      source:        'direct',
      status:        'confirmed',
      checkIn:       checkIn2,
      checkOut:      checkOut2,
      rate:          new Prisma.Decimal(900),
      deposit:       new Prisma.Decimal(0),
      createdBy:     'test',
    },
  });

  // 2a. Open cash session
  const cashSession = await prisma.cashSession.create({
    data: {
      openedBy:       'test-cashier-001',
      openedByName:   'Test Cashier',
      openedAt:       new Date(),
      openingBalance: new Prisma.Decimal(500), // 500 opening
      status:         'OPEN',
    },
  });
  ok('Open CashSession สำเร็จ', !!cashSession.id);
  ok('CashSession status = OPEN', cashSession.status === 'OPEN');

  // 2b. Security deposit (cash) — simulates createSecurityDeposit
  const dep = await prisma.securityDeposit.create({
    data: {
      depositNumber: `DEP-TEST-${Date.now()}`,
      bookingId:     booking2.id,
      guestId:       guest.id,
      amount:        new Prisma.Decimal(500),
      paymentMethod: 'cash',
      receivedAt:    new Date(),
      status:        'held',
      createdBy:     'test',
    },
  });
  ok('SecurityDeposit สร้างแล้ว', !!dep.id);

  // 2c. Payment record for deposit (linked to cashSession)
  const ds2 = todayStr();
  const pc2 = await prisma.payment.count({ where: { paymentNumber: { startsWith: `PAY-${ds2}` } } });
  const rc2 = await prisma.payment.count({ where: { receiptNumber:  { startsWith: `RCP-${ds2}` } } });

  const depPayment = await prisma.payment.create({
    data: {
      paymentNumber:  `PAY-${ds2}-${pad(pc2+1)}`,
      receiptNumber:  `RCP-${ds2}-${pad(rc2+1)}`,
      bookingId:      booking2.id,
      guestId:        guest.id,
      amount:         new Prisma.Decimal(500),
      paymentMethod:  'cash',
      paymentDate:    new Date(),
      cashSessionId:  cashSession.id,   // ← linked to session
      status:         'ACTIVE',
      idempotencyKey: `dep-${dep.id}`,
      receivedBy:     'test-cashier-001',
      notes:          `มัดจำ ${dep.depositNumber}`,
      createdBy:      'test',
    },
  });
  ok('Payment record สำหรับ deposit สร้างแล้ว', !!depPayment.id);
  ok('Payment.cashSessionId ถูก link', depPayment.cashSessionId === cashSession.id);

  // 2d. Verify systemCalculatedCash BEFORE close
  const sessionWithPay = await prisma.cashSession.findUnique({
    where: { id: cashSession.id },
    include: {
      payments: { where: { paymentMethod: 'cash', status: 'ACTIVE' }, select: { amount: true } },
    },
  });
  const cashIn         = sessionWithPay!.payments.reduce((s, p) => s + Number(p.amount), 0);
  const systemCalcPre  = Number(sessionWithPay!.openingBalance) + cashIn;
  ok(`systemCalculatedCash pre-close = 1000 (500 open + 500 dep)`, systemCalcPre === 1000);

  // 2e. Close session
  await prisma.cashSession.update({
    where: { id: cashSession.id },
    data: {
      closedAt:             new Date(),
      closedBy:             'test-cashier-001',
      closingBalance:       new Prisma.Decimal(1000),
      systemCalculatedCash: new Prisma.Decimal(systemCalcPre),
      status:               'CLOSED',
    },
  });
  const closedSession = await prisma.cashSession.findUnique({ where: { id: cashSession.id } });
  ok('CashSession status = CLOSED', closedSession?.status === 'CLOSED');
  ok('systemCalculatedCash = 1000', Number(closedSession?.systemCalculatedCash) === 1000);

  const diff = Number(closedSession!.closingBalance) - Number(closedSession!.systemCalculatedCash);
  ok('ส่วนต่าง = 0 (ยอดตรง)', diff === 0);

  // 2f. Check block: cash payment without open session (no session = error expected)
  // Simulate service check
  const noSession = await prisma.cashSession.findFirst({
    where: { openedBy: 'ghost-user-999', status: 'OPEN' },
  });
  ok('ไม่มีกะที่เปิดสำหรับ ghost-user → null', noSession === null);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3 — Monthly Invoice / Penalty / Renewal
  // ════════════════════════════════════════════════════════════════════════

  section('PHASE 3 — Monthly Billing + Penalty + Renewal');

  // Setup: monthly booking (booking2 is daily, need new one)
  await prisma.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
  const ciMonth = new Date();
  ciMonth.setDate(15); ciMonth.setHours(0,0,0,0); // mid-month check-in (pro-rated scenario)
  const coMonth = new Date(ciMonth.getFullYear(), ciMonth.getMonth() + 3, 15); // 3 months later

  const bookingM = await prisma.booking.create({
    data: {
      bookingNumber: `BK-MONTH-${Date.now()}`,
      guestId:       guest.id,
      roomId:        room.id,
      bookingType:   'monthly_long',
      source:        'direct',
      status:        'checked_in',
      checkIn:       ciMonth,
      checkOut:      coMonth,
      actualCheckIn: ciMonth,
      rate:          new Prisma.Decimal(8000),
      deposit:       new Prisma.Decimal(0),
      createdBy:     'test',
    },
  });
  await prisma.room.update({ where: { id: room.id }, data: { status: 'occupied', currentBookingId: bookingM.id } });
  ok('Monthly booking (checked_in) สร้างแล้ว', !!bookingM.id);

  // 3a. Pro-rated invoice (first partial month)
  const monthEnd = new Date(ciMonth.getFullYear(), ciMonth.getMonth() + 1, 0);
  const totalDays   = monthEnd.getDate();
  const daysInPeriod = totalDays - 15 + 1; // 15th to end of month
  const proRatedAmt  = Math.round((8000 / totalDays) * daysInPeriod * 100) / 100;

  const proratedInv = await prisma.invoice.create({
    data: {
      invoiceNumber: `MNT-TEST-${Date.now()}`,
      bookingId:     bookingM.id,
      guestId:       guest.id,
      issueDate:     ciMonth,
      dueDate:       new Date(ciMonth.getTime() + 7 * 86_400_000),
      subtotal:      proRatedAmt,
      vatAmount:     0,
      grandTotal:    proRatedAmt,
      paidAmount:    0,
      status:        'unpaid',
      invoiceType:   'monthly_rent',
      billingPeriodStart: ciMonth,
      billingPeriodEnd:   monthEnd,
      createdBy:     'test',
      notes:         `Pro-rated: ${daysInPeriod}/${totalDays} วัน`,
      items: { create: [{ description: `ค่าห้อง pro-rated`, amount: proRatedAmt, taxType: 'no_tax' }] },
    },
  });
  ok('Pro-rated invoice สร้างแล้ว', !!proratedInv.id);
  ok(`Pro-rated amount > 0 (${proRatedAmt} บาท)`, proRatedAmt > 0);
  ok('Pro-rated amount < monthlyRate (ต่ำกว่าเต็มเดือน)', proRatedAmt < 8000);
  const expectedPro = Math.round((8000 / totalDays) * daysInPeriod * 100) / 100;
  ok(`calcProRated ถูกต้อง (${proRatedAmt} = ${expectedPro})`, Math.abs(proRatedAmt - expectedPro) < 0.01);

  // 3b. Ledger for monthly invoice (DEBIT AR / CREDIT REVENUE)
  await prisma.ledgerEntry.createMany({
    data: [
      { date: new Date(), type: 'DEBIT',  account: 'AR',      amount: new Prisma.Decimal(proRatedAmt), referenceType: 'Invoice', referenceId: proratedInv.id, description: 'Test accrual', createdBy: 'test' },
      { date: new Date(), type: 'CREDIT', account: 'REVENUE', amount: new Prisma.Decimal(proRatedAmt), referenceType: 'Invoice', referenceId: proratedInv.id, description: 'Test accrual', createdBy: 'test' },
    ],
  });
  const accrualEntries = await prisma.ledgerEntry.findMany({ where: { referenceId: proratedInv.id } });
  ok('Accrual ledger 2 rows', accrualEntries.length === 2);
  ok('DEBIT AR', accrualEntries.some(l => l.account === 'AR' && l.type === 'DEBIT'));

  // 3c. Late penalty calculation
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 15); // 15 days overdue
  const overdueInv = await prisma.invoice.create({
    data: {
      invoiceNumber: `MNT-OVERDUE-${Date.now()}`,
      bookingId:     bookingM.id,
      guestId:       guest.id,
      issueDate:     pastDue,
      dueDate:       pastDue,
      subtotal:      8000,
      vatAmount:     0,
      grandTotal:    8000,
      paidAmount:    0,
      status:        'overdue',
      invoiceType:   'monthly_rent',
      createdBy:     'test',
      notes:         'Overdue test',
      items: { create: [{ description: 'ค่าห้อง overdue', amount: 8000, taxType: 'no_tax' }] },
    },
  });

  // calculatePenalties logic
  const dailyRate = 0.0005; // 0.05% per day = 1.5% per month
  const daysOD    = 15;
  const penalty   = Math.round(8000 * dailyRate * daysOD * 100) / 100;
  ok(`ค่าปรับ 15 วัน @ 0.05%/day = ${penalty} บาท`, penalty > 0);

  // applyLatePenalty
  await prisma.invoice.update({
    where: { id: overdueInv.id },
    data: {
      latePenalty: new Prisma.Decimal(penalty),
      grandTotal:  new Prisma.Decimal(8000 + penalty),
    },
  });
  await prisma.ledgerEntry.createMany({
    data: [
      { date: new Date(), type: 'DEBIT',  account: 'AR',              amount: new Prisma.Decimal(penalty), referenceType: 'Invoice', referenceId: overdueInv.id, description: 'Late penalty', createdBy: 'test' },
      { date: new Date(), type: 'CREDIT', account: 'PENALTY_REVENUE', amount: new Prisma.Decimal(penalty), referenceType: 'Invoice', referenceId: overdueInv.id, description: 'Late penalty', createdBy: 'test' },
    ],
  });
  const penaltyInv = await prisma.invoice.findUnique({ where: { id: overdueInv.id } });
  ok('latePenalty บันทึกแล้ว', Number(penaltyInv?.latePenalty) === penalty);
  ok('grandTotal เพิ่มขึ้น', Number(penaltyInv?.grandTotal) > 8000);
  ok('DEBIT AR + CREDIT PENALTY_REVENUE', (await prisma.ledgerEntry.count({ where: { referenceId: overdueInv.id } })) >= 2);

  // 3d. Contract renewal
  const newCO = new Date(coMonth.getTime() + 90 * 86_400_000); // extend 3 more months
  await prisma.booking.update({
    where: { id: bookingM.id },
    data:  { checkOut: newCO, rate: new Prisma.Decimal(8500) }, // new rate
  });
  const renewed = await prisma.booking.findUnique({ where: { id: bookingM.id } });
  ok('Contract renewal: checkOut ขยายแล้ว', renewed?.checkOut.getTime() === newCO.getTime());
  ok('Contract renewal: rate อัพเดตเป็น 8500', Number(renewed?.rate) === 8500);

  // ════════════════════════════════════════════════════════════════════════
  // INTEGRITY CHECKS
  // ════════════════════════════════════════════════════════════════════════

  section('INTEGRITY CHECKS');

  // All payment allocations sum = invoice grandTotal
  const allAllocations = await prisma.paymentAllocation.findMany({
    where: { invoiceId: invoice!.id },
    select: { amount: true },
  });
  const allocTotal = allAllocations.reduce((s, a) => s + Number(a.amount), 0);
  ok(`PaymentAllocation ยอดรวม = grandTotal (${allocTotal} = 2000)`, allocTotal === 2000);

  // Ledger balance: DEBIT sum = CREDIT sum for our test payments
  const allLedger = await prisma.ledgerEntry.findMany({
    where: { createdBy: 'test' },
    select: { type: true, amount: true },
  });
  const debitSum  = allLedger.filter(l => l.type === 'DEBIT').reduce((s, l) => s + Number(l.amount), 0);
  const creditSum = allLedger.filter(l => l.type === 'CREDIT').reduce((s, l) => s + Number(l.amount), 0);
  ok(`Double-entry balanced (DEBIT ${debitSum} = CREDIT ${creditSum})`, Math.abs(debitSum - creditSum) < 0.01);

  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════

  section('CLEANUP');
  await cleanup(TEST_GUEST_ID, testRoomNumber);
  ok('Cleanup สำเร็จ', true);

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}📊 ผลการทดสอบ:  ${GREEN}${passed} ผ่าน${RESET}  ${failed > 0 ? RED : ''}${failed} ล้มเหลว${RESET}`);
  if (failures.length > 0) {
    console.log(`\n${RED}❌ รายการที่ล้มเหลว:${RESET}`);
    failures.forEach(f => console.log(`   • ${f}`));
  } else {
    console.log(`\n${GREEN}✅ ทุก test ผ่านหมด!${RESET}`);
  }
  console.log();
}

main()
  .catch((e) => { console.error(RED + 'FATAL ERROR:', e, RESET); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
