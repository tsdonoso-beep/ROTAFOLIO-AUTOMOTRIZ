/**
 * Condición del RUC — Buen Contribuyente / Agente de Retención / Percepción
 * --------------------------------------------------------------------------
 *
 * El registro de compras no dice si a un proveedor le corresponde o no la
 * retención del IGV: eso depende de si el proveedor está en el Padrón de
 * Buenos Contribuyentes o en el de Agentes de Retención/Percepción de SUNAT,
 * algo que hoy Contabilidad revisa a mano, RUC por RUC, en
 * e-consultaruc.sunat.gob.pe — todos los días, para cada factura nueva.
 *
 * Esto automatiza esa consulta. A diferencia del portal SOL (que exige Clave
 * SOL y es frágil), la Consulta RUC pública no pide login: es un formulario
 * en dos pasos —
 *
 *   1. GET  a FrameCriterioBusquedaWeb.jsp, que trae un campo oculto «token»
 *      (no lo calcula el navegador con JavaScript: ya viene en el HTML).
 *   2. POST a jcrS00Alias con ese token, las cookies de sesión y el RUC.
 *
 * — así que UrlFetchApp alcanza sin necesidad de un navegador. Si algún día
 * SUNAT le agrega a esa página un captcha o un token que sí se calcule en el
 * cliente, esto se rompe; el respaldo sería llevar la misma consulta al
 * scraper de Playwright (`scripts/descargar-cpe.mts`) en vez de aquí.
 *
 * Guarda el resultado en una pestaña PADRÓN RUC de esta misma hoja —no la de
 * datos, que se reescribe cada mañana—, una fila por proveedor, y solo
 * vuelve a consultar los que llevan más de `DIAS_VIGENCIA_PADRON` sin
 * revisarse. Así el número de consultas queda atado a cuántos proveedores
 * distintos hay, no a cuántas facturas.
 *
 * IMPORTANTE: esto solo dice la condición del proveedor. Si corresponde
 * retenerle o no depende además de si INROPRIN está designada Agente de
 * Retención, de si la operación supera S/ 700, y de si no está sujeta a
 * detracción — ese cálculo no lo hace este archivo.
 *
 * Depende de que `Codigo.gs` ya esté instalado en el mismo proyecto: usa
 * `PESTANA_DATOS` y `COL.ruc` para saber de dónde sacar la lista de RUC.
 */

// ── Configuración ──────────────────────────────────────────────────

/** La pestaña donde se guarda la condición de cada RUC. No es la de datos. */
var PESTANA_PADRON = 'PADRÓN RUC';

var CABECERAS_PADRON = [
  'RUC', 'Razón social', 'Estado', 'Condición',
  'Buen Contribuyente', 'Agente de Retención', 'Agente de Percepción',
  'Padrones (detalle)', 'Consultado el'
];

/** Cuántos días se confía en una consulta antes de repetirla. Los padrones no cambian seguido. */
var DIAS_VIGENCIA_PADRON = 30;

/** Tope de consultas por corrida, para no acercarse al límite de tiempo de un disparador. */
var MAX_CONSULTAS_POR_CORRIDA = 40;

/** Pausa entre RUC, para no golpear SUNAT en ráfaga. */
var PAUSA_ENTRE_CONSULTAS_MS = 600;

// ── Menú (se engancha desde onOpen de Codigo.gs) ──────────────────

/** Los ítems de este archivo. Codigo.gs lo llama desde su onOpen. */
function itemsMenuPadron_(menu) {
  return menu
    .addSeparator()
    .addItem('Consultar un RUC ahora (Buen Contribuyente / Retención)', 'consultarUnRucAhora')
    .addItem('Actualizar condición de todos los proveedores', 'actualizarPadronRuc')
    .addItem('Activar actualización automática diaria', 'instalarPadronAutomatico')
    .addItem('Desactivar actualización automática', 'quitarPadronAutomatico');
}

// ── Orquestación ──────────────────────────────────────────────────

/**
 * Consulta un RUC suelto, a pedido, y lo muestra en un cuadro de diálogo.
 * Sirve para probar la consulta y para resolver un caso puntual sin esperar
 * a la corrida automática.
 */
function consultarUnRucAhora() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Consultar RUC', 'RUC a consultar (11 dígitos):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var ruc = resp.getResponseText().trim();
  if (!/^\d{11}$/.test(ruc)) { ui.alert('Eso no es un RUC: deben ser 11 dígitos.'); return; }

  try {
    var r = consultarRuc_(ruc);
    var hoja = hojaPadron_();
    escribirPadron_(hoja, padronGuardado_(), ruc, r);
    ui.alert(
      ruc + (r.razonSocial ? (' — ' + r.razonSocial) : '') + '\n\n' +
      'Estado: ' + (r.estado || '—') + '\n' +
      'Condición: ' + (r.condicion || '—') + '\n' +
      'Buen Contribuyente: ' + (r.buenContribuyente ? 'Sí' : 'No') + '\n' +
      'Agente de Retención: ' + (r.agenteRetencion ? 'Sí' : 'No') + '\n' +
      'Agente de Percepción: ' + (r.agentePercepcion ? 'Sí' : 'No') +
      (r.padronesTexto ? ('\n\nDetalle del padrón:\n' + r.padronesTexto) : '')
    );
  } catch (e) {
    ui.alert('No se pudo consultar el RUC ' + ruc + ':\n\n' + e.message);
  }
}

/**
 * Recorre los proveedores de la hoja de datos y actualiza en PADRÓN RUC los
 * que no se han consultado o llevan más de `DIAS_VIGENCIA_PADRON` vencidos.
 *
 * Se puede llamar del menú o de un disparador de tiempo. Si quedan más
 * pendientes que `MAX_CONSULTAS_POR_CORRIDA`, el resto espera a la próxima
 * corrida — con el disparador diario activado, un backlog grande se pone al
 * día solo en unos días, sin arriesgar el límite de tiempo de ejecución.
 */
function actualizarPadronRuc() {
  comprobarDependencias_();

  var rucs = rucsAConsultar_();
  var guardado = padronGuardado_();
  var pendientes = rucs.filter(function (r) { return necesitaConsulta_(guardado[r]); });
  var enEstaCorrida = pendientes.slice(0, MAX_CONSULTAS_POR_CORRIDA);

  var hoja = hojaPadron_();
  var ok = 0;
  var fallidos = [];

  for (var i = 0; i < enEstaCorrida.length; i++) {
    var ruc = enEstaCorrida[i];
    try {
      var r = consultarRuc_(ruc);
      escribirPadron_(hoja, guardado, ruc, r);
      ok++;
    } catch (e) {
      fallidos.push(ruc + ' (' + e.message + ')');
    }
    if (i < enEstaCorrida.length - 1) Utilities.sleep(PAUSA_ENTRE_CONSULTAS_MS);
  }

  var msg = enEstaCorrida.length === 0
    ? ('Ningún proveedor necesitaba actualizarse (todos consultados hace menos de '
       + DIAS_VIGENCIA_PADRON + ' días).')
    : ('Consultados ' + ok + ' de ' + enEstaCorrida.length + ' proveedores.'
       + (pendientes.length > enEstaCorrida.length
           ? (' Quedan ' + (pendientes.length - enEstaCorrida.length) + ' para la próxima corrida.')
           : '')
       + (fallidos.length ? ('\n\nNo se pudieron consultar:\n' + fallidos.join('\n')) : ''));

  // Desde un disparador no hay interfaz; solo el menú muestra el aviso.
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function comprobarDependencias_() {
  if (typeof PESTANA_DATOS === 'undefined' || typeof COL === 'undefined') {
    throw new Error(
      'Falta Codigo.gs en este proyecto: PadronRuc.gs necesita PESTANA_DATOS y COL.ruc, ' +
      'que se declaran ahí.'
    );
  }
}

// ── La lista de RUC a vigilar ──────────────────────────────────────

/** Los RUC de proveedor distintos que hay hoy en la pestaña de datos, sin repetir. */
function rucsAConsultar_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(PESTANA_DATOS);
  if (!hoja) {
    throw new Error(
      'No se encontró la pestaña "' + PESTANA_DATOS + '". ' +
      'Este script va en la misma hoja que publica la aplicación.'
    );
  }

  var datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];

  var titulos = datos[0].map(function (t) { return String(t).trim(); });
  var col = titulos.indexOf(COL.ruc);
  if (col === -1) {
    throw new Error('La pestaña "' + PESTANA_DATOS + '" no trae la columna "' + COL.ruc + '".');
  }

  var vistos = {};
  var rucs = [];
  for (var i = 1; i < datos.length; i++) {
    var ruc = String(datos[i][col] || '').trim();
    if (ruc && !vistos[ruc]) { vistos[ruc] = true; rucs.push(ruc); }
  }
  return rucs;
}

// ── La pestaña PADRÓN RUC ──────────────────────────────────────────

function hojaPadron_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(PESTANA_PADRON);
  if (!hoja) {
    hoja = libro.insertSheet(PESTANA_PADRON);
    hoja.appendRow(CABECERAS_PADRON);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/** RUC → { fila, consultadoEl }, tal como está guardado ahora mismo. */
function padronGuardado_() {
  var hoja = hojaPadron_();
  var ultima = hoja.getLastRow();
  var mapa = {};
  if (ultima > 1) {
    var datos = hoja.getRange(2, 1, ultima - 1, CABECERAS_PADRON.length).getValues();
    for (var i = 0; i < datos.length; i++) {
      mapa[String(datos[i][0])] = { fila: i + 2, consultadoEl: datos[i][8] };
    }
  }
  return mapa;
}

function necesitaConsulta_(info) {
  if (!info || !info.consultadoEl) return true;
  if (Object.prototype.toString.call(info.consultadoEl) !== '[object Date]') return true;
  var ms = Date.now() - info.consultadoEl.getTime();
  return ms > DIAS_VIGENCIA_PADRON * 24 * 60 * 60 * 1000;
}

/** Escribe (o actualiza) la fila de un RUC. `guardado` se actualiza en el sitio. */
function escribirPadron_(hoja, guardado, ruc, r) {
  var fila = [
    ruc, r.razonSocial || '', r.estado || '', r.condicion || '',
    r.buenContribuyente ? 'Sí' : 'No',
    r.agenteRetencion ? 'Sí' : 'No',
    r.agentePercepcion ? 'Sí' : 'No',
    r.padronesTexto || '', new Date()
  ];

  var info = guardado[ruc];
  if (info) {
    hoja.getRange(info.fila, 1, 1, CABECERAS_PADRON.length).setValues([fila]);
  } else {
    hoja.appendRow(fila);
    guardado[ruc] = { fila: hoja.getLastRow() };
  }
}

// ── El disparador automático ────────────────────────────────────────

function instalarPadronAutomatico() {
  quitarPadronAutomatico();
  ScriptApp.newTrigger('actualizarPadronRuc').timeBased().atHour(7).everyDays(1).create();
  SpreadsheetApp.getUi().alert(
    'Listo. Todos los días a las 7 de la mañana actualiza la condición de los proveedores ' +
    'vencidos (hasta ' + MAX_CONSULTAS_POR_CORRIDA + ' por corrida).'
  );
}

function quitarPadronAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizarPadronRuc') ScriptApp.deleteTrigger(t);
  });
}

// ══════════════════════════════════════════════════════════════════
// La consulta a SUNAT — sin navegador, en dos pasos.
// ══════════════════════════════════════════════════════════════════

var URL_FORMULARIO_RUC_ = 'https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp';
var URL_CONSULTA_RUC_   = 'https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias';

/**
 * Cabeceras de un navegador real. Sin esto, algunos WAF (como el de SUNAT)
 * tratan distinto una petición que llega sin pinta de navegador, y devuelven
 * una página distinta a la que ve una persona — ya pasó lo mismo con el
 * portal SOL en `scripts/descargar-cpe.mts`.
 */
var CABECERAS_NAVEGADOR_ = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-PE,es;q=0.9'
};

/** Trae el formulario, saca el token oculto y las cookies, y consulta el RUC. */
function consultarRuc_(ruc) {
  var form = UrlFetchApp.fetch(URL_FORMULARIO_RUC_, {
    headers: CABECERAS_NAVEGADOR_,
    muteHttpExceptions: true
  });
  if (form.getResponseCode() !== 200) {
    throw new Error('SUNAT no respondió al abrir el formulario (código ' + form.getResponseCode() + ').');
  }

  var cookies = cookiesDe_(form);
  var html = form.getContentText();
  var token = tokenDelFormulario_(html);
  if (!token) {
    throw new Error(
      'No se encontró el campo "token" en el formulario de SUNAT (código ' + form.getResponseCode() + ').\n' +
      'Esto es lo que llegó, para comparar con lo que muestra el navegador:\n\n' +
      html.substring(0, 600)
    );
  }

  var cabecerasPost = { Cookie: cookies };
  for (var h in CABECERAS_NAVEGADOR_) cabecerasPost[h] = CABECERAS_NAVEGADOR_[h];

  var resp = UrlFetchApp.fetch(URL_CONSULTA_RUC_, {
    method: 'post',
    headers: cabecerasPost,
    payload: {
      accion: 'consPorRuc', razSoc: '', nroRuc: ruc, nrodoc: '',
      token: token, contexto: 'ti-it', modo: '1', rbtnTipo: '1',
      search1: ruc, tipdoc: '1', search2: '', search3: '', codigo: ''
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('SUNAT no respondió a la consulta (código ' + resp.getResponseCode() + ').');
  }

  return leerResultadoRuc_(resp.getContentText(), ruc);
}

/** Las cookies que fijó la respuesta, listas para reenviar en la siguiente petición. */
function cookiesDe_(resp) {
  var headers = resp.getAllHeaders();
  var crudas = headers['Set-Cookie'] || headers['set-cookie'] || [];
  if (Object.prototype.toString.call(crudas) !== '[object Array]') crudas = [crudas];

  var partes = [];
  for (var i = 0; i < crudas.length; i++) {
    if (!crudas[i]) continue;
    partes.push(String(crudas[i]).split(';')[0]);
  }
  return partes.join('; ');
}

/** El valor del input oculto `token`. No lo calcula el navegador: ya viene en el HTML. */
function tokenDelFormulario_(html) {
  var m = /<input\b[^>]*\bname=["']token["'][^>]*\bvalue=["']([^"']*)["']/i.exec(html) ||
          /<input\b[^>]*\bvalue=["']([^"']*)["'][^>]*\bname=["']token["']/i.exec(html);
  return m ? m[1] : null;
}

/**
 * El HTML de resultado, reducido a una lista de líneas de texto.
 *
 * No se intenta seguir la estructura exacta de tablas/celdas —eso cambia con
 * cualquier rediseño menor del portal—; se aplana todo a texto y se busca por
 * las etiquetas («Estado del Contribuyente:», «Padrones:», …), que son las
 * que SUNAT mantiene estables porque las lee gente, no un programa.
 */
function textoPlano_(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|tr|p|div|li|table|\/table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú')
    .replace(/&ntilde;/gi, 'ñ').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&deg;/gi, '°').replace(/&ordm;/gi, 'º')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
    .filter(String);
}

/** Las etiquetas que trae la pantalla, en orden. Sirven para saber dónde termina un valor. */
var ETIQUETAS_CONSULTA_RUC_ = [
  'Número de RUC:', 'Tipo Contribuyente:', 'Nombre Comercial:',
  'Fecha de Inscripción:', 'Fecha de Inicio de Actividades:',
  'Estado del Contribuyente:', 'Condición del Contribuyente:',
  'Domicilio Fiscal:', 'Sistema Emisión de Comprobante:', 'Actividad Comercio Exterior:',
  'Sistema Contabilidad:', 'Actividad(es) Económica(s):',
  'Comprobantes de Pago c/aut. de impresión', 'Sistema de Emisión Electrónica:',
  'Emisor electrónico desde:', 'Comprobantes Electrónicos:', 'Afiliado al PLE desde:',
  'Padrones:', 'Fecha consulta:'
];

/**
 * El valor de una etiqueta, tal como venga: en la misma línea (si el HTML la
 * puso en una sola celda) o repartido en las líneas siguientes hasta la
 * próxima etiqueta conocida (el caso de «Padrones», que a veces trae la
 * resolución y la fecha en renglones separados).
 */
function valorEtiqueta_(lineas, etiqueta) {
  var inicio = -1;
  for (var i = 0; i < lineas.length; i++) {
    if (lineas[i].indexOf(etiqueta) === 0) { inicio = i; break; }
  }
  if (inicio === -1) return '';

  var partes = [];
  var resto = lineas[inicio].slice(etiqueta.length).trim();
  if (resto) partes.push(resto);

  for (var j = inicio + 1; j < lineas.length; j++) {
    var esOtraEtiqueta = ETIQUETAS_CONSULTA_RUC_.some(function (e) { return lineas[j].indexOf(e) === 0; });
    if (esOtraEtiqueta) break;
    partes.push(lineas[j]);
  }
  return partes.join(' ').trim();
}

/**
 * Interpreta el resultado de la consulta.
 *
 * `Padrones` trae «NINGUNO» cuando el RUC no está en ningún padrón, o texto
 * libre como «Incorporado al Régimen de Buenos Contribuyentes (Resolución
 * N° ...) a partir del ...» cuando sí. Se detecta por palabra clave en vez de
 * exigir el texto exacto, porque la redacción varía según el padrón y la
 * resolución.
 */
function leerResultadoRuc_(html, ruc) {
  var lineas = textoPlano_(html);

  var lineaRuc = valorEtiqueta_(lineas, 'Número de RUC:');
  var estado = valorEtiqueta_(lineas, 'Estado del Contribuyente:');
  var condicion = valorEtiqueta_(lineas, 'Condición del Contribuyente:');
  var padrones = valorEtiqueta_(lineas, 'Padrones:');

  if (!lineaRuc && !estado) {
    throw new Error(
      'La respuesta de SUNAT no trajo los datos esperados para el RUC ' + ruc + '. ' +
      'Puede que el RUC no exista, o que haya cambiado la página.'
    );
  }

  var guion = lineaRuc.indexOf(' - ');
  var razonSocial = guion >= 0 ? lineaRuc.slice(guion + 3).trim() : '';
  var ningunPadron = /^ninguno$/i.test(padrones.trim());

  return {
    ruc: ruc,
    razonSocial: razonSocial,
    estado: estado,
    condicion: condicion,
    buenContribuyente: /buenos?\s+contribuyentes/i.test(padrones),
    agenteRetencion: /agente\s+de\s+retenci/i.test(padrones),
    agentePercepcion: /agente\s+de\s+percepci/i.test(padrones),
    padronesTexto: ningunPadron ? '' : padrones
  };
}
