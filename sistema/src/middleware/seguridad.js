'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ErrorHttp } = require('./errores');

const respuestaLimite = (mensaje) => ({ error: { codigo: 'demasiadas_peticiones', mensaje } });

const crearLimitador = (ventanaMin, max, mensaje, opciones = {}) => rateLimit({
  windowMs: ventanaMin * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: respuestaLimite(mensaje),
  ...opciones,
});

const limitadores = {
  general: crearLimitador(1, 300, 'Demasiadas peticiones. Intente en un minuto.'),
  login: crearLimitador(15, 10, 'Demasiados intentos de inicio de sesión. Intente en 15 minutos.'),
  recuperacion: crearLimitador(60, 5, 'Demasiadas solicitudes de recuperación. Intente más tarde.'),
  registro: crearLimitador(60, 10, 'Demasiados registros desde esta dirección. Intente más tarde.'),
  // La ingesta se limita por API key (cada agente tiene su propia cuota).
  ingesta: crearLimitador(1, 600, 'Cuota de ingesta excedida para este agente.', {
    keyGenerator: (req) => req.get('X-API-Key') || 'sin-clave',
  }),
};

/**
 * Defensa adicional contra CSRF: en peticiones que modifican estado desde el navegador,
 * el encabezado Origin (si existe) debe coincidir con la URL pública del sistema.
 */
function verificarOrigen(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origen = req.get('Origin');
  if (!origen) return next(); // clientes no navegador (agentes, curl)
  const permitido = new URL(config.appUrl).origin;
  const propio = `${req.protocol}://${req.get('host')}`;
  if (origen === permitido || origen === propio) return next();
  next(new ErrorHttp(403, 'origen_no_permitido', 'Origen de la petición no permitido.'));
}

module.exports = { limitadores, verificarOrigen };
