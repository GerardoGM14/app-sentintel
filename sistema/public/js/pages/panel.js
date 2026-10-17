(function () {
  'use strict';
  const { $, $$, el, svg, api, numero, hora, etiqueta, insignia, iniciarPagina, alRecibir } = window.SP;

  /** Gráfico de barras vertical en SVG (sin librerías externas). */
  function graficoBarras(contenedor, datos) {
    const ancho = 720, alto = 240, m = { arr: 12, der: 8, aba: 28, izq: 40 };
    const max = Math.max(1, ...datos.map((d) => d.valor));
    const anchoBarra = (ancho - m.izq - m.der) / Math.max(1, datos.length);
    const y = (v) => alto - m.aba - (v / max) * (alto - m.arr - m.aba);
    const g = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, class: 'grafico', preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((max / 4) * i);
      g.append(svg('line', { x1: m.izq, x2: ancho - m.der, y1: y(v), y2: y(v), class: 'eje' }),
        svg('text', { x: m.izq - 6, y: y(v) + 4, 'text-anchor': 'end' }, numero(v)));
    }
    datos.forEach((d, i) => {
      const x = m.izq + i * anchoBarra + 2;
      const rect = svg('rect', {
        x, y: y(d.valor), width: Math.max(1, anchoBarra - 4), height: Math.max(0, alto - m.aba - y(d.valor)),
        rx: 2, class: `barra${i === datos.length - 1 ? ' barra--actual' : ''}`,
      }, svg('title', {}, `${d.etiqueta}: ${numero(d.valor)} eventos`));
      g.append(rect);
      if (i % 3 === 0 || i === datos.length - 1) {
        g.append(svg('text', { x: x + anchoBarra / 2 - 2, y: alto - 8, 'text-anchor': 'middle' }, d.etiqueta));
      }
    });
    contenedor.replaceChildren(g);
  }

  /** Barras horizontales con HTML (accesibles y legibles en móvil). */
  function barrasHorizontales(contenedor, datos) {
    const max = Math.max(1, ...datos.map((d) => d.valor));
    if (!datos.length) return contenedor.replaceChildren(el('p', { class: 'texto-suave' }, 'Sin datos en el periodo.'));
    contenedor.replaceChildren(...datos.map((d) => {
      const valor = el('div', { class: `barras-h__valor barras-h__valor--${d.severidad}` });
      valor.style.width = `${(d.valor / max) * 100}%`;
      return el('div', { class: 'barras-h__fila' },
        el('span', {}, d.etiqueta),
        el('div', { class: 'barras-h__pista', role: 'img', 'aria-label': `${d.etiqueta}: ${d.valor}` }, valor),
        el('span', { class: 'barras-h__numero' }, numero(d.valor)));
    }));
  }

  let horas = [];
  function renderHoras() {
    graficoBarras($('#grafico-horas'), horas.map((h) => ({
      etiqueta: `${String(new Date(h.hora).getHours()).padStart(2, '0')}h`, valor: h.total,
    })));
  }

  async function cargar() {
    const r = await api('/panel/resumen');
    for (const [k, v] of Object.entries(r.totales)) {
      const nodo = $(`[data-kpi="${k}"]`);
      if (nodo) nodo.textContent = numero(v);
    }
    // Completa las 24 horas aunque alguna no tenga eventos
    const mapa = new Map(r.eventos_por_hora.map((h) => [new Date(h.hora).getTime(), h.total]));
    const base = new Date(); base.setMinutes(0, 0, 0);
    horas = Array.from({ length: 24 }, (_, i) => {
      const t = base.getTime() - (23 - i) * 3600e3;
      return { hora: t, total: mapa.get(t) || 0 };
    });
    renderHoras();
    barrasHorizontales($('#categorias'), r.eventos_por_categoria.map((c) => ({ etiqueta: c.categoria, valor: c.total, severidad: c.severidad })));
    const orden = ['critica', 'alta', 'media', 'baja'];
    barrasHorizontales($('#alertas-severidad'), orden.map((s) => ({
      etiqueta: etiqueta(s), severidad: s, valor: r.alertas_por_severidad.find((a) => a.severidad === s)?.total || 0,
    })));
    $('#top-ips').replaceChildren(...(r.top_ips_sospechosas.length
      ? r.top_ips_sospechosas.map((i) => el('tr', {}, el('td', { class: 'mono' }, i.ip), el('td', {}, numero(i.total))))
      : [el('tr', {}, el('td', { class: 'vacio', colspan: 2 }, 'Sin actividad sospechosa.'))]));
  }

  function pulso(id) {
    const n = $(id); n.classList.remove('kpi--pulso'); void n.offsetWidth; n.classList.add('kpi--pulso');
  }

  function agregarFeed(contenido) {
    const feed = $('#feed');
    $$('.texto-suave', feed).forEach((n) => n.remove());
    feed.prepend(el('li', {}, el('time', {}, hora()), contenido));
    while (feed.children.length > 40) feed.lastChild.remove();
  }

  let recibidos = 0;
  iniciarPagina({ titulo: 'Panel' }).then((u) => {
    if (u.rol === 'administrador') $('#titulo-panel').textContent = 'Panel global de seguridad';
    cargar();
    setInterval(cargar, 60000); // refresco completo cada minuto

    // Eventos en tiempo real vía WebSocket (Socket.IO)
    alRecibir('eventos:recibidos', (e) => {
      recibidos += e.cantidad;
      $('#contador-vivo').textContent = `${numero(recibidos)} eventos recibidos`;
      const kpi = $('[data-kpi="eventos_24h"]');
      kpi.textContent = numero(Number(kpi.textContent.replace(/\D/g, '')) + e.cantidad);
      pulso('#kpi-eventos');
      if (horas.length) { horas[horas.length - 1].total += e.cantidad; renderHoras(); }
      agregarFeed(el('span', {}, el('strong', {}, e.activo), ` envió ${numero(e.cantidad)} eventos`));
    });
    alRecibir('alerta:nueva', (a) => {
      const kpi = $('[data-kpi="alertas_abiertas"]');
      kpi.textContent = numero(Number(kpi.textContent.replace(/\D/g, '')) + 1);
      pulso('#kpi-alertas');
      agregarFeed(el('span', {}, insignia(a.severidad), ' ', el('strong', {}, a.regla), ` en ${a.activo} desde ${a.ip_origen || '—'}`));
    });
  });
})();
