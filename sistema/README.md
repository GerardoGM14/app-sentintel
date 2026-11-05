# SentinelaPyME

Plataforma web para centralizar y analizar en tiempo real los eventos de seguridad (logs) de pequeñas y medianas empresas. Recibe eventos de los activos de cada pyme (servidores, firewalls, aplicaciones web) a través de una API REST, los guarda en PostgreSQL en tablas particionadas por mes, aplica reglas de correlación para detectar ataques (fuerza bruta, escaneo de puertos, inyección SQL, malware) y avisa en tiempo real por WebSocket.

**Stack:** Node.js 22 · Express 4 · PostgreSQL 16 · Socket.IO 4 · HTML/CSS/JavaScript propios (sin frameworks de estilo).

## Perfiles

| Perfil | Puede |
|---|---|
| **Cliente** (usuario de la pyme) | Registrar y administrar sus activos y API keys, ver sus eventos y alertas, reportar incidentes, editar su perfil. |
| **Administrador** (analista de seguridad) | Ver todas las organizaciones, gestionar alertas e incidentes, crear y editar reglas de detección, activar/desactivar/desbloquear usuarios y revisar la auditoría. |

## Ejecución local

Requisitos: Node.js 20 o superior y Docker (o un PostgreSQL 16 propio).

```bash
cp .env.example .env            # ajustar valores si es necesario
docker compose up -d            # PostgreSQL en localhost:5433
npm install
npm run db:setup                # crea esquema + particiones + datos de demostración (~120.000 eventos)
npm start                       # http://localhost:3100
```

En otra terminal, para generar tráfico y ataques en vivo:

```bash
npm run simular -- --segundos 120 --eps 40
```

Pruebas de extremo a extremo (con el servidor levantado): `npm test`

### Cuentas de demostración

| Perfil | Correo | Contraseña |
|---|---|---|
| Administrador | admin@sentinelapyme.cl | Admin#Sentinela2026 |
| Cliente | cliente@losandes.cl | Cliente#Demo2026 |
| Cliente | cliente@sonrisa.cl | Cliente#Demo2026 |

Si `SMTP_HOST` está vacío, el enlace de recuperación de contraseña se imprime en la consola del servidor.

## Despliegue en Render (gratuito)

1. Subir esta carpeta a un repositorio de GitHub.
2. En Render: **New → Blueprint**, seleccionar el repositorio. Render lee `render.yaml` y crea el servicio web y la base de datos PostgreSQL.
3. Completar las variables que pide el asistente:
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD` (cuenta de administrador inicial; la contraseña debe tener al menos 10 caracteres y combinar mayúsculas, minúsculas y números).
   - SMTP para la recuperación de contraseña. Por ejemplo, con Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=<correo>`, `SMTP_PASS=<contraseña de aplicación>`. Con Brevo: `smtp-relay.brevo.com`.
4. En el primer arranque, `SEED_ON_START=true` crea el esquema y los datos de demostración. Después se puede cambiar a `false`.
5. La URL pública queda como `https://sentinela-pyme.onrender.com` (o similar).

Para usar el simulador contra el hosting: iniciar sesión como cliente, **rotar la clave** de un activo, copiar la API key y ejecutar:

```bash
SIM_API_KEYS=sp_xxx_yyy npm run simular -- --url https://sentinela-pyme.onrender.com --eps 10
```

Alternativas: base de datos en **Neon** o **Supabase** (`DATABASE_SSL=true`) y servicio web en Render o Railway. También hay un `Dockerfile`.

## Documentación de la API

- Swagger UI: `/api/docs`
- Especificación OpenAPI 3: `/api/openapi.json` (fuente: `src/docs/openapi.yaml`)

## Estructura

```
src/
  app.js              Configuración de Express (Helmet/CSP, rutas, estáticos)
  server.js           Arranque HTTP + Socket.IO + mantenimiento de particiones
  config.js           Variables de entorno
  db/                 schema.sql (3FN, 12 tablas), migrate.js, seed.js, pool.js
  middleware/         auth (JWT, RBAC, API key), esquemas (validación zod), seguridad (rate limit, origen), errores
  routes/             auth, perfil, activos, eventos (ingesta/consulta), alertas, incidentes, administracion, panel
  services/           detector (correlación), tiempoReal (Socket.IO), correo, cripto, auditoria, rut
  docs/openapi.yaml   Documentación de la API
public/               Frontend: HTML + CSS propio responsive + JavaScript (sin frameworks)
scripts/simulador.js  Generador de tráfico y ataques
tests/smoke.js        17 pruebas de extremo a extremo
```
