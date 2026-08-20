'use strict';
/**
 * Datos iniciales: catálogos, reglas, usuarios de demostración, activos con API keys
 * y un volumen histórico de eventos (por defecto 120.000) para demostrar el manejo masivo.
 * Es idempotente en catálogos; los datos de demostración se crean solo si no existen.
 */
const fs = require('fs');
const path = require('path');
const { pool, transaccion } = require('./pool');
const { hashPassword, generarApiKey } = require('../services/cripto');
const { calcularDv } = require('../services/rut');

const ROLES = [
  [1, 'administrador', 'Analista de seguridad de la plataforma: gestiona reglas, alertas, incidentes y usuarios.'],
  [2, 'cliente', 'Usuario de una pyme: registra activos, consulta sus eventos y alertas y reporta incidentes.'],
];
const TIPOS = [
  ['Servidor', 'Servidor físico o virtual (Linux/Windows).'],
  ['Estación de trabajo', 'Computador de escritorio o portátil de un colaborador.'],
  ['Firewall / Router', 'Dispositivo perimetral de red.'],
  ['Aplicación web', 'Sitio o sistema web expuesto a Internet.'],
  ['Base de datos', 'Motor de base de datos.'],
  ['Dispositivo IoT', 'Cámaras, sensores u otros dispositivos conectados.'],
];
const CATEGORIAS = [
  ['AUTH_FALLIDA', 'Inicio de sesión fallido', 'Intento de autenticación rechazado.', 'media'],
  ['AUTH_EXITOSA', 'Inicio de sesión exitoso', 'Autenticación correcta de un usuario.', 'baja'],
  ['ESCANEO_PUERTOS', 'Escaneo de puertos', 'Conexiones secuenciales a múltiples puertos desde un mismo origen.', 'alta'],
  ['MALWARE', 'Malware detectado', 'El antivirus/EDR detectó software malicioso.', 'critica'],
  ['INYECCION_SQL', 'Intento de inyección SQL', 'El WAF detectó un patrón de inyección SQL en una petición.', 'critica'],
  ['XSS', 'Intento de XSS', 'El WAF detectó un patrón de cross-site scripting.', 'alta'],
  ['CONEXION_BLOQUEADA', 'Conexión bloqueada', 'El firewall rechazó una conexión entrante.', 'media'],
  ['HTTP_4XX', 'Error HTTP 4xx', 'Petición web rechazada (404, 403, 401...).', 'baja'],
  ['CAMBIO_PRIVILEGIOS', 'Cambio de privilegios', 'Se modificaron los permisos de una cuenta.', 'alta'],
  ['ACCESO_FUERA_HORARIO', 'Acceso fuera de horario', 'Inicio de sesión fuera del horario laboral definido.', 'media'],
];
const REGLAS = [
  ['AUTH_FALLIDA', 'Fuerza bruta de credenciales', 'Cinco o más inicios de sesión fallidos desde la misma IP sobre un activo en 5 minutos.', 5, 5, 'alta'],
  ['ESCANEO_PUERTOS', 'Reconocimiento por escaneo de puertos', 'Veinte o más sondeos de puertos desde una misma IP en 2 minutos.', 20, 2, 'alta'],
  ['MALWARE', 'Malware en activo', 'Cualquier detección de malware genera una alerta inmediata.', 1, 60, 'critica'],
  ['INYECCION_SQL', 'Ataque de inyección SQL', 'Tres o más intentos de inyección SQL desde la misma IP en 10 minutos.', 3, 10, 'critica'],
  ['XSS', 'Ataque de cross-site scripting', 'Tres o más intentos de XSS desde la misma IP en 10 minutos.', 3, 10, 'alta'],
  ['CONEXION_BLOQUEADA', 'Tráfico bloqueado masivo', 'Cincuenta o más conexiones bloqueadas desde una IP en 5 minutos.', 50, 5, 'media'],
  ['HTTP_4XX', 'Enumeración de rutas web', 'Cien o más errores 4xx desde una IP en 5 minutos (posible fuzzing).', 100, 5, 'baja'],
  ['CAMBIO_PRIVILEGIOS', 'Escalamiento de privilegios', 'Cualquier cambio de privilegios genera alerta para su revisión.', 1, 60, 'alta'],
];

async function seed() {
  await transaccion(async (c) => {
    for (const r of ROLES) {
      await c.query(`INSERT INTO roles VALUES ($1,$2,$3) ON CONFLICT (id_rol) DO UPDATE SET descripcion = EXCLUDED.descripcion`, r);
    }
    for (const t of TIPOS) {
      await c.query(`INSERT INTO tipos_activo (nombre, descripcion) VALUES ($1,$2) ON CONFLICT (nombre) DO NOTHING`, t);
    }
    for (const cat of CATEGORIAS) {
      await c.query(`INSERT INTO categorias_evento (codigo, nombre, descripcion, severidad_base) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (codigo) DO NOTHING`, cat);
    }
  });
  console.log('[seed] Catálogos listos.');

  // ---- Administrador ----
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@sentinelapyme.cl').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'Admin#Sentinela2026';
  let { rows: [admin] } = await pool.query('SELECT id_usuario FROM usuarios WHERE lower(email) = $1', [adminEmail]);
  if (!admin) {
    ({ rows: [admin] } = await pool.query(
      `INSERT INTO usuarios (id_rol, nombre, apellido, email, password_hash) VALUES (1, 'Camila', 'Rojas', $1, $2) RETURNING id_usuario`,
      [adminEmail, await hashPassword(adminPass)]
    ));
    console.log(`[seed] Administrador creado: ${adminEmail}`);
  }

  for (const [codigo, nombre, descripcion, umbral, ventana, severidad] of REGLAS) {
    await pool.query(
      `INSERT INTO reglas_deteccion (id_categoria, id_creador, nombre, descripcion, umbral, ventana_minutos, severidad)
       SELECT id_categoria, $2, $3, $4, $5, $6, $7 FROM categorias_evento WHERE codigo = $1
       ON CONFLICT (nombre) DO NOTHING`,
      [codigo, admin.id_usuario, nombre, descripcion, umbral, ventana, severidad]
    );
  }
  console.log('[seed] Reglas de detección listas.');

  // ---- Organizaciones de demostración ----
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM organizaciones');
  if (n > 0) {
    console.log('[seed] Ya existen organizaciones: se omiten los datos de demostración.');
    return;
  }

  const demo = [
    { rut: `76543210-${calcularDv('76543210')}`, razon: 'Comercial Los Andes SpA', rubro: 'Comercio minorista',
      usuario: ['Diego', 'Muñoz', 'cliente@losandes.cl', 'Cliente#Demo2026'],
      activos: [['Servidor web tienda', 4, '200.54.10.21', 'critica'], ['Firewall perimetral', 3, '200.54.10.1', 'alta'],
                ['ERP contable', 1, '10.0.0.15', 'alta'], ['Notebook gerencia', 2, '10.0.0.52', 'media']] },
    { rut: `77889900-${calcularDv('77889900')}`, razon: 'Clínica Dental Sonrisa Ltda.', rubro: 'Salud',
      usuario: ['Valentina', 'Soto', 'cliente@sonrisa.cl', 'Cliente#Demo2026'],
      activos: [['Servidor fichas clínicas', 5, '10.1.0.10', 'critica'], ['Portal de reservas', 4, '190.98.20.33', 'alta'],
                ['Router sucursal', 3, '10.1.0.1', 'media']] },
  ];

  const claves = [];
  for (const o of demo) {
    const { rows: [org] } = await pool.query(
      'INSERT INTO organizaciones (rut, razon_social, rubro, fecha_registro) VALUES ($1,$2,$3, now() - interval \'45 days\') RETURNING id_organizacion',
      [o.rut, o.razon, o.rubro]
    );
    const [nom, ape, email, pass] = o.usuario;
    await pool.query(
      `INSERT INTO usuarios (id_rol, id_organizacion, nombre, apellido, email, password_hash, fecha_creacion)
       VALUES (2, $1, $2, $3, $4, $5, now() - interval '45 days')`,
      [org.id_organizacion, nom, ape, email, await hashPassword(pass)]
    );
    for (const [nombre, tipo, ip, criticidad] of o.activos) {
      const k = generarApiKey();
      const { rows: [a] } = await pool.query(
        `INSERT INTO activos (id_organizacion, id_tipo_activo, nombre, direccion_ip, criticidad, api_key_prefijo, api_key_hash, fecha_registro)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '40 days') RETURNING id_activo`,
        [org.id_organizacion, tipo, nombre, ip, criticidad, k.prefijo, k.hash]
      );
      claves.push({ organizacion: o.razon, activo: nombre, id_activo: a.id_activo, api_key: k.clave });
    }
    console.log(`[seed] Organización ${o.razon} (usuario ${email} / ${pass})`);
  }
  try {
    fs.writeFileSync(path.join(__dirname, '..', '..', '.simulador-claves.json'), JSON.stringify(claves, null, 2), { mode: 0o600 });
    console.log('[seed] API keys de los agentes guardadas en .simulador-claves.json (uso exclusivo del simulador).');
  } catch {
    console.log('[seed] No se pudo escribir .simulador-claves.json; rote las claves desde la interfaz para usar el simulador.');
  }

  // ---- Volumen histórico de eventos (generación masiva en SQL) ----
  const total = Number(process.env.SEED_EVENTOS || 120000);
  console.time('[seed] Eventos históricos');
  await pool.query(
    `WITH params AS (
       SELECT array_agg(id_activo) AS activos FROM activos
     ), cats AS (
       SELECT array_agg(id_categoria ORDER BY id_categoria) AS ids FROM categorias_evento
     ), base AS (
       SELECT g,
              now() - (random() * interval '29 days') AS fecha,
              (SELECT activos FROM params) AS activos,
              (SELECT ids FROM cats) AS cats,
              random() AS r
         FROM generate_series(1, $1::int) AS g
     )
     INSERT INTO eventos (fecha_evento, fecha_recepcion, id_activo, id_categoria, ip_origen, usuario_objetivo, mensaje, datos)
     SELECT fecha, fecha + interval '1 second',
            activos[1 + floor(random() * array_length(activos, 1))::int],
            -- Distribución realista: mayoría de eventos de bajo riesgo
            CASE WHEN r < 0.38 THEN cats[2]   -- AUTH_EXITOSA
                 WHEN r < 0.62 THEN cats[8]   -- HTTP_4XX
                 WHEN r < 0.80 THEN cats[7]   -- CONEXION_BLOQUEADA
                 WHEN r < 0.92 THEN cats[1]   -- AUTH_FALLIDA
                 WHEN r < 0.96 THEN cats[10]  -- ACCESO_FUERA_HORARIO
                 WHEN r < 0.98 THEN cats[3]   -- ESCANEO_PUERTOS
                 WHEN r < 0.99 THEN cats[6]   -- XSS
                 WHEN r < 0.995 THEN cats[5]  -- INYECCION_SQL
                 WHEN r < 0.998 THEN cats[9]  -- CAMBIO_PRIVILEGIOS
                 ELSE cats[4] END,            -- MALWARE
            ('181.' || (40 + floor(random() * 8))::int || '.' || floor(random() * 12)::int || '.' || (1 + floor(random() * 60))::int)::inet,
            (ARRAY['admin','root','dmunoz','vsoto','contabilidad','ventas','soporte'])[1 + floor(random() * 7)::int],
            'Evento histórico generado para pruebas de volumen',
            jsonb_build_object('origen', 'seed', 'agente', 'sentinela-agent/1.0', 'puerto', (ARRAY[22,80,443,3306,3389,8080])[1 + floor(random() * 6)::int])
       FROM base
      ORDER BY fecha`,
    [total]
  );
  console.timeEnd('[seed] Eventos históricos');

  // ---- Alertas e incidentes históricos ----
  await pool.query(
    `INSERT INTO alertas (id_regla, id_activo, ip_origen, cantidad_eventos, fecha_primer_evento, fecha_ultimo_evento, fecha_generada,
                          estado, id_responsable, nota_resolucion, fecha_cierre)
     SELECT r.id_regla, a.id_activo, ('181.47.' || floor(random()*255)::int || '.' || (1 + floor(random()*253))::int)::inet,
            r.umbral + floor(random() * 30)::int, f - interval '4 minutes', f, f,
            e.estado, CASE WHEN e.estado <> 'abierta' THEN $1::int END,
            CASE WHEN e.estado IN ('resuelta','falso_positivo') THEN 'IP bloqueada en el firewall y credenciales rotadas.' END,
            CASE WHEN e.estado IN ('resuelta','falso_positivo') THEN f + interval '3 hours' END
       FROM generate_series(1, 36) g
       CROSS JOIN LATERAL (SELECT now() - (random() * interval '20 days') AS f) t
       CROSS JOIN LATERAL (SELECT id_regla, umbral FROM reglas_deteccion ORDER BY random() + g * 0 LIMIT 1) r
       CROSS JOIN LATERAL (SELECT id_activo FROM activos ORDER BY random() + g * 0 LIMIT 1) a
       CROSS JOIN LATERAL (SELECT (ARRAY['abierta','en_revision','resuelta','resuelta','falso_positivo','abierta'])[1 + (g % 6)] AS estado) e`,
    [admin.id_usuario]
  );
  await pool.query(
    `INSERT INTO incidentes (id_reportado_por, id_activo, id_categoria, titulo, descripcion, severidad, estado, respuesta_analista, id_responsable, fecha_reporte, fecha_actualizacion)
     SELECT u.id_usuario, a.id_activo, c.id_categoria, x.titulo, x.descripcion, x.severidad, x.estado,
            CASE WHEN x.estado <> 'reportado' THEN 'Se revisaron los registros del activo y se aplicaron medidas de contención.' END,
            CASE WHEN x.estado <> 'reportado' THEN $1::int END,
            now() - x.dias * interval '1 day', now() - x.dias * interval '1 day' + interval '2 hours'
       FROM (VALUES
         ('cliente@losandes.cl', 'Servidor web tienda', 'INYECCION_SQL', 'Comportamiento extraño en el carro de compras', 'Clientes reportan errores al pagar y aparecen mensajes de base de datos en pantalla.', 'alta', 'en_analisis', 3),
         ('cliente@losandes.cl', 'Notebook gerencia', 'MALWARE', 'Correo sospechoso con adjunto ejecutado', 'El gerente abrió un adjunto de un supuesto proveedor y el equipo se volvió lento.', 'critica', 'contenido', 9),
         ('cliente@sonrisa.cl', 'Portal de reservas', 'AUTH_FALLIDA', 'Bloqueo de cuentas de pacientes', 'Varios pacientes indican que su cuenta del portal quedó bloqueada sin haber intentado ingresar.', 'media', 'reportado', 1),
         ('cliente@sonrisa.cl', 'Servidor fichas clínicas', 'CAMBIO_PRIVILEGIOS', 'Usuario con permisos de administrador desconocido', 'Detectamos una cuenta llamada soporte2 con privilegios elevados que nadie reconoce.', 'alta', 'cerrado', 15)
       ) AS x(email, activo, codigo, titulo, descripcion, severidad, estado, dias)
       JOIN usuarios u ON u.email = x.email
       JOIN activos a ON a.nombre = x.activo AND a.id_organizacion = u.id_organizacion
       JOIN categorias_evento c ON c.codigo = x.codigo`,
    [admin.id_usuario]
  );
  await pool.query('ANALYZE');
  console.log('[seed] Alertas e incidentes históricos creados.');
}

if (require.main === module) {
  seed().then(() => pool.end()).catch((e) => { console.error('[seed] Error:', e); process.exit(1); });
}
module.exports = { seed };
