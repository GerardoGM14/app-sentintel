'use strict';
const nodemailer = require('nodemailer');
const config = require('../config');

let transporte = null;
if (config.smtp.host) {
  transporte = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,          // true = TLS implícito (465); false = STARTTLS (587)
    requireTLS: !config.smtp.secure,     // exige cifrar la conexión SMTP
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function enviarRecuperacion(destino, nombre, enlace) {
  const asunto = 'SentinelaPyME - Restablecer contraseña';
  const texto = `Hola ${nombre}:\n\nRecibimos una solicitud para restablecer tu contraseña. ` +
    `Abre el siguiente enlace (válido por ${config.seguridad.minutosTokenRecuperacion} minutos y de un solo uso):\n\n${enlace}\n\n` +
    'Si no solicitaste este cambio, ignora este mensaje: tu contraseña actual seguirá funcionando.\n\nEquipo SentinelaPyME';
  const html = `<p>Hola ${escapar(nombre)}:</p>
    <p>Recibimos una solicitud para restablecer tu contraseña. El enlace es válido por
    ${config.seguridad.minutosTokenRecuperacion} minutos y puede usarse una sola vez.</p>
    <p><a href="${escapar(enlace)}">Restablecer contraseña</a></p>
    <p>Si no solicitaste este cambio, ignora este mensaje.</p><p>Equipo SentinelaPyME</p>`;

  if (!transporte) {
    console.log(`\n[correo:desarrollo] Para: ${destino}\n[correo:desarrollo] Enlace de recuperación: ${enlace}\n`);
    return;
  }
  await transporte.sendMail({ from: config.smtp.from, to: destino, subject: asunto, text: texto, html });
}

module.exports = { enviarRecuperacion };
