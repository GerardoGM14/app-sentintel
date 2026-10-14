(function () {
  'use strict';
  const { $, api, enlazarFormulario, avisoFormulario, redirigirSiHaySesion } = window.SP;
  const form = $('#form-login');
  const params = new URLSearchParams(location.search);

  redirigirSiHaySesion();
  if (params.has('expirada')) avisoFormulario(form, 'Su sesión expiró. Ingrese nuevamente.', 'info');
  if (params.has('restablecida')) avisoFormulario(form, 'Contraseña actualizada. Ya puede iniciar sesión.', 'exito');

  enlazarFormulario(form, {
    enviar: (datos) => api('/auth/login', { metodo: 'POST', cuerpo: datos, redirigir401: false }),
    alExito: () => {
      const volver = params.get('volver');
      // Solo se permiten rutas internas (evita redirecciones abiertas)
      location.href = volver && /^\/[a-z]+\.html$/.test(volver) ? volver : '/panel.html';
    },
  });
})();
