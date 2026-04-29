import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
await p.financialAccount.upsert({
  where:  { code: '2115-01' },
  update: {},
  create: {
    code:     '2115-01',
    name:     'เครดิตคงเหลือลูกค้า',
    nameEN:   'Guest Credit Liability',
    kind:     'LIABILITY',
    subKind:  'GUEST_CREDIT',
    isActive: true,
    isSystem: true,
    isDefault: true,
  },
});
console.log('✅ Seeded 2115-01 เครดิตคงเหลือลูกค้า');
await p.$disconnect();
