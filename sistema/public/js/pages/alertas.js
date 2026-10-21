(function () {
  'use strict';
  const { $, el, api, fecha, numero, etiqueta, insignia, opciones, notificar, abrirModal, campo, enlazarFormulario, iniciarPagina, catalogos, alRecibir } = window.SP;
  let usuario;
  let pagina = 1;
  let filtros = {};
  let administradores = [];

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);

  function fila(a, nueva = false) {
    return el('tr', { class: nueva ? 'nueva' : null },
      td('#', String(a.id_alerta)),
      td('Regla', el('strong', {}, a.regla), el('div', { class: 'texto-suave texto-chico' }, a.categoria)),
      td('Severidad', insignia(a.severidad)),
      td('Activo', a.activo, usuario.rol === 'administrador' && a.organizacion ? el('div', { class: 'texto-suave texto-chico' }, a.organizacion) : null),
      td('IP origen', el('span', { class: 'mono' }, a.ip_origen || '—')),
      td('Eventos', numero(a.cantidad_eventos)),
      td('Generada', fecha(a.fecha_generada)),
      td('Estado', insignia(a.estado)),
      td('Responsable', a.responsable || '—'),
      td('Acciones', usuario.rol === 'administrador'
        ? el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => gestionar(a) }, 'Gestionar')
        : el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => detalle(a) }, 'Ver')));
  }

  async function cargar() {
    const params = new URLSearchParams({ pagina, limite: 20 });
    for (const [k, v] of Object.entries(filtros)) if (v) params.set(k, v);
    const r = await api(`/alertas?${params}`);
    const tbody = $('#tabla-alertas');
    tbody.replaceChildren(...(r.alertas.length ? r.alertas.map((a) => fila(a))
      : [el('tr', {}, el('td', { class: 'vacio', colspan: 10 }, 'No hay alertas con estos filtros.'))]));
    $('#paginacion').replaceChildren(
      el('span', { class: 'texto-suave texto-chico' }, `${numero(r.total)} alertas · página ${r.pagina} de ${r.paginas}`),
      el('button', { class: 'btn btn--secundario btn--chico', type: 'button', disabled: r.pagina <= 1, onclick: () => { pagina--; cargar(); } }, 'Anterior'),
      el('button', { class: 'btn btn--secundario btn--chico', type: 'button', disabled: r.pagina >= r.paginas, onclick: () => { pagina++; cargar(); } }, 'Siguiente'));
  }

  function resumen(a) {
    return el('dl', { class: 'pila texto-chico' },
      el('div', {}, el('strong', {}, 'Condición: '), `${a.umbral} o más eventos en ${a.ventana_minutos} min desde la misma IP`),
      el('div', {}, el('strong', {}, 'Ventana observada: '), `${fecha(a.fecha_primer_evento)} – ${fecha(a.fecha_ultimo_evento)}`),
      el('div', {}, el('strong', {}, 'Activo: '), `${a.activo} (criticidad ${etiqueta(a.criticidad).toLowerCase()})`),
      a.nota_resolucion ? el('div', {}, el('strong', {}, 'Resolución: '), a.nota_resolucion) : null);
  }

  function detalle(a) {
    abrirModal(`Alerta #${a.id_alerta}: ${a.regla}`, resumen(a));
  }

  /** Formulario de gestión de alertas (solo administrador). */
  async function gestionar(a) {
    const cat = await catalogos();
    const form = el('form', { class: 'formulario' },
      el('div', { class: 'aviso', role: 'alert' }),
      resumen(a),
      el('div', { class: 'formulario__grilla' },
        campo({ etiqueta: 'Estado', nombre: 'estado', tipo: 'select', required: true, valor: a.estado,
          lista: cat.estados_alerta.map((s) => ({ valor: s, texto: etiqueta(s) })) }),
        campo({ etiqueta: 'Responsable', nombre: 'id_responsable', tipo: 'select', vacio: 'Sin asignar', valor: a.id_responsable ?? '',
          lista: administradores.map((u) => ({ valor: u.id_usuario, texto: u.nombre })) })),
      campo({ etiqueta: 'Nota de resolución', nombre: 'nota_resolucion', tipo: 'textarea', maxlength: 1000, valor: a.nota_resolucion,
        ayuda: 'Obligatoria al marcar la alerta como resuelta o falso positivo.' }),
      el('div', { class: 'modal__pie' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar')));
    const modal = abrirModal(`Gestionar alerta #${a.id_alerta}`, form);
    enlazarFormulario(form, {
      validar: (d) => (['resuelta', 'falso_positivo'].includes(d.estado) && !(d.nota_resolucion?.length >= 5)
        ? { nota_resolucion: 'Describa la resolución (mínimo 5 caracteres).' } : null),
      enviar: (d) => api(`/alertas/${a.id_alerta}`, { metodo: 'PATCH', cuerpo: { ...d, id_responsable: d.id_responsable ? Number(d.id_responsable) : null } }),
      alExito: (r) => { modal.close(); notificar(r.mensaje, 'exito'); cargar(); },
    });
  }

  iniciarPagina({ titulo: 'Alertas' }).then(async (u) => {
    usuario = u;
    const cat = await catalogos();
    opciones($('#estado'), cat.estados_alerta.map((s) => ({ valor: s, texto: etiqueta(s) })), { vacio: 'Todos' });
    opciones($('#severidad'), cat.severidades.map((s) => ({ valor: s, texto: etiqueta(s) })), { vacio: 'Todas' });
    if (u.rol === 'administrador') ({ administradores } = await api('/admin/administradores'));
    $('#form-filtros').addEventListener('submit', (e) => {
      e.preventDefault();
      filtros = Object.fromEntries(new FormData(e.target));
      pagina = 1;
      cargar();
    });
    // Las alertas nuevas aparecen al instante en la tabla
    alRecibir('alerta:nueva', (a) => {
      if (pagina !== 1 || (filtros.estado && filtros.estado !== 'abierta') || (filtros.severidad && filtros.severidad !== a.severidad)) return;
      cargar();
    });
    alRecibir('alerta:actualizada', () => cargar());
    cargar();
  });
})();
