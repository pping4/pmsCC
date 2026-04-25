import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Room Types
  const roomTypes = await Promise.all([
    prisma.roomType.upsert({
      where: { code: 'STD' },
      update: {},
      create: { code: 'STD', name: 'Standard', icon: '🛏️', baseDaily: 1200, baseMonthly: 18000 },
    }),
    prisma.roomType.upsert({
      where: { code: 'SUP' },
      update: {},
      create: { code: 'SUP', name: 'Superior', icon: '🛋️', baseDaily: 1800, baseMonthly: 25000 },
    }),
    prisma.roomType.upsert({
      where: { code: 'DLX' },
      update: {},
      create: { code: 'DLX', name: 'Deluxe', icon: '✨', baseDaily: 2500, baseMonthly: 35000 },
    }),
    prisma.roomType.upsert({
      where: { code: 'STE' },
      update: {},
      create: { code: 'STE', name: 'Suite', icon: '👑', baseDaily: 4000, baseMonthly: 55000 },
    }),
  ]);

  const [std, sup, dlx, ste] = roomTypes;

  // Generate 48 rooms (floors 2-7, 8 rooms each)
  const floors = [2, 3, 4, 5, 6, 7];
  for (const floor of floors) {
    for (let r = 1; r <= 8; r++) {
      const number = `${floor}0${r}`;
      const typeId = r <= 2 ? std.id : r <= 5 ? sup.id : r <= 7 ? dlx.id : ste.id;
      await prisma.room.upsert({
        where: { number },
        update: {},
        create: { number, floor, typeId, status: 'available' },
      });
    }
  }
  console.log('✅ 48 rooms created');

  // Room Rates (required for bookingRate.service.ts getDailyRate())
  const allRooms = await prisma.room.findMany({ include: { roomType: true } });
  for (const room of allRooms) {
    const base = Number(room.roomType.baseDaily);
    const baseMonthly = Number(room.roomType.baseMonthly);
    await prisma.roomRate.upsert({
      where: { roomId: room.id },
      update: {},
      create: {
        roomId: room.id,
        dailyEnabled: true,
        dailyRate: base,
        monthlyShortEnabled: true,
        monthlyShortRate: baseMonthly,
        monthlyShortFurniture: 500,
        monthlyShortMinMonths: 1,
        monthlyLongEnabled: true,
        monthlyLongRate: Math.round(baseMonthly * 0.85),
        monthlyLongFurniture: 500,
        monthlyLongMinMonths: 3,
        waterRate: 18,
        electricRate: 8,
      },
    });
  }
  console.log('✅ Room rates created');

  // Products
  const products = [
    { code: 'SRV-001', name: 'ค่าซักรีด', price: 200, taxType: 'included' as const, category: 'service' as const },
    { code: 'SRV-002', name: 'มินิบาร์', price: 150, taxType: 'excluded' as const, category: 'product' as const },
    { code: 'SRV-003', name: 'ค่าจอดรถ (เดือน)', price: 2000, taxType: 'included' as const, category: 'service' as const },
    { code: 'SRV-004', name: 'น้ำดื่ม (แพ็ค)', price: 60, taxType: 'no_tax' as const, category: 'product' as const },
    { code: 'SRV-005', name: 'ค่าทำความสะอาดพิเศษ', price: 500, taxType: 'included' as const, category: 'service' as const },
    { code: 'SRV-006', name: 'อินเทอร์เน็ตเพิ่มเติม', price: 800, taxType: 'included' as const, category: 'service' as const },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }
  console.log('✅ Products created');

  // Admin user
  const hashedPassword = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@pms.com' },
    update: {},
    create: {
      email: 'admin@pms.com',
      name: 'Admin User',
      password: hashedPassword,
      role: 'admin',
    },
  });
  await prisma.user.upsert({
    where: { email: 'staff@pms.com' },
    update: {},
    create: {
      email: 'staff@pms.com',
      name: 'Staff',
      password: await bcrypt.hash('staff123', 12),
      role: 'staff',
    },
  });
  console.log('✅ Users created: admin@pms.com / admin123');

  // Test Guests
  const guests = [
    {
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      firstNameTH: 'สมชาย',
      lastNameTH: 'ใจดี',
      gender: 'male' as const,
      nationality: 'Thai',
      idType: 'thai_id' as const,
      idNumber: '1234567890123',
      phone: '081-111-1111',
    },
    {
      firstName: 'สมหญิง',
      lastName: 'รักดี',
      firstNameTH: 'สมหญิง',
      lastNameTH: 'รักดี',
      gender: 'female' as const,
      nationality: 'Thai',
      idType: 'thai_id' as const,
      idNumber: '9876543210987',
      phone: '082-222-2222',
    },
    {
      firstName: 'John',
      lastName: 'Smith',
      gender: 'male' as const,
      nationality: 'British',
      idType: 'passport' as const,
      idNumber: 'AB123456',
      phone: '090-333-3333',
      tm30Reported: false,
    },
    {
      firstName: 'Marie',
      lastName: 'Dupont',
      gender: 'female' as const,
      nationality: 'French',
      idType: 'passport' as const,
      idNumber: 'FR789012',
      phone: '090-444-4444',
      tm30Reported: false,
    },
    {
      firstName: 'Tanaka',
      lastName: 'Yuki',
      gender: 'male' as const,
      nationality: 'Japanese',
      idType: 'passport' as const,
      idNumber: 'JP345678',
      phone: '090-555-5555',
      tm30Reported: false,
    },
    {
      firstName: 'Wang',
      lastName: 'Wei',
      gender: 'female' as const,
      nationality: 'Chinese',
      idType: 'passport' as const,
      idNumber: 'CN901234',
      phone: '090-666-6666',
      tm30Reported: false,
    },
    {
      firstName: 'ประยุทธ์',
      lastName: 'มั่นคง',
      firstNameTH: 'ประยุทธ์',
      lastNameTH: 'มั่นคง',
      gender: 'male' as const,
      nationality: 'Thai',
      idType: 'thai_id' as const,
      idNumber: '5555555555555',
      phone: '083-777-7777',
    },
    {
      firstName: 'Sarah',
      lastName: 'Johnson',
      gender: 'female' as const,
      nationality: 'American',
      idType: 'passport' as const,
      idNumber: 'US567890',
      phone: '090-888-8888',
      tm30Reported: false,
    },
  ];

  const guestRecords = [];
  for (const guest of guests) {
    // Check if guest exists by idNumber
    const existing = await prisma.guest.findFirst({
      where: { idNumber: guest.idNumber },
    });

    if (existing) {
      guestRecords.push(existing);
    } else {
      const record = await prisma.guest.create({
        data: {
          ...guest,
          title: 'Mr.',
        },
      });
      guestRecords.push(record);
    }
  }
  console.log(`✅ ${guestRecords.length} guests created`);

  // Get room records for bookings
  const rooms = await prisma.room.findMany();
  const room201 = rooms.find((r: any) => r.number === '201');
  const room202 = rooms.find((r: any) => r.number === '202');
  const room301 = rooms.find((r: any) => r.number === '301');
  const room302 = rooms.find((r: any) => r.number === '302');
  const room401 = rooms.find((r: any) => r.number === '401');
  const room501 = rooms.find((r: any) => r.number === '501');

  if (!room201 || !room202 || !room301 || !room302 || !room401 || !room501) {
    throw new Error('Required rooms not found');
  }

  // Date calculations — use explicit UTC dates to avoid timezone issues
  // Today is 2026-03-22 — hardcoded to ensure consistency
  const utcDate = (str: string) => new Date(str + 'T00:00:00.000Z');
  const addDays = (d: Date, n: number) => {
    const result = new Date(d);
    result.setUTCDate(result.getUTCDate() + n);
    return result;
  };
  const today = utcDate('2026-03-22');
  const tomorrow = addDays(today, 1);
  const twoDaysFromNow = addDays(today, 2);
  const threeDaysFromNow = addDays(today, 3);
  const thirtyDaysFromNow = addDays(today, 30);
  const twentyThreeDaysFromNow = addDays(today, 23);
  const yesterday = addDays(today, -1);
  const sevenDaysAgo = addDays(today, -7);

  // Bookings
  const bookingData = [
    {
      bookingNumber: 'BK-2026-0001',
      guestId: guestRecords[0].id, // สมชาย
      roomId: room201.id,
      bookingType: 'daily' as const,
      checkIn: today,
      checkOut: twoDaysFromNow,
      rate: 1200,
      status: 'confirmed' as const,
    },
    {
      bookingNumber: 'BK-2026-0002',
      guestId: guestRecords[2].id, // John Smith
      roomId: room301.id,
      bookingType: 'daily' as const,
      checkIn: today,
      checkOut: threeDaysFromNow,
      rate: 1800,
      status: 'confirmed' as const,
    },
    {
      bookingNumber: 'BK-2026-0003',
      guestId: guestRecords[3].id, // Marie Dupont
      roomId: room401.id,
      bookingType: 'monthly_long' as const,
      checkIn: today,
      checkOut: thirtyDaysFromNow,
      rate: 25000,
      status: 'confirmed' as const,
    },
    {
      bookingNumber: 'BK-2026-0004',
      guestId: guestRecords[1].id, // สมหญิง
      roomId: room202.id,
      bookingType: 'daily' as const,
      checkIn: yesterday,
      checkOut: tomorrow,
      rate: 1200,
      status: 'checked_in' as const,
      actualCheckIn: yesterday,
    },
    {
      bookingNumber: 'BK-2026-0005',
      guestId: guestRecords[4].id, // Tanaka Yuki
      roomId: room302.id,
      bookingType: 'daily' as const,
      checkIn: yesterday,
      checkOut: today,
      rate: 1800,
      status: 'checked_in' as const,
      actualCheckIn: yesterday,
    },
    {
      bookingNumber: 'BK-2026-0006',
      guestId: guestRecords[5].id, // Wang Wei
      roomId: room501.id,
      bookingType: 'monthly_short' as const,
      checkIn: sevenDaysAgo,
      checkOut: twentyThreeDaysFromNow,
      rate: 18000,
      status: 'checked_in' as const,
      actualCheckIn: sevenDaysAgo,
    },
  ];

  const bookings = [];
  for (const booking of bookingData) {
    const record = await prisma.booking.upsert({
      where: { bookingNumber: booking.bookingNumber },
      update: {},
      create: {
        ...booking,
        source: 'direct',
        deposit: 0,
      },
    });
    bookings.push(record);

    // Mirror the prod booking-creation path: every booking gets a
    // BookingRoomSegment covering [checkIn, checkOut) in its starting room.
    // Segments are the authoritative source of room placement / availability
    // (see src/services/roomChange.service.ts). Without this, the dev tape
    // chart, SHUFFLE/MOVE candidate lists, and overlap checks would silently
    // disagree with the booking table.
    const hasSegment = await prisma.bookingRoomSegment.findFirst({
      where:  { bookingId: record.id },
      select: { id: true },
    });
    if (!hasSegment) {
      await prisma.bookingRoomSegment.create({
        data: {
          bookingId:   record.id,
          roomId:      record.roomId,
          fromDate:    record.checkIn,
          toDate:      record.checkOut,
          rate:        record.rate,
          bookingType: record.bookingType,
          createdBy:   'seed',
        },
      });
    }
  }
  console.log(`✅ ${bookings.length} bookings created (with room segments)`);

  // Update room statuses for checked_in bookings
  await prisma.room.update({
    where: { id: room202.id },
    data: { status: 'occupied' },
  });
  await prisma.room.update({
    where: { id: room302.id },
    data: { status: 'occupied' },
  });
  await prisma.room.update({
    where: { id: room501.id },
    data: { status: 'occupied' },
  });
  console.log('✅ Room statuses updated for checked_in bookings');

  // Invoices for checked_in guests
  // Invoice for Booking 4 (สมหญิง - room 202)
  const invoice1 = await prisma.invoice.upsert({
    where: { invoiceNumber: 'INV-2026-0001' },
    update: {},
    create: {
      invoiceNumber: 'INV-2026-0001',
      bookingId: bookings[3].id,
      guestId: guestRecords[1].id,
      issueDate: today,
      dueDate: tomorrow,
      subtotal: 2400,
      vatAmount: 0,
      grandTotal: 2400,
      status: 'unpaid',
      items: {
        create: [
          {
            description: 'ค่าห้องพัก',
            amount: 2400,
            taxType: 'included',
            sortOrder: 1,
          },
        ],
      },
    },
    include: { items: true },
  });

  // Invoice for Booking 6 (Wang Wei - room 501)
  const invoice2 = await prisma.invoice.upsert({
    where: { invoiceNumber: 'INV-2026-0002' },
    update: {},
    create: {
      invoiceNumber: 'INV-2026-0002',
      bookingId: bookings[5].id,
      guestId: guestRecords[5].id,
      issueDate: today,
      dueDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000),
      subtotal: 18000,
      vatAmount: 0,
      grandTotal: 18000,
      status: 'unpaid',
      items: {
        create: [
          {
            description: 'ค่าห้องพักรายเดือน',
            amount: 18000,
            taxType: 'included',
            sortOrder: 1,
          },
        ],
      },
    },
    include: { items: true },
  });

  console.log('✅ 2 invoices created for checked_in guests');

  // ─── City Ledger Test Accounts ─────────────────────────────────────────────
  console.log('🏢 Seeding City Ledger accounts...');

  const clAccounts = await Promise.all([
    prisma.cityLedgerAccount.upsert({
      where: { accountCode: 'CL-0001' },
      update: {},
      create: {
        accountCode:     'CL-0001',
        companyName:     'บริษัท เอบีซี จำกัด',
        companyTaxId:    '0105560012345',
        contactName:     'คุณสมชาย ใจดี',
        contactPhone:    '02-123-4567',
        contactEmail:    'accounting@abc.co.th',
        companyAddress:  '123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กทม. 10110',
        creditLimit:     150000,
        creditTermsDays: 30,
        currentBalance:  0,
        status:          'active',
        notes:           'ลูกค้า VIP — ส่วนลด 10%',
      },
    }),
    prisma.cityLedgerAccount.upsert({
      where: { accountCode: 'CL-0002' },
      update: {},
      create: {
        accountCode:     'CL-0002',
        companyName:     'บริษัท ไทยอินเตอร์เนชั่นแนล จำกัด (มหาชน)',
        companyTaxId:    '0107550098765',
        contactName:     'คุณนภา รักษ์ดี',
        contactPhone:    '02-987-6543',
        contactEmail:    'finance@thai-inter.co.th',
        companyAddress:  '456 ถ.พระราม 4 แขวงสีลม เขตบางรัก กทม. 10500',
        creditLimit:     500000,
        creditTermsDays: 60,
        currentBalance:  0,
        status:          'active',
        notes:           'Corporate rate — ตกลงราคาพิเศษ 2,200/คืน',
      },
    }),
    prisma.cityLedgerAccount.upsert({
      where: { accountCode: 'CL-0003' },
      update: {},
      create: {
        accountCode:     'CL-0003',
        companyName:     'สถานทูต XYZ',
        companyTaxId:    null,
        contactName:     'Mr. John Smith',
        contactPhone:    '02-254-0000',
        contactEmail:    'admin@xyz-embassy.org',
        companyAddress:  '789 Wireless Road, Lumpini, Pathumwan, Bangkok 10330',
        creditLimit:     300000,
        creditTermsDays: 90,
        currentBalance:  0,
        status:          'active',
        notes:           'Diplomatic — ไม่เก็บ VAT',
      },
    }),
    prisma.cityLedgerAccount.upsert({
      where: { accountCode: 'CL-0004' },
      update: {},
      create: {
        accountCode:     'CL-0004',
        companyName:     'ห้างหุ้นส่วนจำกัด เก่าแก่ (เครดิตเต็ม)',
        companyTaxId:    '0303550011111',
        contactName:     'คุณแดง มีหนี้',
        contactPhone:    '043-111-222',
        contactEmail:    'old@partner.com',
        companyAddress:  '999 ถ.มิตรภาพ อ.เมือง จ.ขอนแก่น 40000',
        creditLimit:     50000,
        creditTermsDays: 30,
        currentBalance:  48500,   // ใกล้เต็ม credit limit
        status:          'suspended',
        notes:           'ระงับชั่วคราว — ยอดค้างชำระเกิน 90 วัน',
      },
    }),
  ]);

  console.log(`✅ ${clAccounts.length} City Ledger accounts created`);
  clAccounts.forEach(a => console.log(`   ${a.accountCode} — ${a.companyName}`));

  // ── Phase A: Chart of Accounts (FinancialAccount) ────────────────────────
  console.log('📘 Seeding Chart of Accounts...');
  const defaultAccounts: Array<{
    code: string; name: string; nameEN: string;
    kind: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    subKind:
      | 'CASH' | 'BANK' | 'UNDEPOSITED_FUNDS' | 'CARD_CLEARING'
      | 'AR' | 'AR_CORPORATE' | 'DEPOSIT_LIABILITY' | 'AGENT_PAYABLE'
      | 'VAT_OUTPUT' | 'VAT_INPUT' | 'SERVICE_CHARGE_PAYABLE'
      | 'ROOM_REVENUE' | 'FB_REVENUE' | 'PENALTY_REVENUE'
      | 'DISCOUNT_GIVEN' | 'CARD_FEE' | 'BANK_FEE' | 'CASH_OVER_SHORT'
      | 'OTHER_REVENUE' | 'OTHER_EXPENSE' | 'EQUITY_OPENING';
  }> = [
    { code: '1110-01', name: 'เงินสด-ลิ้นชักหลัก',      nameEN: 'Cash - Main Drawer',        kind: 'ASSET',     subKind: 'CASH' },
    { code: '1120-01', name: 'ธนาคาร-บัญชีหลัก',         nameEN: 'Bank - Default',            kind: 'ASSET',     subKind: 'BANK' },
    { code: '1130-01', name: 'เงินฝากระหว่างทาง',        nameEN: 'Undeposited Funds',         kind: 'ASSET',     subKind: 'UNDEPOSITED_FUNDS' },
    { code: '1131-01', name: 'พักบัตรเครดิต',            nameEN: 'Card Clearing',             kind: 'ASSET',     subKind: 'CARD_CLEARING' },
    { code: '1140-01', name: 'ลูกหนี้-แขกผู้เข้าพัก',      nameEN: 'AR - Guest',                kind: 'ASSET',     subKind: 'AR' },
    { code: '1141-01', name: 'ลูกหนี้-บริษัท',            nameEN: 'AR - Corporate',            kind: 'ASSET',     subKind: 'AR_CORPORATE' },
    { code: '2110-01', name: 'เงินมัดจำลูกค้า',           nameEN: 'Guest Deposits',            kind: 'LIABILITY', subKind: 'DEPOSIT_LIABILITY' },
    { code: '2120-01', name: 'ค่าคอมมิชชั่น OTA ค้างจ่าย', nameEN: 'OTA Commission Payable',    kind: 'LIABILITY', subKind: 'AGENT_PAYABLE' },
    { code: '2130-01', name: 'ภาษีขาย 7%',                nameEN: 'VAT Output',                kind: 'LIABILITY', subKind: 'VAT_OUTPUT' },
    { code: '2131-01', name: 'ค่าบริการ 10% ค้างจ่าย',    nameEN: 'Service Charge Payable',    kind: 'LIABILITY', subKind: 'SERVICE_CHARGE_PAYABLE' },
    { code: '4110-01', name: 'รายได้ค่าห้องพัก',          nameEN: 'Room Revenue',              kind: 'REVENUE',   subKind: 'ROOM_REVENUE' },
    { code: '4120-01', name: 'รายได้อาหารและเครื่องดื่ม',   nameEN: 'F&B Revenue',               kind: 'REVENUE',   subKind: 'FB_REVENUE' },
    { code: '4130-01', name: 'รายได้ค่าปรับ',             nameEN: 'Penalty Revenue',           kind: 'REVENUE',   subKind: 'PENALTY_REVENUE' },
    { code: '4900-01', name: 'รายได้อื่น',                nameEN: 'Other Revenue',             kind: 'REVENUE',   subKind: 'OTHER_REVENUE' },
    { code: '5110-01', name: 'ส่วนลดให้ลูกค้า',           nameEN: 'Discount Given',            kind: 'EXPENSE',   subKind: 'DISCOUNT_GIVEN' },
    { code: '5210-01', name: 'ค่าธรรมเนียมบัตรเครดิต',     nameEN: 'Card Fee',                  kind: 'EXPENSE',   subKind: 'CARD_FEE' },
    { code: '5220-01', name: 'ค่าธรรมเนียมธนาคาร',         nameEN: 'Bank Fee',                  kind: 'EXPENSE',   subKind: 'BANK_FEE' },
    { code: '5310-01', name: 'เงินสดเกิน/ขาดบัญชี',        nameEN: 'Cash Over/Short',           kind: 'EXPENSE',   subKind: 'CASH_OVER_SHORT' },
    { code: '5900-01', name: 'ค่าใช้จ่ายอื่น',            nameEN: 'Other Expense',             kind: 'EXPENSE',   subKind: 'OTHER_EXPENSE' },
  ];
  for (const a of defaultAccounts) {
    await prisma.financialAccount.upsert({
      where: { code: a.code },
      update: {},
      create: {
        code: a.code, name: a.name, nameEN: a.nameEN,
        kind: a.kind, subKind: a.subKind,
        isActive: true, isSystem: true, isDefault: true,
      },
    });
  }
  console.log(`✅ ${defaultAccounts.length} financial accounts seeded`);

  // ── Phase B: default CashBox (Counter 1) ─────────────────────────────────
  const cashAcc = await prisma.financialAccount.findUnique({ where: { code: '1110-01' } });
  if (cashAcc) {
    await prisma.cashBox.upsert({
      where: { code: 'COUNTER-1' },
      update: {},
      create: {
        code: 'COUNTER-1',
        name: 'เคาน์เตอร์ 1',
        location: 'เคาน์เตอร์ต้อนรับหลัก',
        displayOrder: 1,
        financialAccountId: cashAcc.id,
        isActive: true,
      },
    });
    console.log('✅ default CashBox "COUNTER-1" seeded');
  }

  // ── Sprint 5: Payment & Finance v2 ───────────────────────────────────────
  // D4: 3 bank accounts (2 บริษัท + 1 ส่วนตัว). Placeholders for account names
  // — real values editable in /settings/accounts (Q1).
  await prisma.financialAccount.upsert({
    where: { code: '1120-01' },
    update: {
      ownerType: 'COMPANY',
      bankName: 'BBL',
      bankAccountName: 'บริษัท (placeholder)',
      isActive: true,
    },
    create: {
      code: '1120-01', name: 'BBL บริษัท', nameEN: 'BBL - Company',
      kind: 'ASSET', subKind: 'BANK',
      bankName: 'BBL', bankAccountName: 'บริษัท (placeholder)',
      ownerType: 'COMPANY', isSystem: false, isDefault: true,
    },
  });
  await prisma.financialAccount.upsert({
    where: { code: '1120-02' },
    update: {
      ownerType: 'COMPANY',
      bankName: 'KBank',
      bankAccountName: 'บริษัท (placeholder)',
      isActive: true,
    },
    create: {
      code: '1120-02', name: 'KBank บริษัท', nameEN: 'KBank - Company',
      kind: 'ASSET', subKind: 'BANK',
      bankName: 'KBank', bankAccountName: 'บริษัท (placeholder)',
      ownerType: 'COMPANY',
    },
  });
  await prisma.financialAccount.upsert({
    where: { code: '1120-03' },
    update: {
      ownerType: 'PERSONAL',
      bankName: 'BBL',
      bankAccountName: 'กรรมการ (ส่วนตัว)',
      isActive: true,
    },
    create: {
      code: '1120-03', name: 'BBL กรรมการ (ส่วนตัว)', nameEN: 'BBL - Personal',
      kind: 'ASSET', subKind: 'BANK',
      bankName: 'BBL', bankAccountName: 'กรรมการ (ส่วนตัว)',
      ownerType: 'PERSONAL',
    },
  });
  console.log('✅ 3 bank accounts seeded (2 COMPANY + 1 PERSONAL)');

  // Clearing accounts — 1131-01 for BBL, create 1131-02 for KBank
  const bblClearingAcct = await prisma.financialAccount.upsert({
    where: { code: '1131-01' },
    update: {},
    create: {
      code: '1131-01', name: 'พักบัตรเครดิต BBL', nameEN: 'Card Clearing - BBL',
      kind: 'ASSET', subKind: 'CARD_CLEARING', isSystem: true, isDefault: true,
    },
  });
  const kbankClearingAcct = await prisma.financialAccount.upsert({
    where: { code: '1131-02' },
    update: {},
    create: {
      code: '1131-02', name: 'พักบัตรเครดิต KBank', nameEN: 'Card Clearing - KBank',
      kind: 'ASSET', subKind: 'CARD_CLEARING', isSystem: true,
    },
  });

  // D3: 2 EDC terminals
  await prisma.edcTerminal.upsert({
    where: { code: 'BBL-01' },
    update: {},
    create: {
      code: 'BBL-01', name: 'เครื่องรูดบัตร BBL', acquirerBank: 'BBL',
      clearingAccountId: bblClearingAcct.id, allowedBrands: [],
    },
  });
  await prisma.edcTerminal.upsert({
    where: { code: 'KBANK-01' },
    update: {},
    create: {
      code: 'KBANK-01', name: 'เครื่องรูดบัตร KBank', acquirerBank: 'KBANK',
      clearingAccountId: kbankClearingAcct.id, allowedBrands: [],
    },
  });
  console.log('✅ 2 EDC terminals seeded (BBL-01, KBANK-01)');

  // D2: default MDR rates (global, brand-level, any cardType) — Q3 defaults
  const defaultMDR: Array<{ brand: 'VISA' | 'MASTER' | 'JCB' | 'UNIONPAY' | 'AMEX'; rate: number }> = [
    { brand: 'VISA',     rate: 1.75 },
    { brand: 'MASTER',   rate: 1.75 },
    { brand: 'JCB',      rate: 2.00 },
    { brand: 'UNIONPAY', rate: 1.60 },
    { brand: 'AMEX',     rate: 3.00 },
  ];
  for (const f of defaultMDR) {
    const existing = await prisma.cardFeeRate.findFirst({
      where: { terminalId: null, brand: f.brand, cardType: null, effectiveTo: null },
      select: { id: true },
    });
    if (!existing) {
      await prisma.cardFeeRate.create({
        data: { terminalId: null, brand: f.brand, cardType: null, ratePercent: f.rate },
      });
    }
  }
  console.log(`✅ ${defaultMDR.length} default MDR rates seeded`);

  // D5/D6: running-number sequences for receipts + tax invoices
  await prisma.numberSequence.upsert({
    where: { kind: 'TAX_INVOICE' },
    update: {},
    create: { kind: 'TAX_INVOICE', prefix: 'TI', resetEvery: 'MONTHLY' },
  });
  await prisma.numberSequence.upsert({
    where: { kind: 'RECEIPT' },
    update: {},
    create: { kind: 'RECEIPT', prefix: 'RC', resetEvery: 'YEARLY' },
  });
  console.log('✅ 2 number sequences seeded (TAX_INVOICE, RECEIPT)');

  console.log('🎉 Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
