(function () {
  'use strict';
  const { $, el, api, numero, etiqueta, insignia, notificar, abrirModal, campo, enlazarFormulario, iniciarPagina, catalogos } = window.SP;

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);

  async function cargar() {
    const { reglas } = await api('/admin/reglas');
    $('#tabla-reglas').replaceChildren(...reglas.map((r) => el('tr', {},
      td('Nombre', el('strong', {}, r.nombre), el('div', { class: 'texto-suave texto-chico' }, r.descripcion)),
      td('Categoría', el('code', {}, r.codigo)),
      td('Condición', `≥ ${numero(r.umbral)} eventos / ${r.ventana_minutos} min por IP`),
      td('Severidad', insignia(r.severidad)),
      td('Alertas generadas', numero(r.alertas_generadas)),
      td('Estado', insignia(r.activa ? 'activo' : 'inactivo')),
      td('Acciones', el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => formulario(r) }, 'Editar')))));
  }

  /** Formulario 3 del dominio: crear / editar regla de detección (administrador). */
  async function formulario(regla) {
    const cat = await catalogos();
    const form = el('form', { class: 'formulario' },
      el('div', { class: 'aviso', role: 'alert' }),
      campo({ etiqueta: 'Nombre', nombre: 'nombre', required: true, minlength: 3, maxlength: 100, valor: regla?.nombre }),
      campo({ etiqueta: 'Descripción', nombre: 'descripcion', tipo: 'textarea', required: true, minlength: 10, maxlength: 300, valor: regla?.descripcion }),
      el('div', { class: 'formulario__grilla' },
        campo({ etiqueta: 'Categoría de evento', nombre: 'id_categoria', tipo: 'select', required: true, vacio: 'Seleccione…', valor: regla?.id_categoria,
          lista: cat.categorias.map((c) => ({ valor: c.id_categoria, texto: c.nombre })), 'data-mensaje': 'Seleccione una categoría.' }),
        campo({ etiqueta: 'Severidad de la alerta', nombre: 'severidad', tipo: 'select', required: true, vacio: 'Seleccione…', valor: regla?.severidad,
          lista: cat.severidades.map((s) => ({ valor: s, texto: etiqueta(s) })), 'data-mensaje': 'Seleccione la severidad.' }),
        campo({ etiqueta: 'Umbral (cantidad de eventos)', nombre: 'umbral', tipo: 'number', required: true, min: 1, max: 100000, step: 1, valor: regla?.umbral ?? 5 }),
        campo({ etiqueta: 'Ventana (minutos)', nombre: 'ventana_minutos', tipo: 'number', required: true, min: 1, max: 1440, step: 1, valor: regla?.ventana_minutos ?? 5 })),
      campo({ etiqueta: 'Regla activa', nombre: 'activa', tipo: 'checkbox', valor: regla ? regla.activa : true }),
      el('p', { class: 'texto-suave texto-chico', id: 'vista-previa' }),
      el('div', { class: 'modal__pie' }, el('button', { class: 'btn', type: 'submit' }, regla ? 'Guardar cambios' : 'Crear regla')));

    // Vista previa dinámica de la condición mientras se escribe
    const vista = () => {
      const u = form.elements.umbral.value || '?';
      const v = form.elements.ventana_minutos.value || '?';
      const c = form.elements.id_categoria.selectedOptions[0]?.textContent || 'la categoría';
      $('#vista-previa', form).textContent = `Se generará una alerta cuando un mismo origen produzca ${u} o más eventos de "${c}" sobre un activo en ${v} minutos.`;
    };
    form.addEventListener('input', vista);
    vista();

    const modal = abrirModal(regla ? 'Editar regla' : 'Nueva regla de detección', form);
    enlazarFormulario(form, {
      enviar: (d) => api(regla ? `/admin/reglas/${regla.id_regla}` : '/admin/reglas', {
        metodo: regla ? 'PUT' : 'POST', cuerpo: { ...d, id_categoria: Number(d.id_categoria) },
      }),
      alExito: (r) => { modal.close(); notificar(r.mensaje, 'exito'); cargar(); },
    });
  }

  iniciarPagina({ titulo: 'Reglas de detección', roles: ['administrador'] }).then(() => {
    $('#btn-nueva').addEventListener('click', () => formulario());
    cargar();
  });
})();
