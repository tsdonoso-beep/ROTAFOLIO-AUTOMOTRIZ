/**
 * Copiar las fuentes de Compras, COMEX y Almacén a una hoja privada
 * --------------------------------------------------------------------------
 *
 * Va en una hoja de TU unidad (no compartida con el equipo): copia, con tus
 * permisos, solo las columnas que usa Contabilidad de:
 *   · la base de datos nacionales de Compras (BD-2026);
 *   · el STATUS DE CARGAS de COMEX (STATUS, BASE DE DATOS IMPORTACIONES y
 *     DUAS-SUNAT, con sus dos tablas una debajo de la otra);
 *   · el kardex de Almacén (solo ingresos por compra, devoluciones y
 *     anulados: lo que se cruza con la OC; las salidas no).
 * Deja los VALORES (no fórmulas, no IMPORTRANGE) en pestañas propias, y en
 * COPIA - ESTADO cuándo se copió cada una, cuántas filas y si faltó alguna
 * columna. Quedan fuera contactos, teléfonos, correos, direcciones y bancos.
 *
 * Corre sola dos veces al día, un poco ANTES de que el robot de las carpetas
 * lea (01:17 y 11:47): a las 00:45 y a las 11:15. Si una fuente falla, su
 * pestaña se queda con la copia anterior y el error queda en COPIA - ESTADO.
 *
 * ── Instalación ──
 * 1. En tu hoja privada → Extensiones → Apps Script → pega esto en un archivo
 *    «CopiarFuentes» → guarda.
 * 2. Elige «instalarCopiaFuentes» → Ejecutar → acepta los permisos (leer las
 *    tres hojas de origen y escribir en esta). Copia todo en ese momento y la
 *    deja programada.
 * 3. Comparte ESTA hoja como Lector solo con la cuenta del robot
 *    (repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com).
 * Si ya tenías pestañas con IMPORTRANGE, puedes borrarlas: el robot lee las
 * pestañas que crea este script.
 */

var CF_HORAS = [[0, 45], [11, 15]];   // [hora, minuto]: antes de cada lectura del robot (01:17 y 11:47)
var CF_ESTADO = 'COPIA - ESTADO';

var CF_FUENTES = [
  {
    destino: 'NACIONALES', id: '13KLLpcFPGlC11ilTIw8thDio9XdV-TnQ1jlZSosVE7M', hoja: 'BD-2026',
    clave: ['N° OC/OS', 'RAZON SOCIAL'],
    columnas: ['FECHA', 'EMPRESA', 'TIPO DE DOCUMENTO', 'N° OC/OS', 'N° REQUERIMIENTO', 'RUC', 'RAZON SOCIAL', 'PROYECTO',
      'ITEM', 'CONCEPTO', 'CODIGO PROYECTO', 'CODIGO PCP', 'NOMBRE DEL PRODUCTO SEGUN', 'UNIDAD DE MEDIDA', 'CANTIDAD',
      'COSTO UNITARIO', 'COSTO TOTAL', 'MONEDA', 'TC', 'COSTO TOTAL (SOLES)', 'FORMA DE PAGO', 'DIAS O PORCENTAJE',
      'LUGAR DE ENTREGA', 'TIEMPO DE ENTREGA', 'SOLICITADO', 'ELABORADO'],
    texto: ['N° OC/OS', 'N° REQUERIMIENTO', 'RUC', 'CODIGO PCP', 'CODIGO PROYECTO'],
    conDato: 'N° OC/OS'
  },
  {
    destino: 'IMPO - STATUS', id: '1gta43_ozxXfexSDjJ9LDwaxWgtGwjRUNCLWZaHIp6_Y', hoja: 'STATUS',
    clave: ['NRO OC', 'ESTADO DE COMPRA'],
    columnas: ['EMPRESA', 'PROYECTO', 'REQ COMPRA', 'NRO OC', 'COMPRADOR', 'ESTADO DE COMPRA', 'FECHA OC', 'DESCRIPCION PRODUCTO',
      'PROVEEDOR', 'ORIGEN', 'INCOTERM', 'MODALIDAD DE ENVIO', 'TIPO DE CARGA', 'OPERADOR LOGISTICO', 'AWB O BL', 'ETD', 'ATD',
      'ETA', 'ATA', 'FECHA APROX EN PLANTA', 'FECHA REAL EN PLANTA', 'DOCUMENTOS ENVIADOS', 'AGENTE ADUANAS', 'DAM',
      'OBSERVACIONES', 'COSTEO'],
    texto: ['NRO OC', 'REQ COMPRA', 'DAM', 'AWB O BL'],
    conDato: 'NRO OC'
  },
  {
    destino: 'IMPO - BASE', id: '1gta43_ozxXfexSDjJ9LDwaxWgtGwjRUNCLWZaHIp6_Y', hoja: 'BASE DE DATOS IMPORTACIONES',
    clave: ['N° OC/OS', 'ELABORADO POR'],
    columnas: ['FECHA', 'EMPRESA', 'TIPO DE DOCUMENTO', 'N° OC/OS', 'N° REQUERIMIENTO', 'RAZON SOCIAL - SUPPLIER', 'PAIS - COUNTRY',
      'PROYECTO', 'CONCEPTO', 'CODIGO PROYECTO', 'INCOTERM', 'NOMBRE DEL PRODUCTO SEGUN', 'UNIDAD DE MEDIDA', 'CANTIDAD',
      'COSTO UNITARIO', 'COSTO TOTAL', 'MONEDA', 'COSTO TOTAL (DOLARES)', 'TC (DOLARES A SOLES)', 'COSTO TOTAL (SOLES)',
      'PORCENTAJE', 'FORMA DE PAGO', 'SOLICITADO', 'ELABORADO POR'],
    texto: ['N° OC/OS', 'N° REQUERIMIENTO', 'CODIGO PROYECTO'],
    conDato: 'N° OC/OS'
  },
  {
    // Dos tablas lado a lado (2025 y 2026) con las mismas columnas: se copian una debajo de la otra.
    destino: 'IMPO - DUAS', id: '1gta43_ozxXfexSDjJ9LDwaxWgtGwjRUNCLWZaHIp6_Y', hoja: 'DUAS-SUNAT',
    clave: ['N° OC', 'DUA'], bloques: true,
    columnas: ['N° OC', 'DUA', 'FECHA AFECTACION', 'ENCARGADO', '¿SUBIO OC?', 'FECHA DE SUBIDA', 'OBSERVACION'],
    texto: ['N° OC', 'DUA'],
    conDato: 'DUA'
  },
  {
    // El kardex ORIGINAL de Almacén (no una copia con IMPORTRANGE): si cambia, basta con poner aquí su id.
    destino: 'KARDEX', id: '1vDEQKVvAW5SB9MeLAr0UwAy4AuIL4UspTlkvX-O0nfU', hoja: 'KARDEX',
    clave: ['VALE DE ALMACEN', 'NUMERO ORDEN'],
    columnas: ['VALE DE ALMACEN', 'FECHA REGISTRO', 'FECHA OPERACION', 'TIPO DE MOVIMIENTO', 'TIPO DE OPERACION', 'TIPO DOCUMENTO',
      'NUMERO DOCUMENTO', 'TIPO DE ORDEN', 'NUMERO ORDEN', 'PROYECTO', 'SEDE', 'RESPONSABLE DE REGISTRO', 'RECEPCIONADO POR',
      'CODIGO SIDIGE', 'DESCRIPCION DE SKU', 'UNDIDAD DE MEDIDA', 'OBSERVACIONES', 'INGRESO', 'SALIDA'],
    texto: ['VALE DE ALMACEN', 'NUMERO DOCUMENTO', 'NUMERO ORDEN', 'CODIGO SIDIGE'],
    // Solo lo que se cruza con una OC: ingresos por compra o servicio, devoluciones y anulados.
    filtro: function (v) {
      var mov = normalizar_(v('TIPO DE MOVIMIENTO')), op = normalizar_(v('TIPO DE OPERACION'));
      if (mov === 'ANULADO') return true;
      if (mov !== 'INGRESO') return false;
      return /COMPRA|DEVOLUCION|ORDEN DE SERVICIO/.test(op) || /\d{3,4}\s*-\s*20\d\d/.test(String(v('NUMERO ORDEN')));
    }
  }
];

// ── Instalación ──

function instalarCopiaFuentes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'copiarFuentes') ScriptApp.deleteTrigger(t);
  });
  CF_HORAS.forEach(function (h) {
    ScriptApp.newTrigger('copiarFuentes').timeBased().everyDays(1).atHour(h[0]).nearMinute(h[1]).create();
  });
  var r = copiarFuentes();
  var texto = r + '\n\nQueda programado todos los días a las 00:45 y 11:15.';
  try { SpreadsheetApp.getUi().alert('Copia de fuentes', texto, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { Logger.log(texto); }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fuentes')
    .addItem('Copiar ahora', 'copiarFuentesDesdeMenu')
    .addItem('Programar copia (00:45 y 11:15)', 'instalarCopiaFuentes')
    .addToUi();
}

function copiarFuentesDesdeMenu() {
  SpreadsheetApp.getUi().alert('Copia de fuentes', copiarFuentes(), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ── La copia ──

/** Copia cada fuente a su pestaña. Una que falla no detiene a las demás. */
function copiarFuentes() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var abiertos = {}, estado = [], resumen = [];
  CF_FUENTES.forEach(function (f) {
    var inicio = new Date();
    try {
      var origen = abiertos[f.id] || (abiertos[f.id] = SpreadsheetApp.openById(f.id));
      var r = leerFuente_(origen, f);
      escribirPestana_(libro, f, r.filas);
      estado.push([f.destino, origen.getName() + ' › ' + r.hoja, r.filas.length, r.faltan.join(', '), inicio, new Date(), 'OK']);
      resumen.push(f.destino + ': ' + r.filas.length + ' filas' + (r.faltan.length ? ' (sin: ' + r.faltan.join(', ') + ')' : ''));
    } catch (e) {
      estado.push([f.destino, f.hoja, '', '', inicio, new Date(), 'ERROR: ' + String(e.message || e).slice(0, 300)]);
      resumen.push(f.destino + ': ERROR — ' + String(e.message || e).slice(0, 120) + ' (se dejó la copia anterior)');
    }
  });
  var h = libro.getSheetByName(CF_ESTADO) || libro.insertSheet(CF_ESTADO);
  h.clear();
  h.getRange(1, 1, 1, 7).setValues([['Pestaña', 'Origen', 'Filas copiadas', 'Columnas que no se encontraron', 'Inicio', 'Fin', 'Resultado']])
    .setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff');
  h.getRange(2, 1, estado.length, 7).setValues(estado);
  h.getRange(2, 5, estado.length, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  h.setFrozenRows(1);
  return resumen.join('\n');
}

/** Lee una fuente: busca su fila de encabezados y se queda con las columnas pedidas (o sus bloques). */
function leerFuente_(origen, f) {
  var hoja = origen.getSheetByName(f.hoja) || buscarHoja_(origen, f.hoja, f.clave);
  if (!hoja) throw new Error('No hay una pestaña «' + f.hoja + '» ni otra con las columnas ' + f.clave.join(' / ') + '.');
  var valores = hoja.getDataRange().getValues();
  var fc = filaDeEncabezados_(valores, f.clave);
  if (fc < 0) throw new Error('No encontré los encabezados ' + f.clave.join(' / ') + ' en «' + hoja.getName() + '».');
  var cab = valores[fc].map(normalizar_);
  // Cada bloque empieza donde aparece la primera columna clave (DUAS-SUNAT tiene dos).
  var inicios = [];
  cab.forEach(function (c, j) { if (c === normalizar_(f.clave[0])) inicios.push(j); });
  if (!f.bloques) inicios = [inicios[0]];
  var faltan = {};
  var filas = [f.columnas];
  inicios.forEach(function (ini, b) {
    var fin = b + 1 < inicios.length ? inicios[b + 1] : cab.length;
    var idx = f.columnas.map(function (nombre) {
      var j = buscarColumna_(cab, nombre, f.bloques ? ini : 0, f.bloques ? fin : cab.length);
      if (j < 0) faltan[nombre] = true;
      return j;
    });
    var iDato = f.conDato ? idx[f.columnas.indexOf(f.conDato)] : -1;
    for (var r = fc + 1; r < valores.length; r++) {
      var fila = valores[r];
      if (iDato >= 0 && String(fila[iDato] == null ? '' : fila[iDato]).trim() === '') continue;
      var v = function (nombre) { var j = idx[f.columnas.indexOf(nombre)]; return j >= 0 ? fila[j] : ''; };
      if (f.filtro && !f.filtro(v)) continue;
      filas.push(idx.map(function (j) { return j >= 0 ? fila[j] : ''; }));
    }
  });
  return { hoja: hoja.getName(), filas: filas, faltan: Object.keys(faltan) };
}

function escribirPestana_(libro, f, filas) {
  var h = libro.getSheetByName(f.destino) || libro.insertSheet(f.destino);
  h.clear();
  if (h.getMaxRows() < filas.length) h.insertRowsAfter(h.getMaxRows(), filas.length - h.getMaxRows());
  if (h.getMaxColumns() < f.columnas.length) h.insertColumnsAfter(h.getMaxColumns(), f.columnas.length - h.getMaxColumns());
  // Las columnas de códigos como texto, para que «0004-2026» o «T005-01027092» no se vuelvan fecha o número.
  (f.texto || []).forEach(function (nombre) {
    var j = f.columnas.indexOf(nombre);
    if (j >= 0) h.getRange(1, j + 1, filas.length, 1).setNumberFormat('@');
  });
  var datos = filas.map(function (fila) {
    return fila.map(function (x, j) { return (f.texto || []).indexOf(f.columnas[j]) >= 0 && x !== '' && x != null ? String(x) : x; });
  });
  h.getRange(1, 1, datos.length, f.columnas.length).setValues(datos);
  h.getRange(1, 1, 1, f.columnas.length).setFontWeight('bold');
  h.setFrozenRows(1);
}

// ── Apoyo ──

/** «N° OC/OS», «Nº OC/OS » y «n° oc/os» son la misma columna: mayúsculas, sin tildes ni espacios de más. */
function normalizar_(t) {
  return String(t == null ? '' : t).toUpperCase().replace(/[ÁÀ]/g, 'A').replace(/[ÉÈ]/g, 'E').replace(/[ÍÌ]/g, 'I')
    .replace(/[ÓÒ]/g, 'O').replace(/[ÚÙÜ]/g, 'U').replace(/Nº/g, 'N°').replace(/\s+/g, ' ').trim();
}

/** La columna por su nombre: igual, o que empiece igual (los encabezados largos a veces cambian el final). */
function buscarColumna_(cab, nombre, desde, hasta) {
  var n = normalizar_(nombre);
  for (var j = desde; j < hasta; j++) if (cab[j] === n) return j;
  for (var k = desde; k < hasta; k++) if (cab[k] && (cab[k].indexOf(n) === 0 || n.indexOf(cab[k]) === 0) && cab[k].length >= 3) return k;
  return -1;
}

/** La fila de encabezados: la primera (de las 15 primeras) que tiene las columnas clave; -1 si ninguna. */
function filaDeEncabezados_(valores, clave) {
  for (var i = 0; i < Math.min(15, valores.length); i++) {
    var cab = valores[i].map(normalizar_);
    if (clave.every(function (c) { return cab.indexOf(normalizar_(c)) >= 0; })) return i;
  }
  return -1;
}

/** La pestaña por su nombre (sin importar mayúsculas ni espacios) o, si se llama distinto, la que tiene las columnas clave. */
function buscarHoja_(libro, nombre, clave) {
  var n = normalizar_(nombre);
  var hojas = libro.getSheets();
  for (var i = 0; i < hojas.length; i++) if (normalizar_(hojas[i].getName()) === n) return hojas[i];
  for (var k = 0; k < hojas.length; k++) {
    var filas = Math.min(15, hojas[k].getLastRow()), cols = hojas[k].getLastColumn();
    if (filas > 0 && cols > 0 && filaDeEncabezados_(hojas[k].getRange(1, 1, filas, cols).getValues(), clave) >= 0) return hojas[k];
  }
  return null;
}
