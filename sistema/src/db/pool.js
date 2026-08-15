'use strict';
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.ssl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[db] Error inesperado en el pool:', err.message));

/** Consulta parametrizada: los valores viajan separados del SQL (previene inyección SQL). */
const query = (texto, parametros) => pool.query(texto, parametros);

/** Ejecuta una función dentro de una transacción ACID. */
async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

/** Garantiza que existan particiones mensuales desde N meses atrás hasta M meses adelante. */
async function asegurarParticiones(mesesAtras = 2, mesesAdelante = 2) {
  await query(
    `SELECT crear_particion_eventos((date_trunc('month', now()) + make_interval(months => g))::date)
       FROM generate_series($1::int, $2::int) AS g`,
    [-mesesAtras, mesesAdelante]
  );
}

module.exports = { pool, query, transaccion, asegurarParticiones };
