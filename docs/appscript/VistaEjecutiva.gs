/**
 * Vista ejecutiva de "COMPROBANTES SUNAT - DETALLE" — publicada como
 * aplicación web
 * --------------------------------------------------------------------------
 *
 * Un enlace propio (no la hoja) para compartir de forma formal: resume el
 * detalle de comprobantes —cuánto, de quién, en qué tipo, cómo se mueve mes
 * a mes— con un botón que abre la hoja real para quien necesite el
 * desglose línea por línea. Y los indicadores para Contabilidad: precios de
 * cada producto en el tiempo (para revalorizar el Kardex), cuánto costó cada
 * importación en gastos con factura de SUNAT, proveedores mes a mes,
 * detracción por mes y cuánto del gasto ya tiene su OC y su centro de costo.
 *
 * Mismo espíritu que `TableroPadron.gs` + `TableroPadron.html`: este archivo
 * calcula los números UNA vez por visita —no tiene sentido bajar cientos de
 * filas al navegador de cada persona solo para sumarlas ahí— y
 * `VistaEjecutivaPagina.html` los pinta. `doGet()` es lo que hace posible
 * publicarlo como su propia URL, distinto de `Tablero.html` (que se abre
 * como diálogo desde el menú de la hoja).
 *
 * ── Instalación ──
 * 1. Abre "COMPROBANTES SUNAT - DETALLE" → Extensiones → Apps Script.
 * 2. Pega esto en un archivo `VistaEjecutiva` (Script) — el `+` junto a
 *    «Archivos» → Script.
 * 3. El `+` → HTML → llámalo `VistaEjecutivaPagina` (un script y un HTML NO
 *    pueden llamarse igual: Apps Script comparte un solo espacio de nombres
 *    entre todos los archivos del proyecto, sin importar el tipo) → pega el
 *    contenido de `VistaEjecutivaPagina.html`.
 * 4. Guarda.
 * 5. Implementar → Nueva implementación → tipo «Aplicación web».
 *    - Ejecutar como: Yo (tu cuenta).
 *    - Quién tiene acceso: «Cualquier usuario con el enlace» (o la variante
 *      de Workspace si solo debe verlo gente de la empresa).
 * 6. Implementar → copia la URL que termina en `/exec`. Esa es la que se
 *    comparte, no la del editor de Apps Script.
 * 7. Cada vez que cambies el código hay que volver a «Gestionar
 *    implementaciones» → el lápiz → Versión «Nueva» → Implementar: una
 *    implementación ya publicada no se actualiza sola con el código nuevo.
 */

var HOJA_ID_VISTA = '1Kp5RS_7_dIwQDziSsK-vKbuYyCUxtG7VYktk5XkWj_A';
var NOMBRE_PESTANA_VISTA = 'COMPROBANTES SUNAT - DETALLE';
var URL_HOJA_VISTA = 'https://docs.google.com/spreadsheets/d/' + HOJA_ID_VISTA + '/edit';

/** Punto de entrada de la aplicación web. Apps Script lo llama solo al visitar la URL publicada. */
function doGet() {
  return HtmlService.createTemplateFromFile('VistaEjecutivaPagina')
    .evaluate()
    .setTitle('SUNAT · Comprobantes — Vista ejecutiva')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Lo que pide el HTML por `google.script.run`. Nunca lanza: el error viaja en el objeto. */
function datosDeLaVistaEjecutiva() {
  try {
    return calcularResumenVista_();
  } catch (e) {
    return { error: e.message };
  }
}

/** Lee la pestaña de detalle y arma todos los agregados que pinta la página. */
function calcularResumenVista_() {
  var libro = SpreadsheetApp.openById(HOJA_ID_VISTA);
  var hoja = libro.getSheetByName(NOMBRE_PESTANA_VISTA) || libro.getSheets()[0];
  var valores = hoja.getDataRange().getValues();
  var cab = valores[0];
  var col = function (nombre) {
    var i = cab.indexOf(nombre);
    if (i === -1) throw new Error('La hoja no trae la columna "' + nombre + '".');
    return i;
  };

  var iPeriodo = col('Período'), iOrigen = col('Origen'), iRuc = col('RUC proveedor'),
    iProveedor = col('Proveedor'), iTipo = col('Tipo'), iSerie = col('Serie'),
    iNumero = col('Número'), iMoneda = col('Moneda'), iDetraccion = col('Detracción'),
    iTotal = col('Total del comprobante');
  // Las columnas que se fueron sumando al final de la hoja: si una versión
  // vieja no las trae, esas secciones salen vacías en vez de fallar.
  var opc = function (nombre) { return cab.indexOf(nombre); };
  var extra = {
    origen: iOrigen, periodo: iPeriodo, proveedor: iProveedor, moneda: iMoneda,
    descripcion: opc('Descripción'), unidad: opc('Unidad'), cantidad: opc('Cantidad'),
    precio: opc('Precio unitario'), importe: opc('Importe'),
    oc: opc('OC (carpeta)'), cc: opc('Centro de costo (CG)'), area: opc('Área que completa el legajo'),
    legajo: opc('Legajo de la OC'), situacion: opc('Situación del pago (OC)')
  };

  // El detalle trae una fila por ÍTEM: el mismo comprobante se repite tantas
  // veces como productos tenga. Para no contar ni sumar de más, se agrupa
  // primero por documento (proveedor + tipo + serie + número) y todo lo que
  // sigue se calcula sobre esa lista, no sobre las filas crudas.
  var documentos = {};
  var precios = {}; // producto → lo que se pagó por él cada mes (para «Precios en el tiempo»)
  for (var f = 1; f < valores.length; f++) {
    var fila = valores[f];
    if (!fila[iRuc] && !fila[iSerie]) continue;
    anotarPrecio_(precios, fila, extra);
    var clave = [fila[iRuc], fila[iTipo], fila[iSerie], fila[iNumero]].join('|');
    if (documentos[clave]) continue;
    documentos[clave] = {
      oc: extra.oc >= 0 ? String(fila[extra.oc] || '').trim() : '',
      cc: extra.cc >= 0 ? String(fila[extra.cc] || '').trim() : '',
      area: extra.area >= 0 ? String(fila[extra.area] || '') : '',
      legajo: extra.legajo >= 0 ? String(fila[extra.legajo] || '') : '',
      situacion: extra.situacion >= 0 ? String(fila[extra.situacion] || '') : '',
      periodo: String(fila[iPeriodo] || ''),
      origen: String(fila[iOrigen] || 'Otro'),
      proveedorRuc: String(fila[iRuc] || ''),
      proveedor: String(fila[iProveedor] || fila[iRuc] || 'Sin nombre'),
      tipo: String(fila[iTipo] || 'Otro'),
      moneda: String(fila[iMoneda] || 'PEN'),
      total: Number(fila[iTotal]) || 0,
      detraccion: Number(fila[iDetraccion]) || 0
    };
  }
  var docs = [];
  for (var clave2 in documentos) docs.push(documentos[clave2]);

  var sumarEn = function (mapa, clave, monto) {
    var act = mapa[clave] || { cantidad: 0, monto: 0 };
    act.cantidad++; act.monto += monto;
    mapa[clave] = act;
  };

  var porOrigen = {}, porTipo = {}, porPeriodo = {}, porMoneda = {}, porProveedorRecibido = {};
  var documentosConDetraccion = 0, montoDetraccion = 0;

  docs.forEach(function (d) {
    sumarEn(porOrigen, d.origen, d.total);
    sumarEn(porTipo, d.tipo, d.total);
    sumarEn(porPeriodo, d.periodo, d.total);
    sumarEn(porMoneda, d.moneda, d.total);
    if (d.detraccion > 0) { documentosConDetraccion++; montoDetraccion += d.detraccion; }
    if (d.origen === 'Recibido') {
      var act = porProveedorRecibido[d.proveedorRuc] || { nombre: d.proveedor, cantidad: 0, monto: 0 };
      act.cantidad++; act.monto += d.total;
      porProveedorRecibido[d.proveedorRuc] = act;
    }
  });

  var aLista = function (mapa) {
    var out = [];
    for (var k in mapa) out.push({ clave: k, cantidad: mapa[k].cantidad, monto: mapa[k].monto });
    return out;
  };
  var porMonto = function (a, b) { return b.monto - a.monto; };

  var periodos = aLista(porPeriodo).sort(function (a, b) { return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0; });
  var maxPeriodo = Math.max.apply(null, [1].concat(periodos.map(function (p) { return p.monto; })));
  periodos = periodos.map(function (p) {
    return { etiqueta: etiquetaPeriodo_(p.clave), cantidad: p.cantidad, montoTexto: moneda_(p.monto), pct: pct_(p.monto, maxPeriodo) };
  });

  var listaOrigen = aLista(porOrigen).sort(porMonto);
  var maxOrigen = Math.max.apply(null, [1].concat(listaOrigen.map(function (x) { return x.monto; })));
  var COLOR_ORIGEN = { 'Emitido': 'var(--accent)', 'Recibido': 'var(--tinta)', 'Otro': 'var(--text3)' };
  listaOrigen = listaOrigen.map(function (x) {
    return { etiqueta: x.clave || 'Otro', cantidad: x.cantidad, montoTexto: moneda_(x.monto), pct: pct_(x.monto, maxOrigen), color: COLOR_ORIGEN[x.clave] || 'var(--text3)' };
  });

  var listaTipo = aLista(porTipo).sort(porMonto);
  var maxTipo = Math.max.apply(null, [1].concat(listaTipo.map(function (x) { return x.monto; })));
  var COLOR_TIPO = { 'Factura': 'var(--accent)', 'Boleta': '#5B8DEF', 'Nota de crédito': 'var(--danger)', 'Nota de débito': 'var(--warn)' };
  listaTipo = listaTipo.map(function (x) {
    return { etiqueta: x.clave || 'Otro', cantidad: x.cantidad, montoTexto: moneda_(x.monto), pct: pct_(x.monto, maxTipo), color: COLOR_TIPO[x.clave] || 'var(--text3)' };
  });

  var proveedoresTop = [];
  for (var ruc in porProveedorRecibido) {
    var p = porProveedorRecibido[ruc];
    proveedoresTop.push({ ruc: ruc, nombre: p.nombre, cantidad: p.cantidad, montoTexto: moneda_(p.monto), monto: p.monto });
  }
  proveedoresTop.sort(porMonto);
  proveedoresTop = proveedoresTop.slice(0, 8);

  var listaMoneda = aLista(porMoneda).sort(porMonto);
  var monedaPrincipal = listaMoneda[0] || { clave: 'PEN', monto: 0 };
  var otrasMonedas = listaMoneda.slice(1).map(function (m) {
    return moneda_(m.monto, m.clave) + ' (' + m.cantidad + (m.cantidad === 1 ? ' doc.)' : ' docs.)');
  });

  var proveedoresDistintos = {};
  docs.forEach(function (d) { proveedoresDistintos[d.proveedorRuc] = true; });
  var cuantosProveedores = 0;
  for (var x in proveedoresDistintos) cuantosProveedores++;

  var rangoPeriodo = periodos.length ? '' : 'Sin datos';
  if (periodos.length) {
    var claves = aLista(porPeriodo).map(function (p) { return p.clave; }).sort();
    rangoPeriodo = etiquetaPeriodo_(claves[0]) + (claves[0] === claves[claves.length - 1] ? '' : ' – ' + etiquetaPeriodo_(claves[claves.length - 1]));
  }

  var nuevos = indicadoresNuevos_(docs, precios, periodos.length ? aLista(porPeriodo).map(function (p) { return p.clave; }).sort() : []);

  return {
    error: null,
    cobertura: nuevos.cobertura,
    porMes: nuevos.porMes,
    precios: nuevos.precios,
    importaciones: nuevos.importaciones,
    proveedoresMes: nuevos.proveedoresMes,
    centros: nuevos.centros,
    urlHoja: URL_HOJA_VISTA,
    generadoEl: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Lima', "d 'de' MMMM 'de' yyyy, HH:mm"),
    totalDocumentosTexto: miles_(docs.length),
    proveedoresDistintosTexto: miles_(cuantosProveedores),
    monedaPrincipal: monedaPrincipal.clave,
    montoPrincipalTexto: moneda_(monedaPrincipal.monto, monedaPrincipal.clave),
    otrasMonedas: otrasMonedas,
    documentosConDetraccion: documentosConDetraccion,
    montoDetraccionTexto: moneda_(montoDetraccion),
    rangoPeriodo: rangoPeriodo,
    porOrigen: listaOrigen,
    porTipo: listaTipo,
    periodos: periodos,
    proveedoresTop: proveedoresTop
  };
}

// ── Los indicadores para Contabilidad ──
// Todo sale de columnas que la hoja ya trae. Los montos se suman por
// moneda y no se convierten: la hoja no trae el tipo de cambio de cada ítem.

/** Una fila de ítem recibido suma a su producto, en su mes. */
function anotarPrecio_(precios, fila, c) {
  if (c.descripcion < 0 || c.precio < 0) return;
  if (String(fila[c.origen]) !== 'Recibido') return;
  var desc = String(fila[c.descripcion] || '').replace(/\s+/g, ' ').trim();
  var precio = Number(fila[c.precio]) || 0;
  if (desc.length < 4 || precio <= 0) return;
  var unidad = c.unidad >= 0 ? String(fila[c.unidad] || '').trim() : '';
  var moneda = String(fila[c.moneda] || 'PEN');
  var k = desc.toUpperCase() + '|' + unidad.toUpperCase() + '|' + moneda;
  var p = precios[k] || (precios[k] = { desc: desc, unidad: unidad, moneda: moneda, total: 0, meses: {}, proveedores: {} });
  var cant = c.cantidad >= 0 ? Number(fila[c.cantidad]) || 0 : 0;
  var imp = c.importe >= 0 ? Number(fila[c.importe]) || 0 : 0;
  var periodo = String(fila[c.periodo] || '');
  var m = p.meses[periodo] || (p.meses[periodo] = { cant: 0, imp: 0, suma: 0, n: 0 });
  if (cant > 0 && imp > 0) { m.cant += cant; m.imp += imp; }
  m.suma += precio; m.n++;
  p.total += imp || precio * (cant || 1);
  p.proveedores[String(fila[c.proveedor] || '')] = true;
}

function indicadoresNuevos_(docs, precios, clavesPeriodo) {
  var recibidos = docs.filter(function (d) { return d.origen === 'Recibido'; });
  var esImpo = function (d) {
    return /COMEX|IMPORTA/i.test(d.area) || d.oc.split(' / ').some(function (o) { return /^\d{3}-\d{4}$/.test(o.trim()); });
  };
  var enSoles = function (d) { return d.moneda === 'PEN' ? d.total : 0; };

  // Cobertura: cuántos recibidos ya están unidos a su OC y a un centro de costo.
  var conOc = recibidos.filter(function (d) { return d.oc; }).length;
  var conCc = recibidos.filter(function (d) { return d.cc && d.cc !== '-'; }).length;
  var cobertura = {
    recibidos: recibidos.length,
    conOcTexto: miles_(conOc), conOcPct: recibidos.length ? Math.round(100 * conOc / recibidos.length) : 0,
    conCcTexto: miles_(conCc), conCcPct: recibidos.length ? Math.round(100 * conCc / recibidos.length) : 0
  };

  // Por mes: total, detracción y gastos de importación (en soles).
  var mes = {};
  docs.forEach(function (d) {
    var m = mes[d.periodo] || (mes[d.periodo] = { docs: 0, total: 0, detraccion: 0, impo: 0 });
    m.docs++; m.total += enSoles(d); m.detraccion += d.detraccion;
    if (d.origen === 'Recibido' && esImpo(d)) m.impo += enSoles(d);
  });
  var porMes = clavesPeriodo.map(function (k) {
    var m = mes[k] || { docs: 0, total: 0, detraccion: 0, impo: 0 };
    return { etiqueta: etiquetaPeriodo_(k), docs: miles_(m.docs), total: moneda_(m.total), detraccion: moneda_(m.detraccion), impo: moneda_(m.impo) };
  });

  // Precios en el tiempo: productos comprados en dos meses o más.
  var lista = [];
  for (var k in precios) {
    var p = precios[k];
    var meses = Object.keys(p.meses).filter(function (x) { return /^\d{6}$/.test(x); }).sort();
    if (meses.length < 2) continue;
    var precioDe = function (x) { var m = p.meses[x]; return m.cant > 0 ? m.imp / m.cant : m.suma / m.n; };
    var ini = precioDe(meses[0]), fin = precioDe(meses[meses.length - 1]);
    lista.push({
      desc: p.desc, unidad: p.unidad, moneda: p.moneda, total: p.total,
      proveedores: Object.keys(p.proveedores).filter(String).slice(0, 2).join(' / '),
      meses: meses.length,
      primero: etiquetaPeriodo_(meses[0]) + ' · ' + moneda_(ini, p.moneda),
      ultimo: etiquetaPeriodo_(meses[meses.length - 1]) + ' · ' + moneda_(fin, p.moneda),
      variacion: ini > 0 ? Math.round(1000 * (fin - ini) / ini) / 10 : 0
    });
  }
  lista.sort(function (a, b) { return b.total - a.total; });
  var preciosTop = lista.slice(0, 150);

  // Importaciones: los comprobantes de SUNAT unidos a una OC de importación.
  var impo = {};
  recibidos.filter(esImpo).forEach(function (d) {
    d.oc.split(' / ').forEach(function (o) {
      o = o.trim(); if (!o) return;
      var x = impo[o] || (impo[o] = { oc: o, docs: 0, montos: {}, proveedores: {}, legajo: d.legajo, situacion: d.situacion, soles: 0 });
      x.docs++; x.montos[d.moneda] = (x.montos[d.moneda] || 0) + d.total; x.proveedores[d.proveedor] = true;
      if (d.moneda === 'PEN') x.soles += d.total;
    });
  });
  var importaciones = Object.keys(impo).map(function (o) {
    var x = impo[o];
    return { oc: o, docs: x.docs, soles: x.soles,
      monto: Object.keys(x.montos).map(function (m) { return moneda_(x.montos[m], m); }).join(' + '),
      proveedores: Object.keys(x.proveedores).slice(0, 3).join(' / '), legajo: x.legajo, situacion: x.situacion };
  }).sort(function (a, b) { return b.soles - a.soles; });

  // Proveedores mes a mes: los 10 que más facturaron en los últimos 6 meses (en soles).
  var ult = clavesPeriodo.filter(function (x) { return /^\d{6}$/.test(x); }).slice(-6);
  var prov = {};
  recibidos.forEach(function (d) {
    if (ult.indexOf(d.periodo) === -1 || d.moneda !== 'PEN') return;
    var x = prov[d.proveedorRuc] || (prov[d.proveedorRuc] = { nombre: d.proveedor, ruc: d.proveedorRuc, total: 0, meses: {} });
    x.total += d.total; x.meses[d.periodo] = (x.meses[d.periodo] || 0) + d.total;
  });
  var provLista = Object.keys(prov).map(function (r) { return prov[r]; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
  var proveedoresMes = {
    meses: ult.map(etiquetaPeriodo_),
    filas: provLista.map(function (x) {
      return { nombre: x.nombre, ruc: x.ruc, total: moneda_(x.total),
        valores: ult.map(function (m) { return x.meses[m] ? moneda_(x.meses[m]) : '—'; }) };
    })
  };

  // Centros de costo: a dónde va el gasto recibido ya unido a su OC (en soles).
  var cc = {};
  recibidos.forEach(function (d) {
    if (!d.cc || d.cc === '-') return;
    var x = cc[d.cc] || (cc[d.cc] = { cantidad: 0, monto: 0 });
    x.cantidad++; x.monto += enSoles(d);
  });
  var centrosLista = Object.keys(cc).map(function (k) { return { clave: k, cantidad: cc[k].cantidad, monto: cc[k].monto }; })
    .sort(function (a, b) { return b.monto - a.monto; }).slice(0, 10);
  var maxCc = Math.max.apply(null, [1].concat(centrosLista.map(function (x) { return x.monto; })));
  var centros = centrosLista.map(function (x) {
    return { etiqueta: x.clave, cantidad: x.cantidad, montoTexto: moneda_(x.monto), pct: pct_(x.monto, maxCc), color: 'var(--accent)' };
  });

  return { cobertura: cobertura, porMes: porMes, precios: preciosTop, importaciones: importaciones.slice(0, 40),
    importacionesTotal: importaciones.length, proveedoresMes: proveedoresMes, centros: centros };
}

/** "mar 2026" a partir de un período "AAAAMM"; lo que no calce se muestra tal cual. */
function etiquetaPeriodo_(periodo) {
  if (!/^\d{6}$/.test(periodo)) return periodo || 'Sin período';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  var mes = Number(periodo.slice(4, 6)) - 1;
  return MESES[mes] + ' ' + periodo.slice(0, 4);
}

/**
 * "S/ 1,234.56" a mano, sin `toLocaleString`: el runtime V8 de Apps Script
 * no trae el paquete de idiomas completo y una vez desplegado formatea
 * distinto a como se probó en el editor — más vale no depender de eso para
 * una cifra en soles.
 */
function moneda_(monto, cod) {
  var signo = cod === 'USD' ? 'US$ ' : 'S/ ';
  var n = Number(monto) || 0;
  var negativo = n < 0;
  var partes = Math.abs(n).toFixed(2).split('.');
  var entero = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negativo ? '-' : '') + signo + entero + '.' + partes[1];
}

/** "1,234" a mano, mismo motivo que `moneda_`. */
function miles_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pct_(monto, maximo) {
  return maximo > 0 ? Math.max(4, Math.round((monto / maximo) * 100)) : 0;
}
