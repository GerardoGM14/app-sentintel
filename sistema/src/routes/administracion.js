'use strict';
/** Rutas exclusivas del perfil administrador: reglas, usuarios, organizaciones y auditoría. */
const router = require('express').Router();
const { query } = require('../db/pool');
const { esquemas } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { auditar } = require('../services/auditoria');

// ---------- Reglas de detección ----------
router.get('/reglas', asincrono(async (_req, res) => {
  const { rows } = await query(
    `SELECT r.id_regla, r.nombre, r.descripcion, r.umbral, r.ventana_minutos, r.severidad, r.activa,
            r.fecha_creacion, c.id_categoria, c.nombre AS categoria, c.codigo,
            (SELECT count(*)::int FROM alertas a WHERE a.id_regla = r.id_regla) AS alertas_generadas
       FROM reglas_deteccion r JOIN categorias_evento c ON c.id_categoria = r.id_categoria
      ORDER BY r.activa DESC, r.nombre`
  );
  res.json({ reglas: rows });
}));

router.post('/reglas', asincrono(async (req, res) => {
  const d = esquemas.regla.parse(req.body);
  const { rows: [r] } = await query(
    `INSERT INTO reglas_deteccion (id_categoria, id_creador, nombre, descripcion, umbral, ventana_minutos, severidad, activa)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id_regla`,
    [d.id_categoria, req.usuario.id, d.nombre, d.descripcion, d.umbral, d.ventana_minutos, d.severidad, d.activa]
  );
  await auditar(req, 'regla_creada', 'regla', r.id_regla, { nombre: d.nombre });
  res.status(201).json({ mensaje: 'Regla creada.', id_regla: r.id_regla });
}));

router.put('/reglas/:id(\\d+)', asincrono(async (req, res) => {
  const d = esquemas.regla.parse(req.body);
  const { rowCount } = await query(
    `UPDATE reglas_deteccion SET id_categoria = $2, nombre = $3, descripcion = $4, umbral = $5,
            ventana_minutos = $6, severidad = $7, activa = $8 WHERE id_regla = $1`,
    [req.params.id, d.id_categoria, d.nombre, d.descripcion, d.umbral, d.ventana_minutos, d.severidad, d.activa]
  );
  if (!rowCount) throw new ErrorHttp(404, 'no_encontrado', 'Regla no encontrada.');
  await auditar(req, 'regla_editada', 'regla', req.params.id);
  res.json({ mensaje: 'Regla actualizada.' });
}));

// ---------- Usuarios ----------
router.get('/usuarios', asincrono(async (_req, res) => {
  const { rows } = await query(
    `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.activo, u.ultimo_acceso, u.fecha_creacion,
            (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > now()) AS bloqueado,
            r.nombre AS rol, o.razon_social AS organizacion
       FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
       LEFT JOIN organizaciones o ON o.id_organizacion = u.id_organizacion
      ORDER BY r.id_rol, u.apellido, u.nombre`
  );
  res.json({ usuarios: rows });
}));

router.patch('/usuarios/:id(\\d+)', asincrono(async (req, res) => {
  const d = esquemas.gestionUsuario.parse(req.body);
  if (Number(req.params.id) === req.usuario.id && d.activo === false) {
    throw new ErrorHttp(400, 'operacion_invalida', 'No puede desactivar su propia cuenta.');
  }
  const { rowCount } = await query(
    `UPDATE usuarios SET
        activo = COALESCE($2, activo),
        version_token = CASE WHEN $2 = false THEN version_token + 1 ELSE version_token END,
        bloqueado_hasta = CASE WHEN $3 THEN NULL ELSE bloqueado_hasta END,
        intentos_fallidos = CASE WHEN $3 THEN 0 ELSE intentos_fallidos END
      WHERE id_usuario = $1`,
    [req.params.id, d.activo ?? null, d.desbloquear === true]
  );
  if (!rowCount) throw new ErrorHttp(404, 'no_encontrado', 'Usuario no encontrado.');
  await auditar(req, 'usuario_gestionado', 'usuario', req.params.id, d);
  res.json({ mensaje: 'Usuario actualizado.' });
}));

router.get('/administradores', asincrono(async (_req, res) => {
  const { rows } = await query(
    `SELECT id_usuario, nombre || ' ' || apellido AS nombre FROM usuarios WHERE id_rol = 1 AND activo ORDER BY nombre`
  );
  res.json({ administradores: rows });
}));

// ---------- Organizaciones ----------
router.get('/organizaciones', asincrono(async (_req, res) => {
  const { rows } = await query(
    `SELECT o.id_organizacion, o.rut, o.razon_social, o.rubro, o.fecha_registro,
            (SELECT count(*)::int FROM usuarios u WHERE u.id_organizacion = o.id_organizacion) AS usuarios,
            (SELECT count(*)::int FROM activos a WHERE a.id_organizacion = o.id_organizacion) AS activos
       FROM organizaciones o ORDER BY o.razon_social`
  );
  res.json({ organizaciones: rows });
}));

// ---------- Auditoría ----------
router.get('/auditoria', asincrono(async (_req, res) => {
  const { rows } = await query(
    `SELECT au.id_auditoria::text, au.accion, au.entidad, au.id_entidad, host(au.ip) AS ip, au.fecha,
            u.email AS usuario
       FROM auditoria au LEFT JOIN usuarios u ON u.id_usuario = au.id_usuario
      ORDER BY au.fecha DESC LIMIT 200`
  );
  res.json({ registros: rows });
}));

module.exports = router;
