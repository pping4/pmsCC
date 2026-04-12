/**
 * PMS E2E HTTP Test — Phase 1 / 2 / 3
 *
 * Tests the running Next.js server via actual HTTP calls.
 * No Prisma binary required — works on any OS.
 *
 * Prerequisites:
 *   1. Next.js dev server running:  npm run dev
 *   2. An admin user exists (default: admin@hotel.com / admin123)
 *   3. At least 1 available room in the database
 *
 * Run:
 *   node scripts/test-http.mjs
 *   node scripts/test-http.mjs --base http://localhost:3000 --email admin@hotel.com --pass admin123
 */

const args = process.argv.slice(2);
const arg  = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const BASE  = arg('--base')  || 'http://localhost:3000';
const EMAIL = arg('--email') || 'admin@hotel.com';
const PASS  = arg('--pass')  || 'admin123';

// ─── Colors ───────────────────────────────────────────────────────────────────
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m';
const X = '\x1b[0m',  B = '\x1b[1m';

let passed = 0, failed = 0;
const failures = [];

function ok(label, val) {
  if (val) { console.log(`  ${G}✓${X} ${label}`); passed++; }
  else      { console.log(`  ${R}✗${X} ${label}`); failed++; failures.push(label); }
}
function section(n) { console.log(`\n${B}${C}━━ ${n} ━━${X}`); }
function info(m)    { console.log(`  ${Y}ℹ${X}  ${m}`); }
function warn(m)    { console.log(`  ${R}⚠${X}  ${m}`); }

// ─── UUID helper ──────────────────────────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function addDays(d, n) { return new Date(d.getTime() + n * 86_400_000); }
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── Fetch helper (maintains session cookies) ─────────────────────────────────
let cookies = {};

async function api(method, path, body) {
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookieStr ? { Cookie: cookieStr } : {}) },
    redirect: 'manual',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try { res = await fetch(`${BASE}${path}`, opts); }
  catch (e) { return { status: 0, data: { error: e.message } }; }

  // Merge Set-Cookie
  const sc = res.headers.get('set-cookie');
  if (sc) {
    sc.split(',').forEach(c => {
      const [pair] = c.trim().split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

// ─── NextAuth sign-in ─────────────────────────────────────────────────────────
async function signIn() {
  const r1 = await api('GET', '/api/auth/csrf');
  const csrfToken = r1.data?.csrfToken;
  if (!csrfToken) return null;

  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieStr },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASS, redirect: 'false', json: 'true' }),
    redirect: 'manual',
  });
  const sc = r2.headers.get('set-cookie');
  if (sc) {
    sc.split(',').forEach(c => {
      const [pair] = c.trim().split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
  }

  const r3 = await api('GET', '/api/auth/session');
  return r3.data?.user ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${B}🧪 PMS E2E HTTP Test — Phase 1 / 2 / 3${X}`);
  console.log(`   URL   : ${BASE}`);
  console.log(`   Login : ${EMAIL}\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  section('AUTH');
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await signIn();
  ok('Sign-in สำเร็จ', !!user?.email);
  if (!user) {
    console.log(`\n${R}ไม่สามารถ sign-in ได้${X}`);
    console.log('  → server กำลัง run อยู่? (npm run dev)');
    console.log('  → email/password ถูกต้อง?');
    console.log(`  → ลอง: node scripts/test-http.mjs --email YOUR@EMAIL --pass YOURPASS`);
    process.exit(1);
  }
  info(`Logged in as: ${user.email} | role: ${user.role} | id: ${user.id}`);

  const userId   = user.id;
  const userName = user.name ?? user.email;

  // ─────────────────────────────────────────────────────────────────────────────
  section('SETUP — Find Available Room');
  // ─────────────────────────────────────────────────────────────────────────────
  const roomsRes = await api('GET', '/api/rooms?status=available');
  ok('GET /api/rooms → 200', roomsRes.status === 200);

  // Rooms API returns an enriched array directly (not wrapped)
  const allRooms = Array.isArray(roomsRes.data) ? roomsRes.data : [];
  const testRoom = allRooms[0] ?? null;
  ok('มีห้องว่างอย่างน้อย 1 ห้อง', !!testRoom);
  if (!testRoom) {
    warn('ไม่พบห้องว่าง — เช็คเอาท์ booking ที่ค้างอยู่หรือเพิ่มห้องในระบบก่อน');
    process.exit(1);
  }
  info(`Test room: ${testRoom.number} (id: ${testRoom.id})`);

  // ─────────────────────────────────────────────────────────────────────────────
  section('SETUP — Create Test Guest');
  // ─────────────────────────────────────────────────────────────────────────────
  const ts = Date.now();
  const guestRes = await api('POST', '/api/guests', {
    title: 'Mr.', firstName: 'E2E', lastName: `Test-${ts}`,
    nationality: 'Thai', idType: 'thai_id',
    idNumber: `TEST-E2E-${ts}`,
  });
  ok('POST /api/guests → 200/201', guestRes.status === 200 || guestRes.status === 201);

  // Guests API returns { guest } or the object directly
  const testGuest = guestRes.data?.guest ?? guestRes.data;
  ok('Guest มี id', !!testGuest?.id);
  if (!testGuest?.id) {
    warn(`สร้าง Guest ล้มเหลว: ${JSON.stringify(guestRes.data)}`);
    process.exit(1);
  }
  info(`Guest: ${testGuest.firstName} ${testGuest.lastName} (id: ${testGuest.id})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Daily Booking → Check-in (no payment) → Transfer Payment → Check-out
  // ═══════════════════════════════════════════════════════════════════════════
  section('PHASE 1 — Daily Booking + Check-in + Payment + Check-out');

  const today = new Date();

  // Booking API uses YYYY-MM-DD strings (appends T00:00:00.000Z internally)
  const p1CheckIn  = ymd(today);
  const p1CheckOut = ymd(addDays(today, 2));       // 2 nights @ ฿1,000 = ฿2,000

  // 1a. Create booking
  const b1Res = await api('POST', '/api/bookings', {
    guestId:     testGuest.id,
    roomNumber:  testRoom.number,       // ← must be roomNumber (not roomId)
    bookingType: 'daily',
    source:      'direct',
    checkIn:     p1CheckIn,
    checkOut:    p1CheckOut,
    rate:        1000,
    deposit:     0,
  });
  ok('POST /api/bookings → 200/201', b1Res.status === 200 || b1Res.status === 201);

  // Bookings API returns the booking object directly
  const booking1 = b1Res.data?.booking ?? b1Res.data;
  const b1Id = booking1?.id;
  ok('Booking status = confirmed', booking1?.status === 'confirmed');
  if (!b1Id) warn(`Booking1 ล้มเหลว: ${JSON.stringify(b1Res.data)}`);
  else       info(`Booking1: ${b1Id}`);

  // 1b. GET booking to verify
  if (b1Id) {
    const bGet = await api('GET', `/api/bookings/${b1Id}`);
    ok('GET /api/bookings/:id → 200', bGet.status === 200);
    // GET /api/bookings/:id returns the booking object directly (no wrapper)
    ok('Booking.guestId ถูกต้อง', bGet.data?.guestId === testGuest.id);
  }

  // 1c. Check-in without upfront payment
  let inv1Id = null;
  if (b1Id) {
    const ci1 = await api('POST', '/api/checkin', {
      bookingId:      b1Id,
      collectUpfront: false,
    });
    ok('POST /api/checkin → 200', ci1.status === 200);
    ok('checkin: booking.status = checked_in', ci1.data?.booking?.status === 'checked_in');
    inv1Id = ci1.data?.stayInvoiceId;
    ok('checkin: สร้าง stay invoice', !!inv1Id);
    info(`Invoice1: ${inv1Id}`);

    if (ci1.status !== 200) warn(`CI1 error: ${JSON.stringify(ci1.data)}`);
  }

  // 1d. Record transfer payment
  if (inv1Id && b1Id) {
    const payRes = await api('POST', '/api/payments', {
      idempotencyKey: uuid(),          // ← required UUID
      guestId:        testGuest.id,
      bookingId:      b1Id,
      amount:         2000,
      paymentMethod:  'transfer',
      allocations:    [{ invoiceId: inv1Id, amount: 2000 }],  // ← required, not invoiceIds
    });
    ok('POST /api/payments (transfer) → 200/201', payRes.status === 200 || payRes.status === 201);
    // Response: { success, paymentId, paymentNumber, receiptNumber, amount }
    ok('Payment มี paymentId', !!payRes.data?.paymentId);
    info(`Payment: ${payRes.data?.paymentNumber} | Receipt: ${payRes.data?.receiptNumber}`);

    if (payRes.status !== 200 && payRes.status !== 201) {
      warn(`Payment error: ${JSON.stringify(payRes.data)}`);
    }

    // Verify invoice is now paid (GET /api/invoices/:id returns the invoice directly, no wrapper)
    const invGet = await api('GET', `/api/invoices/${inv1Id}`);
    if (invGet.status === 200) {
      const inv = invGet.data;  // direct object, not {invoice: {...}}
      ok('Invoice.status = paid', inv?.status === 'paid');
      ok('Invoice.paidAmount = 2000', Number(inv?.paidAmount) === 2000);
    } else {
      info(`GET /api/invoices/:id → ${invGet.status}`);
    }
  }

  // 1e. Check-out
  // Checkout response: { success: true, summary: { totalInvoiced, totalPaid, outstanding, ... } }
  if (b1Id) {
    const co1 = await api('POST', '/api/checkout', { bookingId: b1Id });
    ok('POST /api/checkout → 200', co1.status === 200);
    ok('Checkout success = true', co1.data?.success === true);
    info(`Checkout summary: invoiced=฿${co1.data?.summary?.totalInvoiced} paid=฿${co1.data?.summary?.totalPaid} outstanding=฿${co1.data?.summary?.outstanding}`);

    if (co1.data?.summary?.outstanding > 0) {
      warn(`⚠ มียอดค้างชำระ ฿${co1.data.summary.outstanding} — อาจต้องตรวจสอบ`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — CashSession + Cash Deposit + Cash Upfront
  // ═══════════════════════════════════════════════════════════════════════════
  section('PHASE 2 — CashSession + Security Deposit + Upfront Cash Payment');

  // 2a. Open cash session — ถ้ามีอยู่แล้วให้ใช้ session เดิม
  let cashSessionId = null;
  const openSess = await api('POST', '/api/cash-sessions', {
    openedBy:       userId,
    openedByName:   userName,
    openingBalance: 500,
  });

  if (openSess.status === 200 || openSess.status === 201) {
    cashSessionId = openSess.data?.sessionId;
    ok('POST /api/cash-sessions (open) → สร้างกะใหม่', !!cashSessionId);
    info(`CashSession ใหม่: ${cashSessionId}`);
  } else if (openSess.data?.error?.includes('เปิดอยู่แล้ว')) {
    // มีกะเปิดอยู่แล้ว — ใช้กะเดิม
    const curSessCheck = await api('GET', '/api/cash-sessions/current');
    cashSessionId = curSessCheck.data?.session?.id ?? null;
    ok('POST /api/cash-sessions → ใช้กะที่เปิดอยู่แล้ว', !!cashSessionId);
    info(`CashSession เดิม: ${cashSessionId}`);
  } else {
    ok('POST /api/cash-sessions → 200/201 หรือมีกะเปิดอยู่', false);
    warn(`Open session error: ${JSON.stringify(openSess.data)}`);
  }

  // 2b. Verify /current returns our session
  const curSess = await api('GET', '/api/cash-sessions/current');
  ok('GET /api/cash-sessions/current → 200', curSess.status === 200);
  ok('Current session = cashSessionId ที่ใช้', curSess.data?.session?.id === cashSessionId);

  // 2c. Create Phase 2 booking — reuse testRoom (overlap check only blocks confirmed/checked_in)
  //     Phase 1 booking is checked_out, so no overlap
  const p2CheckIn  = ymd(addDays(today, 3));
  const p2CheckOut = ymd(addDays(today, 4));   // 1 night @ ฿900

  const b2Res = await api('POST', '/api/bookings', {
    guestId:     testGuest.id,
    roomNumber:  testRoom.number,    // same room — OK since booking1 is checked_out
    bookingType: 'daily',
    source:      'direct',
    checkIn:     p2CheckIn,
    checkOut:    p2CheckOut,
    rate:        900,
    deposit:     0,
  });
  ok('POST /api/bookings (booking2) → 200/201', b2Res.status === 200 || b2Res.status === 201);
  const booking2 = b2Res.data?.booking ?? b2Res.data;
  const b2Id = booking2?.id;
  if (!b2Id) warn(`Booking2 ล้มเหลว: ${JSON.stringify(b2Res.data)}`);
  else       info(`Booking2: ${b2Id}`);

  // 2d. Check-in with cash deposit (฿500) + cash upfront (฿900)
  //     Both linked to cashSessionId so they count toward systemCalculatedCash
  let inv2Id = null, secDepId = null;
  if (b2Id && cashSessionId) {
    const ci2 = await api('POST', '/api/checkin', {
      bookingId:            b2Id,
      // Deposit
      depositAmount:        500,
      depositPaymentMethod: 'cash',
      depositCashSessionId: cashSessionId,   // links deposit payment to session
      // Upfront stay payment
      collectUpfront:       true,
      upfrontPaymentMethod: 'cash',
      cashSessionId,                          // links upfront payment to session
    });
    ok('POST /api/checkin (deposit + upfront) → 200', ci2.status === 200);
    ok('booking2 status = checked_in', ci2.data?.booking?.status === 'checked_in');
    inv2Id   = ci2.data?.stayInvoiceId;
    secDepId = ci2.data?.securityDepositId;
    ok('สร้าง stay invoice (booking2)', !!inv2Id);
    ok('สร้าง SecurityDeposit', !!secDepId);

    if (ci2.status !== 200) warn(`CI2 error: ${JSON.stringify(ci2.data)}`);
    else                    info(`Invoice2: ${inv2Id} | Deposit: ${secDepId}`);
  }

  // 2e. GET session detail — อ่าน openingBalance จริงก่อน แล้วค่อยคำนวณ expected
  let sessionOpeningBalance = 500; // default fallback
  if (cashSessionId) {
    const detRes = await api('GET', `/api/cash-sessions/${cashSessionId}`);
    ok('GET /api/cash-sessions/:id → 200', detRes.status === 200);
    const detail = detRes.data?.session;
    if (detail) {
      sessionOpeningBalance = Number(detail.openingBalance ?? 500);
      info(`Session openingBalance: ฿${sessionOpeningBalance}`);
      info(`Session breakdown: ${JSON.stringify(detail.breakdown ?? {})}`);
      info(`totalCollected: ฿${detail.totalCollected}`);

      // ตรวจว่าใน session มีเงิน cash จาก deposit(500) + upfront(900) = 1400 เพิ่มขึ้น
      const cashBreakdown = Number(detail.breakdown?.cash ?? 0);
      const newCashInSession = 500 + 900; // deposit + upfront ที่เพิ่งรับ
      // ใน session เดิมอาจมี cash จากก่อนหน้าด้วย ดังนั้นตรวจว่า >= 1400
      ok(
        `Cash breakdown มีอย่างน้อย มัดจำ500 + ห้อง900 = ฿${newCashInSession}`,
        cashBreakdown >= newCashInSession
      );
    }
  }

  // 2f. Close session — ใช้ openingBalance จริงในการคำนวณ expected
  //     systemCalculatedCash = openingBalance + SUM(cash payments in session)
  if (cashSessionId) {
    const detRes2 = await api('GET', `/api/cash-sessions/${cashSessionId}`);
    const detail2 = detRes2.data?.session;
    const cashInSession = Number(detail2?.breakdown?.cash ?? 0);
    const expectedCash = sessionOpeningBalance + cashInSession;

    const closeRes = await api('PUT', `/api/cash-sessions/${cashSessionId}`, {
      closedBy:       userId,
      closedByName:   userName,
      closingBalance: expectedCash,
      closingNote:    'E2E test - close',
    });
    ok('PUT /api/cash-sessions/:id (close) → 200', closeRes.status === 200);
    const sysCalc = closeRes.data?.systemCalculatedCash;
    info(`systemCalculatedCash = ฿${sysCalc} | openingBalance = ฿${sessionOpeningBalance} | cashInSession = ฿${cashInSession}`);
    info(`Expected = ฿${sessionOpeningBalance} + ฿${cashInSession} = ฿${expectedCash}`);

    ok(
      `systemCalculatedCash = openingBalance(฿${sessionOpeningBalance}) + cash(฿${cashInSession}) = ฿${expectedCash}`,
      Number(sysCalc) === expectedCash
    );

    if (closeRes.status !== 200) warn(`Close session error: ${JSON.stringify(closeRes.data)}`);
  }

  // 2g. Verify SecurityDeposit via GET
  if (secDepId) {
    const depRes = await api('GET', `/api/security-deposits/${secDepId}`);
    if (depRes.status === 200) {
      const dep = depRes.data?.deposit ?? depRes.data;
      ok('SecurityDeposit status = held', dep?.status === 'held');
      ok('SecurityDeposit amount = 500', Number(dep?.amount) === 500);
    } else {
      info(`GET /api/security-deposits/:id → ${depRes.status}`);
    }
  }

  // 2h. Checkout booking2
  if (b2Id) {
    const co2 = await api('POST', '/api/checkout', { bookingId: b2Id });
    ok('POST /api/checkout (booking2) → 200', co2.status === 200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — Monthly Billing
  // ═══════════════════════════════════════════════════════════════════════════
  section('PHASE 3 — Monthly Billing + Late Penalty');

  // 3a. Find any checked-in monthly booking (monthly_long or monthly_short)
  const mRes = await api('GET', '/api/bookings?type=monthly_long&status=checked_in&limit=1');
  ok('GET /api/bookings?type=monthly_long → ไม่ใช่ 500', mRes.status !== 500);

  // GET /api/bookings returns raw array
  const mArr = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.bookings ?? []);
  const mBooking = mArr[0] ?? null;

  if (mBooking) {
    info(`Monthly Booking: ${mBooking.id}`);

    // 3b. Get invoices filtered by bookingId (now supported)
    const invRes = await api('GET', `/api/invoices?bookingId=${mBooking.id}`);
    ok('GET /api/invoices?bookingId → 200', invRes.status === 200);

    // GET /api/invoices returns raw array
    const invArr = Array.isArray(invRes.data) ? invRes.data : [];
    info(`Invoices for booking: ${invArr.length} รายการ | types: ${invArr.map(i => i.invoiceType).join(', ') || 'ไม่มี'}`);

    // monthly_rent หรือ general (จาก route เก่า) ก็นับว่ามี invoice
    const mInv = invArr.find(i =>
      i.invoiceType === 'monthly_rent' ||
      i.invoiceType === 'daily_stay'   ||
      i.invoiceType === 'general'
    );
    ok('มี stay invoice สำหรับ booking นี้ (monthly_rent/daily_stay/general)', !!mInv);
    if (mInv) info(`Stay Invoice: ${mInv.id} | type: ${mInv.invoiceType} | status: ${mInv.status}`);
  } else {
    info(`${Y}ไม่พบ monthly_long booking ที่ checked_in${X}`);
    info('→ สร้าง monthly booking ด้วยมือแล้วรัน test อีกครั้งเพื่อทดสอบ Phase 3 ครบ');
  }

  // 3c. Billing collection (monthly invoices)
  const bilRes = await api('GET', '/api/billing/collection');
  ok('GET /api/billing/collection → ไม่ใช่ 500', bilRes.status !== 500);
  if (bilRes.status === 200) {
    info(`Billing collection OK: ${JSON.stringify(bilRes.data).slice(0, 120)}`);
  }

  // 3d. Late penalties (preview / dry-run)
  const penRes = await api('GET', '/api/billing/penalties');
  ok('GET /api/billing/penalties → ไม่ใช่ 500', penRes.status !== 500);
  if (penRes.status === 200) {
    const pens = penRes.data?.penalties ?? penRes.data ?? [];
    info(`Late penalties found: ${Array.isArray(pens) ? pens.length : JSON.stringify(pens).slice(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  section('DASHBOARD');

  const dash = await api('GET', '/api/dashboard');
  ok('GET /api/dashboard → 200', dash.status === 200);
  if (dash.status === 200) {
    // Response: { rooms:{total,occupied,...}, revenue:{thisMonth,pending,...}, guests:{...} }
    ok('dashboard มี rooms.occupied', dash.data?.rooms?.occupied !== undefined);
    ok('dashboard มี revenue.thisMonth', dash.data?.revenue?.thisMonth !== undefined);
    info(`Revenue this month: ฿${Number(dash.data?.revenue?.thisMonth ?? 0).toLocaleString()} | Occupied: ${dash.data?.rooms?.occupied}/${dash.data?.rooms?.total}`);
  } else {
    warn(`Dashboard ${dash.status}: ${JSON.stringify(dash.data)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  const line = '━'.repeat(50);
  console.log(`\n${B}${line}${X}`);
  console.log(`${B}  ผลการทดสอบ${X}`);
  console.log(`  ${G}✓ ผ่าน   : ${passed}${X}`);
  console.log(`  ${R}✗ ไม่ผ่าน: ${failed}${X}`);

  if (failures.length) {
    console.log(`\n${B}${R}  รายการที่ไม่ผ่าน:${X}`);
    failures.forEach((f, i) => console.log(`  ${R}${i + 1}. ${f}${X}`));
  }

  const verdict = failed === 0
    ? `${G}${B}🎉 ผ่านทุกรายการ!${X}`
    : `${R}${B}⚠️  มี ${failed} รายการไม่ผ่าน${X}`;
  console.log(`\n  ${verdict}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${R}✗ Test crash:${X}`, err);
  process.exit(2);
});
