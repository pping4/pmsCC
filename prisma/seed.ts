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
  }
  console.log(`✅ ${bookings.length} bookings created`);

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

  console.log('🎉 Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
