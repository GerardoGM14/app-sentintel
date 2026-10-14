(function () {
  'use strict';
  const { $, api, enlazarFormulario, avisoFormulario, medidorPassword } = window.SP;
  const form = $('#form-restablecer');
  const token = new URLSearchParams(location.search).get('token') || '';
  form.elements.token.value = token;
  // Se elimina el token de la barra de direcciones y del historial.
  history.replaceState(null, '', location.pathname);
  medidorPassword($('#password'));

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    avisoFormulario(form, 'El enlace no es válido. Solicite uno nuevo desde "Recuperar contraseña".');
    form.querySelector('[type="submit"]').disabled = true;
  }

  enlazarFormulario(form, {
    validar: (d) => (d.password && d.confirmacion && d.password !== d.confirmacion ? { confirmacion: 'Las contraseñas no coinciden.' } : null),
    enviar: (datos) => api('/auth/restablecer', { metodo: 'POST', cuerpo: datos, redirigir401: false }),
    alExito: () => { location.href = '/login.html?restablecida=1'; },
  });
})();
