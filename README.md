# app-sentintel

**SentinelaPyME**: plataforma web para centralizar y analizar en tiempo real los eventos de seguridad de pequeñas y medianas empresas. Proyecto de Título.

| Carpeta | Contenido |
|---|---|
| [`sistema/`](sistema/) | Aplicación web: Node.js + Express, PostgreSQL 16 particionado, Socket.IO y frontend con CSS propio. Ver [sistema/README.md](sistema/README.md). |
| [`informe/`](informe/) | Informe de la Evaluación Sumativa N.º 2 (APA 7), diagramas y capturas del sistema. |

## Inicio rápido

```bash
cd sistema
cp .env.example .env
docker compose up -d
npm install
npm run db:setup
npm start          # http://localhost:3100
```
