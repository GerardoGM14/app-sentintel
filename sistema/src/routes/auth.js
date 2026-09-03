'use strict';
const router = require('express').Router();
const config = require('../config');
const { query, transaccion } = require('../db/pool');
const { esquemas } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { limitadores } = require('../middleware/seguridad');
const { emitirSesion, cerrarSesion, autenticar } = require('../middleware/auth');
const { hashPassword, verificarPassword, sha256, tokenAleatorio, HASH_FICTICIO } = require('../services/cripto');
const { enviarRecuperacion } = require('../services/correo');
const { auditar } = require('../services/auditoria');

const ROL_CLIENTE = 2;

/** POST /registro — crea la organización (pyme) y su primer usuario con perfil cliente. */
router.post('/registro', limitadores.registro, asincrono(async (req, res) => {
  const d = esquemas.registro.parse(req.body);
  const existe = await query('SELECT 1 FROM usuarios WHERE lower(email) = $1', [d.email]);
  if (existe.rowCount) throw new ErrorHttp(409, 'email_registrado', 'El correo ya está registrado.', { email: 'El correo ya está registrado.' });
  const rutExiste = await query('SELECT 1 FROM organizaciones WHERE rut = $1', [d.rut]);
  if (rutExiste.rowCount) throw new ErrorHttp(409, 'rut_registrado', 'La organización ya está registrada.', { rut: 'Este RUT ya está registrado.' });

  const hash = await hashPassword(d.password);
  const usuario = await transaccion(async (c) => {
    const { rows: [org] } = await c.query(
      'INSERT INTO organizaciones (rut, razon_social, rubro) VALUES ($1, $2, $3) RETURNING id_organizacion',
      [d.rut, d.razon_social, d.rubro]
    );
    const { rows: [u] } = await c.query(
      `INSERT INTO usuarios (id_rol, id_organizacion, nombre, apellido, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_usuario, version_token`,
      [ROL_CLIENTE, org.id_organizacion, d.nombre, d.apellido, d.email, hash]
    );
    return { ...u, rol: 'cliente' };
  });
  req.usuario = { id: usuario.id_usuario };
  await auditar(req, 'registro', 'usuario', usuario.id_usuario);
  emitirSesion(res, usuario);
  res.status(201).json({ mensaje: 'Cuenta creada correctamente.', rol: 'cliente' });
}));

/** POST /login — verifica bcrypt, bloquea tras 5 intentos fallidos y emite cookie JWT. */
router.post('/login', limitadores.login, asincrono(async (req, res) => {
  const d = esquemas.login.parse(req.body);
  const { rows } = await query(
    `SELECT u.id_usuario, u.password_hash, u.activo, u.intentos_fallidos, u.bloqueado_hasta,
            u.version_token, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE lower(u.email) = $1`,
    [d.email]
  );
  const u = rows[0];
  // Se compara siempre contra un hash para no revelar, por tiempo de respuesta, si el correo existe.
  const coincide = await verificarPassword(d.password, u ? u.password_hash : HASH_FICTICIO);
  const errorGenerico = new ErrorHttp(401, 'credenciales_invalidas', 'Correo o contraseña incorrectos.');

  if (!u) throw errorGenerico;
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    throw new ErrorHttp(423, 'cuenta_bloqueada', 'La cuenta está bloqueada temporalmente por intentos fallidos. Intente más tarde o restablezca su contraseña.');
  }
  if (!u.activo) throw new ErrorHttp(403, 'cuenta_desactivada', 'La cuenta está desactivada. Contacte al administrador.');

  if (!coincide) {
    const intentos = u.intentos_fallidos + 1;
    const bloquear = intentos >= config.seguridad.maxIntentosLogin;
    await query(
      `UPDATE usuarios SET intentos_fallidos = $2,
              bloqueado_hasta = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE bloqueado_hasta END
        WHERE id_usuario = $1`,
      [u.id_usuario, bloquear ? 0 : intentos, bloquear, config.seguridad.minutosBloqueo]
    );
    req.usuario = { id: u.id_usuario };
    await auditar(req, bloquear ? 'cuenta_bloqueada' : 'login_fallido', 'usuario', u.id_usuario);
    throw errorGenerico;
  }

  await query(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id_usuario = $1',
    [u.id_usuario]
  );
  req.usuario = { id: u.id_usuario };
  await auditar(req, 'login', 'usuario', u.id_usuario);
  emitirSesion(res, u);
  res.json({ mensaje: 'Sesión iniciada.', rol: u.rol });
}));

router.post('/logout', (req, res) => {
  cerrarSesion(res);
  res.json({ mensaje: 'Sesión cerrada.' });
});

/** GET /sesion — datos del usuario autenticado (usado por el frontend). */
router.get('/sesion', autenticar, (req, res) => res.json({ usuario: req.usuario }));

/**
 * POST /recuperar — genera un token de un solo uso (30 min) y lo envía por correo.
 * La respuesta es siempre la misma para evitar la enumeración de cuentas.
 */
router.post('/recuperar', limitadores.recuperacion, asincrono(async (req, res) => {
  const { email } = esquemas.recuperar.parse(req.body);
  const respuesta = { mensaje: 'Si el correo está registrado, recibirá un enlace para restablecer su contraseña.' };
  const { rows } = await query('SELECT id_usuario, nombre FROM usuarios WHERE lower(email) = $1 AND activo', [email]);
  if (!rows.length) return res.json(respuesta);

  const u = rows[0];
  const token = tokenAleatorio(32);
  await transaccion(async (c) => {
    // Invalida tokens anteriores no usados
    await c.query('UPDATE tokens_recuperacion SET fecha_uso = now() WHERE id_usuario = $1 AND fecha_uso IS NULL', [u.id_usuario]);
    await c.query(
      `INSERT INTO tokens_recuperacion (id_usuario, token_hash, fecha_expiracion)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [u.id_usuario, sha256(token), config.seguridad.minutosTokenRecuperacion]
    );
  });
  const enlace = `${config.appUrl}/restablecer.html?token=${token}`;
  try {
    await enviarRecuperacion(email, u.nombre, enlace);
  } catch (err) {
    console.error('[correo] Error al enviar:', err.message);
  }
  req.usuario = { id: u.id_usuario };
  await auditar(req, 'solicitud_recuperacion', 'usuario', u.id_usuario);
  res.json(respuesta);
}));

/** POST /restablecer — valida el token (hash, vigencia, uso único) y fija la nueva contraseña. */
router.post('/restablecer', limitadores.recuperacion, asincrono(async (req, res) => {
  const d = esquemas.restablecer.parse(req.body);
  const hash = await hashPassword(d.password);
  const idUsuario = await transaccion(async (c) => {
    const { rows } = await c.query(
      `UPDATE tokens_recuperacion SET fecha_uso = now()
        WHERE token_hash = $1 AND fecha_uso IS NULL AND fecha_expiracion > now()
        RETURNING id_usuario`,
      [sha256(d.token)]
    );
    if (!rows.length) throw new ErrorHttp(400, 'token_invalido', 'El enlace es inválido, ya fue utilizado o expiró. Solicite uno nuevo.');
    await c.query(
      `UPDATE usuarios SET password_hash = $2, version_token = version_token + 1,
              intentos_fallidos = 0, bloqueado_hasta = NULL
        WHERE id_usuario = $1`,
      [rows[0].id_usuario, hash]
    );
    return rows[0].id_usuario;
  });
  req.usuario = { id: idUsuario };
  await auditar(req, 'password_restablecida', 'usuario', idUsuario);
  res.json({ mensaje: 'Contraseña actualizada. Ya puede iniciar sesión.' });
}));

module.exports = router;
