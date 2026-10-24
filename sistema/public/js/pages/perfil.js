(function () {
  'use strict';
  const { $, api, fecha, etiqueta, enlazarFormulario, avisoFormulario, medidorPassword, iniciarPagina } = window.SP;

  iniciarPagina({ titulo: 'Mi perfil' }).then(async () => {
    const { perfil } = await api('/perfil');
    const form = $('#form-perfil');
    form.elements.nombre.value = perfil.nombre;
    form.elements.apellido.value = perfil.apellido;
    form.elements.email.value = perfil.email;
    $('#datos-organizacion').textContent = perfil.razon_social
      ? `${etiqueta(perfil.rol)} de ${perfil.razon_social} (RUT ${perfil.rut}, ${perfil.rubro}). Cuenta creada el ${fecha(perfil.fecha_creacion)}.`
      : `${etiqueta(perfil.rol)} de la plataforma. Cuenta creada el ${fecha(perfil.fecha_creacion)}.`;

    enlazarFormulario(form, {
      enviar: (d) => api('/perfil', { metodo: 'PUT', cuerpo: d }),
      alExito: (r) => avisoFormulario(form, r.mensaje, 'exito'),
    });

    const formPass = $('#form-password');
    medidorPassword($('#password'));
    enlazarFormulario(formPass, {
      validar: (d) => {
        const e = {};
        if (d.password && !(/[a-z]/.test(d.password) && /[A-Z]/.test(d.password) && /\d/.test(d.password))) e.password = 'Debe combinar mayúsculas, minúsculas y números.';
        if (d.password && d.confirmacion && d.password !== d.confirmacion) e.confirmacion = 'Las contraseñas no coinciden.';
        return e;
      },
      enviar: (d) => api('/perfil/password', { metodo: 'PUT', cuerpo: d }),
      alExito: (r) => { formPass.reset(); avisoFormulario(formPass, r.mensaje, 'exito'); },
    });
  });
})();
