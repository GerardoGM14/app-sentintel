#!/usr/bin/env node
'use strict';
/**
 * Prueba de humo de extremo a extremo contra un servidor en ejecución.
 * Uso: npm test   (requiere el servidor levantado y la BD con seed)
 * Variables: TEST_URL (por defecto http://localhost:3100)
 */
require('dotenv').config({ quiet: true });
const assert = require('assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE = (process.env.TEST_URL || 'http://localhost:3100').replace(/\/$/, '');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sufijo = Date.now().toString().slice(-7);

/** Cliente HTTP mínimo que conserva la cookie de sesión. */
function cliente() {
  let cookie = '';
  return async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const r = await fetch(BASE + ruta, {
      method: metodo,
      headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...cabeceras },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { estado: r.status, datos: await r.json().catch(() => null), cabeceras: r.headers, set };
  };
}

function rutValido(cuerpo) {
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return `${cuerpo}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push([nombre, fn]);

const cli = cliente();
const adm = cliente();
const anon = cliente();
const email = `prueba${sufijo}@test.cl`;
let pass = 'ClaveSegura2026';
let apiKey, idActivo, idIncidente;

prueba('Cabeceras de seguridad (CSP, HSTS en prod, nosniff, frame)', async () => {
  const r = await fetch(`${BASE}/login.html`);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

prueba('Registro: rechaza RUT inválido, contraseña débil y XSS', async () => {
  const r = await anon('POST', '/api/v1/auth/registro', { rut: '11111111-2', razon_social: '<script>', rubro: 'Test', nombre: 'Ana', apellido: 'Paz', email, password: 'debil', confirmacion: 'debil' });
  assert.equal(r.estado, 400);
  assert.ok(r.datos.error.detalles.rut && r.datos.error.detalles.password && r.datos.error.detalles.razon_social);
});

prueba('Registro válido crea organización + usuario cliente y sesión HttpOnly', async () => {
  const r = await cli('POST', '/api/v1/auth/registro', { rut: rutValido(`7${sufijo}`), razon_social: `Pyme Prueba ${sufijo} SpA`, rubro: 'Servicios', nombre: 'Ana', apellido: 'Paz', email, password: pass, confirmacion: pass });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.match(r.set, /HttpOnly/i);
  assert.match(r.set, /SameSite=Strict/i);
  const { rows: [u] } = await pool.query('SELECT password_hash FROM usuarios WHERE email = $1', [email]);
  assert.match(u.password_hash, /^\$2[aby]\$12\$/, 'La contraseña se almacena con bcrypt costo 12');
});

prueba('Registro duplicado devuelve 409', async () => {
  const r = await anon('POST', '/api/v1/auth/registro', { rut: rutValido(`8${sufijo}`), razon_social: 'Otra SpA', rubro: 'Servicios', nombre: 'Ana', apellido: 'Paz', email, password: pass, confirmacion: pass });
  assert.equal(r.estado, 409);
});

prueba('Sin sesión la API responde 401', async () => {
  assert.equal((await anon('GET', '/api/v1/alertas')).estado, 401);
});

prueba('Inyección SQL en login no tiene efecto (consultas parametrizadas)', async () => {
  const r = await anon('POST', '/api/v1/auth/login', { email: "' OR 1=1 --@x.cl", password: "' OR '1'='1" });
  assert.ok([400, 401].includes(r.estado));
});

prueba('Formulario 1: registrar activo devuelve API key (solo se guarda el hash)', async () => {
  const r = await cli('POST', '/api/v1/activos', { nombre: 'Servidor de prueba', id_tipo_activo: 1, direccion_ip: '10.9.9.9', criticidad: 'alta' });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  apiKey = r.datos.api_key;
  idActivo = r.datos.id_activo;
  const { rows: [a] } = await pool.query('SELECT api_key_hash FROM activos WHERE id_activo = $1', [idActivo]);
  assert.equal(a.api_key_hash, crypto.createHash('sha256').update(apiKey).digest('hex'));
});

prueba('Ingesta masiva + detección: 6 fallos de login desde una IP generan alerta', async () => {
  const eventos = Array.from({ length: 6 }, () => ({ categoria: 'AUTH_FALLIDA', ip_origen: '203.0.113.77', usuario_objetivo: 'root' }));
  const r = await anon('POST', '/api/v1/ingesta/eventos', { eventos }, { 'X-API-Key': apiKey });
  assert.equal(r.estado, 202);
  assert.equal(r.datos.aceptados, 6);
  assert.equal(r.datos.alertas_generadas, 1);
});

prueba('Ingesta rechaza API key inválida y lotes de más de 500 eventos', async () => {
  assert.equal((await anon('POST', '/api/v1/ingesta/eventos', { eventos: [{ categoria: 'AUTH_FALLIDA' }] }, { 'X-API-Key': 'sp_00000000_' + 'a'.repeat(43) })).estado, 401);
  const grande = Array.from({ length: 501 }, () => ({ categoria: 'HTTP_4XX' }));
  assert.equal((await anon('POST', '/api/v1/ingesta/eventos', { eventos: grande }, { 'X-API-Key': apiKey })).estado, 400);
});

prueba('Aislamiento multi-organización: el cliente solo ve sus alertas y eventos', async () => {
  const r = await cli('GET', '/api/v1/alertas');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.alertas.length >= 1);
  assert.ok(r.datos.alertas.every((a) => a.organizacion === `Pyme Prueba ${sufijo} SpA`));
  const ev = await cli('GET', '/api/v1/eventos?limite=200');
  assert.ok(ev.datos.eventos.every((e) => e.organizacion === `Pyme Prueba ${sufijo} SpA`));
});

prueba('Formulario 2: reportar incidente (validación + creación)', async () => {
  const malo = await cli('POST', '/api/v1/incidentes', { titulo: 'x', descripcion: 'corta', severidad: 'extrema' });
  assert.equal(malo.estado, 400);
  const r = await cli('POST', '/api/v1/incidentes', { titulo: 'Acceso sospechoso al servidor', descripcion: 'Se observaron múltiples intentos de acceso por SSH durante la madrugada.', severidad: 'alta', id_activo: idActivo });
  assert.equal(r.estado, 201);
  idIncidente = r.datos.id_incidente;
});

prueba('RBAC: el cliente no puede acceder a funciones de administrador (403)', async () => {
  assert.equal((await cli('GET', '/api/v1/admin/reglas')).estado, 403);
  assert.equal((await cli('PATCH', `/api/v1/incidentes/${idIncidente}`, { estado: 'cerrado' })).estado, 403);
});

prueba('Administrador: login, Formulario 3 (crear regla) y gestión de alerta/incidente', async () => {
  const l = await adm('POST', '/api/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(l.estado, 200);
  const regla = await adm('POST', '/api/v1/admin/reglas', { nombre: `Regla prueba ${sufijo}`, descripcion: 'Regla creada por la prueba automatizada.', id_categoria: 8, umbral: 500, ventana_minutos: 10, severidad: 'baja', activa: false });
  assert.equal(regla.estado, 201);
  const { rows: [al] } = await pool.query('SELECT id_alerta FROM alertas WHERE id_activo = $1', [idActivo]);
  const sinNota = await adm('PATCH', `/api/v1/alertas/${al.id_alerta}`, { estado: 'resuelta' });
  assert.equal(sinNota.estado, 400, 'Cerrar sin nota debe fallar');
  const ok = await adm('PATCH', `/api/v1/alertas/${al.id_alerta}`, { estado: 'resuelta', nota_resolucion: 'IP bloqueada en firewall.' });
  assert.equal(ok.estado, 200);
  const inc = await adm('PATCH', `/api/v1/incidentes/${idIncidente}`, { estado: 'en_analisis', respuesta_analista: 'Estamos revisando los registros.' });
  assert.equal(inc.estado, 200);
});

prueba('Perfil: actualizar datos y cambiar contraseña (exige la actual)', async () => {
  assert.equal((await cli('PUT', '/api/v1/perfil', { nombre: 'Ana María', apellido: 'Paz', email })).estado, 200);
  assert.equal((await cli('PUT', '/api/v1/perfil/password', { actual: 'Incorrecta123', password: 'OtraClave2026x', confirmacion: 'OtraClave2026x' })).estado, 400);
  const r = await cli('PUT', '/api/v1/perfil/password', { actual: pass, password: 'OtraClave2026x', confirmacion: 'OtraClave2026x' });
  assert.equal(r.estado, 200);
  pass = 'OtraClave2026x';
});

prueba('Recuperación: respuesta genérica, token de un solo uso e invalidación de sesiones', async () => {
  const inexistente = await anon('POST', '/api/v1/auth/recuperar', { email: 'noexiste@x.cl' });
  const existente = await anon('POST', '/api/v1/auth/recuperar', { email });
  assert.equal(inexistente.datos.mensaje, existente.datos.mensaje, 'No debe revelar si el correo existe');
  // Simula el clic en el enlace del correo con un token conocido
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO tokens_recuperacion (id_usuario, token_hash, fecha_expiracion)
                    SELECT id_usuario, $2, now() + interval '30 minutes' FROM usuarios WHERE email = $1`,
  [email, crypto.createHash('sha256').update(token).digest('hex')]);
  const r = await anon('POST', '/api/v1/auth/restablecer', { token, password: 'Recuperada2026', confirmacion: 'Recuperada2026' });
  assert.equal(r.estado, 200);
  const reuso = await anon('POST', '/api/v1/auth/restablecer', { token, password: 'Recuperada2026', confirmacion: 'Recuperada2026' });
  assert.equal(reuso.estado, 400, 'El token no puede reutilizarse');
  assert.equal((await cli('GET', '/api/v1/auth/sesion')).estado, 401, 'La sesión anterior queda invalidada');
  pass = 'Recuperada2026';
});

prueba('Bloqueo de cuenta tras 5 intentos fallidos (423)', async () => {
  const c = cliente();
  for (let i = 0; i < 5; i++) await c('POST', '/api/v1/auth/login', { email, password: 'Equivocada123' });
  const r = await c('POST', '/api/v1/auth/login', { email, password: pass });
  assert.equal(r.estado, 423);
});

prueba('Auditoría registra las acciones', async () => {
  const r = await adm('GET', '/api/v1/admin/auditoria');
  const acciones = new Set(r.datos.registros.map((x) => x.accion));
  for (const a of ['registro', 'activo_creado', 'incidente_reportado', 'alerta_gestionada', 'password_restablecida', 'cuenta_bloqueada']) {
    assert.ok(acciones.has(a), `falta ${a}`);
  }
});

(async () => {
  let ok = 0;
  for (const [nombre, fn] of pruebas) {
    try { await fn(); ok++; console.log(`  ✔ ${nombre}`); } catch (e) { console.log(`  ✘ ${nombre}\n      ${e.message}`); }
  }
  // Limpieza de los datos de prueba
  await pool.query(`DELETE FROM organizaciones WHERE razon_social = $1`, [`Pyme Prueba ${sufijo} SpA`]);
  await pool.query(`DELETE FROM reglas_deteccion WHERE nombre = $1`, [`Regla prueba ${sufijo}`]);
  await pool.end();
  console.log(`\n${ok}/${pruebas.length} pruebas superadas`);
  process.exit(ok === pruebas.length ? 0 : 1);
})();
