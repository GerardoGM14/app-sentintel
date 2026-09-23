'use strict';
/**
 * Motor de correlación: tras cada lote ingerido, evalúa las reglas activas de las
 * categorías recibidas sobre una ventana de tiempo deslizante, agrupando por
 * (activo, categoría, IP de origen). Si se supera el umbral crea una alerta o
 * actualiza la alerta abierta equivalente (deduplicación).
 */
const { query } = require('../db/pool');
const tiempoReal = require('./tiempoReal');

async function evaluarLote(activo, grupos) {
  const nuevas = [];
  const categorias = [...new Set(grupos.map((g) => g.id_categoria))];
  const { rows: reglas } = await query(
    `SELECT id_regla, id_categoria, nombre, umbral, ventana_minutos, severidad
       FROM reglas_deteccion WHERE activa AND id_categoria = ANY($1::smallint[])`,
    [categorias]
  );
  if (!reglas.length) return nuevas;

  for (const g of grupos) {
    for (const regla of reglas.filter((r) => r.id_categoria === g.id_categoria)) {
      const { rows: [conteo] } = await query(
        `SELECT count(*)::int AS cantidad, min(fecha_evento) AS primero, max(fecha_evento) AS ultimo
           FROM eventos
          WHERE id_activo = $1 AND id_categoria = $2
            AND ip_origen IS NOT DISTINCT FROM $3::inet
            AND fecha_evento >= now() - make_interval(mins => $4)`,
        [activo.id_activo, g.id_categoria, g.ip_origen, regla.ventana_minutos]
      );
      if (conteo.cantidad < regla.umbral) continue;

      // ¿Existe ya una alerta abierta equivalente? Se actualiza en vez de duplicar.
      const { rows: existente } = await query(
        `UPDATE alertas
            SET cantidad_eventos = GREATEST(cantidad_eventos, $4), fecha_ultimo_evento = $5
          WHERE id_alerta = (
                SELECT id_alerta FROM alertas
                 WHERE id_regla = $1 AND id_activo = $2 AND ip_origen IS NOT DISTINCT FROM $3::inet
                   AND estado IN ('abierta','en_revision')
                 ORDER BY fecha_generada DESC LIMIT 1)
          RETURNING id_alerta`,
        [regla.id_regla, activo.id_activo, g.ip_origen, conteo.cantidad, conteo.ultimo]
      );
      if (existente.length) continue;

      const { rows: [alerta] } = await query(
        `INSERT INTO alertas (id_regla, id_activo, ip_origen, cantidad_eventos, fecha_primer_evento, fecha_ultimo_evento)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_alerta, fecha_generada, estado`,
        [regla.id_regla, activo.id_activo, g.ip_origen, conteo.cantidad, conteo.primero, conteo.ultimo]
      );
      const carga = {
        id_alerta: alerta.id_alerta,
        regla: regla.nombre,
        severidad: regla.severidad,
        activo: activo.nombre,
        ip_origen: g.ip_origen,
        cantidad_eventos: conteo.cantidad,
        fecha_generada: alerta.fecha_generada,
        estado: alerta.estado,
      };
      nuevas.push(carga);
      tiempoReal.emitir(activo.id_organizacion, 'alerta:nueva', carga);
    }
  }
  return nuevas;
}

module.exports = { evaluarLote };
