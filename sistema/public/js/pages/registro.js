(function () {
  'use strict';
  const { $, api, enlazarFormulario, medidorPassword, redirigirSiHaySesion } = window.SP;
  const form = $('#form-registro');
  redirigirSiHaySesion();
  medidorPassword($('#password'));

  /** Validación del RUT chileno en el cliente (módulo 11); el servidor vuelve a validarlo. */
  function rutValido(rut) {
    const limpio = rut.replace(/[.\s-]/g, '').toUpperCase();
    if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
    let suma = 0;
    let m = 2;
    for (let i = limpio.length - 2; i >= 0; i--) { suma += Number(limpio[i]) * m; m = m === 7 ? 2 : m + 1; }
    const r = 11 - (suma % 11);
    return limpio.slice(-1) === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
  }

  enlazarFormulario(form, {
    validar: (d) => {
      const e = {};
      if (d.rut && !rutValido(d.rut)) e.rut = 'El RUT no es válido (revise el dígito verificador).';
      if (d.password && !(/[a-z]/.test(d.password) && /[A-Z]/.test(d.password) && /\d/.test(d.password))) {
        e.password = 'Debe combinar mayúsculas, minúsculas y números.';
      }
      if (d.password && d.confirmacion && d.password !== d.confirmacion) e.confirmacion = 'Las contraseñas no coinciden.';
      return e;
    },
    enviar: ({ acepto, ...datos }) => api('/auth/registro', { metodo: 'POST', cuerpo: datos, redirigir401: false }),
    alExito: () => { location.href = '/activos.html?bienvenida=1'; },
  });
})();
