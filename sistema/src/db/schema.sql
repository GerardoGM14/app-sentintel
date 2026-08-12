-- =====================================================================
-- SentinelaPyME - Esquema relacional (PostgreSQL 16) en Tercera Forma Normal
-- 12 tablas. La tabla de hechos "eventos" se particiona por rango mensual
-- para soportar grandes volúmenes (Big Data) con poda de particiones.
-- El script es idempotente: puede ejecutarse varias veces.
-- =====================================================================

-- ---------- Catálogos ----------
CREATE TABLE IF NOT EXISTS roles (
  id_rol        SMALLINT     PRIMARY KEY,
  nombre        VARCHAR(30)  NOT NULL UNIQUE,
  descripcion   VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS tipos_activo (
  id_tipo_activo SMALLSERIAL  PRIMARY KEY,
  nombre         VARCHAR(50)  NOT NULL UNIQUE,
  descripcion    VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias_evento (
  id_categoria   SMALLSERIAL  PRIMARY KEY,
  codigo         VARCHAR(30)  NOT NULL UNIQUE,
  nombre         VARCHAR(80)  NOT NULL,
  descripcion    VARCHAR(250) NOT NULL,
  severidad_base VARCHAR(10)  NOT NULL
    CHECK (severidad_base IN ('baja','media','alta','critica'))
);

-- ---------- Organizaciones y usuarios ----------
CREATE TABLE IF NOT EXISTS organizaciones (
  id_organizacion SERIAL       PRIMARY KEY,
  rut             VARCHAR(12)  NOT NULL UNIQUE,
  razon_social    VARCHAR(150) NOT NULL,
  rubro           VARCHAR(80)  NOT NULL,
  fecha_registro  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario        SERIAL       PRIMARY KEY,
  id_rol            SMALLINT     NOT NULL REFERENCES roles(id_rol),
  id_organizacion   INT          REFERENCES organizaciones(id_organizacion) ON DELETE CASCADE,
  nombre            VARCHAR(60)  NOT NULL,
  apellido          VARCHAR(60)  NOT NULL,
  email             VARCHAR(254) NOT NULL,
  password_hash     CHAR(60)     NOT NULL,          -- bcrypt (costo 12)
  activo            BOOLEAN      NOT NULL DEFAULT TRUE,
  intentos_fallidos SMALLINT     NOT NULL DEFAULT 0,
  bloqueado_hasta   TIMESTAMPTZ,
  version_token     INT          NOT NULL DEFAULT 0, -- invalida sesiones JWT
  fecha_creacion    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultimo_acceso     TIMESTAMPTZ,
  -- Un cliente siempre pertenece a una organización (rol 2 = cliente)
  CONSTRAINT chk_cliente_con_org CHECK (id_rol <> 2 OR id_organizacion IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios (lower(email));
CREATE INDEX IF NOT EXISTS ix_usuarios_org ON usuarios (id_organizacion);

CREATE TABLE IF NOT EXISTS tokens_recuperacion (
  id_token         SERIAL      PRIMARY KEY,
  id_usuario       INT         NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  token_hash       CHAR(64)    NOT NULL UNIQUE,     -- SHA-256 del token enviado por correo
  fecha_creacion   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  fecha_uso        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_tokens_usuario ON tokens_recuperacion (id_usuario);

-- ---------- Activos monitoreados ----------
CREATE TABLE IF NOT EXISTS activos (
  id_activo       SERIAL       PRIMARY KEY,
  id_organizacion INT          NOT NULL REFERENCES organizaciones(id_organizacion) ON DELETE CASCADE,
  id_tipo_activo  SMALLINT     NOT NULL REFERENCES tipos_activo(id_tipo_activo),
  nombre          VARCHAR(100) NOT NULL,
  direccion_ip    INET,
  criticidad      VARCHAR(10)  NOT NULL CHECK (criticidad IN ('baja','media','alta','critica')),
  api_key_prefijo CHAR(8)      NOT NULL UNIQUE,     -- identifica la clave sin revelarla
  api_key_hash    CHAR(64)     NOT NULL UNIQUE,     -- SHA-256 de la clave del agente
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  fecha_registro  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ux_activo_nombre_org UNIQUE (id_organizacion, nombre)
);

-- ---------- Tabla de hechos particionada ----------
CREATE SEQUENCE IF NOT EXISTS eventos_id_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS eventos (
  id_evento        BIGINT       NOT NULL DEFAULT nextval('eventos_id_seq'),
  fecha_evento     TIMESTAMPTZ  NOT NULL,
  fecha_recepcion  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  id_activo        INT          NOT NULL REFERENCES activos(id_activo) ON DELETE CASCADE,
  id_categoria     SMALLINT     NOT NULL REFERENCES categorias_evento(id_categoria),
  ip_origen        INET,
  usuario_objetivo VARCHAR(100),
  mensaje          VARCHAR(500),
  datos            JSONB,                            -- carga útil semiestructurada del agente
  PRIMARY KEY (id_evento, fecha_evento)
) PARTITION BY RANGE (fecha_evento);

CREATE INDEX IF NOT EXISTS ix_eventos_deteccion
  ON eventos (id_activo, id_categoria, ip_origen, fecha_evento DESC);
CREATE INDEX IF NOT EXISTS ix_eventos_categoria_fecha
  ON eventos (id_categoria, fecha_evento DESC);
CREATE INDEX IF NOT EXISTS ix_eventos_fecha_brin
  ON eventos USING BRIN (fecha_evento);

-- Crea (si no existe) la partición mensual que contiene la fecha indicada
CREATE OR REPLACE FUNCTION crear_particion_eventos(p_fecha DATE) RETURNS TEXT AS $$
DECLARE
  v_inicio DATE := date_trunc('month', p_fecha)::date;
  v_fin    DATE := (date_trunc('month', p_fecha) + INTERVAL '1 month')::date;
  v_nombre TEXT := 'eventos_' || to_char(v_inicio, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF eventos FOR VALUES FROM (%L) TO (%L)',
    v_nombre, v_inicio, v_fin);
  RETURN v_nombre;
END;
$$ LANGUAGE plpgsql;

-- ---------- Detección y respuesta ----------
CREATE TABLE IF NOT EXISTS reglas_deteccion (
  id_regla        SERIAL       PRIMARY KEY,
  id_categoria    SMALLINT     NOT NULL REFERENCES categorias_evento(id_categoria),
  id_creador      INT          REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  nombre          VARCHAR(100) NOT NULL UNIQUE,
  descripcion     VARCHAR(300) NOT NULL,
  umbral          INT          NOT NULL CHECK (umbral BETWEEN 1 AND 100000),
  ventana_minutos INT          NOT NULL CHECK (ventana_minutos BETWEEN 1 AND 1440),
  severidad       VARCHAR(10)  NOT NULL CHECK (severidad IN ('baja','media','alta','critica')),
  activa          BOOLEAN      NOT NULL DEFAULT TRUE,
  fecha_creacion  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reglas_categoria ON reglas_deteccion (id_categoria) WHERE activa;

CREATE TABLE IF NOT EXISTS alertas (
  id_alerta           SERIAL       PRIMARY KEY,
  id_regla            INT          NOT NULL REFERENCES reglas_deteccion(id_regla),
  id_activo           INT          NOT NULL REFERENCES activos(id_activo) ON DELETE CASCADE,
  id_responsable      INT          REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  ip_origen           INET,
  cantidad_eventos    INT          NOT NULL CHECK (cantidad_eventos > 0),
  fecha_primer_evento TIMESTAMPTZ  NOT NULL,
  fecha_ultimo_evento TIMESTAMPTZ  NOT NULL,
  fecha_generada      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  estado              VARCHAR(15)  NOT NULL DEFAULT 'abierta'
    CHECK (estado IN ('abierta','en_revision','resuelta','falso_positivo')),
  nota_resolucion     VARCHAR(1000),
  fecha_cierre        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_alertas_estado_fecha ON alertas (estado, fecha_generada DESC);
CREATE INDEX IF NOT EXISTS ix_alertas_activo ON alertas (id_activo);
CREATE INDEX IF NOT EXISTS ix_alertas_dedup ON alertas (id_regla, id_activo, ip_origen)
  WHERE estado IN ('abierta','en_revision');

CREATE TABLE IF NOT EXISTS incidentes (
  id_incidente        SERIAL        PRIMARY KEY,
  id_reportado_por    INT           NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  id_activo           INT           REFERENCES activos(id_activo) ON DELETE SET NULL,
  id_categoria        SMALLINT      REFERENCES categorias_evento(id_categoria),
  id_responsable      INT           REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  titulo              VARCHAR(150)  NOT NULL,
  descripcion         VARCHAR(3000) NOT NULL,
  severidad           VARCHAR(10)   NOT NULL CHECK (severidad IN ('baja','media','alta','critica')),
  estado              VARCHAR(15)   NOT NULL DEFAULT 'reportado'
    CHECK (estado IN ('reportado','en_analisis','contenido','cerrado')),
  respuesta_analista  VARCHAR(3000),
  fecha_reporte       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  fecha_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_incidentes_reportante ON incidentes (id_reportado_por);
CREATE INDEX IF NOT EXISTS ix_incidentes_estado ON incidentes (estado, fecha_reporte DESC);

-- ---------- Trazabilidad ----------
CREATE TABLE IF NOT EXISTS auditoria (
  id_auditoria BIGSERIAL   PRIMARY KEY,
  id_usuario   INT         REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  accion       VARCHAR(50) NOT NULL,
  entidad      VARCHAR(40) NOT NULL,
  id_entidad   VARCHAR(40),
  ip           INET,
  detalle      JSONB,
  fecha        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auditoria_fecha ON auditoria (fecha DESC);
