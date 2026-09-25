'use strict';
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');

let io = null;

function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  for (const parte of cabecera.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Inicializa Socket.IO autenticando cada conexión con la misma cookie JWT de la API. */
function iniciar(servidorHttp) {
  io = new Server(servidorHttp, {
    cors: { origin: config.appUrl, credentials: true },
    serveClient: true,
  });

  io.use(async (socket, next) => {
    try {
      const token = leerCookie(socket.handshake.headers.cookie, config.jwt.cookie);
      if (!token) return next(new Error('no_autenticado'));
      const datos = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
      const { rows } = await query(
        `SELECT u.id_usuario, u.id_organizacion, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
          WHERE u.id_usuario = $1 AND u.activo AND u.version_token = $2`,
        [datos.sub, datos.ver]
      );
      if (!rows.length) return next(new Error('no_autenticado'));
      socket.data.usuario = rows[0];
      next();
    } catch {
      next(new Error('no_autenticado'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.usuario;
    // Salas: cada cliente solo recibe datos de su propia organización.
    socket.join(u.rol === 'administrador' ? 'administradores' : `org:${u.id_organizacion}`);
  });
  return io;
}

/** Emite un evento a la organización afectada y a los administradores. */
function emitir(idOrganizacion, nombreEvento, carga) {
  if (!io) return;
  io.to(`org:${idOrganizacion}`).to('administradores').emit(nombreEvento, carga);
}

function emitirAdministradores(nombreEvento, carga) {
  if (io) io.to('administradores').emit(nombreEvento, carga);
}

module.exports = { iniciar, emitir, emitirAdministradores };
