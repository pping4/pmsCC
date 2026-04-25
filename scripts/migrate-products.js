const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/pms_db' });
c.connect()
  .then(() => c.query(
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;" +
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'ครั้ง';" +
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;"
  ))
  .then(() => { console.log('Migration OK: description, unit, sort_order added to products'); c.end(); })
  .catch(e => { console.error('Error:', e.message); c.end(); process.exit(1); });
