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
      name: 'Admin',
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

  console.log('🎉 Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
