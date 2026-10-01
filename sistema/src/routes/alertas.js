'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db/pool');
const { esquemas, ESTADOS_ALERTA, SEVERIDADES } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { permitirRoles } = require('../middleware/auth');
const { auditar } = require('../services/auditoria');
const tiempoReal = require('../services/tiempoReal');

const filtro = z.object({
  estado: z.enum(ESTADOS_ALERTA).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

const SELECT_ALERTA = `
  SELECT al.id_alerta, al.estado, al.cantidad_eventos, host(al.ip_origen) AS ip_origen,
         al.fecha_primer_evento, al.fecha_ultimo_evento, al.fecha_generada, al.fecha_cierre, al.nota_resolucion,
         r.nombre AS regla, r.severidad, r.umbral, r.ventana_minutos, c.nombre AS categoria,
         a.id_activo, a.nombre AS activo, a.criticidad, o.id_organizacion, o.razon_social AS organizacion,
         al.id_responsable, resp.nombre || ' ' || resp.apellido AS responsable
    FROM alertas al
    JOIN reglas_deteccion r ON r.id_regla = al.id_regla
    JOIN categorias_evento c ON c.id_categoria = r.id_categoria
    JOIN activos a ON a.id_activo = al.id_activo
    JOIN organizaciones o ON o.id_organizacion = a.id_organizacion
    LEFT JOIN usuarios resp ON resp.id_usuario = al.id_responsable`;

router.get('/', asincrono(async (req, res) => {
  const f = filtro.parse(req.query);
  const org = req.usuario.rol === 'cliente' ? req.usuario.idOrganizacion : null;
  const params = [org, f.estado ?? null, f.severidad ?? null];
  const where = `WHERE ($1::int IS NULL OR o.id_organizacion = $1)
                   AND ($2::text IS NULL OR al.estado = $2)
                   AND ($3::text IS NULL OR r.severidad = $3)`;
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(`${SELECT_ALERTA} ${where}
           ORDER BY CASE r.severidad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
                    al.fecha_generada DESC
           LIMIT $4 OFFSET $5`, [...params, f.limite, (f.pagina - 1) * f.limite]),
    query(`SELECT count(*)::int AS total FROM alertas al
             JOIN reglas_deteccion r ON r.id_regla = al.id_regla
             JOIN activos a ON a.id_activo = al.id_activo
             JOIN organizaciones o ON o.id_organizacion = a.id_organizacion ${where}`, params),
  ]);
  res.json({ alertas: rows, total, pagina: f.pagina, paginas: Math.max(1, Math.ceil(total / f.limite)) });
}));

/** PATCH /:id — el analista (administrador) gestiona el ciclo de vida de la alerta. */
router.patch('/:id(\\d+)', permitirRoles('administrador'), asincrono(async (req, res) => {
  const d = esquemas.gestionAlerta.parse(req.body);
  if (d.id_responsable) {
    const r = await query('SELECT 1 FROM usuarios WHERE id_usuario = $1 AND id_rol = 1 AND activo', [d.id_responsable]);
    if (!r.rowCount) throw new ErrorHttp(400, 'responsable_invalido', 'El responsable debe ser un administrador activo.', { id_responsable: 'Responsable inválido.' });
  }
  const cerrada = ['resuelta', 'falso_positivo'].includes(d.estado);
  const { rowCount } = await query(
    `UPDATE alertas SET estado = $2, id_responsable = COALESCE($3, id_responsable),
            nota_resolucion = COALESCE($4, nota_resolucion),
            fecha_cierre = CASE WHEN $5 THEN now() ELSE NULL END
      WHERE id_alerta = $1`,
    [req.params.id, d.estado, d.id_responsable ?? null, d.nota_resolucion ?? null, cerrada]
  );
  if (!rowCount) throw new ErrorHttp(404, 'no_encontrado', 'Alerta no encontrada.');
  const { rows: [al] } = await query(`${SELECT_ALERTA} WHERE al.id_alerta = $1`, [req.params.id]);
  await auditar(req, 'alerta_gestionada', 'alerta', req.params.id, { estado: d.estado });
  tiempoReal.emitir(al.id_organizacion, 'alerta:actualizada', { id_alerta: al.id_alerta, estado: al.estado });
  res.json({ mensaje: 'Alerta actualizada.', alerta: al });
}));

module.exports = router;
