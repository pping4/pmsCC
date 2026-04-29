import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
await p.financialAccount.upsert({
  where:  { code: '4140-01' },
  update: {},
  create: {
    code: '4140-01', name: 'รายได้จากเครดิตหมดอายุ', nameEN: 'Forfeited Guest Credit',
    kind: 'REVENUE', subKind: 'FORFEITED_REVENUE',
    isActive: true, isSystem: true, isDefault: true,
  },
});
console.log('✅ Seeded 4140-01 รายได้จากเครดิตหมดอายุ');
await p.$disconnect();
