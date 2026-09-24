/**
 * Lectura de facturas en las carpetas de OC
 * --------------------------------------------------------------------------
 *
 * Segundo paso después de `CapturaCarpetasOC.gs`, y va EN EL MISMO PROYECTO
 * (usa sus funciones y su pestaña ARCHIVOS). Abre los archivos que parecen
 * factura pero no traen el número en el nombre («FACTURA OC 0115-2026.pdf»),
 * lee su texto y anota lo que dice el documento: RUC del emisor, tipo,
 * serie-número, fecha, total y la OC si aparece escrita.
 *
 * Cómo lee: le pide a Drive una copia del archivo convertida a documento de
 * Google, que es la misma lectura (OCR) que hace Drive con PDF e imágenes. Se
 * saca el texto y la copia se borra enseguida. El archivo original no se toca.
 *
 * Escribe en una pestaña nueva, LECTURA, una fila por archivo leído. No
 * modifica CARPETAS ni ARCHIVOS.
 *
 * ── Instalación ──
 * 1. En el mismo proyecto de Apps Script donde está la captura: el + junto a
 *    «Archivos» → Script → llámalo LecturaFacturas → pega esto → guarda.
 * 2. A la izquierda, «Servicios» (+) → «Drive API» → Agregar.
 * 3. Recarga la hoja: aparece el menú «Leer facturas».
 */

var LEER_OTROS_SI_NO_HAY_FACTURA = true; // en carpetas sin factura, mirar también los «OTRO»
var OTROS_POR_CARPETA = 5;               // cuántos «OTRO» como mucho por carpeta
var MINUTOS_POR_TANDA_LECTURA = 4.5;
var RUC_EMPRESA = '20512201611';         // INROPRIN: el adquiriente, nunca el emisor
var CARPETA_TEMPORAL = '_lectura_facturas_temporal';

var CAB_LECTURA = ['ID archivo', 'Enlace del archivo', 'OC', 'RUC (base CG)', 'Proveedor (base CG)',
  'Nombre del archivo', 'Por qué se lee', 'Estado', 'RUC emisor (leído)', 'Tipo (leído)',
  'Serie-número (leído)', 'Fecha (leída)', 'Total (leído)', 'OC en el documento', 'Leído en',
  'Inicio del texto (para revisar)'];
var COL_ESTADO_LECTURA = 8;

function menuLecturaFacturas_() {
  SpreadsheetApp.getUi().createMenu('Leer facturas')
    .addItem('1. Preparar lista de facturas a leer', 'prepararLectura')
    .addItem('2. Leer siguiente tanda', 'leerSiguienteTanda')
    .addSeparator()
    .addItem('Leer solo cada 10 minutos', 'activarLecturaAutomatica')
    .addItem('Detener lectura automática', 'detenerLecturaAutomatica')
    .addSeparator()
    .addItem('Reintentar las que no se pudieron leer', 'reintentarLectura')
    .addToUi();
}

/**
 * Para correr UNA vez desde el editor de Apps Script (elegirla arriba y
 * «Ejecutar»): hace que Google vuelva a pedir todos los permisos. En la
 * pantalla de permisos hay que marcar TODAS las casillas —en especial
 * «Documentos de Google»—, o la lectura dice «No tienes permiso para llamar…».
 */
function autorizarLectura() {
  DriveApp.getRootFolder().getName();
  DocumentApp.getActiveDocument(); // solo para que Google incluya el permiso de Documentos
  Logger.log('Permisos listos. Vuelve a la hoja y usa «Reintentar las que no se pudieron leer».');
}

/** Vuelve a PENDIENTE lo que quedó «NO SE PUDO LEER», para leerlo otra vez. */
function reintentarLectura() {
  var hojaL = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LECTURA');
  if (!hojaL || hojaL.getLastRow() < 2) return;
  var rango = hojaL.getRange(2, COL_ESTADO_LECTURA, hojaL.getLastRow() - 1, 1);
  var n = 0;
  rango.setValues(rango.getValues().map(function (f) {
    if (f[0] === 'NO SE PUDO LEER') { n++; return ['PENDIENTE']; }
    return f;
  }));
  SpreadsheetApp.getActiveSpreadsheet().toast(n + ' archivos vuelven a PENDIENTE. Sigue con «Leer solo cada 10 minutos».',
    'Leer facturas', 10);
}

// ── 1. Qué leer, sacado de ARCHIVOS ──

function prepararLectura() {
  var ui = SpreadsheetApp.getUi();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaA = libro.getSheetByName('ARCHIVOS');
  if (!hojaA || hojaA.getLastRow() < 2) {
    ui.alert('Falta la captura', 'Primero hay que correr la captura de carpetas (pestaña ARCHIVOS).', ui.ButtonSet.OK);
    return;
  }
  var hojaL = libro.getSheetByName('LECTURA');
  if (hojaL && hojaL.getLastRow() > 1) {
    var r = ui.alert('Ya hay una lista', 'Prepararla de nuevo borra LECTURA y empieza desde cero. ¿Seguir?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }

  var datos = hojaA.getRange(1, 1, hojaA.getLastRow(), hojaA.getLastColumn()).getValues();
  var cab = datos[0];
  var i = {
    oc: columna_(cab, 'OC'), ruc: columna_(cab, 'RUC'), prov: columna_(cab, 'Proveedor'),
    carpeta: columna_(cab, 'Enlace carpeta OC'), donde: columna_(cab, 'Dónde se encontró'),
    nombre: columna_(cab, 'Nombre del archivo'), url: columna_(cab, 'Enlace del archivo'),
    tipo: columna_(cab, 'Tipo de archivo'), parece: columna_(cab, 'Parece ser'),
    serie: columna_(cab, 'Serie-número en el nombre')
  };
  var filas = datos.slice(1);

  var conFactura = {};
  filas.forEach(function (f) {
    if (esFactura_({ parece: String(f[i.parece]) })) conFactura[f[i.carpeta]] = true;
  });

  var lista = [], vistos = {}, otrosPorCarpeta = {};
  filas.forEach(function (f) {
    var tipo = String(f[i.tipo]);
    if (tipo !== 'PDF' && tipo !== 'Imagen') return;
    var id = idDeDrive_(String(f[i.url]));
    if (!id || vistos[id]) return;
    var parece = String(f[i.parece]);
    var motivo = porQueLeer_(parece, String(f[i.serie] || ''), !!conFactura[f[i.carpeta]]);
    if (!motivo) return;
    if (motivo === 'OTRO en carpeta sin factura') {
      var n = otrosPorCarpeta[f[i.carpeta]] = (otrosPorCarpeta[f[i.carpeta]] || 0) + 1;
      if (n > OTROS_POR_CARPETA) return;
    }
    vistos[id] = true;
    lista.push([id, f[i.url], f[i.oc], f[i.ruc], f[i.prov], f[i.nombre], motivo, 'PENDIENTE',
      '', '', '', '', '', '', '', '']);
  });

  hojaL = prepararHoja_(libro, 'LECTURA', CAB_LECTURA);
  if (lista.length) {
    hojaL.getRange(2, 1, lista.length, 1).setNumberFormat('@');
    hojaL.getRange(2, 9, lista.length, 1).setNumberFormat('@');
    hojaL.getRange(2, 1, lista.length, CAB_LECTURA.length).setValues(lista);
  }
  ui.alert('Lista preparada', lista.length + ' archivos por leer.\n\nSigue con «Leer solo cada 10 minutos».', ui.ButtonSet.OK);
}

/** Por qué vale la pena abrir un archivo, o '' si no. */
function porQueLeer_(parece, serieEnNombre, carpetaTieneFactura) {
  if (/^(FACTURA|NOTA DE|BOLETA|COMPROBANTE)/.test(parece) && !serieEnNombre) return 'Factura sin número en el nombre';
  if (LEER_OTROS_SI_NO_HAY_FACTURA && parece === 'OTRO' && !carpetaTieneFactura) return 'OTRO en carpeta sin factura';
  return '';
}

// ── 2. Leer, por tandas ──

function leerSiguienteTanda() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    try { libro.toast('Ya hay una tanda corriendo. Sigue sola: revisa LECTURA en unos minutos.', 'Leer facturas', 10); } catch (e) {}
    return;
  }
  try {
    if (typeof Drive === 'undefined') {
      throw new Error('Falta activar el servicio «Drive API»: en Apps Script, Servicios (+) → Drive API → Agregar.');
    }
    var inicio = Date.now();
    var hojaL = libro.getSheetByName('LECTURA');
    if (!hojaL || hojaL.getLastRow() < 2) throw new Error('Primero «1. Preparar lista de facturas a leer».');
    var lista = hojaL.getRange(2, 1, hojaL.getLastRow() - 1, CAB_LECTURA.length).getValues();
    var temporal = carpetaTemporal_();
    var hechas = 0, leidas = 0;

    for (var k = 0; k < lista.length; k++) {
      if (lista[k][COL_ESTADO_LECTURA - 1] !== 'PENDIENTE') continue;
      if ((Date.now() - inicio) / 60000 > MINUTOS_POR_TANDA_LECTURA) break;
      var res = leerArchivo_(String(lista[k][0]), temporal);
      // Sin permiso no es culpa del archivo: fallarían TODOS. Se para aquí,
      // sin marcar la fila, y se avisa qué hacer.
      if (res.error && /permiso|permission|autoriza|authoriz/i.test(res.error)) {
        detenerLecturaAutomatica_();
        throw new Error('Falta un permiso de Google (' + res.error.slice(0, 120) + '). En Apps Script, ' +
          'elige la función «autorizarLectura», dale Ejecutar y marca TODAS las casillas de permisos.');
      }
      var d = res.texto ? leerDatosDeFactura_(res.texto) : {};
      var estado = res.error ? 'NO SE PUDO LEER' : (!res.texto ? 'SIN TEXTO' : (d.serie ? 'LEÍDO' : 'LEÍDO SIN NÚMERO'));
      if (d.serie) leidas++;
      // Se escribe fila por fila: leer es lento, y así una tanda cortada no
      // pierde lo que ya leyó.
      hojaL.getRange(k + 2, COL_ESTADO_LECTURA, 1, 9).setValues([[
        estado, d.ruc || '', d.tipo || '', d.serie || '', d.fecha || '', d.total == null ? '' : d.total,
        d.oc || '', new Date(), res.error || (res.texto || '').replace(/\s+/g, ' ').slice(0, 300)
      ]]);
      hechas++;
    }

    var pendientes = hojaL.getRange(2, COL_ESTADO_LECTURA, lista.length, 1).getValues()
      .filter(function (f) { return f[0] === 'PENDIENTE'; }).length;
    if (pendientes === 0) detenerLecturaAutomatica_();
    libro.toast(hechas + ' archivos leídos en esta tanda (' + leidas + ' con número). Faltan ' + pendientes +
      (pendientes === 0 ? ' — TERMINADO.' : '.'), 'Leer facturas', 10);
  } finally {
    lock.releaseLock();
  }
}

/** Copia el archivo como documento de Google (con OCR), saca el texto y borra la copia. */
function leerArchivo_(id, temporal) {
  var copia = null;
  try {
    var v2 = typeof Drive.Files.insert === 'function'; // el servicio puede estar en v2 o v3
    copia = v2
      ? Drive.Files.copy({ title: 'lectura ' + id, parents: [{ id: temporal }] }, id,
          { convert: true, ocr: true, ocrLanguage: 'es', supportsAllDrives: true })
      : Drive.Files.copy({ name: 'lectura ' + id, mimeType: 'application/vnd.google-apps.document', parents: [temporal] }, id,
          { ocrLanguage: 'es', supportsAllDrives: true });
    var texto = DocumentApp.openById(copia.id).getBody().getText();
    return { texto: texto };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200) };
  } finally {
    if (copia) {
      try { Drive.Files.remove(copia.id); } catch (e) {
        try { DriveApp.getFileById(copia.id).setTrashed(true); } catch (e2) {}
      }
    }
  }
}

function carpetaTemporal_() {
  var it = DriveApp.getFoldersByName(CARPETA_TEMPORAL);
  return (it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_TEMPORAL)).getId();
}

// ── Lectura automática ──

function activarLecturaAutomatica() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaL = libro.getSheetByName('LECTURA');
  if (!hojaL || hojaL.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Falta un paso', 'Primero usa «1. Preparar lista de facturas a leer».',
      SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  detenerLecturaAutomatica_();
  ScriptApp.newTrigger('leerSiguienteTanda').timeBased().everyMinutes(10).create();
  libro.toast('Empieza la primera tanda (unos 5 minutos). Después sigue sola cada 10 minutos y se detiene al terminar.',
    'Leer facturas', 15);
  leerSiguienteTanda();
}

function detenerLecturaAutomatica() {
  detenerLecturaAutomatica_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Lectura automática detenida.', 'Leer facturas', 5);
}

function detenerLecturaAutomatica_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'leerSiguienteTanda') ScriptApp.deleteTrigger(t);
  });
}

// ── Qué dice el texto (sin llamadas a Google: se prueba suelto) ──

/**
 * Del texto de una factura: RUC del emisor, tipo, serie-número, fecha, total
 * y la OC si aparece. Lo que no encuentra lo deja vacío; no adivina.
 */
function leerDatosDeFactura_(texto) {
  var t = String(texto || '').replace(/ /g, ' ');
  var T = t.toUpperCase();
  var plano = T.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return {
    ruc: rucEmisor_(T),
    tipo: tipoDeDocumento_(plano),
    serie: serieDelDocumento_(T),
    fecha: fechaDelDocumento_(plano),
    total: totalDelDocumento_(plano),
    oc: ocDelDocumento_(plano)
  };
}

/** El RUC que no es el de la empresa: primero el que va rotulado «RUC», si no el primero que aparezca. */
function rucEmisor_(T) {
  var re = /R\.?\s*U\.?\s*C\.?\s*(?:N[°ºO.]*)?\s*[:.]?\s*((?:10|15|16|17|20)\d{9})(?!\d)/g, m;
  while ((m = re.exec(T))) if (m[1] !== RUC_EMPRESA) return m[1];
  var todos = T.match(/(?:^|\D)((?:10|15|16|17|20)\d{9})(?!\d)/g) || [];
  for (var i = 0; i < todos.length; i++) {
    var r = todos[i].replace(/\D/g, '');
    if (r !== RUC_EMPRESA) return r;
  }
  return '';
}

function tipoDeDocumento_(P) {
  if (/NOTA\s+DE\s+CREDITO/.test(P)) return 'NOTA DE CRÉDITO';
  if (/NOTA\s+DE\s+DEBITO/.test(P)) return 'NOTA DE DÉBITO';
  if (/RECIBO\s+POR\s+HONORARIOS/.test(P)) return 'RECIBO POR HONORARIOS';
  if (/FACTURA/.test(P)) return 'FACTURA';
  if (/BOLETA/.test(P)) return 'BOLETA';
  if (/GUIA\s+DE\s+REMISION/.test(P)) return 'GUÍA';
  return '';
}

/**
 * La serie-número del propio documento: F001-00018178, E001-179, FE01-1380.
 * Se saltan las series de guía (T001, EG07…), que un comprobante suele citar.
 */
function serieDelDocumento_(T) {
  var re = /(?:^|[^A-Z0-9])([FBE][A-Z0-9]{3})\s*[-–—]\s*0*(\d{1,8})(?!\d)/g, m;
  while ((m = re.exec(T))) {
    var serie = m[1];
    if (!/\d/.test(serie) || /^EG/.test(serie)) continue;
    return serie + '-' + m[2];
  }
  return '';
}

function fechaDelDocumento_(P) {
  var cerca = /FECHA\s+(?:DE\s+)?(?:EMISION|LA\s+FACTURA|DE\s+LA\s+FACTURA)?\s*[:.]?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(P)
    || /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d\d)/.exec(P);
  if (!cerca) {
    var iso = /(20\d\d)-(\d{2})-(\d{2})/.exec(P);
    return iso ? iso[3] + '/' + iso[2] + '/' + iso[1] : '';
  }
  return ('0' + cerca[1]).slice(-2) + '/' + ('0' + cerca[2]).slice(-2) + '/' + cerca[3];
}

/** El total: «IMPORTE TOTAL» si está; si no, el mayor de los montos rotulados «TOTAL». */
function totalDelDocumento_(P) {
  var monto = '((?:S\\/\\.?|US\\$|\\$|PEN|USD)?\\s*\\d{1,3}(?:[,.\\s]\\d{3})*(?:[.,]\\d{2}))';
  var fuerte = new RegExp('(?:IMPORTE\\s+TOTAL|TOTAL\\s+A\\s+PAGAR|TOTAL\\s+VENTA|MONTO\\s+TOTAL)[^\\d]{0,25}' + monto, 'g');
  var m, mejor = null;
  while ((m = fuerte.exec(P))) mejor = aNumero_(m[1]);
  if (mejor != null) return mejor;
  var debil = new RegExp('TOTAL[^\\d]{0,25}' + monto, 'g');
  while ((m = debil.exec(P))) {
    var n = aNumero_(m[1]);
    if (n != null && (mejor == null || n > mejor)) mejor = n;
  }
  return mejor;
}

/** «1,425.00» → 1425; «1.425,00» → 1425. */
function aNumero_(s) {
  var x = String(s).replace(/[^\d.,]/g, '');
  if (/,\d{2}$/.test(x)) x = x.replace(/\./g, '').replace(',', '.');
  else x = x.replace(/,/g, '');
  var n = Number(x);
  return isNaN(n) ? null : n;
}

/** «ORDEN DE COMPRA N° 0115-2026», «Ref. de O.C.: 0115-2026», «OC 2026-0115» → «0115-2026». */
function ocDelDocumento_(P) {
  var m = /(?:ORDEN\s+DE\s+(?:COMPRA|SERVICIO)|\bO\.?\s?[CS]\.?(?=[\s:#N°º.\d]))\s*(?:N[°ºO.]*)?\s*[:#.]?\s*(\d{1,6}\s*-\s*20\d\d|20\d\d\s*-\s*\d{1,6})(?!\d)/.exec(P);
  if (!m) return '';
  var p = m[1].replace(/\s+/g, '').split('-');
  var anio = /^20\d\d$/.test(p[0]) ? p[0] : p[1];
  var num = /^20\d\d$/.test(p[0]) ? p[1] : p[0];
  return ('0000' + Number(num)).slice(-4) + '-' + anio;
}
