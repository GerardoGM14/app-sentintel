'use strict';
const { query } = require('../db/pool');

/** Registra una acción relevante para trazabilidad (no interrumpe la operación si falla). */
async function auditar(req, accion, entidad, idEntidad = null, detalle = null) {
  try {
    await query(
      `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, ip, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req?.usuario?.id ?? null, accion, entidad, idEntidad == null ? null : String(idEntidad),
       req?.ip ? req.ip.replace(/^::ffff:/, '') : null, detalle]
    );
  } catch (err) {
    console.error('[auditoria] No se pudo registrar:', err.message);
  }
}

module.exports = { auditar };
