(function () {
  'use strict';
  const { $, el, api, fecha, etiqueta, insignia, notificar, abrirModal, confirmar, campo, enlazarFormulario, iniciarPagina, catalogos } = window.SP;
  let usuario;

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);

  async function cargar() {
    const { activos } = await api('/activos');
    const tbody = $('#tabla-activos');
    if (!activos.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { class: 'vacio', colspan: 9 }, usuario.rol === 'cliente'
        ? 'Aún no registra activos. Use "Registrar activo" para comenzar a enviar eventos.' : 'No hay activos registrados.')));
      return;
    }
    tbody.replaceChildren(...activos.map((a) => el('tr', {},
      td('Nombre', el('strong', {}, a.nombre)),
      td('Tipo', a.tipo),
      td('Organización', a.organizacion),
      td('IP', el('span', { class: 'mono' }, a.direccion_ip || '—')),
      td('Criticidad', insignia(a.criticidad)),
      td('Clave', el('code', {}, `sp_${a.api_key_prefijo}_…`)),
      td('Alertas abiertas', String(a.alertas_abiertas)),
      td('Estado', insignia(a.activo ? 'activo' : 'inactivo')),
      td('Acciones', usuario.rol !== 'cliente' ? '' : el('div', { class: 'fila' },
        el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => formulario(a) }, 'Editar'),
        el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => rotar(a) }, 'Rotar clave'),
        el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => alternar(a) }, a.activo ? 'Deshabilitar' : 'Habilitar'))),
    )));
  }

  function mostrarClave(titulo, clave) {
    abrirModal(titulo, [
      el('div', { class: 'aviso aviso--info' }, 'Copie esta API key y configúrela en el agente del activo. Por seguridad solo se almacena su hash: no podrá volver a verla.'),
      el('p', {}),
      el('code', { class: 'clave-api', id: 'clave-generada' }, clave),
      el('div', { class: 'modal__pie' },
        el('button', { class: 'btn', type: 'button', onclick: async (e) => {
          try { await navigator.clipboard.writeText(clave); e.target.textContent = 'Copiada ✓'; } catch { notificar('No se pudo copiar automáticamente.', 'error'); }
        } }, 'Copiar clave')),
    ]);
  }

  /** Formulario 1 del dominio: registrar / editar activo. */
  async function formulario(activo) {
    const cat = await catalogos();
    const form = el('form', { class: 'formulario' },
      el('div', { class: 'aviso', role: 'alert' }),
      campo({ etiqueta: 'Nombre del activo', nombre: 'nombre', required: true, minlength: 3, maxlength: 100, valor: activo?.nombre, placeholder: 'Ej.: Servidor web tienda' }),
      el('div', { class: 'formulario__grilla' },
        campo({ etiqueta: 'Tipo', nombre: 'id_tipo_activo', tipo: 'select', required: true, vacio: 'Seleccione…',
          lista: cat.tipos_activo.map((t) => ({ valor: t.id_tipo_activo, texto: t.nombre })), valor: activo?.id_tipo_activo, 'data-mensaje': 'Seleccione un tipo.' }),
        campo({ etiqueta: 'Criticidad para el negocio', nombre: 'criticidad', tipo: 'select', required: true, vacio: 'Seleccione…',
          lista: cat.severidades.map((s) => ({ valor: s, texto: etiqueta(s) })), valor: activo?.criticidad, 'data-mensaje': 'Seleccione la criticidad.' })),
      campo({ etiqueta: 'Dirección IP (opcional)', nombre: 'direccion_ip', maxlength: 45, valor: activo?.direccion_ip, placeholder: '200.54.10.21', ayuda: 'IPv4 o IPv6 del activo.' }),
      el('div', { class: 'modal__pie' }, el('button', { class: 'btn', type: 'submit' }, activo ? 'Guardar cambios' : 'Registrar activo')));
    const modal = abrirModal(activo ? 'Editar activo' : 'Registrar activo', form);
    enlazarFormulario(form, {
      validar: (d) => (d.direccion_ip && !/^[0-9a-fA-F:.]{2,45}$/.test(d.direccion_ip) ? { direccion_ip: 'Dirección IP inválida.' } : null),
      enviar: (d) => api(activo ? `/activos/${activo.id_activo}` : '/activos', {
        metodo: activo ? 'PUT' : 'POST', cuerpo: { ...d, id_tipo_activo: Number(d.id_tipo_activo), direccion_ip: d.direccion_ip || null },
      }),
      alExito: (r) => {
        modal.close();
        notificar(r.mensaje, 'exito');
        if (r.api_key) mostrarClave('API key del nuevo activo', r.api_key);
        cargar();
      },
    });
  }

  async function rotar(a) {
    if (!(await confirmar(`Se generará una nueva API key para "${a.nombre}" y la actual dejará de funcionar de inmediato.`, 'Rotar clave'))) return;
    const r = await api(`/activos/${a.id_activo}/rotar-clave`, { metodo: 'POST' });
    mostrarClave('Nueva API key', r.api_key);
    cargar();
  }

  async function alternar(a) {
    if (a.activo && !(await confirmar(`Mientras "${a.nombre}" esté deshabilitado, sus eventos serán rechazados.`, 'Deshabilitar'))) return;
    const r = await api(`/activos/${a.id_activo}/estado`, { metodo: 'PATCH', cuerpo: { activo: !a.activo } });
    notificar(r.mensaje, 'exito');
    cargar();
  }

  iniciarPagina({ titulo: 'Activos' }).then((u) => {
    usuario = u;
    if (u.rol === 'cliente') {
      $('#btn-nuevo').classList.remove('oculto');
      $('#ayuda-agente').classList.remove('oculto');
      $('#btn-nuevo').addEventListener('click', () => formulario());
      if (new URLSearchParams(location.search).has('bienvenida')) {
        notificar('Su cuenta fue creada. Registre su primer activo para comenzar.', 'exito', '¡Bienvenido!');
      }
    }
    cargar();
  });
})();
