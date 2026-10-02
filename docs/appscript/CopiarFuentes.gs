/**
 * Copiar las fuentes de Compras, COMEX y Almacén a una hoja privada
 * --------------------------------------------------------------------------
 *
 * Va en una hoja de TU unidad (no compartida con el equipo): copia, con tus
 * permisos, solo las columnas que usa Contabilidad de:
 *   · la base de datos nacionales de Compras (BD-2026);
 *   · el STATUS DE CARGAS de COMEX (STATUS, BASE DE DATOS IMPORTACIONES y
 *     DUAS-SUNAT, con sus dos tablas una debajo de la otra);
 *   · el kardex de Almacén, de su base original (BASE DE DATOS INROPRIN):
 *     KARDEX (una fila por producto) y KARDEX - VALES (una por vale, con el
 *     enlace a la guía o factura que Almacén escaneó al recibir). Solo
 *     ingresos por compra, servicio o devolución y anulados: lo que se cruza
 *     con la OC; las salidas no.
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
 *    hojas de origen, escribir en esta y ver tus archivos de Drive para hallar
 *    los PDF escaneados de Almacén; no cambia ni comparte nada en Drive). Copia todo en ese momento y la
 *    deja programada.
 * 3. Comparte ESTA hoja como Lector solo con la cuenta del robot
 *    (repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com).
 * Si ya tenías pestañas con IMPORTRANGE, puedes borrarlas: el robot lee las
 * pestañas que crea este script.
 */

var CF_HORAS = [[0, 45], [11, 15]];   // [hora, minuto]: antes de cada lectura del robot (01:17 y 11:47)
var CF_ESTADO = 'COPIA - ESTADO';
var CF_KARDEX = '1Itr_Y3ZYXDr61m6bFTYzKEYjEY9Qnyi6ah2N_0jiMtA';   // BASE DE DATOS INROPRIN (Almacén)
var CF_SEGUNDOS_ENLACES = 150;   // tope para buscar en Drive los archivos escaneados en cada corrida

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
    // El kardex ORIGINAL de Almacén (la base de su app, no una copia con IMPORTRANGE): si cambia, basta con poner aquí su id.
    // Una fila por producto de cada vale.
    destino: 'KARDEX', id: CF_KARDEX, hoja: 'KARDEX',
    clave: ['VALE DE ALMACEN', 'NUMERO ORDEN'],
    columnas: ['ID', 'ID DOCUMENTO', 'VALE DE ALMACEN', 'FECHA REGISTRO', 'FECHA OPERACION', 'TIPO DE MOVIMIENTO', 'TIPO DE OPERACION',
      'TIPO ANEXO', 'DESCRIPCION', 'TIPO DOCUMENTO', 'NUMERO DOCUMENTO', 'TIPO DE ORDEN', 'NUMERO ORDEN', 'PROYECTO', 'SEDE',
      'RESPONSABLE DE REGISTRO', 'RECEPCIONADO POR', 'CODIGO SIDIGE', 'DESCRIPCION DE SKU', 'UNDIDAD DE MEDIDA', 'CATEGORIA',
      'OBSERVACIONES', 'INGRESO', 'SALIDA'],
    texto: ['ID', 'ID DOCUMENTO', 'VALE DE ALMACEN', 'NUMERO DOCUMENTO', 'NUMERO ORDEN', 'CODIGO SIDIGE'],
    conDato: 'VALE DE ALMACEN',
    filtro: function (v) { return entraDelKardex_(v); }
  },
  {
    // La cabecera de cada vale (una fila por vale) con el documento que Almacén escaneó al recibir:
    // la guía del proveedor o, a veces, la factura. DOCUMENTO y DOC VALE son rutas de la app de Almacén;
    // el script busca esos archivos en Drive y deja su enlace.
    destino: 'KARDEX - VALES', id: CF_KARDEX, hoja: 'DOCUMENTO',
    clave: ['VALE DE ALMACEN', 'DOC VALE'],
    columnas: ['ID', 'VALE DE ALMACEN', 'FECHA REGISTRO', 'FECHA OPERACION', 'TIPO DE MOVIMIENTO', 'TIPO DE OPERACION', 'TIPO ANEXO',
      'DESCRIPCION', 'TIPO DOCUMENTO', 'NUMERO DOCUMENTO', 'TIPO DE ORDEN', 'NUMERO ORDEN', 'PROYECTO', 'SEDE',
      'RESPONSABLE DE REGISTRO', 'RECEPCIONADO POR', 'DOCUMENTO', 'DOC VALE', 'N_PDF'],
    texto: ['ID', 'VALE DE ALMACEN', 'NUMERO DOCUMENTO', 'NUMERO ORDEN'],
    conDato: 'VALE DE ALMACEN',
    filtro: function (v) { return entraDelKardex_(v); },
    enlaces: [['DOCUMENTO', 'ENLACE DOCUMENTO'], ['DOC VALE', 'ENLACE VALE']]
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
      if (f.enlaces) r.nota = agregarEnlaces_(libro, f, r.filas);
      escribirPestana_(libro, f, r.filas);
      estado.push([f.destino, origen.getName() + ' › ' + r.hoja, r.filas.length - 1, r.faltan.join(', '), inicio, new Date(), 'OK' + (r.nota ? ' · ' + r.nota : '')]);
      resumen.push(f.destino + ': ' + (r.filas.length - 1) + ' filas' + (r.faltan.length ? ' (sin: ' + r.faltan.join(', ') + ')' : '') + (r.nota ? ' · ' + r.nota : ''));
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
  var ancho = filas[0].length;
  if (h.getMaxColumns() < ancho) h.insertColumnsAfter(h.getMaxColumns(), ancho - h.getMaxColumns());
  // Las columnas de códigos como texto, para que «0004-2026» o «T005-01027092» no se vuelvan fecha o número.
  (f.texto || []).forEach(function (nombre) {
    var j = f.columnas.indexOf(nombre);
    if (j >= 0) h.getRange(1, j + 1, filas.length, 1).setNumberFormat('@');
  });
  var datos = filas.map(function (fila) {
    return fila.map(function (x, j) { return (f.texto || []).indexOf(f.columnas[j]) >= 0 && x !== '' && x != null ? String(x) : x; });
  });
  h.getRange(1, 1, datos.length, ancho).setValues(datos);
  h.getRange(1, 1, 1, ancho).setFontWeight('bold');
  h.setFrozenRows(1);
}

// ── Kardex ──

/**
 * Del kardex solo entra lo que se cruza con una OC: los ingresos por compra (nacional o importada), por orden de
 * servicio o devolución, o cualquier ingreso con número de OC; y los anulados, para ver correcciones. Las salidas
 * (despachos a proyectos, ventas, producción) no: esa guía la emite Almacén, no es la del proveedor.
 */
function entraDelKardex_(v) {
  var mov = normalizar_(v('TIPO DE MOVIMIENTO')), op = normalizar_(v('TIPO DE OPERACION'));
  if (mov === 'ANULADO') return true;
  if (mov !== 'INGRESO') return false;
  return /COMPRA|DEVOLUCION|ORDEN DE SERVICIO/.test(op) || /\d{3,4}\s*-\s*20\d\d/.test(String(v('NUMERO ORDEN')));
}

/**
 * Agrega a cada fila el enlace de Drive de los archivos que guarda la app de Almacén («DOCUMENTO_Files_/xx.pdf»,
 * «/Files/Orders/Vale_….pdf»). Reusa los enlaces que ya están en la pestaña y solo busca los nuevos, con un tope
 * de tiempo: lo que no alcance se completa en la siguiente corrida. Devuelve una nota para COPIA - ESTADO.
 */
function agregarEnlaces_(libro, f, filas) {
  var cab = filas[0], previos = {};
  var h = libro.getSheetByName(f.destino);
  if (h && h.getLastRow() > 1) {
    var v = h.getDataRange().getValues(), c = v[0];
    f.enlaces.forEach(function (e) {
      var i = c.indexOf(e[0]), j = c.indexOf(e[1]);
      if (i < 0 || j < 0) return;
      for (var r = 1; r < v.length; r++) if (v[r][i] && v[r][j]) previos[String(v[r][i])] = v[r][j];
    });
  }
  // Los archivos que faltan, por carpeta: la carpeta es la parte de la ruta antes del nombre.
  var faltan = {}, nFaltan = 0;
  f.enlaces.forEach(function (e) {
    var i = cab.indexOf(e[0]);
    for (var r = 1; r < filas.length; r++) {
      var ruta = String(filas[r][i] || '').trim();
      if (!ruta || previos[ruta]) continue;
      var partes = ruta.split('/').filter(String);
      if (partes.length < 2) continue;
      var carpeta = partes[partes.length - 2], nombre = partes[partes.length - 1];
      (faltan[carpeta] = faltan[carpeta] || {})[nombre] = ruta;
      nFaltan++;
    }
  });
  var hallados = 0, inicio = Date.now(), corto = false;
  Object.keys(faltan).forEach(function (carpeta) {
    var carpetas = DriveApp.getFoldersByName(carpeta);
    while (carpetas.hasNext() && !corto) {
      var archivos = carpetas.next().getFiles();
      while (archivos.hasNext()) {
        if (Date.now() - inicio > CF_SEGUNDOS_ENLACES * 1000) { corto = true; break; }
        var a = archivos.next(), ruta = faltan[carpeta][a.getName()];
        if (ruta && !previos[ruta]) { previos[ruta] = a.getUrl(); hallados++; }
      }
    }
  });
  f.enlaces.forEach(function (e) {
    var i = cab.indexOf(e[0]);
    cab.push(e[1]);
    for (var r = 1; r < filas.length; r++) filas[r].push(previos[String(filas[r][i] || '').trim()] || '');
  });
  var sinEnlace = nFaltan - hallados;
  if (!nFaltan) return '';
  return hallados + ' enlaces nuevos' + (sinEnlace ? ', ' + sinEnlace + ' archivos sin hallar en tu Drive' + (corto ? ' (se sigue en la próxima copia)' : '') : '');
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
