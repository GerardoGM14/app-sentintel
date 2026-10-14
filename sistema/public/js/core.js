/* SentinelaPyME — núcleo del frontend (JavaScript estándar, sin frameworks).
 * - Cliente de la API REST (fetch con cookie de sesión HttpOnly).
 * - Construcción segura del DOM: nunca se usa innerHTML con datos del usuario (previene XSS).
 * - Diseño común (barra lateral según el rol), formularios, modales y notificaciones.
 */
(function () {
  'use strict';

  const API = '/api/v1';

  // ---------- DOM seguro ----------
  /** el('div', { class: 'x', onclick: fn }, 'texto', otroNodo) */
  function el(etiqueta, atributos, ...hijos) {
    const nodo = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(atributos || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2), v);
      else if (k === 'class') nodo.className = v;
      else if (k === 'dataset') Object.assign(nodo.dataset, v);
      else nodo.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat()) {
      if (h === null || h === undefined || h === false) continue;
      nodo.append(h instanceof Node ? h : document.createTextNode(String(h)));
    }
    return nodo;
  }
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(etiqueta, atributos, ...hijos) {
    const nodo = document.createElementNS(SVG_NS, etiqueta);
    for (const [k, v] of Object.entries(atributos || {})) nodo.setAttribute(k, v);
    for (const h of hijos.flat()) if (h != null) nodo.append(h instanceof Node ? h : document.createTextNode(String(h)));
    return nodo;
  }

  // ---------- API ----------
  class ErrorApi extends Error {
    constructor(estado, cuerpo) {
      super(cuerpo?.error?.mensaje || 'Error de comunicación con el servidor.');
      this.estado = estado;
      this.codigo = cuerpo?.error?.codigo;
      this.detalles = cuerpo?.error?.detalles || {};
    }
  }

  async function api(ruta, { metodo = 'GET', cuerpo, redirigir401 = true } = {}) {
    let respuesta;
    try {
      respuesta = await fetch(API + ruta, {
        method: metodo,
        credentials: 'same-origin',
        headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      throw new ErrorApi(0, { error: { mensaje: 'No se pudo conectar con el servidor. Revise su conexión.' } });
    }
    const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      if (respuesta.status === 401 && redirigir401) {
        location.href = `/login.html?expirada=1&volver=${encodeURIComponent(location.pathname)}`;
      }
      throw new ErrorApi(respuesta.status, datos);
    }
    return datos;
  }

  // ---------- Formato ----------
  const fmtFecha = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' });
  const fmtHora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtNum = new Intl.NumberFormat('es-CL');
  const fecha = (v) => (v ? fmtFecha.format(new Date(v)) : '—');
  const hora = (v) => fmtHora.format(v ? new Date(v) : new Date());
  const numero = (v) => fmtNum.format(v ?? 0);
  const ETIQUETAS = {
    baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica',
    abierta: 'Abierta', en_revision: 'En revisión', resuelta: 'Resuelta', falso_positivo: 'Falso positivo',
    reportado: 'Reportado', en_analisis: 'En análisis', contenido: 'Contenido', cerrado: 'Cerrado',
    administrador: 'Administrador', cliente: 'Cliente',
  };
  const etiqueta = (v) => ETIQUETAS[v] || v;
  const insignia = (v) => el('span', { class: `insignia insignia--${v}` }, etiqueta(v));

  // ---------- Notificaciones ----------
  function notificar(mensaje, tipo = 'info', titulo) {
    let zona = $('#notificaciones');
    if (!zona) {
      zona = el('div', { id: 'notificaciones', class: 'notificaciones', role: 'status', 'aria-live': 'polite' });
      document.body.append(zona);
    }
    const n = el('div', { class: `notificacion notificacion--${tipo}` }, titulo ? el('strong', {}, titulo) : null, mensaje);
    zona.append(n);
    setTimeout(() => n.remove(), tipo === 'alerta' ? 8000 : 4500);
  }

  // ---------- Formularios ----------
  function limpiarErrores(form) {
    $$('.campo--error', form).forEach((c) => c.classList.remove('campo--error'));
    $$('.campo__error', form).forEach((e) => { e.textContent = ''; });
    $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
    const aviso = $('.aviso', form);
    if (aviso) { aviso.textContent = ''; aviso.className = 'aviso'; }
  }

  function mostrarError(form, campo, mensaje) {
    const input = form.elements[campo];
    const contenedor = input?.closest?.('.campo');
    if (!contenedor) return false;
    contenedor.classList.add('campo--error');
    input.setAttribute('aria-invalid', 'true');
    let zona = $('.campo__error', contenedor);
    if (!zona) { zona = el('small', { class: 'campo__error', id: `error-${campo}` }); contenedor.append(zona); }
    zona.textContent = mensaje;
    input.setAttribute('aria-describedby', zona.id);
    return true;
  }

  function avisoFormulario(form, mensaje, tipo = 'error') {
    let aviso = $('.aviso', form);
    if (!aviso) { aviso = el('div', { class: 'aviso', role: 'alert' }); form.prepend(aviso); }
    aviso.className = `aviso aviso--${tipo}`;
    aviso.textContent = mensaje;
  }

  /** Lee el formulario respetando tipos: checkbox → boolean, number → número, vacío → omitido. */
  function leerFormulario(form) {
    const datos = {};
    for (const campo of form.elements) {
      if (!campo.name || campo.disabled) continue;
      if (campo.type === 'checkbox') datos[campo.name] = campo.checked;
      else if (campo.value.trim() === '') continue;
      else if (campo.type === 'number' || campo.dataset.tipo === 'numero') datos[campo.name] = Number(campo.value);
      else datos[campo.name] = campo.type === 'password' ? campo.value : campo.value.trim();
    }
    return datos;
  }

  /**
   * Valida en el cliente (restricciones HTML5 + validador opcional), envía y muestra
   * los errores por campo que devuelve la API. La validación del servidor es la definitiva.
   */
  function enlazarFormulario(form, { enviar, validar, alExito }) {
    form.noValidate = true;
    form.addEventListener('input', (e) => {
      const c = e.target.closest('.campo');
      if (c?.classList.contains('campo--error')) {
        c.classList.remove('campo--error');
        const z = $('.campo__error', c); if (z) z.textContent = '';
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores(form);
      let valido = true;
      for (const campo of form.elements) {
        if (campo.name && !campo.checkValidity()) {
          valido = false;
          mostrarError(form, campo.name, campo.dataset.mensaje || campo.validationMessage);
        }
      }
      const datos = leerFormulario(form);
      const extra = validar ? validar(datos, form) : null;
      if (extra) for (const [k, v] of Object.entries(extra)) { valido = false; mostrarError(form, k, v); }
      if (!valido) { $('[aria-invalid="true"]', form)?.focus(); return; }

      const boton = $('[type="submit"]', form);
      const textoBoton = boton?.textContent;
      if (boton) { boton.disabled = true; boton.textContent = 'Procesando…'; }
      try {
        const r = await enviar(datos, form);
        if (alExito) alExito(r, form);
      } catch (err) {
        if (!(err instanceof ErrorApi)) throw err;
        let alguno = false;
        for (const [k, v] of Object.entries(err.detalles || {})) alguno = mostrarError(form, k, v) || alguno;
        avisoFormulario(form, err.message);
        if (alguno) $('[aria-invalid="true"]', form)?.focus();
      } finally {
        if (boton) { boton.disabled = false; boton.textContent = textoBoton; }
      }
    });
  }

  /** Indicador de fortaleza de contraseña (orientativo). */
  function medidorPassword(input) {
    const barra = el('div', { class: 'medidor__barra' });
    const texto = el('small', { class: 'ayuda', 'aria-live': 'polite' }, 'Mínimo 10 caracteres con mayúsculas, minúsculas y números.');
    input.closest('.campo').append(el('div', { class: 'medidor', 'aria-hidden': 'true' }, barra), texto);
    input.addEventListener('input', () => {
      const v = input.value;
      let p = 0;
      if (v.length >= 10) p++;
      if (v.length >= 14) p++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) p++;
      if (/\d/.test(v)) p++;
      if (/[^A-Za-z0-9]/.test(v)) p++;
      barra.style.width = `${(p / 5) * 100}%`;
      barra.className = `medidor__barra ${p >= 4 ? 'medidor__barra--buena' : p >= 3 ? 'medidor__barra--media' : ''}`;
      texto.textContent = v ? `Fortaleza: ${['muy débil', 'débil', 'regular', 'aceptable', 'fuerte', 'muy fuerte'][p]}` : 'Mínimo 10 caracteres con mayúsculas, minúsculas y números.';
    });
  }

  // ---------- Modal ----------
  function abrirModal(titulo, contenido) {
    const cuerpo = el('div', { class: 'modal__cuerpo' }, contenido);
    const dialogo = el('dialog', { class: 'modal', 'aria-labelledby': 'modal-titulo' },
      el('div', { class: 'modal__cabecera' },
        el('h2', { id: 'modal-titulo' }, titulo),
        el('button', { class: 'cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => dialogo.close() }, '×')),
      cuerpo);
    dialogo.addEventListener('close', () => dialogo.remove());
    document.body.append(dialogo);
    dialogo.showModal();
    return dialogo;
  }

  function confirmar(mensaje, textoBoton = 'Confirmar') {
    return new Promise((resolver) => {
      let ok = false;
      const d = abrirModal('Confirmar acción', [
        el('p', {}, mensaje),
        el('div', { class: 'modal__pie' },
          el('button', { class: 'btn btn--secundario', type: 'button', onclick: () => d.close() }, 'Cancelar'),
          el('button', { class: 'btn btn--peligro', type: 'button', onclick: () => { ok = true; d.close(); } }, textoBoton)),
      ]);
      d.addEventListener('close', () => resolver(ok));
    });
  }

  /** Construye un <select> con opciones [{valor, texto}]. */
  function opciones(select, lista, { vacio } = {}) {
    select.replaceChildren(...(vacio ? [el('option', { value: '' }, vacio)] : []),
      ...lista.map((o) => el('option', { value: o.valor }, o.texto)));
  }

  /**
   * Crea un campo de formulario accesible (label + control + zona de error).
   * campo({ etiqueta, nombre, tipo: 'text'|'select'|'textarea'|..., lista: [{valor, texto}], valor, ...atributos })
   */
  let contadorCampos = 0;
  function campo({ etiqueta: texto, nombre, tipo = 'text', lista, valor, vacio, ayuda, completo, ...atributos }) {
    const id = `c${++contadorCampos}-${nombre}`;
    let control;
    if (tipo === 'select') {
      control = el('select', { id, name: nombre, ...atributos });
      opciones(control, lista || [], { vacio });
    } else if (tipo === 'textarea') {
      control = el('textarea', { id, name: nombre, ...atributos });
    } else {
      control = el('input', { id, name: nombre, type: tipo, ...atributos });
    }
    if (tipo === 'checkbox') {
      control.checked = Boolean(valor);
      return el('div', { class: `campo${completo ? ' campo--completo' : ''}` }, el('label', { class: 'casilla', for: id }, control, texto));
    }
    if (valor !== undefined && valor !== null) control.value = valor;
    return el('div', { class: `campo${completo ? ' campo--completo' : ''}` },
      el('label', { for: id }, texto), control, ayuda ? el('small', { class: 'ayuda' }, ayuda) : null);
  }

  // ---------- Diseño de la aplicación ----------
  const ICONOS = {
    panel: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    activos: 'M4 4h16v6H4V4zm0 10h16v6H4v-6zm3-8v2h2V6H7zm0 10v2h2v-2H7z',
    eventos: 'M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z',
    alertas: 'M12 2 1 21h22L12 2zm1 15h-2v2h2v-2zm0-7h-2v5h2v-5z',
    incidentes: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z',
    reglas: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5-2.2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    usuarios: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zm-8 0c-.3 0-.7 0-1.1.1A4.2 4.2 0 0 1 9 17v3H0v-3c0-2.2 4.4-4 8-4z',
    perfil: 'M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z',
    salir: 'M10 17l1.4-1.4-2.6-2.6H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5z',
    menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  };
  const icono = (nombre) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'currentColor' }, svg('path', { d: ICONOS[nombre] }));

  const MENU = {
    cliente: [['panel', 'Panel'], ['activos', 'Mis activos'], ['eventos', 'Eventos'], ['alertas', 'Alertas'], ['incidentes', 'Incidentes'], ['perfil', 'Mi perfil']],
    administrador: [['panel', 'Panel global'], ['alertas', 'Alertas'], ['incidentes', 'Incidentes'], ['eventos', 'Eventos'], ['activos', 'Activos'], ['reglas', 'Reglas de detección'], ['usuarios', 'Usuarios y auditoría'], ['perfil', 'Mi perfil']],
  };

  let usuarioActual = null;

  /** Verifica la sesión, aplica control de acceso por rol y monta el diseño. */
  async function iniciarPagina({ titulo, roles } = {}) {
    const { usuario } = await api('/auth/sesion');
    usuarioActual = usuario;
    if (roles && !roles.includes(usuario.rol)) {
      location.replace('/panel.html');
      return new Promise(() => {}); // la página no continúa: se está redirigiendo
    }
    const pagina = document.body.dataset.pagina;
    const contenido = $('#contenido');

    const lateral = el('nav', { class: 'lateral', id: 'lateral', 'aria-label': 'Navegación principal' },
      el('a', { class: 'marca', href: '/panel.html' }, el('img', { src: '/img/logo.svg', alt: '' }), el('span', {}, 'Sentinela', el('em', {}, 'PyME'))),
      el('ul', { class: 'navegacion' },
        MENU[usuario.rol].map(([clave, texto]) => el('li', {},
          el('a', { href: `/${clave}.html`, 'aria-current': clave === pagina ? 'page' : null }, icono(clave), texto))),
        el('li', {}, el('a', { href: '#', id: 'salir' }, icono('salir'), 'Cerrar sesión'))),
      el('div', { class: 'lateral__pie' },
        el('strong', {}, usuario.organizacion || 'Centro de operaciones'),
        usuario.rol === 'administrador' ? 'Analista de seguridad' : 'Cuenta de cliente'));

    const velo = el('div', { class: 'velo oculto', onclick: () => alternarMenu(false) });
    const botonMenu = el('button', {
      class: 'btn btn--secundario btn--icono btn-menu', type: 'button',
      'aria-label': 'Abrir menú', 'aria-controls': 'lateral', 'aria-expanded': 'false',
      onclick: () => alternarMenu(),
    }, icono('menu'));

    function alternarMenu(forzar) {
      const abrir = forzar ?? !lateral.classList.contains('lateral--abierta');
      lateral.classList.toggle('lateral--abierta', abrir);
      velo.classList.toggle('oculto', !abrir);
      botonMenu.setAttribute('aria-expanded', String(abrir));
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') alternarMenu(false); });

    const iniciales = `${usuario.nombre[0] || ''}${usuario.apellido[0] || ''}`.toUpperCase();
    const cabecera = el('header', { class: 'cabecera' },
      el('div', { class: 'fila' }, botonMenu, el('p', { class: 'cabecera__titulo' }, titulo || document.title.split('·')[0].trim())),
      el('div', { class: 'cabecera__usuario' },
        el('span', { class: 'estado-conexion', id: 'estado-conexion' }, 'Sin conexión'),
        el('div', { class: 'cabecera__nombre' }, el('div', {}, `${usuario.nombre} ${usuario.apellido}`), el('div', { class: 'rol' }, etiqueta(usuario.rol))),
        el('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales)));

    const principal = el('div', { class: 'app-principal' }, cabecera);
    contenido.replaceWith(principal);
    principal.append(contenido);
    document.body.prepend(el('a', { class: 'saltar-contenido', href: '#contenido' }, 'Saltar al contenido'), lateral, velo);

    $('#salir').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { metodo: 'POST' }).catch(() => {});
      location.href = '/login.html';
    });
    conectarTiempoReal();
    return usuario;
  }

  // ---------- Tiempo real (Socket.IO) ----------
  let socket = null;
  const oyentes = [];
  function conectarTiempoReal() {
    if (typeof io !== 'function') return;
    socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    const indicador = () => $('#estado-conexion');
    socket.on('connect', () => { indicador()?.classList.add('estado-conexion--en-linea'); if (indicador()) indicador().textContent = 'En vivo'; });
    socket.on('disconnect', () => { indicador()?.classList.remove('estado-conexion--en-linea'); if (indicador()) indicador().textContent = 'Sin conexión'; });
    socket.on('alerta:nueva', (a) => {
      notificar(`${a.activo} · IP ${a.ip_origen || 'desconocida'} · ${a.cantidad_eventos} eventos`, 'alerta', `Nueva alerta ${etiqueta(a.severidad).toLowerCase()}: ${a.regla}`);
    });
    socket.on('incidente:nuevo', (i) => notificar(`${i.organizacion}: ${i.titulo}`, 'alerta', 'Nuevo incidente reportado'));
    socket.on('incidente:actualizado', (i) => notificar(`"${i.titulo}" ahora está ${etiqueta(i.estado).toLowerCase()}.`, 'info', 'Incidente actualizado'));
    oyentes.forEach(([ev, fn]) => socket.on(ev, fn));
  }
  function alRecibir(evento, fn) {
    if (socket) socket.on(evento, fn); else oyentes.push([evento, fn]);
  }

  /** Página de acceso: si ya hay sesión, ir al panel. */
  async function redirigirSiHaySesion() {
    try { await api('/auth/sesion', { redirigir401: false }); location.replace('/panel.html'); } catch { /* sin sesión */ }
  }

  let catalogosCache = null;
  const catalogos = async () => (catalogosCache ||= await api('/catalogos'));

  window.SP = {
    el, $, $$, svg, api, ErrorApi, fecha, hora, numero, etiqueta, insignia, notificar,
    enlazarFormulario, leerFormulario, mostrarError, avisoFormulario, limpiarErrores, medidorPassword,
    abrirModal, confirmar, opciones, campo, iniciarPagina, alRecibir, redirigirSiHaySesion, catalogos,
    get usuario() { return usuarioActual; },
  };
})();
