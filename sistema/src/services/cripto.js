'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

const hashPassword = (plano) => bcrypt.hash(plano, config.bcryptCost);
const verificarPassword = (plano, hash) => bcrypt.compare(plano, hash);

/** Hash SHA-256 para secretos de alta entropía (tokens y API keys); no se guardan en claro. */
const sha256 = (valor) => crypto.createHash('sha256').update(valor).digest('hex');

/** Token aleatorio criptográficamente seguro (256 bits) codificado en base64url. */
const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Genera una API key para un agente: "sp_<prefijo>_<secreto>". */
function generarApiKey() {
  const prefijo = crypto.randomBytes(4).toString('hex'); // 8 caracteres
  const secreto = tokenAleatorio(32);
  const clave = `sp_${prefijo}_${secreto}`;
  return { clave, prefijo, hash: sha256(clave) };
}

/** Hash bcrypt de referencia para igualar tiempos cuando el usuario no existe. */
const HASH_FICTICIO = bcrypt.hashSync('contraseña-ficticia-para-tiempo-constante', 10);

module.exports = { hashPassword, verificarPassword, sha256, tokenAleatorio, generarApiKey, HASH_FICTICIO };
