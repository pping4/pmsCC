const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/pms_db' });

async function run() {
  await c.connect();
  const category = 'service';
  const taxType = 'no_tax';

  // Step 1: count
  const countRows = await c.query(
    `SELECT COUNT(*)::bigint AS count FROM products WHERE category = '${category}'::"ProductCategory"`
  );
  const count = Number(countRows.rows[0].count);
  const code = `SRV-${String(count + 1).padStart(3, '0')}`;
  console.log('Code:', code);

  // Step 2: insert - try the exact SQL from the API route
  try {
    const ins = await c.query(
      `INSERT INTO products (id, code, name, description, unit, price, tax_type, category, active, sort_order, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '${taxType}'::"TaxType", '${category}'::"ProductCategory", true, $6, NOW())
       RETURNING id, code, name, description, unit, price, tax_type, category, active, sort_order`,
      [code, 'ทดสอบ', null, 'ครั้ง', 500, 0]
    );
    console.log('INSERT OK:', ins.rows[0]);
    await c.query('DELETE FROM products WHERE code = $1', [code]);
    console.log('Cleaned up');
  } catch(e) {
    console.error('INSERT ERROR:', e.message);
    console.error('DETAIL:', e.detail);
  }
  await c.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
