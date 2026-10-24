(function () {
  'use strict';
  const { $, $$, el, api, fecha, etiqueta, insignia, notificar, abrirModal, campo, enlazarFormulario, iniciarPagina, catalogos, alRecibir } = window.SP;
  let usuario;
  let estado = '';
  let administradores = [];

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);

  async function cargar() {
    const { incidentes } = await api(`/incidentes${estado ? `?estado=${estado}` : ''}`);
    $('#tabla-incidentes').replaceChildren(...(incidentes.length ? incidentes.map((i) => el('tr', {},
      td('#', String(i.id_incidente)),
      td('Título', el('strong', {}, i.titulo), el('div', { class: 'texto-suave texto-chico' }, i.categoria || 'Sin categoría')),
      td('Organización', i.organizacion),
      td('Activo', i.activo || '—'),
      td('Severidad', insignia(i.severidad)),
      td('Estado', insignia(i.estado)),
      td('Reportado', fecha(i.fecha_reporte), el('div', { class: 'texto-suave texto-chico' }, i.reportado_por)),
      td('Acciones', el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => (usuario.rol === 'administrador' ? gestionar(i) : detalle(i)) },
        usuario.rol === 'administrador' ? 'Gestionar' : 'Ver')),
    )) : [el('tr', {}, el('td', { class: 'vacio', colspan: 8 }, 'No hay incidentes en esta vista.'))]));
  }

  function ficha(i) {
    return el('div', { class: 'pila' },
      el('div', { class: 'fila' }, insignia(i.severidad), insignia(i.estado)),
      el('p', {}, i.descripcion),
      el('p', { class: 'texto-suave texto-chico' }, `Reportado por ${i.reportado_por} (${i.organizacion}) el ${fecha(i.fecha_reporte)}. Activo: ${i.activo || '—'}.`),
      i.respuesta_analista ? el('div', { class: 'aviso aviso--info' }, el('strong', {}, `Respuesta del analista${i.responsable ? ` (${i.responsable})` : ''}: `), i.respuesta_analista) : null);
  }

  function detalle(i) { abrirModal(`Incidente #${i.id_incidente}: ${i.titulo}`, ficha(i)); }

  /** Formulario 2 del dominio: reportar incidente (cliente). */
  async function reportar() {
    const [cat, { activos }] = await Promise.all([catalogos(), api('/activos')]);
    const form = el('form', { class: 'formulario' },
      el('div', { class: 'aviso', role: 'alert' }),
      campo({ etiqueta: 'Título', nombre: 'titulo', required: true, minlength: 5, maxlength: 150, placeholder: 'Resumen breve de lo ocurrido', 'data-mensaje': 'Ingrese un título (mínimo 5 caracteres).' }),
      el('div', { class: 'formulario__grilla' },
        campo({ etiqueta: 'Severidad estimada', nombre: 'severidad', tipo: 'select', required: true, vacio: 'Seleccione…',
          lista: cat.severidades.map((s) => ({ valor: s, texto: etiqueta(s) })), 'data-mensaje': 'Seleccione la severidad.' }),
        campo({ etiqueta: 'Tipo de incidente', nombre: 'id_categoria', tipo: 'select', vacio: 'No lo sé',
          lista: cat.categorias.map((c) => ({ valor: c.id_categoria, texto: c.nombre })) }),
        campo({ etiqueta: 'Activo afectado', nombre: 'id_activo', tipo: 'select', vacio: 'Ninguno / no aplica', completo: true,
          lista: activos.filter((a) => a.activo).map((a) => ({ valor: a.id_activo, texto: a.nombre })) })),
      campo({ etiqueta: 'Descripción detallada', nombre: 'descripcion', tipo: 'textarea', required: true, minlength: 20, maxlength: 3000,
        ayuda: 'Qué ocurrió, cuándo, quién lo detectó y qué acciones se han tomado. Mínimo 20 caracteres.', 'data-mensaje': 'Describa el incidente (mínimo 20 caracteres).' }),
      el('div', { class: 'modal__pie' }, el('button', { class: 'btn', type: 'submit' }, 'Enviar reporte')));
    const modal = abrirModal('Reportar incidente', form);
    enlazarFormulario(form, {
      enviar: (d) => api('/incidentes', { metodo: 'POST', cuerpo: {
        ...d, id_activo: d.id_activo ? Number(d.id_activo) : null, id_categoria: d.id_categoria ? Number(d.id_categoria) : null,
      } }),
      alExito: (r) => { modal.close(); notificar(r.mensaje, 'exito'); cargar(); },
    });
  }

  /** Gestión de incidentes (administrador). */
  async function gestionar(i) {
    const cat = await catalogos();
    const form = el('form', { class: 'formulario' },
      el('div', { class: 'aviso', role: 'alert' }),
      ficha(i),
      el('div', { class: 'formulario__grilla' },
        campo({ etiqueta: 'Estado', nombre: 'estado', tipo: 'select', required: true, valor: i.estado,
          lista: cat.estados_incidente.map((s) => ({ valor: s, texto: etiqueta(s) })) }),
        campo({ etiqueta: 'Responsable', nombre: 'id_responsable', tipo: 'select', vacio: 'Yo', valor: i.id_responsable ?? '',
          lista: administradores.map((u) => ({ valor: u.id_usuario, texto: u.nombre })) })),
      campo({ etiqueta: 'Respuesta al cliente', nombre: 'respuesta_analista', tipo: 'textarea', minlength: 5, maxlength: 3000, valor: i.respuesta_analista,
        ayuda: 'Acciones realizadas y recomendaciones. El cliente la verá en su panel.' }),
      el('div', { class: 'modal__pie' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar')));
    const modal = abrirModal(`Incidente #${i.id_incidente}`, form);
    enlazarFormulario(form, {
      enviar: (d) => api(`/incidentes/${i.id_incidente}`, { metodo: 'PATCH', cuerpo: { ...d, id_responsable: d.id_responsable ? Number(d.id_responsable) : null } }),
      alExito: (r) => { modal.close(); notificar(r.mensaje, 'exito'); cargar(); },
    });
  }

  iniciarPagina({ titulo: 'Incidentes' }).then(async (u) => {
    usuario = u;
    const cat = await catalogos();
    if (u.rol === 'cliente') {
      $('#btn-reportar').classList.remove('oculto');
      $('#btn-reportar').addEventListener('click', reportar);
    } else {
      ({ administradores } = await api('/admin/administradores'));
      $('#descripcion-incidentes').textContent = 'Incidentes reportados por las organizaciones. Asigne responsables y registre la respuesta.';
    }
    const pestanas = [['', 'Todos'], ...cat.estados_incidente.map((s) => [s, etiqueta(s)])];
    $('#pestanas').replaceChildren(...pestanas.map(([valor, texto]) => el('button', {
      class: 'pestana', role: 'tab', type: 'button', 'aria-selected': String(valor === estado),
      onclick: (e) => {
        estado = valor;
        $$('.pestana').forEach((p) => p.setAttribute('aria-selected', 'false'));
        e.target.setAttribute('aria-selected', 'true');
        cargar();
      },
    }, texto)));
    alRecibir('incidente:nuevo', cargar);
    alRecibir('incidente:actualizado', cargar);
    cargar();
  });
})();
