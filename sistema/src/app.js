'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const config = require('./config');
const { query } = require('./db/pool');
const { autenticar, permitirRoles } = require('./middleware/auth');
const { limitadores, verificarOrigen } = require('./middleware/seguridad');
const { manejadorErrores, noEncontrado, asincrono } = require('./middleware/errores');
const { SEVERIDADES, ESTADOS_ALERTA, ESTADOS_INCIDENTE } = require('./middleware/esquemas');
const eventos = require('./routes/eventos');

const app = express();
app.disable('x-powered-by');
if (config.esProduccion) app.set('trust proxy', 1); // detrás del balanceador del hosting

// Cabeceras de seguridad HTTP: CSP estricta (sin scripts ni estilos en línea), HSTS, anti-clickjacking, etc.
const csp = {
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: config.esProduccion ? [] : null,
  },
};
app.use(helmet({
  contentSecurityPolicy: csp,
  hsts: config.esProduccion ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Healthcheck para el hosting / balanceador
app.get('/salud', asincrono(async (_req, res) => {
  await query('SELECT 1');
  res.json({ estado: 'ok', fecha: new Date().toISOString() });
}));

// ---------- Documentación de la API (OpenAPI 3) ----------
const especificacion = YAML.parse(fs.readFileSync(path.join(__dirname, 'docs', 'openapi.yaml'), 'utf8'));
app.get('/api/openapi.json', (_req, res) => res.json(especificacion));
app.use('/api/docs', helmet.contentSecurityPolicy({
  directives: { ...csp.directives, scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] },
}), swaggerUi.serve, swaggerUi.setup(especificacion, { customSiteTitle: 'SentinelaPyME API' }));

// ---------- API REST v1 ----------
const api = express.Router();
api.use(verificarOrigen);
api.use('/ingesta', eventos.ingesta);          // agentes (API key)
api.use(limitadores.general);
api.use('/auth', require('./routes/auth'));

// Rutas que requieren sesión
api.use(autenticar);
api.get('/catalogos', asincrono(async (_req, res) => {
  const [tipos, categorias] = await Promise.all([
    query('SELECT id_tipo_activo, nombre FROM tipos_activo ORDER BY nombre'),
    query('SELECT id_categoria, codigo, nombre, severidad_base FROM categorias_evento ORDER BY nombre'),
  ]);
  res.set('Cache-Control', 'private, max-age=300');
  res.json({
    tipos_activo: tipos.rows, categorias: categorias.rows,
    severidades: SEVERIDADES, estados_alerta: ESTADOS_ALERTA, estados_incidente: ESTADOS_INCIDENTE,
  });
}));
api.use('/perfil', require('./routes/perfil'));
api.use('/panel', require('./routes/panel'));
api.use('/activos', require('./routes/activos'));
api.use('/eventos', eventos.consulta);
api.use('/alertas', require('./routes/alertas'));
api.use('/incidentes', require('./routes/incidentes'));
api.use('/admin', permitirRoles('administrador'), require('./routes/administracion'));
api.use(noEncontrado);

app.use('/api/v1', api);
app.use('/api', noEncontrado);

// ---------- Frontend estático ----------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: (res, ruta) => {
    if (ruta.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));
app.use(manejadorErrores);

module.exports = app;
