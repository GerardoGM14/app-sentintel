'use strict';
/** Esquemas de validación de entrada (lista blanca): todo dato externo se valida antes de usarse. */
const { z } = require('zod');
const { normalizarRut } = require('../services/rut');
const net = require('net');

const SEVERIDADES = ['baja', 'media', 'alta', 'critica'];
const ESTADOS_ALERTA = ['abierta', 'en_revision', 'resuelta', 'falso_positivo'];
const ESTADOS_INCIDENTE = ['reportado', 'en_analisis', 'contenido', 'cerrado'];

const texto = (min, max, etiqueta) => z.string({ error: `${etiqueta} es obligatorio.` })
  .trim()
  .min(min, `${etiqueta} debe tener al menos ${min} caracteres.`)
  .max(max, `${etiqueta} admite como máximo ${max} caracteres.`)
  .refine((v) => !/[<>]/.test(v), `${etiqueta} contiene caracteres no permitidos (< >).`);

const nombrePersona = (etiqueta) => texto(2, 60, etiqueta)
  .refine((v) => /^[\p{L}][\p{L}\s'.-]*$/u.test(v), `${etiqueta} solo admite letras.`);

const email = z.string({ error: 'El correo es obligatorio.' }).trim().toLowerCase()
  .max(254, 'Correo demasiado largo.')
  .pipe(z.email('Ingrese un correo electrónico válido.'));

/** Política de contraseñas alineada con NIST SP 800-63B: longitud mínima y complejidad básica. */
const password = z.string({ error: 'La contraseña es obligatoria.' })
  .min(10, 'La contraseña debe tener al menos 10 caracteres.')
  .max(64, 'La contraseña admite como máximo 64 caracteres.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v),
    'La contraseña debe combinar mayúsculas, minúsculas y números.');

const ip = z.string().trim().refine((v) => net.isIP(v) !== 0, 'Dirección IP inválida.');
const ipOpcional = z.union([ip, z.literal('').transform(() => null), z.null()]).optional();
const id = z.coerce.number().int().positive();
const idOpcional = z.union([id, z.literal('').transform(() => null), z.null()]).optional();

const confirmar = (schema) => schema.refine((d) => d.password === d.confirmacion, {
  path: ['confirmacion'], message: 'Las contraseñas no coinciden.',
});

const esquemas = {
  registro: confirmar(z.object({
    rut: z.string({ error: 'El RUT es obligatorio.' }).transform((v, ctx) => {
      const r = normalizarRut(v);
      if (!r) ctx.addIssue({ code: 'custom', message: 'RUT inválido (revise el dígito verificador).' });
      return r ?? z.NEVER;
    }),
    razon_social: texto(3, 150, 'La razón social'),
    rubro: texto(3, 80, 'El rubro'),
    nombre: nombrePersona('El nombre'),
    apellido: nombrePersona('El apellido'),
    email,
    password,
    confirmacion: z.string(),
  })),
  login: z.object({
    email,
    password: z.string({ error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.').max(64),
  }),
  recuperar: z.object({ email }),
  restablecer: confirmar(z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace de recuperación inválido.'),
    password,
    confirmacion: z.string(),
  })),
  perfil: z.object({ nombre: nombrePersona('El nombre'), apellido: nombrePersona('El apellido'), email }),
  cambioPassword: confirmar(z.object({
    actual: z.string().min(1, 'Ingrese su contraseña actual.').max(64),
    password,
    confirmacion: z.string(),
  })).refine((d) => d.actual !== d.password, { path: ['password'], message: 'La nueva contraseña debe ser distinta a la actual.' }),

  activo: z.object({
    nombre: texto(3, 100, 'El nombre'),
    id_tipo_activo: id,
    direccion_ip: ipOpcional,
    criticidad: z.enum(SEVERIDADES, { error: 'Seleccione una criticidad válida.' }),
  }),
  activoEstado: z.object({ activo: z.boolean() }),

  incidente: z.object({
    titulo: texto(5, 150, 'El título'),
    descripcion: texto(20, 3000, 'La descripción'),
    severidad: z.enum(SEVERIDADES, { error: 'Seleccione una severidad válida.' }),
    id_activo: idOpcional,
    id_categoria: idOpcional,
  }),
  gestionIncidente: z.object({
    estado: z.enum(ESTADOS_INCIDENTE, { error: 'Estado inválido.' }),
    respuesta_analista: texto(5, 3000, 'La respuesta').optional(),
    id_responsable: idOpcional,
  }),

  regla: z.object({
    nombre: texto(3, 100, 'El nombre'),
    descripcion: texto(10, 300, 'La descripción'),
    id_categoria: id,
    umbral: z.coerce.number({ error: 'El umbral debe ser numérico.' }).int().min(1, 'Mínimo 1.').max(100000, 'Máximo 100000.'),
    ventana_minutos: z.coerce.number({ error: 'La ventana debe ser numérica.' }).int().min(1, 'Mínimo 1 minuto.').max(1440, 'Máximo 1440 minutos (24 h).'),
    severidad: z.enum(SEVERIDADES, { error: 'Seleccione una severidad válida.' }),
    activa: z.boolean().default(true),
  }),

  gestionAlerta: z.object({
    estado: z.enum(ESTADOS_ALERTA, { error: 'Estado inválido.' }),
    id_responsable: idOpcional,
    nota_resolucion: texto(5, 1000, 'La nota').optional(),
  }).refine((d) => !['resuelta', 'falso_positivo'].includes(d.estado) || d.nota_resolucion, {
    path: ['nota_resolucion'], message: 'Para cerrar la alerta debe registrar una nota de resolución.',
  }),

  gestionUsuario: z.object({
    activo: z.boolean().optional(),
    desbloquear: z.boolean().optional(),
  }),

  /** Ingesta: lote de 1 a 500 eventos enviados por un agente. */
  lote: z.object({
    eventos: z.array(z.object({
      categoria: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,30}$/, 'Código de categoría inválido.'),
      fecha: z.iso.datetime({ offset: true, error: 'Fecha ISO 8601 inválida.' }).optional(),
      ip_origen: ip.optional(),
      usuario_objetivo: z.string().trim().max(100).optional(),
      mensaje: z.string().trim().max(500).optional(),
      datos: z.record(z.string(), z.unknown()).optional()
        .refine((d) => !d || JSON.stringify(d).length <= 4096, 'El campo datos supera 4 KB.'),
    })).min(1, 'Debe enviar al menos un evento.').max(500, 'Máximo 500 eventos por lote.'),
  }),

  filtroEventos: z.object({
    desde: z.iso.datetime({ offset: true }).optional(),
    hasta: z.iso.datetime({ offset: true }).optional(),
    id_categoria: id.optional(),
    id_activo: id.optional(),
    ip: ip.optional(),
    antes_de: z.string().regex(/^\d+$/).optional(), // cursor: id_evento
    limite: z.coerce.number().int().min(1).max(200).default(50),
  }),
};

module.exports = { esquemas, SEVERIDADES, ESTADOS_ALERTA, ESTADOS_INCIDENTE };
