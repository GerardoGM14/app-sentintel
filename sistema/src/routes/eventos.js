'use strict';
const express = require('express');
const { query, pool } = require('../db/pool');
const { esquemas } = require('../middleware/esquemas');
const { asincrono, ErrorHttp } = require('../middleware/errores');
const { autenticarAgente } = require('../middleware/auth');
const { limitadores } = require('../middleware/seguridad');
const detector = require('../services/detector');
const tiempoReal = require('../services/tiempoReal');

// ---------------------------------------------------------------------------
// Ingesta (agentes): POST /api/v1/ingesta/eventos  con cabecera X-API-Key
// ---------------------------------------------------------------------------
const ingesta = express.Router();

let cacheCategorias = null;
async function categorias() {
  if (!cacheCategorias) {
    const { rows } = await query('SELECT id_categoria, codigo FROM categorias_evento');
    cacheCategorias = new Map(rows.map((r) => [r.codigo, r.id_categoria]));
    setTimeout(() => { cacheCategorias = null; }, 5 * 60 * 1000).unref();
  }
  return cacheCategorias;
}

ingesta.post('/eventos', limitadores.ingesta, autenticarAgente, asincrono(async (req, res) => {
  const { eventos } = esquemas.lote.parse(req.body);
  const mapa = await categorias();
  const ahora = Date.now();
  const filas = [];
  const rechazados = [];

  eventos.forEach((e, i) => {
    const idCat = mapa.get(e.categoria);
    const fecha = e.fecha ? new Date(e.fecha) : new Date(ahora);
    if (!idCat) return rechazados.push({ indice: i, motivo: `Categoría desconocida: ${e.categoria}` });
    // Se aceptan eventos de hasta 7 días de antigüedad y 5 minutos en el futuro (desfase de reloj).
    if (fecha.getTime() < ahora - 7 * 864e5 || fecha.getTime() > ahora + 5 * 6e4) {
      return rechazados.push({ indice: i, motivo: 'Fecha fuera del rango aceptado.' });
    }
    filas.push([fecha.toISOString(), idCat, e.ip_origen ?? null, e.usuario_objetivo ?? null, e.mensaje ?? null,
      e.datos ? JSON.stringify(e.datos) : null]);
  });

  if (filas.length) {
    // Inserción masiva en una sola sentencia usando arreglos (UNNEST): eficiente y parametrizada.
    const col = (i) => filas.map((f) => f[i]);
    await pool.query(
      `INSERT INTO eventos (fecha_evento, id_activo, id_categoria, ip_origen, usuario_objetivo, mensaje, datos)
       SELECT f, $1, c, ip, u, m, d::jsonb
         FROM UNNEST($2::timestamptz[], $3::smallint[], $4::inet[], $5::text[], $6::text[], $7::text[])
              AS t(f, c, ip, u, m, d)`,
      [req.activo.id_activo, col(0), col(1), col(2), col(3), col(4), col(5)]
    );
  }

  // Agrupa por (categoría, IP) y evalúa las reglas de correlación
  const grupos = new Map();
  const porCategoria = {};
  for (const f of filas) {
    grupos.set(`${f[1]}|${f[2]}`, { id_categoria: f[1], ip_origen: f[2] });
    porCategoria[f[1]] = (porCategoria[f[1]] || 0) + 1;
  }
  const alertas = filas.length ? await detector.evaluarLote(req.activo, [...grupos.values()]) : [];

  if (filas.length) {
    tiempoReal.emitir(req.activo.id_organizacion, 'eventos:recibidos', {
      activo: req.activo.nombre, cantidad: filas.length, por_categoria: porCategoria, fecha: new Date().toISOString(),
    });
  }
  res.status(202).json({ aceptados: filas.length, rechazados, alertas_generadas: alertas.length });
}));

// ---------------------------------------------------------------------------
// Consulta (usuarios): GET /api/v1/eventos  con paginación por cursor
// ---------------------------------------------------------------------------
const consulta = express.Router();

consulta.get('/', asincrono(async (req, res) => {
  const f = esquemas.filtroEventos.parse(req.query);
  const hasta = f.hasta ? new Date(f.hasta) : new Date();
  const desde = f.desde ? new Date(f.desde) : new Date(hasta.getTime() - 24 * 3600 * 1000);
  if (desde > hasta) throw new ErrorHttp(400, 'rango_invalido', 'La fecha "desde" debe ser anterior a "hasta".');
  if (hasta - desde > 31 * 864e5) throw new ErrorHttp(400, 'rango_excesivo', 'El rango máximo de consulta es de 31 días.');

  const org = req.usuario.rol === 'cliente' ? req.usuario.idOrganizacion : null;
  // El filtro por fecha_evento permite a PostgreSQL leer solo las particiones necesarias (partition pruning).
  const { rows } = await query(
    `SELECT e.id_evento::text, e.fecha_evento, host(e.ip_origen) AS ip_origen, e.usuario_objetivo, e.mensaje,
            c.codigo AS categoria, c.nombre AS categoria_nombre, c.severidad_base AS severidad,
            a.nombre AS activo, o.razon_social AS organizacion
       FROM eventos e
       JOIN activos a ON a.id_activo = e.id_activo
       JOIN organizaciones o ON o.id_organizacion = a.id_organizacion
       JOIN categorias_evento c ON c.id_categoria = e.id_categoria
      WHERE e.fecha_evento BETWEEN $1 AND $2
        AND ($3::int IS NULL OR a.id_organizacion = $3)
        AND ($4::smallint IS NULL OR e.id_categoria = $4)
        AND ($5::int IS NULL OR e.id_activo = $5)
        AND ($6::inet IS NULL OR e.ip_origen = $6)
        AND ($7::bigint IS NULL OR e.id_evento < $7)
      ORDER BY e.id_evento DESC
      LIMIT $8`,
    [desde, hasta, org, f.id_categoria ?? null, f.id_activo ?? null, f.ip ?? null, f.antes_de ?? null, f.limite]
  );
  res.json({
    eventos: rows,
    siguiente_cursor: rows.length === f.limite ? rows[rows.length - 1].id_evento : null,
    rango: { desde, hasta },
  });
}));

module.exports = { ingesta, consulta };
