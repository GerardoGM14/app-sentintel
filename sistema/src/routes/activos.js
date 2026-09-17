'use strict';
const router = require('express').Router();
const { query } = require('../db/pool');
const { esquemas } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { permitirRoles } = require('../middleware/auth');
const { generarApiKey } = require('../services/cripto');
const { auditar } = require('../services/auditoria');

/** GET / — el cliente ve solo los activos de su organización; el administrador ve todos. */
router.get('/', asincrono(async (req, res) => {
  const esCliente = req.usuario.rol === 'cliente';
  const { rows } = await query(
    `SELECT a.id_activo, a.nombre, host(a.direccion_ip) AS direccion_ip, a.criticidad, a.activo,
            a.api_key_prefijo, a.fecha_registro, t.id_tipo_activo, t.nombre AS tipo,
            o.razon_social AS organizacion,
            (SELECT count(*)::int FROM alertas al WHERE al.id_activo = a.id_activo
                AND al.estado IN ('abierta','en_revision')) AS alertas_abiertas
       FROM activos a
       JOIN tipos_activo t ON t.id_tipo_activo = a.id_tipo_activo
       JOIN organizaciones o ON o.id_organizacion = a.id_organizacion
      WHERE ($1::int IS NULL OR a.id_organizacion = $1)
      ORDER BY o.razon_social, a.nombre`,
    [esCliente ? req.usuario.idOrganizacion : null]
  );
  res.json({ activos: rows });
}));

/** POST / — registra un activo y devuelve su API key UNA sola vez (solo se almacena su hash). */
router.post('/', permitirRoles('cliente'), asincrono(async (req, res) => {
  const d = esquemas.activo.parse(req.body);
  const k = generarApiKey();
  const { rows: [a] } = await query(
    `INSERT INTO activos (id_organizacion, id_tipo_activo, nombre, direccion_ip, criticidad, api_key_prefijo, api_key_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_activo`,
    [req.usuario.idOrganizacion, d.id_tipo_activo, d.nombre, d.direccion_ip ?? null, d.criticidad, k.prefijo, k.hash]
  );
  await auditar(req, 'activo_creado', 'activo', a.id_activo, { nombre: d.nombre });
  res.status(201).json({
    mensaje: 'Activo registrado. Copie la API key ahora: no volverá a mostrarse.',
    id_activo: a.id_activo,
    api_key: k.clave,
  });
}));

async function activoPropio(req) {
  const { rows } = await query('SELECT id_activo FROM activos WHERE id_activo = $1 AND id_organizacion = $2',
    [req.params.id, req.usuario.idOrganizacion]);
  if (!rows.length) throw new ErrorHttp(404, 'no_encontrado', 'Activo no encontrado.');
}

router.put('/:id(\\d+)', permitirRoles('cliente'), asincrono(async (req, res) => {
  await activoPropio(req);
  const d = esquemas.activo.parse(req.body);
  await query(
    `UPDATE activos SET nombre = $2, id_tipo_activo = $3, direccion_ip = $4, criticidad = $5 WHERE id_activo = $1`,
    [req.params.id, d.nombre, d.id_tipo_activo, d.direccion_ip ?? null, d.criticidad]
  );
  await auditar(req, 'activo_editado', 'activo', req.params.id);
  res.json({ mensaje: 'Activo actualizado.' });
}));

/** PATCH /:id/estado — habilita o deshabilita la recepción de eventos del agente. */
router.patch('/:id(\\d+)/estado', permitirRoles('cliente'), asincrono(async (req, res) => {
  await activoPropio(req);
  const d = esquemas.activoEstado.parse(req.body);
  await query('UPDATE activos SET activo = $2 WHERE id_activo = $1', [req.params.id, d.activo]);
  await auditar(req, d.activo ? 'activo_habilitado' : 'activo_deshabilitado', 'activo', req.params.id);
  res.json({ mensaje: d.activo ? 'Activo habilitado.' : 'Activo deshabilitado.' });
}));

/** POST /:id/rotar-clave — invalida la API key anterior y emite una nueva. */
router.post('/:id(\\d+)/rotar-clave', permitirRoles('cliente'), asincrono(async (req, res) => {
  await activoPropio(req);
  const k = generarApiKey();
  await query('UPDATE activos SET api_key_prefijo = $2, api_key_hash = $3 WHERE id_activo = $1',
    [req.params.id, k.prefijo, k.hash]);
  await auditar(req, 'api_key_rotada', 'activo', req.params.id);
  res.json({ mensaje: 'Nueva API key generada. La anterior dejó de funcionar.', api_key: k.clave });
}));

module.exports = router;
