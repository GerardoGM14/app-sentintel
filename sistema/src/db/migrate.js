'use strict';
const fs = require('fs');
const path = require('path');
const { pool, asegurarParticiones } = require('./pool');

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await asegurarParticiones(2, 3);
  const { rows } = await pool.query(
    `SELECT inhrelid::regclass::text AS particion FROM pg_inherits
      WHERE inhparent = 'eventos'::regclass ORDER BY 1`
  );
  console.log('[migrate] Esquema aplicado. Particiones de eventos:', rows.map((r) => r.particion).join(', '));
}

if (require.main === module) {
  migrar()
    .then(() => pool.end())
    .catch((err) => { console.error('[migrate] Error:', err); process.exit(1); });
}
module.exports = { migrar };
