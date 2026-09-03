'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');
const { sha256 } = require('../services/cripto');
const { ErrorHttp } = require('./errores');

const opcionesCookie = () => ({
  httpOnly: true,                    // inaccesible desde JavaScript (mitiga robo por XSS)
  secure: config.esProduccion,       // solo por HTTPS en producción
  sameSite: 'strict',                // mitiga CSRF
  maxAge: config.jwt.expiraHoras * 3600 * 1000,
  path: '/',
});

function emitirSesion(res, usuario) {
  const token = jwt.sign(
    { sub: usuario.id_usuario, rol: usuario.rol, ver: usuario.version_token },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: `${config.jwt.expiraHoras}h` }
  );
  res.cookie(config.jwt.cookie, token, opcionesCookie());
}

function cerrarSesion(res) {
  const { maxAge, ...resto } = opcionesCookie();
  res.clearCookie(config.jwt.cookie, resto);
}

/**
 * Verifica el JWT de la cookie y vuelve a consultar al usuario: si fue desactivado o
 * cambió su contraseña (version_token), la sesión queda invalidada de inmediato.
 */
async function autenticar(req, _res, next) {
  try {
    const token = req.cookies?.[config.jwt.cookie];
    if (!token) throw new ErrorHttp(401, 'no_autenticado', 'Debe iniciar sesión.');
    let datos;
    try {
      datos = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    } catch {
      throw new ErrorHttp(401, 'sesion_invalida', 'La sesión expiró o no es válida.');
    }
    const { rows } = await query(
      `SELECT u.id_usuario, u.id_organizacion, u.nombre, u.apellido, u.email, u.version_token,
              r.nombre AS rol, o.razon_social
         FROM usuarios u
         JOIN roles r ON r.id_rol = u.id_rol
         LEFT JOIN organizaciones o ON o.id_organizacion = u.id_organizacion
        WHERE u.id_usuario = $1 AND u.activo`,
      [datos.sub]
    );
    const u = rows[0];
    if (!u || u.version_token !== datos.ver) {
      throw new ErrorHttp(401, 'sesion_invalida', 'La sesión ya no es válida. Inicie sesión nuevamente.');
    }
    req.usuario = {
      id: u.id_usuario, rol: u.rol, idOrganizacion: u.id_organizacion,
      nombre: u.nombre, apellido: u.apellido, email: u.email, organizacion: u.razon_social,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Control de acceso basado en roles (RBAC) con principio de mínimo privilegio. */
const permitirRoles = (...roles) => (req, _res, next) => {
  if (!req.usuario || !roles.includes(req.usuario.rol)) {
    return next(new ErrorHttp(403, 'prohibido', 'No tiene permisos para realizar esta acción.'));
  }
  next();
};

/** Autenticación de agentes de recolección mediante API key (cabecera X-API-Key). */
async function autenticarAgente(req, _res, next) {
  try {
    const clave = req.get('X-API-Key');
    if (!clave || !/^sp_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/.test(clave)) {
      throw new ErrorHttp(401, 'api_key_invalida', 'API key ausente o con formato inválido.');
    }
    const { rows } = await query(
      `SELECT id_activo, id_organizacion, nombre FROM activos
        WHERE api_key_hash = $1 AND activo`,
      [sha256(clave)]
    );
    if (!rows.length) throw new ErrorHttp(401, 'api_key_invalida', 'API key no reconocida o activo deshabilitado.');
    req.activo = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { emitirSesion, cerrarSesion, autenticar, permitirRoles, autenticarAgente };
