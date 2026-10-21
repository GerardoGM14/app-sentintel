(function () {
  'use strict';
  const { $, el, api, fecha, numero, insignia, opciones, notificar, iniciarPagina, catalogos, alRecibir, ErrorApi } = window.SP;
  const form = $('#form-filtros');
  let cursor = null;
  let filtros = {};
  let cargados = 0;
  let nuevos = 0;

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);
  const aIso = (local) => (local ? new Date(local).toISOString() : undefined);

  function fila(e) {
    return el('tr', {},
      td('Fecha', fecha(e.fecha_evento)),
      td('Categoría', e.categoria_nombre),
      td('Severidad', insignia(e.severidad)),
      td('Activo', e.activo),
      td('IP origen', el('span', { class: 'mono' }, e.ip_origen || '—')),
      td('Usuario', e.usuario_objetivo || '—'),
      td('Mensaje', e.mensaje || '—'));
  }

  async function buscar(agregar = false) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') params.set(k, v);
    if (agregar && cursor) params.set('antes_de', cursor);
    params.set('limite', '50');
    const tbody = $('#tabla-eventos');
    try {
      const r = await api(`/eventos?${params}`);
      if (!agregar) { tbody.replaceChildren(); cargados = 0; }
      tbody.append(...r.eventos.map(fila));
      cargados += r.eventos.length;
      if (!cargados) tbody.replaceChildren(el('tr', {}, el('td', { class: 'vacio', colspan: 7 }, 'No hay eventos que coincidan con los filtros.')));
      cursor = r.siguiente_cursor;
      $('#btn-mas').classList.toggle('oculto', !cursor);
      $('#resumen-eventos').textContent = `Mostrando ${numero(cargados)} eventos · ${fecha(r.rango.desde)} – ${fecha(r.rango.hasta)}`;
    } catch (err) {
      if (err instanceof ErrorApi) notificar(err.message, 'error');
    }
  }

  iniciarPagina({ titulo: 'Eventos' }).then(async () => {
    const [cat, { activos }] = await Promise.all([catalogos(), api('/activos')]);
    opciones($('#id_categoria'), cat.categorias.map((c) => ({ valor: c.id_categoria, texto: c.nombre })), { vacio: 'Todas' });
    opciones($('#id_activo'), activos.map((a) => ({ valor: a.id_activo, texto: a.nombre })), { vacio: 'Todos' });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (d.ip && !/^[0-9a-fA-F:.]{2,45}$/.test(d.ip)) return notificar('La IP de origen no es válida.', 'error');
      if (d.desde && d.hasta && new Date(d.desde) > new Date(d.hasta)) return notificar('"Desde" debe ser anterior a "Hasta".', 'error');
      filtros = { ...d, desde: aIso(d.desde), hasta: aIso(d.hasta) };
      nuevos = 0; $('#aviso-nuevos').classList.add('oculto');
      buscar();
    });
    form.addEventListener('reset', () => setTimeout(() => { filtros = {}; buscar(); }));
    $('#btn-mas').addEventListener('click', () => buscar(true));

    // Aviso en tiempo real de eventos nuevos (sin recargar automáticamente la tabla del usuario)
    alRecibir('eventos:recibidos', (e) => {
      nuevos += e.cantidad;
      const aviso = $('#aviso-nuevos');
      aviso.replaceChildren(`Llegaron ${numero(nuevos)} eventos nuevos. `,
        el('button', { class: 'btn btn--chico', type: 'button', onclick: () => { nuevos = 0; aviso.classList.add('oculto'); filtros.hasta = undefined; buscar(); } }, 'Actualizar'));
      aviso.classList.remove('oculto');
    });
    buscar();
  });
})();
