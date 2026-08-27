'use strict';
const { ZodError } = require('zod');
const config = require('../config');

class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

/** Formato de error uniforme: { error: { codigo, mensaje, detalles? } } */
function manejadorErrores(err, req, res, _next) {
  if (err instanceof ZodError) {
    const detalles = {};
    for (const issue of err.issues) {
      const campo = issue.path.join('.') || '_';
      if (!detalles[campo]) detalles[campo] = issue.message;
    }
    return res.status(400).json({ error: { codigo: 'validacion', mensaje: 'Revise los datos ingresados.', detalles } });
  }
  if (err instanceof ErrorHttp) {
    return res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message, detalles: err.detalles } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { codigo: 'json_invalido', mensaje: 'El cuerpo de la petición no es JSON válido.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { codigo: 'carga_excesiva', mensaje: 'La petición supera el tamaño permitido.' } });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: { codigo: 'duplicado', mensaje: 'Ya existe un registro con esos datos.' } });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: { codigo: 'referencia_invalida', mensaje: 'Un dato relacionado no existe.' } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    error: { codigo: 'error_interno', mensaje: 'Ocurrió un error inesperado.', ...(config.esProduccion ? {} : { traza: err.message }) },
  });
}

function noEncontrado(req, res) {
  res.status(404).json({ error: { codigo: 'no_encontrado', mensaje: `Ruta no encontrada: ${req.method} ${req.path}` } });
}

/** Envuelve controladores async para delegar errores al manejador central. */
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ErrorHttp, manejadorErrores, noEncontrado, asincrono };
