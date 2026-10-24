(function () {
  'use strict';
  const { $, $$, el, api, fecha, numero, etiqueta, insignia, notificar, confirmar, iniciarPagina } = window.SP;
  let yo;

  const td = (etq, ...c) => el('td', { 'data-etiqueta': etq }, ...c);
  const vacio = (cols, texto) => el('tr', {}, el('td', { class: 'vacio', colspan: cols }, texto));

  async function cargarUsuarios() {
    const { usuarios } = await api('/admin/usuarios');
    $('#tabla-usuarios').replaceChildren(...usuarios.map((u) => el('tr', {},
      td('Nombre', `${u.nombre} ${u.apellido}`),
      td('Correo', u.email),
      td('Rol', etiqueta(u.rol)),
      td('Organización', u.organizacion || '—'),
      td('Último acceso', fecha(u.ultimo_acceso)),
      td('Estado', insignia(u.activo ? 'activo' : 'inactivo'), u.bloqueado ? el('span', { class: 'insignia insignia--alta' }, 'Bloqueado') : null),
      td('Acciones', u.id_usuario === yo.id ? el('span', { class: 'texto-suave texto-chico' }, 'Su cuenta') : el('div', { class: 'fila' },
        el('button', { class: `btn btn--chico ${u.activo ? 'btn--peligro' : ''}`, type: 'button', onclick: () => alternar(u) }, u.activo ? 'Desactivar' : 'Activar'),
        u.bloqueado ? el('button', { class: 'btn btn--secundario btn--chico', type: 'button', onclick: () => desbloquear(u) }, 'Desbloquear') : null)))));
  }

  async function alternar(u) {
    if (u.activo && !(await confirmar(`¿Desactivar la cuenta de ${u.nombre} ${u.apellido}? Sus sesiones se cerrarán de inmediato.`, 'Desactivar'))) return;
    const r = await api(`/admin/usuarios/${u.id_usuario}`, { metodo: 'PATCH', cuerpo: { activo: !u.activo } });
    notificar(r.mensaje, 'exito');
    cargarUsuarios();
  }

  async function desbloquear(u) {
    const r = await api(`/admin/usuarios/${u.id_usuario}`, { metodo: 'PATCH', cuerpo: { desbloquear: true } });
    notificar(r.mensaje, 'exito');
    cargarUsuarios();
  }

  async function cargarOrganizaciones() {
    const { organizaciones } = await api('/admin/organizaciones');
    $('#tabla-organizaciones').replaceChildren(...(organizaciones.length ? organizaciones.map((o) => el('tr', {},
      td('RUT', el('span', { class: 'mono' }, o.rut)), td('Razón social', o.razon_social), td('Rubro', o.rubro),
      td('Usuarios', numero(o.usuarios)), td('Activos', numero(o.activos)), td('Registro', fecha(o.fecha_registro)))) : [vacio(6, 'Sin organizaciones.')]));
  }

  async function cargarAuditoria() {
    const { registros } = await api('/admin/auditoria');
    $('#tabla-auditoria').replaceChildren(...(registros.length ? registros.map((a) => el('tr', {},
      td('Fecha', fecha(a.fecha)), td('Usuario', a.usuario || '—'), td('Acción', el('code', {}, a.accion)),
      td('Entidad', `${a.entidad}${a.id_entidad ? ` #${a.id_entidad}` : ''}`), td('IP', el('span', { class: 'mono' }, a.ip || '—')))) : [vacio(5, 'Sin registros.')]));
  }

  const cargadores = { usuarios: cargarUsuarios, organizaciones: cargarOrganizaciones, auditoria: cargarAuditoria };

  iniciarPagina({ titulo: 'Usuarios y auditoría', roles: ['administrador'] }).then((u) => {
    yo = u;
    $$('.pestana').forEach((tab) => tab.addEventListener('click', () => {
      $$('.pestana').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('[role="tabpanel"]').forEach((p) => p.classList.toggle('oculto', p.id !== tab.getAttribute('aria-controls')));
      cargadores[tab.id.replace('tab-', '')]();
    }));
    cargarUsuarios();
  });
})();
