const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const category = 'service';
  const taxType  = 'no_tax';
  const name     = 'Test Item API';
  const price    = 100;
  const unit     = 'ครั้ง';
  const sortOrder = 0;
  const description = null;

  console.log('Step 1: COUNT...');
  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS count FROM products WHERE category = '${category}'::"ProductCategory"`
  );
  console.log('count =', String(countRows[0].count));

  const prefix = 'SRV';
  const code = `${prefix}-${String(Number(countRows[0].count) + 1).padStart(3, '0')}`;
  console.log('code =', code);

  console.log('Step 2: INSERT...');
  const sql = `INSERT INTO products (id, code, name, description, unit, price, tax_type, category, active, sort_order, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '${taxType}'::"TaxType", '${category}'::"ProductCategory", true, $6, NOW())
     RETURNING id, code, name`;
  console.log('SQL:', sql);
  console.log('Params:', [code, name, description, unit, price, sortOrder]);

  const rows = await prisma.$queryRawUnsafe(sql, code, name, description, unit, price, sortOrder);
  console.log('INSERT OK:', rows[0]);

  await prisma.$queryRawUnsafe('DELETE FROM products WHERE id = $1', rows[0].id);
  console.log('Cleaned up OK');
}

main()
  .catch(e => {
    console.error('ERROR name:', e.name);
    console.error('ERROR message:', e.message);
    console.error('ERROR code:', e.code);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
