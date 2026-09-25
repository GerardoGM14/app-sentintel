'use strict';
const http = require('http');
const config = require('./config');
const app = require('./app');
const tiempoReal = require('./services/tiempoReal');
const { pool, asegurarParticiones } = require('./db/pool');
const { migrar } = require('./db/migrate');

async function iniciar() {
  await migrar(); // idempotente: crea tablas/particiones faltantes
  if (process.env.SEED_ON_START === 'true') {
    // Útil en hostings sin consola: carga catálogos y datos de demostración solo si no existen.
    await require('./db/seed').seed();
  }
  // Mantenimiento: cada 12 h asegura las particiones de los próximos meses.
  setInterval(() => asegurarParticiones(0, 3).catch((e) => console.error('[particiones]', e.message)), 12 * 3600 * 1000).unref();

  const servidor = http.createServer(app);
  tiempoReal.iniciar(servidor);
  servidor.listen(config.port, () => {
    console.log(`[servidor] SentinelaPyME escuchando en ${config.appUrl} (puerto ${config.port}, ${config.env})`);
  });

  const apagar = () => {
    console.log('[servidor] Cerrando...');
    servidor.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', apagar);
  process.on('SIGINT', apagar);
}

iniciar().catch((err) => {
  console.error('[servidor] No se pudo iniciar:', err);
  process.exit(1);
});
