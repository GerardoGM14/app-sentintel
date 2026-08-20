'use strict';
/** Normaliza y valida un RUT chileno con su dígito verificador (módulo 11). */
function normalizarRut(rut) {
  const limpio = String(rut).replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado ? `${cuerpo}-${dv}` : null;
}

function calcularDv(cuerpo) {
  for (const dv of '0123456789K') if (normalizarRut(`${cuerpo}${dv}`)) return dv;
  return null;
}

module.exports = { normalizarRut, calcularDv };
