/**
 * Desglose de comprobantes en la misma hoja
 * ------------------------------------------
 *
 * El registro de compras (la pestaña de datos) trae la cabecera: cuánto, de
 * quién, cuándo. No trae EN QUÉ se gastó. Ese detalle —«4 CONTENEDOR DE BASURA
 * 240L a 287.29 c/u»— vive solo en el XML de cada comprobante.
 *
 * No hay API de SUNAT que devuelva los ítems: la única fuente es el XML. Por
 * eso esto NO scrapea el portal —que sería frágil y guardaría la Clave SOL en
 * el script—, sino que trabaja sobre los XML que ya se bajaron:
 *
 *   1. Una persona baja el ZIP en SUNAT (Consultar Factura y Nota → Descarga
 *      masiva) y lo deja en una carpeta de Drive.
 *   2. Este script —a mano desde el menú, o solo con un disparador de tiempo—
 *      abre cada ZIP, lee cada XML, saca los ítems y los escribe en la pestaña
 *      «DETALLE» de esta misma hoja.
 *   3. El ZIP procesado se mueve a una subcarpeta, para no repetirlo.
 *
 * Es «automático» de verdad de la descarga en adelante, y no depende del HTML
 * de SUNAT: lo único que puede cambiar es el formato del XML, que es un
 * estándar (UBL 2.1) y cambia poco.
 */

// ── Configuración (ajústala una vez) ──────────────────────────────

/**
 * La carpeta de Drive donde se dejan los ZIP de la descarga masiva.
 *
 * Es el ID que sale en la URL de la carpeta: .../folders/ESTE_ID
 */
var CARPETA_ZIPS = 'PON_AQUI_EL_ID_DE_LA_CARPETA';

/** El RUC de la empresa, para decidir si un comprobante es recibido o emitido. */
var RUC_EMPRESA = '20512201611';

/** La pestaña donde se escribe el detalle. No es la de datos, así que sobrevive. */
var PESTANA_DETALLE = 'DETALLE';

var CABECERAS_DETALLE = [
  'Período', 'Origen', 'RUC proveedor', 'Proveedor',
  'Tipo', 'Serie', 'Número', 'Fecha de emisión', 'Moneda',
  'Línea', 'Descripción', 'Cantidad', 'Unidad', 'Precio unitario', 'Importe',
  'Total del comprobante'
];

// ── Menú (se engancha desde onOpen de Codigo.gs) ──────────────────

/**
 * Los ítems del menú que agrega este archivo. Codigo.gs lo llama desde su
 * onOpen para que haya un solo menú, no dos.
 */
function itemsMenuDesglose_(menu) {
  return menu
    .addSeparator()
    .addItem('Desglosar ZIPs de Drive (ítems)', 'desglosarComprobantes')
    .addItem('Activar desglose automático', 'instalarDesgloseAutomatico')
    .addItem('Desactivar desglose automático', 'quitarDesgloseAutomatico');
}

// ── Orquestación ──────────────────────────────────────────────────

/**
 * Procesa todos los ZIP de la carpeta y escribe sus ítems en la pestaña.
 *
 * Se puede llamar del menú o de un disparador de tiempo. Devuelve un resumen
 * para el aviso que muestra el menú.
 */
function desglosarComprobantes() {
  if (CARPETA_ZIPS === 'PON_AQUI_EL_ID_DE_LA_CARPETA') {
    SpreadsheetApp.getUi().alert(
      'Falta configurar la carpeta.\n\nEn Desglose.gs, pon en CARPETA_ZIPS el ID ' +
      'de la carpeta de Drive donde dejas los ZIP de la descarga masiva.');
    return;
  }

  var carpeta = DriveApp.getFolderById(CARPETA_ZIPS);
  var procesados = subcarpeta_(carpeta, 'procesados');

  var comprobantes = [];
  var zips = 0, xmls = 0, errores = 0;

  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var archivo = it.next();
    if (!/\.zip$/i.test(archivo.getName())) continue;
    zips++;
    try {
      var textos = xmlsDeZip_(archivo.getBlob());
      xmls += textos.length;
      for (var i = 0; i < textos.length; i++) {
        var c = leerComprobanteXml_(textos[i]);
        if (c.serie && c.numero) comprobantes.push(c);
      }
      archivo.moveTo(procesados);
    } catch (e) {
      errores++;
    }
  }

  var escritos = escribirDetalle_(comprobantes);

  var msg = zips === 0
    ? 'No había ZIP nuevos en la carpeta.'
    : ('Procesados ' + zips + ' ZIP (' + xmls + ' XML). ' +
       'Se escribieron ' + escritos + ' ítems nuevos en «' + PESTANA_DETALLE + '».' +
       (errores ? ('\n' + errores + ' ZIP no se pudieron leer.') : ''));

  // Desde un disparador no hay interfaz; solo el menú muestra el aviso.
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** La subcarpeta de procesados, creándola si no existe. */
function subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * Saca los textos XML de un ZIP, entrando en los ZIP anidados.
 *
 * La descarga de un comprobante trae el XML junto a un CSS y un XSL de
 * presentación, que se ignoran. La masiva puede traer un ZIP por comprobante
 * dentro de uno grande.
 */
function xmlsDeZip_(blob) {
  var out = [];
  blob.setContentType('application/zip');
  var partes = Utilities.unzip(blob);
  for (var i = 0; i < partes.length; i++) {
    var nombre = partes[i].getName() || '';
    if (/\.zip$/i.test(nombre)) {
      out = out.concat(xmlsDeZip_(partes[i]));
    } else if (/\.xml$/i.test(nombre)) {
      out.push(decodificarXml_(partes[i]));
    }
  }
  return out;
}

/**
 * Convierte los bytes del XML a texto respetando su codificación.
 *
 * SUNAT declara sus comprobantes en ISO-8859-1, no en UTF-8; leerlos como
 * UTF-8 parte tildes y eñes. Se mira el prólogo y se decodifica como diga.
 */
function decodificarXml_(blob) {
  var cabeza = blob.getDataAsString('ISO-8859-1').substring(0, 120).toLowerCase();
  var m = /encoding=["']([^"']+)["']/.exec(cabeza);
  var enc = (m ? m[1] : 'utf-8').trim();
  var latin = /8859-1|latin1|windows-1252/.test(enc);
  return blob.getDataAsString(latin ? 'ISO-8859-1' : 'UTF-8');
}

/**
 * Escribe los ítems en la pestaña, sin repetir los que ya están.
 *
 * La llave de un ítem es tipo|serie|número|proveedor|línea. Reprocesar un ZIP
 * que ya se cargó no vuelve a escribir nada.
 */
function escribirDetalle_(comprobantes) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(PESTANA_DETALLE);
  if (!hoja) {
    hoja = libro.insertSheet(PESTANA_DETALLE);
    hoja.appendRow(CABECERAS_DETALLE);
    hoja.setFrozenRows(1);
  }

  // Las llaves que ya están, para no duplicar.
  var vistas = {};
  var ultima = hoja.getLastRow();
  if (ultima > 1) {
    var previas = hoja.getRange(2, 1, ultima - 1, CABECERAS_DETALLE.length).getValues();
    for (var i = 0; i < previas.length; i++) {
      vistas[llaveItem_(previas[i][4], previas[i][5], previas[i][6], previas[i][2], previas[i][9])] = true;
    }
  }

  var filas = [];
  for (var c = 0; c < comprobantes.length; c++) {
    var cp = comprobantes[c];
    var periodo = periodoDe_(cp.fechaEmision);
    var origen = origenDe_(cp, RUC_EMPRESA);
    for (var j = 0; j < cp.items.length; j++) {
      var it = cp.items[j];
      var llave = llaveItem_(nombreTipo_(cp.tipoComprobante), cp.serie, cp.numero, cp.proveedorRuc, it.linea);
      if (vistas[llave]) continue;
      vistas[llave] = true;
      filas.push([
        periodo, origen, cp.proveedorRuc || '', cp.proveedorNombre || '',
        nombreTipo_(cp.tipoComprobante), cp.serie || '', cp.numero || '',
        fechaCorta_(cp.fechaEmision), cp.moneda || '',
        it.linea == null ? '' : it.linea, it.descripcion || '',
        it.cantidad, it.unidad || '', it.precioUnitario, it.importe, cp.total
      ]);
    }
  }

  if (filas.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, CABECERAS_DETALLE.length).setValues(filas);
  }
  return filas.length;
}

function llaveItem_(tipo, serie, numero, ruc, linea) {
  return [tipo, serie, numero, ruc, linea].join('|');
}

// ── El disparador automático ──────────────────────────────────────

/** Deja el desglose corriendo solo cada hora. */
function instalarDesgloseAutomatico() {
  quitarDesgloseAutomatico();
  ScriptApp.newTrigger('desglosarComprobantes').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert(
    'Listo. Cada hora revisará la carpeta y desglosará los ZIP nuevos.\n\n' +
    'Tú solo dejas el ZIP de la descarga masiva en la carpeta.');
}

/** Lo apaga. */
function quitarDesgloseAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'desglosarComprobantes') ScriptApp.deleteTrigger(t);
  });
}

// ══════════════════════════════════════════════════════════════════
// Parser de UBL 2.1 — port de lib/sunat/cpe-xml.ts, validado contra un
// XML real. Lee por nombre de etiqueta, ignora el prefijo del espacio de
// nombres, y desenvuelve el texto en CDATA. No lanza: devuelve lo que
// entendió.
// ══════════════════════════════════════════════════════════════════

var CONTENIDO_ = '((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)';

function limpiar_(s) {
  var t = String(s).replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  return t || null;
}

function valor_(xml, nombre) {
  var re = new RegExp('<(?:[\\w.-]+:)?' + nombre + '\\b[^>]*>' + CONTENIDO_ + '</(?:[\\w.-]+:)?' + nombre + '>');
  var m = re.exec(xml);
  return m ? limpiar_(m[1]) : null;
}

function valores_(xml, nombre) {
  var re = new RegExp('<(?:[\\w.-]+:)?' + nombre + '\\b[^>]*>' + CONTENIDO_ + '</(?:[\\w.-]+:)?' + nombre + '>', 'g');
  var out = [], m;
  while ((m = re.exec(xml))) { var t = limpiar_(m[1]); if (t) out.push(t); }
  return out;
}

function atributo_(xml, nombre, attr) {
  var re = new RegExp('<(?:[\\w.-]+:)?' + nombre + '\\b[^>]*\\b' + attr + '="([^"]*)"');
  var m = re.exec(xml);
  return m ? (m[1].trim() || null) : null;
}

function bloques_(xml, nombre) {
  var tag = new RegExp('<(/?)(?:[\\w.-]+:)?' + nombre + '\\b([^>]*)>', 'g');
  var out = [], profundidad = 0, inicio = -1, m;
  while ((m = tag.exec(xml))) {
    var esCierre = m[1] === '/';
    if (/\/\s*$/.test(m[2])) continue; // autocierre
    if (!esCierre) {
      if (profundidad === 0) inicio = m.index + m[0].length;
      profundidad++;
    } else if (profundidad > 0) {
      profundidad--;
      if (profundidad === 0 && inicio >= 0) { out.push(xml.slice(inicio, m.index)); inicio = -1; }
    }
  }
  return out;
}

function bloque_(xml, nombre) { return bloques_(xml, nombre)[0] || ''; }

function aMonto_(v) {
  if (v == null) return '';
  var s = String(v).replace(/\s/g, '');
  if (!s) return '';
  var limpio = (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) ? s.replace(/,/g, '')
    : (s.indexOf(',') >= 0 ? s.replace(',', '.') : s);
  var n = Number(limpio);
  return isFinite(n) ? n : '';
}

function aFechaXml_(v) {
  if (!v) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : null;
}

function partirSerieNumero_(id) {
  if (!id) return { serie: null, numero: null };
  var m = /^([A-Za-z0-9]{1,4})-(\d+)$/.exec(String(id).trim());
  if (!m) return { serie: null, numero: null };
  return { serie: m[1].toUpperCase(), numero: m[2].replace(/^0+/, '') || '0' };
}

function tipoDe_(xml) {
  if (/<(?:[\w.-]+:)?CreditNote\b/.test(xml)) return { tipo: '07', lineaTag: 'CreditNoteLine', cantidadTag: 'CreditedQuantity' };
  if (/<(?:[\w.-]+:)?DebitNote\b/.test(xml)) return { tipo: '08', lineaTag: 'DebitNoteLine', cantidadTag: 'DebitedQuantity' };
  return { tipo: valor_(xml, 'InvoiceTypeCode'), lineaTag: 'InvoiceLine', cantidadTag: 'InvoicedQuantity' };
}

function parte_(b) {
  var ident = bloque_(b, 'PartyIdentification');
  var ruc = valor_(ident, 'ID');
  var nombre = valor_(bloque_(b, 'PartyLegalEntity'), 'RegistrationName') || valor_(bloque_(b, 'PartyName'), 'Name');
  return { ruc: ruc, nombre: nombre };
}

function itemDe_(b, cantidadTag) {
  var linea = valor_(b, 'ID');
  return {
    linea: linea == null ? null : (Number(linea) || null),
    descripcion: valor_(bloque_(b, 'Item'), 'Description'),
    cantidad: aMonto_(valor_(b, cantidadTag)),
    unidad: atributo_(b, cantidadTag, 'unitCode'),
    precioUnitario: aMonto_(valor_(bloque_(b, 'Price'), 'PriceAmount')),
    importe: aMonto_(valor_(b, 'LineExtensionAmount'))
  };
}

function leerComprobanteXml_(xml) {
  var t = tipoDe_(xml);

  var idDoc = null, todos = valores_(xml, 'ID');
  for (var i = 0; i < todos.length; i++) {
    if (/^[A-Za-z0-9]{1,4}-\d+$/.test(todos[i])) { idDoc = todos[i]; break; }
  }
  var sn = partirSerieNumero_(idDoc);

  var proveedor = parte_(bloque_(xml, 'AccountingSupplierParty'));
  var adquiriente = parte_(bloque_(xml, 'AccountingCustomerParty'));
  var totales = bloque_(xml, 'LegalMonetaryTotal');

  var items = bloques_(xml, t.lineaTag).map(function (b) { return itemDe_(b, t.cantidadTag); });
  items.sort(function (a, b) { return (a.linea || 0) - (b.linea || 0); });

  return {
    tipoComprobante: t.tipo,
    serie: sn.serie,
    numero: sn.numero,
    fechaEmision: aFechaXml_(valor_(xml, 'IssueDate')),
    moneda: valor_(xml, 'DocumentCurrencyCode'),
    proveedorRuc: proveedor.ruc,
    proveedorNombre: proveedor.nombre,
    adquirienteRuc: adquiriente.ruc,
    adquirienteNombre: adquiriente.nombre,
    subtotal: aMonto_(valor_(totales, 'LineExtensionAmount')),
    igv: aMonto_(valor_(bloque_(xml, 'TaxTotal'), 'TaxAmount')),
    total: aMonto_(valor_(totales, 'PayableAmount')),
    items: items
  };
}

// ── Ayudantes de presentación ─────────────────────────────────────

function origenDe_(c, rucEmpresa) {
  var ruc = String(rucEmpresa).trim();
  if (c.adquirienteRuc === ruc) return 'Recibido';
  if (c.proveedorRuc === ruc) return 'Emitido';
  return 'Otro';
}

function periodoDe_(fechaEmision) {
  if (!fechaEmision) return '';
  var m = /^(\d{4})-(\d{2})/.exec(fechaEmision);
  return m ? (m[1] + m[2]) : '';
}

function fechaCorta_(iso) {
  if (!iso) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
}

var NOMBRE_TIPO_ = { '01': 'Factura', '03': 'Boleta', '07': 'Nota de crédito', '08': 'Nota de débito', '12': 'Ticket' };
function nombreTipo_(codigo) { return codigo ? (NOMBRE_TIPO_[codigo] || codigo) : ''; }
