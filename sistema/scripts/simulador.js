#!/usr/bin/env node
'use strict';
/**
 * Simulador de agentes de recolección. Envía por la API REST lotes de eventos "normales"
 * y, periódicamente, ráfagas de ataque (fuerza bruta, escaneo de puertos, inyección SQL)
 * para demostrar la ingesta masiva y la detección en tiempo real.
 *
 * Uso:
 *   node scripts/simulador.js [--url http://localhost:3100] [--segundos 120] [--eps 40]
 * Las API keys se leen de .simulador-claves.json (creado por el seed) o de SIM_API_KEYS (separadas por coma).
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const URL_BASE = (args.url || process.env.SIM_URL || 'http://localhost:3100').replace(/\/$/, '');
const SEGUNDOS = Number(args.segundos || 120);
const EPS = Number(args.eps || 40); // eventos por segundo (aprox.)

function cargarClaves() {
  if (process.env.SIM_API_KEYS) return process.env.SIM_API_KEYS.split(',').map((k, i) => ({ activo: `agente-${i + 1}`, api_key: k.trim() }));
  const archivo = path.join(__dirname, '..', '.simulador-claves.json');
  if (!fs.existsSync(archivo)) {
    console.error('No se encontraron API keys. Ejecute "npm run db:seed" o defina SIM_API_KEYS.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(archivo, 'utf8'));
}

const agentes = cargarClaves();
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
const ipAzar = (pref = '181.43') => `${pref}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 253)}`;
const USUARIOS = ['admin', 'root', 'ventas', 'contabilidad', 'soporte', 'gerencia'];

function eventoNormal() {
  const r = Math.random();
  if (r < 0.45) return { categoria: 'AUTH_EXITOSA', ip_origen: ipAzar('10.0'), usuario_objetivo: azar(USUARIOS), mensaje: 'Inicio de sesión correcto' };
  if (r < 0.75) return { categoria: 'HTTP_4XX', ip_origen: ipAzar(), mensaje: `GET /${azar(['wp-admin', 'favicon.ico', 'api/v2', 'old'])} 404`, datos: { metodo: 'GET', estado: 404 } };
  if (r < 0.92) return { categoria: 'CONEXION_BLOQUEADA', ip_origen: ipAzar('45.155'), mensaje: 'DROP TCP', datos: { puerto: azar([22, 23, 445, 3389]) } };
  return { categoria: 'AUTH_FALLIDA', ip_origen: ipAzar('10.0'), usuario_objetivo: azar(USUARIOS), mensaje: 'Contraseña incorrecta' };
}

const ATAQUES = [
  { nombre: 'Fuerza bruta SSH', crear: (ip) => Array.from({ length: 12 }, () => ({ categoria: 'AUTH_FALLIDA', ip_origen: ip, usuario_objetivo: azar(['root', 'admin']), mensaje: 'Failed password for root (ssh)', datos: { servicio: 'sshd', puerto: 22 } })) },
  { nombre: 'Escaneo de puertos', crear: (ip) => Array.from({ length: 40 }, (_, i) => ({ categoria: 'ESCANEO_PUERTOS', ip_origen: ip, mensaje: `SYN a puerto ${20 + i}`, datos: { puerto: 20 + i } })) },
  { nombre: 'Inyección SQL', crear: (ip) => Array.from({ length: 5 }, () => ({ categoria: 'INYECCION_SQL', ip_origen: ip, mensaje: "GET /productos?id=1' OR '1'='1", datos: { waf: 'regla 942100' } })) },
];

async function enviar(agente, eventos) {
  const r = await fetch(`${URL_BASE}/api/v1/ingesta/eventos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': agente.api_key },
    body: JSON.stringify({ eventos }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${cuerpo?.error?.mensaje || ''}`);
  return cuerpo;
}

(async () => {
  console.log(`Simulador → ${URL_BASE} · ${agentes.length} agentes · ~${EPS} eventos/s · ${SEGUNDOS}s`);
  let total = 0, alertas = 0;
  const inicio = Date.now();
  for (let s = 1; s <= SEGUNDOS; s++) {
    const t0 = Date.now();
    const lotes = new Map();
    for (let i = 0; i < EPS; i++) {
      const ag = azar(agentes);
      if (!lotes.has(ag)) lotes.set(ag, []);
      lotes.get(ag).push(eventoNormal());
    }
    if (s % 10 === 0) { // cada 10 s, un ataque
      const ataque = azar(ATAQUES);
      const victima = azar(agentes);
      const ipAtacante = ipAzar('185.220');
      lotes.set(victima, [...(lotes.get(victima) || []), ...ataque.crear(ipAtacante)]);
      console.log(`  [${s}s] Ataque simulado: ${ataque.nombre} desde ${ipAtacante} contra "${victima.activo}"`);
    }
    const resultados = await Promise.allSettled([...lotes].map(([ag, ev]) => enviar(ag, ev)));
    for (const r of resultados) {
      if (r.status === 'fulfilled') { total += r.value.aceptados; alertas += r.value.alertas_generadas; } else console.error('  Error:', r.reason.message);
    }
    if (s % 5 === 0) console.log(`  [${s}s] ${total} eventos enviados · ${alertas} alertas generadas`);
    await new Promise((res) => setTimeout(res, Math.max(0, 1000 - (Date.now() - t0))));
  }
  const seg = (Date.now() - inicio) / 1000;
  console.log(`Fin: ${total} eventos en ${seg.toFixed(1)} s (${(total / seg).toFixed(0)} ev/s) · ${alertas} alertas.`);
})();
