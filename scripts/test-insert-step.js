const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Step 1: simple raw with null param
  console.log('Test null param...');
  const r1 = await p['$queryRawUnsafe']('SELECT $1::text AS val', null);
  console.log('null param OK:', r1);

  // Step 2: INSERT with enum cast embedded in SQL string
  const taxType  = 'no_tax';
  const category = 'service';
  const sql = `INSERT INTO products (id, code, name, description, unit, price, tax_type, category, active, sort_order, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '${taxType}'::"TaxType", '${category}'::"ProductCategory", true, $6, NOW())
     RETURNING id, code, name`;

  console.log('Test INSERT...');
  const r2 = await p['$queryRawUnsafe'](sql, 'TST-999', 'Test', null, 'ครั้ง', 99, 0);
  console.log('INSERT OK:', r2[0]);

  // Cleanup
  await p['$queryRawUnsafe']('DELETE FROM products WHERE code = $1', 'TST-999');
  console.log('Done');
}

run()
  .catch(e => { console.error('ERROR:', e.message || e); process.exit(1); })
  .finally(() => p['$disconnect']());
