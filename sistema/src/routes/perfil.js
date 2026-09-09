'use strict';
const router = require('express').Router();
const { query } = require('../db/pool');
const { esquemas } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { emitirSesion } = require('../middleware/auth');
const { hashPassword, verificarPassword } = require('../services/cripto');
const { auditar } = require('../services/auditoria');

router.get('/', asincrono(async (req, res) => {
  const { rows: [p] } = await query(
    `SELECT u.nombre, u.apellido, u.email, u.fecha_creacion, u.ultimo_acceso, r.nombre AS rol,
            o.rut, o.razon_social, o.rubro
       FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
       LEFT JOIN organizaciones o ON o.id_organizacion = u.id_organizacion
      WHERE u.id_usuario = $1`,
    [req.usuario.id]
  );
  res.json({ perfil: p });
}));

router.put('/', asincrono(async (req, res) => {
  const d = esquemas.perfil.parse(req.body);
  const dup = await query('SELECT 1 FROM usuarios WHERE lower(email) = $1 AND id_usuario <> $2', [d.email, req.usuario.id]);
  if (dup.rowCount) throw new ErrorHttp(409, 'email_registrado', 'El correo ya está en uso.', { email: 'El correo ya está en uso.' });
  await query('UPDATE usuarios SET nombre = $2, apellido = $3, email = $4 WHERE id_usuario = $1',
    [req.usuario.id, d.nombre, d.apellido, d.email]);
  await auditar(req, 'perfil_actualizado', 'usuario', req.usuario.id);
  res.json({ mensaje: 'Perfil actualizado.' });
}));

/** PUT /password — exige la contraseña actual e invalida las demás sesiones (version_token). */
router.put('/password', asincrono(async (req, res) => {
  const d = esquemas.cambioPassword.parse(req.body);
  const { rows: [u] } = await query('SELECT password_hash FROM usuarios WHERE id_usuario = $1', [req.usuario.id]);
  if (!(await verificarPassword(d.actual, u.password_hash))) {
    throw new ErrorHttp(400, 'password_incorrecta', 'La contraseña actual no es correcta.', { actual: 'La contraseña actual no es correcta.' });
  }
  const hash = await hashPassword(d.password);
  const { rows: [act] } = await query(
    `UPDATE usuarios SET password_hash = $2, version_token = version_token + 1 WHERE id_usuario = $1
     RETURNING id_usuario, version_token`,
    [req.usuario.id, hash]
  );
  await auditar(req, 'password_cambiada', 'usuario', req.usuario.id);
  emitirSesion(res, { ...act, rol: req.usuario.rol }); // renueva la sesión actual
  res.json({ mensaje: 'Contraseña actualizada. Las demás sesiones fueron cerradas.' });
}));

module.exports = router;
