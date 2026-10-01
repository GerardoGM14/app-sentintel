'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db/pool');
const { esquemas, ESTADOS_INCIDENTE } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { permitirRoles } = require('../middleware/auth');
const { auditar } = require('../services/auditoria');
const tiempoReal = require('../services/tiempoReal');

const SELECT_INCIDENTE = `
  SELECT i.id_incidente, i.titulo, i.descripcion, i.severidad, i.estado, i.respuesta_analista,
         i.fecha_reporte, i.fecha_actualizacion,
         rep.nombre || ' ' || rep.apellido AS reportado_por, o.id_organizacion, o.razon_social AS organizacion,
         a.nombre AS activo, c.nombre AS categoria,
         i.id_responsable, resp.nombre || ' ' || resp.apellido AS responsable
    FROM incidentes i
    JOIN usuarios rep ON rep.id_usuario = i.id_reportado_por
    JOIN organizaciones o ON o.id_organizacion = rep.id_organizacion
    LEFT JOIN activos a ON a.id_activo = i.id_activo
    LEFT JOIN categorias_evento c ON c.id_categoria = i.id_categoria
    LEFT JOIN usuarios resp ON resp.id_usuario = i.id_responsable`;

router.get('/', asincrono(async (req, res) => {
  const { estado } = z.object({ estado: z.enum(ESTADOS_INCIDENTE).optional() }).parse(req.query);
  const org = req.usuario.rol === 'cliente' ? req.usuario.idOrganizacion : null;
  const { rows } = await query(
    `${SELECT_INCIDENTE}
      WHERE ($1::int IS NULL OR o.id_organizacion = $1) AND ($2::text IS NULL OR i.estado = $2)
      ORDER BY (i.estado = 'cerrado'), i.fecha_reporte DESC LIMIT 200`,
    [org, estado ?? null]
  );
  res.json({ incidentes: rows });
}));

/** POST / — el cliente reporta un incidente; el activo debe pertenecer a su organización. */
router.post('/', permitirRoles('cliente'), asincrono(async (req, res) => {
  const d = esquemas.incidente.parse(req.body);
  if (d.id_activo) {
    const r = await query('SELECT 1 FROM activos WHERE id_activo = $1 AND id_organizacion = $2', [d.id_activo, req.usuario.idOrganizacion]);
    if (!r.rowCount) throw new ErrorHttp(400, 'activo_invalido', 'El activo no pertenece a su organización.', { id_activo: 'Activo inválido.' });
  }
  const { rows: [i] } = await query(
    `INSERT INTO incidentes (id_reportado_por, id_activo, id_categoria, titulo, descripcion, severidad)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_incidente`,
    [req.usuario.id, d.id_activo ?? null, d.id_categoria ?? null, d.titulo, d.descripcion, d.severidad]
  );
  await auditar(req, 'incidente_reportado', 'incidente', i.id_incidente);
  tiempoReal.emitirAdministradores('incidente:nuevo', {
    id_incidente: i.id_incidente, titulo: d.titulo, severidad: d.severidad, organizacion: req.usuario.organizacion,
  });
  res.status(201).json({ mensaje: 'Incidente reportado. Un analista lo revisará a la brevedad.', id_incidente: i.id_incidente });
}));

/** PATCH /:id — el administrador actualiza estado, responsable y respuesta. */
router.patch('/:id(\\d+)', permitirRoles('administrador'), asincrono(async (req, res) => {
  const d = esquemas.gestionIncidente.parse(req.body);
  const { rowCount } = await query(
    `UPDATE incidentes SET estado = $2, respuesta_analista = COALESCE($3, respuesta_analista),
            id_responsable = COALESCE($4, id_responsable, $5), fecha_actualizacion = now()
      WHERE id_incidente = $1`,
    [req.params.id, d.estado, d.respuesta_analista ?? null, d.id_responsable ?? null, req.usuario.id]
  );
  if (!rowCount) throw new ErrorHttp(404, 'no_encontrado', 'Incidente no encontrado.');
  const { rows: [i] } = await query(`${SELECT_INCIDENTE} WHERE i.id_incidente = $1`, [req.params.id]);
  await auditar(req, 'incidente_gestionado', 'incidente', req.params.id, { estado: d.estado });
  tiempoReal.emitir(i.id_organizacion, 'incidente:actualizado', { id_incidente: i.id_incidente, estado: i.estado, titulo: i.titulo });
  res.json({ mensaje: 'Incidente actualizado.', incidente: i });
}));

module.exports = router;
