'use strict';
const router = require('express').Router();
const { query } = require('../db/pool');
const { asincrono } = require('../middleware/errores');

/** GET /resumen — indicadores agregados de las últimas 24 horas (y 7 días para tendencia). */
router.get('/resumen', asincrono(async (req, res) => {
  const org = req.usuario.rol === 'cliente' ? req.usuario.idOrganizacion : null;
  const p = [org];
  const filtroOrg = '($1::int IS NULL OR a.id_organizacion = $1)';

  const [totales, porHora, porCategoria, topIps, alertasSev, porDia] = await Promise.all([
    query(`SELECT
             (SELECT count(*)::int FROM eventos e JOIN activos a ON a.id_activo = e.id_activo
               WHERE e.fecha_evento >= now() - interval '24 hours' AND ${filtroOrg}) AS eventos_24h,
             (SELECT count(*)::int FROM alertas al JOIN activos a ON a.id_activo = al.id_activo
               WHERE al.estado IN ('abierta','en_revision') AND ${filtroOrg}) AS alertas_abiertas,
             (SELECT count(*)::int FROM activos a WHERE a.activo AND ${filtroOrg}) AS activos,
             (SELECT count(*)::int FROM incidentes i JOIN usuarios u ON u.id_usuario = i.id_reportado_por
               WHERE i.estado <> 'cerrado' AND ($1::int IS NULL OR u.id_organizacion = $1)) AS incidentes_abiertos`, p),
    query(`SELECT date_trunc('hour', e.fecha_evento) AS hora, count(*)::int AS total
             FROM eventos e JOIN activos a ON a.id_activo = e.id_activo
            WHERE e.fecha_evento >= date_trunc('hour', now()) - interval '23 hours' AND ${filtroOrg}
            GROUP BY 1 ORDER BY 1`, p),
    query(`SELECT c.nombre AS categoria, c.severidad_base AS severidad, count(*)::int AS total
             FROM eventos e JOIN activos a ON a.id_activo = e.id_activo
             JOIN categorias_evento c ON c.id_categoria = e.id_categoria
            WHERE e.fecha_evento >= now() - interval '24 hours' AND ${filtroOrg}
            GROUP BY c.nombre, c.severidad_base ORDER BY total DESC`, p),
    query(`SELECT host(e.ip_origen) AS ip, count(*)::int AS total
             FROM eventos e JOIN activos a ON a.id_activo = e.id_activo
             JOIN categorias_evento c ON c.id_categoria = e.id_categoria
            WHERE e.fecha_evento >= now() - interval '24 hours' AND e.ip_origen IS NOT NULL
              AND c.severidad_base IN ('media','alta','critica') AND ${filtroOrg}
            GROUP BY e.ip_origen ORDER BY total DESC LIMIT 5`, p),
    query(`SELECT r.severidad, count(*)::int AS total
             FROM alertas al JOIN reglas_deteccion r ON r.id_regla = al.id_regla
             JOIN activos a ON a.id_activo = al.id_activo
            WHERE al.estado IN ('abierta','en_revision') AND ${filtroOrg}
            GROUP BY r.severidad`, p),
    query(`SELECT date_trunc('day', e.fecha_evento) AS dia, count(*)::int AS total
             FROM eventos e JOIN activos a ON a.id_activo = e.id_activo
            WHERE e.fecha_evento >= date_trunc('day', now()) - interval '6 days' AND ${filtroOrg}
            GROUP BY 1 ORDER BY 1`, p),
  ]);

  res.json({
    totales: totales.rows[0],
    eventos_por_hora: porHora.rows,
    eventos_por_dia: porDia.rows,
    eventos_por_categoria: porCategoria.rows,
    top_ips_sospechosas: topIps.rows,
    alertas_por_severidad: alertasSev.rows,
  });
}));

module.exports = router;
