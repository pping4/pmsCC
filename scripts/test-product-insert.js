const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/pms_db' });

c.connect().then(async () => {
  // Test 1: COUNT with enum cast
  try {
    const r1 = await c.query('SELECT COUNT(*) FROM products WHERE category = $1::"ProductCategory"', ['service']);
    console.log('COUNT OK:', r1.rows[0].count);
  } catch(e) { console.error('COUNT ERR:', e.message); }

  // Test 2: INSERT with enum cast
  try {
    const r2 = await c.query(`
      INSERT INTO products (id, code, name, description, unit, price, tax_type, category, active, sort_order, created_at)
      VALUES (gen_random_uuid(), 'TEST-001', 'test item', null, 'ครั้ง', 5, $1::"TaxType", $2::"ProductCategory", true, 0, NOW())
      RETURNING id, code, name, tax_type, category
    `, ['no_tax', 'service']);
    console.log('INSERT OK:', r2.rows[0]);
    // cleanup
    await c.query('DELETE FROM products WHERE code = $1', ['TEST-001']);
  } catch(e) { console.error('INSERT ERR:', e.message); }

  c.end();
}).catch(e => { console.error('CONNECT ERR:', e.message); c.end(); });
