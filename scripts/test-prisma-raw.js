const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p['$queryRawUnsafe']('SELECT 1 AS n')
  .then(r => { console.log('Prisma raw OK:', r); })
  .catch(e => { console.error('Prisma raw ERR:', e.message); })
  .finally(() => p['$disconnect']());
