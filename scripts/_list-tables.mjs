import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
for (const r of rows) console.log(r.tablename);
await p.$disconnect();
