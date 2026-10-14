(function () {
  'use strict';
  const { $, api, enlazarFormulario, avisoFormulario } = window.SP;
  const form = $('#form-recuperar');
  enlazarFormulario(form, {
    enviar: (datos) => api('/auth/recuperar', { metodo: 'POST', cuerpo: datos, redirigir401: false }),
    alExito: (r) => { avisoFormulario(form, r.mensaje, 'exito'); form.reset(); },
  });
})();
