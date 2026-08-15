'use strict';
require('dotenv').config({ quiet: true });

const env = process.env.NODE_ENV || 'development';
const esProduccion = env === 'production';

function requerida(nombre, valorPorDefecto) {
  const v = process.env[nombre] ?? valorPorDefecto;
  if (v === undefined || v === '') throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

const jwtSecret = requerida('JWT_SECRET', esProduccion ? undefined : 'solo_para_desarrollo_no_usar_en_produccion_123');
if (esProduccion && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}

module.exports = {
  env,
  esProduccion,
  port: Number(process.env.PORT || 3100),
  // En Render, RENDER_EXTERNAL_URL se define automáticamente con la URL pública del servicio.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3100').replace(/\/$/, ''),
  db: {
    connectionString: requerida('DATABASE_URL'),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  jwt: {
    secret: jwtSecret,
    expiraHoras: Number(process.env.JWT_EXPIRES_HOURS || 2),
    cookie: 'sp_sesion',
  },
  bcryptCost: Number(process.env.BCRYPT_COST || 12),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'SentinelaPyME <no-responder@sentinelapyme.cl>',
  },
  seguridad: {
    maxIntentosLogin: 5,
    minutosBloqueo: 15,
    minutosTokenRecuperacion: 30,
  },
};
