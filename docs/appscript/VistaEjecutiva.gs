// Vista ejecutiva de "COMPROBANTES SUNAT - DETALLE"
//
// Un enlace propio (no la hoja) para compartir de forma formal: resume lo
// que hay en el detalle —cuánto, de quién, en qué tipo de comprobante, cómo
// se mueve mes a mes— y trae un botón que abre la hoja real para quien
// necesite el desglose línea por línea.
//
// No es el tablero interno (Codigo.gs + Tablero.html, que vive DENTRO de la
// hoja como una pestaña más). Esto es un sitio aparte: se instala una vez,
// se publica como aplicación web, y de ahí en adelante es un enlace que se
// manda por correo o WhatsApp y se ve sin abrir Sheets ni pedir permiso de
// edición — solo lectura de un resumen.
//
// ── Instalación ──────────────────────────────────────────────────
// 1. Abre la hoja "COMPROBANTES SUNAT - DETALLE" → Extensiones · Apps Script.
// 2. Si ya existe un proyecto con Codigo.gs (el tablero), este archivo va
//    APARTE: el "+" junto a "Archivos" → Script → llámalo "VistaEjecutiva" →
//    pega este contenido completo. No hace falta ningún archivo .html: la
//    página se arma aquí mismo.
// 3. Implementar → Nueva implementación → tipo "Aplicación web".
//      Ejecutar como: Yo (tu cuenta).
//      Quién tiene acceso: "Cualquier usuario con el enlace de Google
//      Workspace" si la empresa usa Workspace, o "Cualquier usuario" si
//      necesitas mandarlo fuera de la organización.
// 4. Copiar la URL que da al implementar (termina en /exec). Esa es la que
//    se comparte — no la de Apps Script del editor.
// 5. Cada vez que se edite este código hay que "Nueva implementación" de
//    nuevo (o Gestionar implementaciones → editar → nueva versión) para que
//    el enlace ya compartido refleje el cambio.

const HOJA_ID = '1Kp5RS_7_dIwQDziSsK-vKbuYyCUxtG7VYktk5XkWj_A';
const NOMBRE_PESTANA = 'COMPROBANTES SUNAT - DETALLE';
const URL_HOJA = 'https://docs.google.com/spreadsheets/d/' + HOJA_ID + '/edit';

function doGet() {
  const resumen = calcularResumen_();
  return HtmlService.createHtmlOutput(construirHtml_(resumen))
    .setTitle('INROPRIN · SUNAT — Vista ejecutiva')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Lee la pestaña de detalle y arma todos los agregados que pinta la página. */
function calcularResumen_() {
  const libro = SpreadsheetApp.openById(HOJA_ID);
  const hoja = libro.getSheetByName(NOMBRE_PESTANA) || libro.getSheets()[0];
  const valores = hoja.getDataRange().getValues();
  const cab = valores[0];
  const col = (nombre) => {
    const i = cab.indexOf(nombre);
    if (i === -1) throw new Error('La hoja no trae la columna "' + nombre + '".');
    return i;
  };

  const iPeriodo = col('Período'), iOrigen = col('Origen'), iRuc = col('RUC proveedor'),
    iProveedor = col('Proveedor'), iTipo = col('Tipo'), iSerie = col('Serie'),
    iNumero = col('Número'), iMoneda = col('Moneda'), iDetraccion = col('Detracción'),
    iTotal = col('Total del comprobante');

  // El detalle trae una fila por ÍTEM: el mismo comprobante se repite tantas
  // veces como productos tenga. Para no contar ni sumar de más, se agrupa
  // primero por documento (proveedor + tipo + serie + número) y todo lo que
  // sigue se calcula sobre esa lista, no sobre las filas crudas.
  const documentos = new Map();
  for (let f = 1; f < valores.length; f++) {
    const fila = valores[f];
    if (!fila[iRuc] && !fila[iSerie]) continue;
    const clave = [fila[iRuc], fila[iTipo], fila[iSerie], fila[iNumero]].join('|');
    if (documentos.has(clave)) continue;
    documentos.set(clave, {
      periodo: String(fila[iPeriodo] || ''),
      origen: String(fila[iOrigen] || 'Otro'),
      proveedorRuc: String(fila[iRuc] || ''),
      proveedor: String(fila[iProveedor] || fila[iRuc] || 'Sin nombre'),
      tipo: String(fila[iTipo] || 'Otro'),
      moneda: String(fila[iMoneda] || 'PEN'),
      total: Number(fila[iTotal]) || 0,
      detraccion: Number(fila[iDetraccion]) || 0,
    });
  }
  const docs = Array.from(documentos.values());

  const sumarEn = (mapa, clave, monto) => {
    const act = mapa.get(clave) || { cantidad: 0, monto: 0 };
    act.cantidad++; act.monto += monto;
    mapa.set(clave, act);
  };

  const porOrigen = new Map();
  const porTipo = new Map();
  const porPeriodo = new Map();
  const porMoneda = new Map();
  const porProveedorRecibido = new Map(); // clave: ruc → {nombre, cantidad, monto}
  let documentosConDetraccion = 0, montoDetraccion = 0;

  docs.forEach((d) => {
    sumarEn(porOrigen, d.origen, d.total);
    sumarEn(porTipo, d.tipo, d.total);
    sumarEn(porPeriodo, d.periodo, d.total);
    sumarEn(porMoneda, d.moneda, d.total);
    if (d.detraccion > 0) { documentosConDetraccion++; montoDetraccion += d.detraccion; }
    if (d.origen === 'Recibido') {
      const act = porProveedorRecibido.get(d.proveedorRuc) || { nombre: d.proveedor, cantidad: 0, monto: 0 };
      act.cantidad++; act.monto += d.total;
      porProveedorRecibido.set(d.proveedorRuc, act);
    }
  });

  const aLista = (mapa) => Array.from(mapa.entries())
    .map(([clave, v]) => ({ clave: clave, cantidad: v.cantidad, monto: v.monto }));

  const periodos = aLista(porPeriodo).sort((a, b) => a.clave.localeCompare(b.clave));
  const proveedoresTop = Array.from(porProveedorRecibido.entries())
    .map(([ruc, v]) => ({ ruc: ruc, nombre: v.nombre, cantidad: v.cantidad, monto: v.monto }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8);

  const monedaPrincipal = aLista(porMoneda).sort((a, b) => b.monto - a.monto)[0];
  const proveedoresDistintos = new Set(docs.map((d) => d.proveedorRuc)).size;

  return {
    totalDocumentos: docs.length,
    proveedoresDistintos: proveedoresDistintos,
    monedaPrincipal: monedaPrincipal ? monedaPrincipal.clave : 'PEN',
    montoPrincipal: monedaPrincipal ? monedaPrincipal.monto : 0,
    otrasMonedas: aLista(porMoneda).sort((a, b) => b.monto - a.monto).slice(1),
    documentosConDetraccion: documentosConDetraccion,
    montoDetraccion: montoDetraccion,
    periodoDesde: periodos.length ? periodos[0].clave : '',
    periodoHasta: periodos.length ? periodos[periodos.length - 1].clave : '',
    porOrigen: aLista(porOrigen).sort((a, b) => b.monto - a.monto),
    porTipo: aLista(porTipo).sort((a, b) => b.monto - a.monto),
    periodos: periodos,
    proveedoresTop: proveedoresTop,
    generadoEl: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Lima', "d 'de' MMMM 'de' yyyy, HH:mm"),
  };
}

// ── Presentación ───────────────────────────────────────────────────

/** "MM/AAAA" a partir de un período "AAAAMM"; lo que no calce se muestra tal cual. */
function etiquetaPeriodo_(periodo) {
  if (!/^\d{6}$/.test(periodo)) return periodo || 'Sin período';
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const mes = Number(periodo.slice(4, 6)) - 1;
  return MESES[mes] + ' ' + periodo.slice(0, 4);
}

function moneda_(monto, sufijo) {
  const signo = sufijo === 'USD' ? 'US$ ' : 'S/ ';
  return signo + Number(monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapar_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Fila de barra horizontal: etiqueta, cantidad, monto y una barra proporcional al máximo del grupo. */
function filaBarra_(etiqueta, cantidad, monto, maximo, colorBarra) {
  const pct = maximo > 0 ? Math.max(4, Math.round((monto / maximo) * 100)) : 0;
  return '' +
    '<div class="fila-barra">' +
    '<div class="fila-barra-cab">' +
    '<span class="fb-etiqueta">' + escapar_(etiqueta) + '</span>' +
    '<span class="fb-cifras"><b>' + moneda_(monto) + '</b> · ' + cantidad + (cantidad === 1 ? ' doc.' : ' docs.') + '</span>' +
    '</div>' +
    '<div class="fb-pista"><div class="fb-relleno" style="width:' + pct + '%; background:' + colorBarra + '"></div></div>' +
    '</div>';
}

function construirHtml_(r) {
  const maxTipo = Math.max(1, ...r.porTipo.map((x) => x.monto));
  const maxOrigen = Math.max(1, ...r.porOrigen.map((x) => x.monto));
  const maxPeriodo = Math.max(1, ...r.periodos.map((x) => x.monto));

  const coloresTipo = { 'Factura': 'var(--accent)', 'Boleta': '#5B8DEF', 'Nota de crédito': 'var(--danger)', 'Nota de débito': 'var(--warn)' };
  const coloresOrigen = { 'Emitido': 'var(--accent)', 'Recibido': 'var(--tinta)', 'Otro': 'var(--text3)' };

  const filasTipo = r.porTipo.map((x) => filaBarra_(x.clave || 'Otro', x.cantidad, x.monto, maxTipo, coloresTipo[x.clave] || 'var(--text3)')).join('');
  const filasOrigen = r.porOrigen.map((x) => filaBarra_(x.clave || 'Otro', x.cantidad, x.monto, maxOrigen, coloresOrigen[x.clave] || 'var(--text3)')).join('');
  const filasPeriodo = r.periodos.map((x) => filaBarra_(etiquetaPeriodo_(x.clave), x.cantidad, x.monto, maxPeriodo, 'var(--accent)')).join('');

  const filasProveedores = r.proveedoresTop.map((p, i) => (
    '<tr>' +
    '<td class="td-num">' + (i + 1) + '</td>' +
    '<td>' + escapar_(p.nombre) + '<div class="td-sub">' + escapar_(p.ruc) + '</div></td>' +
    '<td class="td-num">' + p.cantidad + '</td>' +
    '<td class="td-num td-monto">' + moneda_(p.monto) + '</td>' +
    '</tr>'
  )).join('');

  const otrasMonedasHtml = r.otrasMonedas.length
    ? r.otrasMonedas.map((m) => '<div class="kpi-extra">+ ' + moneda_(m.monto, m.clave) + ' (' + m.cantidad + ' docs.)</div>').join('')
    : '';

  const rangoPeriodo = r.periodoDesde
    ? (etiquetaPeriodo_(r.periodoDesde) + (r.periodoDesde === r.periodoHasta ? '' : ' – ' + etiquetaPeriodo_(r.periodoHasta)))
    : 'Sin datos';

  return '<!DOCTYPE html><html><head><base target="_top">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">' +
    '<style>' + ESTILOS_ + '</style></head><body>' +
    '<div class="pagina">' +

    '<header class="cabecera">' +
    '<div class="marca">' + LOGO_SVG_ +
    '<div class="marca-texto"><div class="marca-titulo">SUNAT · Comprobantes</div>' +
    '<div class="marca-sub">Vista ejecutiva · INROPRIN S.A.C.</div></div></div>' +
    '<a class="boton-hoja" href="' + URL_HOJA + '" target="_blank" rel="noopener">Abrir la hoja completa ↗</a>' +
    '</header>' +

    '<section class="kpis">' +
    '<div class="kpi"><div class="kpi-rotulo">Comprobantes con detalle</div><div class="kpi-valor">' + r.totalDocumentos.toLocaleString('es-PE') + '</div></div>' +
    '<div class="kpi"><div class="kpi-rotulo">Monto total (' + r.monedaPrincipal + ')</div><div class="kpi-valor">' + moneda_(r.montoPrincipal, r.monedaPrincipal) + '</div>' + otrasMonedasHtml + '</div>' +
    '<div class="kpi"><div class="kpi-rotulo">Proveedores distintos</div><div class="kpi-valor">' + r.proveedoresDistintos.toLocaleString('es-PE') + '</div></div>' +
    '<div class="kpi"><div class="kpi-rotulo">Con detracción</div><div class="kpi-valor">' + moneda_(r.montoDetraccion) + '</div><div class="kpi-extra">' + r.documentosConDetraccion + ' comprobantes</div></div>' +
    '<div class="kpi"><div class="kpi-rotulo">Período cubierto</div><div class="kpi-valor kpi-valor-chico">' + rangoPeriodo + '</div></div>' +
    '</section>' +

    '<section class="dos-columnas">' +
    '<div class="tarjeta"><h2>Por tipo de comprobante</h2>' + (filasTipo || '<p class="vacio">Sin datos.</p>') + '</div>' +
    '<div class="tarjeta"><h2>Emitidas vs. recibidas</h2>' + (filasOrigen || '<p class="vacio">Sin datos.</p>') + '</div>' +
    '</section>' +

    '<section class="tarjeta tarjeta-ancha">' +
    '<h2>Evolución mensual</h2>' +
    (filasPeriodo || '<p class="vacio">Sin datos.</p>') +
    '</section>' +

    '<section class="tarjeta tarjeta-ancha">' +
    '<h2>Principales proveedores (comprobantes recibidos)</h2>' +
    (filasProveedores
      ? '<table class="tabla"><thead><tr><th></th><th>Proveedor</th><th class="th-num">Comprobantes</th><th class="th-num">Monto</th></tr></thead><tbody>' + filasProveedores + '</tbody></table>'
      : '<p class="vacio">Sin comprobantes recibidos en el detalle.</p>') +
    '</section>' +

    '<footer class="pie">' +
    '<span>Generado el ' + r.generadoEl + ' · a partir de "COMPROBANTES SUNAT - DETALLE"</span>' +
    '<a class="boton-hoja boton-hoja-secundario" href="' + URL_HOJA + '" target="_blank" rel="noopener">Ver el detalle completo ↗</a>' +
    '</footer>' +

    '</div></body></html>';
}

// Wordmark de Roland Print (empresa matriz de INROPRIN), la misma que usa la
// aplicación — así el enlace se ve como parte de la misma familia visual.
const LOGO_SVG_ = '<svg width="130" height="29" viewBox="0 0 183 41" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Roland Print">' +
  '<path opacity="0.15" d="M15.3066 35.9092L26.7855 35.8535L31.4094 40.5052H19.9305L15.3066 35.9092Z" fill="#1D1D1B"/>' +
  '<path d="M11.9185 20.6918L5.95923 26.6176L0 20.6918L5.95923 14.7715L11.9185 20.6918Z" fill="#006DB1"/>' +
  '<path d="M18.8459 13.8087L12.8867 19.7345L6.92188 13.8087L12.8867 7.88281L18.8459 13.8087Z" fill="#E30613"/>' +
  '<path d="M25.7681 6.92584L19.8088 12.8517L13.8496 6.92584L19.8088 1L25.7681 6.92584Z" fill="#006DB1"/>' +
  '<path d="M18.9683 27.7032L13.009 33.629L7.0498 27.7032L13.009 21.7773L18.9683 27.7032Z" fill="#00A298"/>' +
  '<path d="M25.8957 20.8148L19.9365 26.7406L13.9717 20.8148L19.9365 14.8945L25.8957 20.8148Z" fill="#FFDD00"/>' +
  '<path d="M32.8179 13.9317L26.8586 19.8575L20.8994 13.9317L26.8586 8.00586L32.8179 13.9317Z" fill="#00A298"/>' +
  '<path d="M25.8843 34.5801L19.925 40.506L13.9658 34.5801L19.9306 28.6543L25.8843 34.5801Z" fill="#E30613"/>' +
  '<path d="M32.812 27.6918L26.8528 33.6176L20.8936 27.6918L26.8528 21.7715L32.812 27.6918Z" fill="#006DB1"/>' +
  '<path d="M38.5097 24.7486L30.2246 23.2018L31.777 14.9668L40.0621 16.5136L38.5097 24.7486Z" fill="#E30613"/>' +
  '<path d="M50.4785 16.111H59.0918C61.0171 16.111 62.447 16.5228 63.3763 17.3407C64.3389 18.1976 64.8229 19.444 64.8229 21.0854C64.8229 22.1815 64.5837 23.0829 64.0996 23.8007C63.6879 24.4851 63.0313 24.9803 62.141 25.2864C62.9311 25.559 63.482 25.9707 63.7936 26.516C64.1052 27.0279 64.2943 27.9015 64.3611 29.1312L64.4668 31.2344V31.9021C64.4668 32.1414 64.4835 32.364 64.5169 32.5699C64.6226 33.1875 64.8285 33.577 65.1345 33.7495H61.1116C60.9392 33.41 60.8334 33.0484 60.8 32.67C60.7333 32.1247 60.6943 31.7464 60.6943 31.5405L60.6443 29.6431C60.5775 28.6193 60.3716 27.8793 60.0266 27.4397C59.6483 27.0613 58.975 26.8777 58.0124 26.8777H54.1453V33.7495H50.4841V16.1055L50.4785 16.111ZM54.1397 23.8007H58.4242C59.3534 23.8007 60.0433 23.6115 60.4885 23.2387C60.9336 22.8604 61.1617 22.2817 61.1617 21.4972C61.1617 20.7126 60.9392 20.1284 60.4885 19.7556C60.0767 19.3438 59.4591 19.1379 58.63 19.1379H54.1397V23.8063V23.8007Z" fill="#1D1D1B"/>' +
  '<path d="M83.786 16.1113V33.7553H80.1748V16.1113H83.786Z" fill="#1D1D1B"/>' +
  '<path d="M90.3954 33.8169C89.1602 33.8169 88.0751 33.4831 87.1459 32.8154C86.2167 32.1477 85.7549 31.2352 85.7549 29.6994C85.7549 28.2639 86.1778 27.2345 87.018 26.6225C87.4686 26.2942 87.9861 26.0215 88.5704 25.8101C89.0767 25.6265 91.3803 25.2203 91.6919 25.1869C93.2053 24.981 93.962 24.5359 93.962 23.8515C93.962 23.3396 93.695 23.0057 93.1608 22.8499C92.6266 22.6941 92.137 22.6218 91.6919 22.6218C91.2078 22.6218 90.7793 22.6886 90.401 22.8277C90.0226 22.9668 89.75 23.2227 89.5775 23.5955H86.1221C86.2612 22.5384 86.7397 21.6648 87.5688 20.9804C88.498 20.1958 89.8223 19.8008 91.5416 19.8008C93.4668 19.8008 94.9135 20.1235 95.8761 20.7745C96.8721 21.4589 97.3729 22.4159 97.3729 23.6456V33.8169M94.0121 31.046V26.884C93.528 27.1232 92.8603 27.3458 91.9979 27.5517L90.8127 27.8076C90.1951 27.9801 89.7166 28.1749 89.4718 28.4753C89.1935 28.8203 89.1101 29.2265 89.1101 29.6048C89.1101 30.1168 89.2659 30.3338 89.5775 30.6398C89.8835 30.9124 90.3342 31.0515 90.9184 31.0515H94.0121V31.046Z" fill="#1D1D1B"/>' +
  '<path d="M108.001 33.756V25.037C108.001 24.219 107.751 23.6181 107.256 23.2397C106.755 22.8614 106.198 22.6778 105.581 22.6778C104.963 22.6778 104.412 22.8669 103.928 23.2397C103.45 23.6181 103.205 24.2135 103.205 25.037V33.756H99.5938V25.7547C99.5938 23.4289 100.206 21.8765 101.424 21.0864C102.643 20.3019 103.995 19.8734 105.475 19.8066C106.989 19.8066 108.38 20.2017 109.654 20.9862C110.928 21.7708 111.562 23.3621 111.562 25.7547V33.756H108.001Z" fill="#1D1D1B"/>' +
  '<path d="M119.864 33.8172C119.096 33.8394 117.889 33.7838 117.232 33.5724C116.575 33.3609 115.685 32.8101 115.168 32.1591C114.172 30.896 113.671 29.1655 113.671 26.9788C113.671 24.7921 114.166 23.1006 115.168 21.7986C116.197 20.4632 117.521 19.7955 119.14 19.7955C120.003 19.7955 120.76 19.968 121.411 20.3074C122.101 20.7191 122.651 21.2477 123.063 21.8987V16.0508H126.569V33.8116H119.858L119.864 33.8172ZM122.941 23.9074C122.39 23.223 120.999 22.8836 120.07 22.8836C119.14 22.8836 118.473 23.2397 117.955 23.9575C117.438 24.6419 117.182 25.5989 117.182 26.8286C117.182 28.1974 117.438 29.2379 117.955 29.9556C118.473 30.6734 119.207 31.0351 120.175 31.0351C121.144 31.0351 121.383 31.0407 122.941 31.0295V23.9074Z" fill="#1D1D1B"/>' +
  '<path d="M133.758 16.1113H141.653C143.545 16.1113 144.953 16.5898 145.882 17.5469C146.845 18.5039 147.323 19.9228 147.323 21.8035C147.323 23.584 146.861 24.9862 145.932 26.01C145.003 26.967 143.662 27.4455 141.909 27.4455H137.419V33.7553H133.758V16.1113ZM137.425 24.2628H140.986C141.948 24.2628 142.638 24.057 143.05 23.6452C143.495 23.2669 143.723 22.6214 143.723 21.6978C143.723 20.9132 143.517 20.2789 143.106 19.8004C142.627 19.3886 141.987 19.1828 141.197 19.1828H137.43V24.2628H137.425Z" fill="#1D1D1B"/>' +
  '<path d="M147.612 33.7566V27.1408C147.612 25.8054 147.807 24.687 148.202 23.7801C148.597 22.8731 149.137 22.1498 149.827 21.5989C150.483 21.087 151.246 20.7086 152.125 20.4694C153.004 20.2301 153.905 20.1133 154.835 20.1133H155.352V23.7522H154.167C153.171 23.7522 152.431 23.9915 151.947 24.47C151.468 24.9485 151.223 25.6997 151.223 26.7291V33.7566H147.612Z" fill="#1D1D1B"/>' +
  '<path d="M161.095 16.1113V18.9324H157.483V16.1113H161.095ZM161.095 20.112V33.7553H157.483V20.112H161.095Z" fill="#1D1D1B"/>' +
  '<path d="M171.705 33.756V25.037C171.705 24.219 171.455 23.6181 170.96 23.2397C170.459 22.8614 169.903 22.6778 169.285 22.6778C168.667 22.6778 168.116 22.8669 167.632 23.2397C167.148 23.6181 166.909 24.2135 166.909 25.037V33.756H163.298V25.7547C163.298 23.4289 163.91 21.8765 165.128 21.0864C166.347 20.3019 167.699 19.8734 169.179 19.8066C170.693 19.8066 172.089 20.2017 173.358 20.9862C174.632 21.7708 175.266 23.3621 175.266 25.7547V33.756H171.705Z" fill="#1D1D1B"/>' +
  '<path d="M183.001 22.6211H180.886V33.7495H177.325V16.1055H180.886V20.1562H183.001V22.6155" fill="#1D1D1B"/>' +
  '<path d="M77.3037 22.8049C76.686 21.553 75.7234 20.6738 74.4159 20.1619C73.2808 19.7558 72.0066 19.6445 70.5988 19.8337C69.1855 20.0228 68.0393 20.6182 67.1435 21.6364C66.5926 22.2429 66.1865 23.0052 65.9305 23.9178C65.6746 24.8303 65.541 25.7484 65.541 26.6609C65.541 27.7793 65.6968 28.8532 66.0084 29.8825C66.3144 30.9175 66.8319 31.7354 67.5552 32.3475C68.2396 32.954 69.1633 33.388 70.3151 33.6439C71.4669 33.8999 72.6131 33.8721 73.7482 33.566C75.0224 33.2989 76.0684 32.6034 76.8975 31.485C77.2758 30.9453 77.5819 30.2832 77.8267 29.5042C78.066 28.7252 78.1884 27.796 78.1884 26.711C78.1884 25.2253 77.8935 23.9178 77.3092 22.7994L77.3037 22.8049ZM71.8619 30.9954C69.9144 30.9954 68.9741 29.1091 68.9741 26.7833C68.9741 24.4575 69.9089 22.5712 71.8619 22.5712C73.8149 22.5712 74.7497 24.4575 74.7497 26.7833C74.7497 29.1091 73.8038 30.9954 71.8619 30.9954Z" fill="#1D1D1B"/>' +
  '</svg>';

const ESTILOS_ = '' +
  ':root{' +
  '--bg:#EDF1F4;--surface:#FFFFFF;--surface2:#F6F8FA;--border:#E4E9EE;--border2:#D2DAE2;' +
  '--accent:#00A298;--accent-texto:#007A72;--accent-suave:#E6F5F4;--accent-borde:#A8DED9;' +
  '--tinta:#1D1D1B;--text:#101A24;--text2:#52627A;--text3:#8494A8;' +
  '--danger:#C62828;--warn:#A15C07;--success:#0A6E4E;' +
  '--sombra:0 2px 4px rgba(16,26,38,.05),0 6px 16px rgba(16,26,38,.06);' +
  '}' +
  '*{box-sizing:border-box;}' +
  'body{margin:0;background:var(--bg);color:var(--text);font-family:"DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;}' +
  '.pagina{max-width:1080px;margin:0 auto;padding:28px 24px 56px;}' +
  'h2{font-family:"Sora",sans-serif;font-size:15px;font-weight:700;margin:0 0 16px;color:var(--text);}' +
  '.cabecera{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border2);}' +
  '.marca{display:flex;align-items:center;gap:16px;}' +
  '.marca-titulo{font-family:"Sora",sans-serif;font-weight:700;font-size:17px;color:var(--text);}' +
  '.marca-sub{font-size:12.5px;color:var(--text2);margin-top:2px;}' +
  '.boton-hoja{display:inline-flex;align-items:center;gap:6px;background:var(--tinta);color:#fff;text-decoration:none;font-weight:600;font-size:13.5px;padding:11px 18px;border-radius:10px;box-shadow:var(--sombra);white-space:nowrap;}' +
  '.boton-hoja:hover{background:#000;}' +
  '.boton-hoja-secundario{background:var(--accent);}' +
  '.boton-hoja-secundario:hover{background:var(--accent-texto);}' +
  '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;}' +
  '.kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 18px 16px;box-shadow:var(--sombra);}' +
  '.kpi-rotulo{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}' +
  '.kpi-valor{font-family:"Sora",sans-serif;font-size:24px;font-weight:800;color:var(--text);letter-spacing:-.01em;}' +
  '.kpi-valor-chico{font-size:16px;font-weight:700;}' +
  '.kpi-extra{font-size:12px;color:var(--text2);margin-top:6px;}' +
  '.dos-columnas{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}' +
  '@media(max-width:760px){.dos-columnas{grid-template-columns:1fr;} .cabecera{flex-direction:column;align-items:flex-start;}}' +
  '.tarjeta{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 22px;box-shadow:var(--sombra);}' +
  '.tarjeta-ancha{margin-bottom:14px;}' +
  '.fila-barra{margin-bottom:14px;}' +
  '.fila-barra:last-child{margin-bottom:0;}' +
  '.fila-barra-cab{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;gap:10px;}' +
  '.fb-etiqueta{font-size:13.5px;font-weight:600;color:var(--text);text-transform:capitalize;}' +
  '.fb-cifras{font-size:12.5px;color:var(--text2);white-space:nowrap;}' +
  '.fb-pista{height:8px;background:var(--surface3,#EEF2F6);border-radius:6px;overflow:hidden;}' +
  '.fb-relleno{height:100%;border-radius:6px;}' +
  '.vacio{color:var(--text3);font-size:13px;margin:0;}' +
  '.tabla{width:100%;border-collapse:collapse;font-size:13.5px;}' +
  '.tabla th{text-align:left;padding:0 10px 10px 0;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border2);}' +
  '.th-num{text-align:right;}' +
  '.tabla td{padding:11px 10px 11px 0;border-bottom:1px solid var(--border);vertical-align:top;}' +
  '.td-num{text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);}' +
  '.td-monto{color:var(--text);font-weight:600;}' +
  '.td-sub{font-size:11.5px;color:var(--text3);margin-top:2px;}' +
  '.pie{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:24px;font-size:12px;color:var(--text3);}';
