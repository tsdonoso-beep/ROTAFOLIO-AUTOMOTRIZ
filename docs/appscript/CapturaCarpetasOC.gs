/**
 * Captura de archivos en las carpetas de OC
 * --------------------------------------------------------------------------
 *
 * Recorre el enlace de carpeta de cada OC de la base de Control de Gestión y
 * anota cada archivo que encuentra: dónde está, cómo se llama, su enlace y
 * qué parece ser (factura, guía, pago…) según las palabras de su nombre y de
 * la carpeta donde está. No abre ni lee los archivos: eso va después, sobre
 * lo que esto deje escrito.
 *
 * Busca a fondo:
 *   · todas las subcarpetas, a cualquier profundidad;
 *   · palabras parecidas, no solo «FACTURA»: FACT, FT, F001-…, E001-…, y
 *     errores de tipeo (FATURA, FACTRUA);
 *   · si una OC no tiene nada que parezca factura adentro, busca afuera: en
 *     la carpeta superior y en todo el Drive, archivos con su número de OC.
 *
 * La base original SOLO SE LEE. Todo se escribe en la hoja donde está pegado
 * este script (una hoja de tu unidad):
 *   · CARPETAS  una fila por carpeta de OC, con lo que se encontró.
 *   · ARCHIVOS  una fila por archivo.
 *   · RESUMEN   cuántas OC tienen factura, cuántas no, cuántas sin acceso.
 *
 * ── Instalación ──
 * 1. Crea una hoja nueva en tu unidad → Extensiones → Apps Script.
 * 2. Borra lo que haya y pega este archivo. Guarda.
 * 3. Recarga la hoja: aparece el menú «Carpetas OC».
 * 4. «1. Armar lista de carpetas» (la primera vez pide permisos: Configuración
 *    avanzada → Ir a … → Permitir).
 * 5. «2. Revisar siguiente tanda». Cada tanda dura unos 5 minutos. Para no
 *    apretarlo a mano: «Revisar solo cada 10 minutos», que se detiene al
 *    terminar.
 */

// ── Configuración ──
var ORIGEN_ID = '1tsu4HEA_o_yWdvvJCF5zhlrW_ffzMXiqtzMiRzMlxCY';
// El archivo «Bd ventas, costo y gastos» tiene muchas pestañas. Si esta se
// renombra, se busca sola la que tenga «N° OC/OS» y «LINK DE CARPETA».
var ORIGEN_PESTANA = '3. Registro Compras Grupo';
var EMPRESAS = ['INROPRIN'];     // vacío [] = todas
var ANIOS = [2026];              // vacío [] = todos
var BUSCAR_FUERA = true;         // si no hay factura adentro, buscar afuera
var MINUTOS_POR_TANDA = 4.5;     // Apps Script corta a los 6

var CAB_CARPETAS = ['ID carpeta', 'Enlace carpeta', 'OC', 'RUC', 'Proveedor',
  'Filas en la base', 'Estado', 'Archivos dentro', '¿Factura dentro?',
  'Facturas dentro', 'XML dentro', 'Facturas fuera', 'Revisado en', 'Detalle'];
var CAB_ARCHIVOS = ['OC', 'RUC', 'Proveedor', 'Enlace carpeta OC',
  'Dónde se encontró', 'Ubicación', 'Nombre del archivo', 'Enlace del archivo',
  'Tipo de archivo', 'Parece ser', 'Pistas', 'Serie-número en el nombre',
  'Creado', 'Modificado'];
var COL_ESTADO = 7; // desde aquí hasta «Detalle» lo llena la revisión

var DENTRO = 'DENTRO DE LA CARPETA';
var SUPERIOR = 'CARPETA SUPERIOR (confirmar)';
var EN_DRIVE = 'BÚSQUEDA EN DRIVE (confirmar)';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Carpetas OC')
    .addItem('1. Armar lista de carpetas', 'armarListaDeCarpetas')
    .addItem('2. Revisar siguiente tanda', 'revisarSiguienteTanda')
    .addSeparator()
    .addItem('Revisar solo cada 10 minutos', 'activarAutomatico')
    .addItem('Detener revisión automática', 'detenerAutomatico')
    .addToUi();
}

// ── 1. La lista de carpetas, sacada de la base ──

function armarListaDeCarpetas() {
  var ui = SpreadsheetApp.getUi();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaC = libro.getSheetByName('CARPETAS');
  if (hojaC && hojaC.getLastRow() > 1) {
    var r = ui.alert('Ya hay una lista',
      'Armarla de nuevo borra CARPETAS y ARCHIVOS y empieza desde cero. ¿Seguir?',
      ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }

  var hoja = pestanaDeOrigen_(SpreadsheetApp.openById(ORIGEN_ID));
  var valores = hoja.getDataRange().getValues();

  var filaCab = buscarFilaCabecera_(valores);
  var cab = valores[filaCab];
  var iOC = columna_(cab, 'N° OC/OS'), iRuc = columna_(cab, 'RUC / DNI / RUT'),
    iProv = columna_(cab, 'PROVEEDOR'), iEmp = columna_(cab, 'EMPRESA'),
    iAnio = columna_(cab, 'AÑO'), iFecha = columna_(cab, 'FECHA OC'),
    iLink = columna_(cab, 'LINK DE CARPETA');

  // El enlace puede estar como texto, como =HYPERLINK() o escondido detrás de
  // un texto («003 Orden de compra»): se leen las tres formas.
  var nFilas = valores.length - filaCab - 1;
  var rangoLink = hoja.getRange(filaCab + 2, iLink + 1, nFilas, 1);
  var ricos = rangoLink.getRichTextValues();
  var formulas = rangoLink.getFormulas();

  var porCarpeta = {}, orden = [], sinEnlace = 0;
  for (var k = 0; k < nFilas; k++) {
    var f = valores[filaCab + 1 + k];
    if (EMPRESAS.length && EMPRESAS.indexOf(String(f[iEmp]).trim()) === -1) continue;
    if (ANIOS.length && ANIOS.indexOf(anioDeFila_(f[iAnio], f[iFecha])) === -1) continue;

    var url = urlDeCelda_(f[iLink], formulas[k][0], ricos[k][0]);
    var id = idDeDrive_(url);
    if (!id) { sinEnlace++; continue; }

    if (!porCarpeta[id]) {
      porCarpeta[id] = { url: url, oc: [], ruc: [], prov: [], filas: 0 };
      orden.push(id);
    }
    var c = porCarpeta[id];
    c.filas++;
    agregarSinRepetir_(c.oc, f[iOC]);
    agregarSinRepetir_(c.ruc, f[iRuc]);
    agregarSinRepetir_(c.prov, f[iProv]);
  }

  var filas = orden.map(function (id) {
    var c = porCarpeta[id];
    return [id, c.url, c.oc.join(' / '), c.ruc.join(' / '), c.prov.join(' / '),
      c.filas, 'PENDIENTE', '', '', '', '', '', '', ''];
  });

  hojaC = prepararHoja_(libro, 'CARPETAS', CAB_CARPETAS);
  prepararHoja_(libro, 'ARCHIVOS', CAB_ARCHIVOS);
  if (filas.length) {
    hojaC.getRange(2, 1, filas.length, 1).setNumberFormat('@');
    hojaC.getRange(2, 1, filas.length, CAB_CARPETAS.length).setValues(filas);
  }
  armarResumen_(libro, sinEnlace);

  ui.alert('Lista armada',
    filas.length + ' carpetas por revisar.\n' + sinEnlace +
    ' filas de la base no tienen enlace de carpeta y no entran.\n\nSigue con «2. Revisar siguiente tanda».',
    ui.ButtonSet.OK);
}

// ── 2. Revisar carpetas, por tandas ──

function revisarSiguienteTanda() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // ya hay una tanda corriendo
  try {
    var inicio = Date.now();
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    var hojaC = libro.getSheetByName('CARPETAS');
    var hojaA = libro.getSheetByName('ARCHIVOS');
    if (!hojaC || hojaC.getLastRow() < 2) throw new Error('Primero «1. Armar lista de carpetas».');

    var lista = hojaC.getRange(2, 1, hojaC.getLastRow() - 1, CAB_CARPETAS.length).getValues();
    var archivos = [], estados = {}, hechas = 0;
    var cacheSuperior = {}; // la carpeta superior se lista una vez por tanda, no una por OC

    for (var i = 0; i < lista.length; i++) {
      if (lista[i][COL_ESTADO - 1] !== 'PENDIENTE') continue;
      if ((Date.now() - inicio) / 60000 > MINUTOS_POR_TANDA) break;

      var c = lista[i];
      var res = revisarCarpeta_(String(c[0]));
      var dentro = res.archivos;
      var facturasDentro = dentro.filter(esFactura_).length;
      var xmlDentro = dentro.filter(function (a) { return a.parece === 'XML'; }).length;

      var fuera = [];
      if (BUSCAR_FUERA && facturasDentro === 0 && res.estado !== 'SIN ACCESO') {
        fuera = buscarFuera_(String(c[2]), res.carpeta, String(c[0]), cacheSuperior);
      }

      dentro.concat(fuera).forEach(function (a) {
        archivos.push([c[2], c[3], c[4], c[1], a.donde, a.ubicacion, a.nombre, a.url,
          a.tipo, a.parece, a.pistas, a.serie, a.creado, a.modificado]);
      });
      estados[i] = [res.estado, dentro.length, facturasDentro ? 'SÍ' : 'NO',
        facturasDentro, xmlDentro, fuera.filter(esFactura_).length, new Date(), res.detalle];
      hechas++;
    }

    // Se escribe todo junto al final: si la tanda se corta a la mitad, no
    // queda una carpeta marcada como revisada sin sus archivos.
    if (archivos.length) {
      hojaA.getRange(hojaA.getLastRow() + 1, 1, archivos.length, CAB_ARCHIVOS.length).setValues(archivos);
    }
    Object.keys(estados).forEach(function (i) {
      hojaC.getRange(Number(i) + 2, COL_ESTADO, 1, estados[i].length).setValues([estados[i]]);
    });

    var pendientes = lista.filter(function (c, i) {
      return c[COL_ESTADO - 1] === 'PENDIENTE' && !estados[i];
    }).length;
    if (pendientes === 0) detenerAutomatico_();
    libro.toast(hechas + ' carpetas revisadas en esta tanda, ' + archivos.length +
      ' archivos. Faltan ' + pendientes + '.', 'Carpetas OC', 10);
  } finally {
    lock.releaseLock();
  }
}

/** Los archivos de una carpeta y todas sus subcarpetas. Nunca lanza: el problema va en `estado`. */
function revisarCarpeta_(id) {
  var archivos = [];
  var carpeta;
  try {
    carpeta = DriveApp.getFolderById(id);
    carpeta.getName(); // obliga a comprobar el acceso aquí y no más abajo
  } catch (e) {
    // El enlace puede ser de un archivo suelto y no de una carpeta.
    try {
      var suelto = DriveApp.getFileById(id);
      archivos.push(datosDeArchivo_(suelto, '(el enlace es un archivo, no una carpeta)', DENTRO, ''));
      return { estado: 'ES UN ARCHIVO', archivos: archivos, carpeta: null, detalle: '' };
    } catch (e2) {
      return { estado: 'SIN ACCESO', archivos: [], carpeta: null, detalle: String(e.message || e) };
    }
  }
  try {
    recorrer_(carpeta, carpeta.getName(), '', {}, archivos);
    return { estado: archivos.length ? 'OK' : 'VACÍA', archivos: archivos, carpeta: carpeta, detalle: '' };
  } catch (e) {
    return { estado: 'ERROR A MEDIAS', archivos: archivos, carpeta: carpeta, detalle: String(e.message || e) };
  }
}

/**
 * `sub` son solo las subcarpetas debajo de la de la OC: el nombre de la
 * carpeta principal («OC 2026 - 0115 …») no sirve de pista, porque diría
 * «orden de compra» de todo lo que tiene adentro.
 */
function recorrer_(carpeta, ruta, sub, vistas, salida) {
  var id = carpeta.getId();
  if (vistas[id]) return; // una carpeta puede colgar de dos lados
  vistas[id] = true;
  var fs = carpeta.getFiles();
  while (fs.hasNext()) salida.push(datosDeArchivo_(fs.next(), ruta, DENTRO, sub));
  var subs = carpeta.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    recorrer_(s, ruta + ' / ' + s.getName(), (sub ? sub + ' / ' : '') + s.getName(), vistas, salida);
  }
}

/**
 * Cuando la carpeta no tiene factura: archivos con el número de OC en el
 * nombre, primero en la carpeta superior y luego en todo el Drive. Solo se
 * quedan los que además parecen factura, nota o XML — lo demás es ruido.
 */
function buscarFuera_(ocTexto, carpeta, idCarpeta, cacheSuperior) {
  var hallados = [], vistos = {};
  var ocs = ocTexto.split(' / ').map(numeroDeOC_).filter(Boolean);
  if (!ocs.length) return hallados;

  var quedarse = function (f, donde, ubicacion) {
    var id = f.getId();
    if (vistos[id]) return;
    var nombre = f.getName();
    if (!ocs.some(function (oc) { return nombreMencionaOC_(nombre, oc); })) return;
    var a = datosDeArchivo_(f, ubicacion, donde);
    if (!esFactura_(a) && a.parece !== 'XML') return;
    vistos[id] = true;
    hallados.push(a);
  };

  try {
    if (carpeta) {
      var padres = carpeta.getParents();
      while (padres.hasNext()) {
        var p = padres.next();
        if (!cacheSuperior[p.getId()]) {
          var lista = [], it = p.getFiles();
          while (it.hasNext()) lista.push(it.next());
          cacheSuperior[p.getId()] = { nombre: p.getName(), archivos: lista };
        }
        var sup = cacheSuperior[p.getId()];
        sup.archivos.forEach(function (f) { quedarse(f, SUPERIOR, sup.nombre); });
      }
    }
    if (!hallados.length) {
      ocs.forEach(function (oc) {
        consultasDeDrive_(oc).forEach(function (q) {
          var it = DriveApp.searchFiles(q), n = 0;
          while (it.hasNext() && n++ < 30) {
            var f = it.next();
            quedarse(f, EN_DRIVE, rutaDe_(f));
          }
        });
      });
    }
  } catch (e) {
    // La búsqueda de afuera es una ayuda: si falla, queda lo de adentro.
  }
  return hallados;
}

function rutaDe_(f) {
  try {
    var p = f.getParents();
    return p.hasNext() ? p.next().getName() : '(sin carpeta)';
  } catch (e) {
    return '';
  }
}

/** `pistaCarpeta`: nombres de carpeta que pueden decir qué es el archivo. */
function datosDeArchivo_(f, ubicacion, donde, pistaCarpeta) {
  var nombre = f.getName(), mime = f.getMimeType(), url = f.getUrl();
  // Un acceso directo apunta a otro archivo: se anota el de verdad.
  if (mime === 'application/vnd.google-apps.shortcut') {
    try {
      var real = DriveApp.getFileById(f.getTargetId());
      nombre = real.getName() + ' (acceso directo)';
      mime = real.getMimeType();
      url = real.getUrl();
    } catch (e) {
      nombre += ' (acceso directo sin acceso)';
    }
  }
  var c = clasificar_(nombre, pistaCarpeta == null ? ubicacion : pistaCarpeta, mime);
  return {
    donde: donde, ubicacion: ubicacion, nombre: nombre, url: url,
    tipo: tipoLegible_(mime, nombre), parece: c.parece, pistas: c.pistas.join(', '),
    serie: c.serie, creado: f.getDateCreated(), modificado: f.getLastUpdated()
  };
}

// ── Revisión automática ──

function activarAutomatico() {
  detenerAutomatico_();
  ScriptApp.newTrigger('revisarSiguienteTanda').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Revisará una tanda cada 10 minutos y se detendrá solo al terminar.', 'Carpetas OC', 8);
}

function detenerAutomatico() {
  detenerAutomatico_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Revisión automática detenida.', 'Carpetas OC', 5);
}

function detenerAutomatico_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarSiguienteTanda') ScriptApp.deleteTrigger(t);
  });
}

// ── Qué parece ser cada archivo (sin llamadas a Google: se prueba suelto) ──

// En orden: gana la primera que calce. «PAGO FACTURA F001-123» sale FACTURA,
// pero en «Pistas» quedan las dos palabras para que una persona decida.
var CATEGORIAS = [
  { parece: 'NOTA DE CRÉDITO', frases: ['NOTA DE CREDITO', 'NOTA CREDITO'], palabras: ['NC'] },
  { parece: 'NOTA DE DÉBITO', frases: ['NOTA DE DEBITO', 'NOTA DEBITO'], palabras: ['ND'] },
  { parece: 'FACTURA', frases: ['FACTURA ELECTRONICA'], palabras: ['FACTURA', 'FACTURAS', 'FACT', 'FAC', 'FACTU', 'FACTS', 'FT', 'FTS', 'FE'], parecidas: ['FACTURA', 'FACTURAS', 'FACTURACION'] },
  { parece: 'BOLETA', frases: [], palabras: ['BOLETA', 'BOLETAS', 'BV'], parecidas: ['BOLETA'] },
  { parece: 'RECIBO POR HONORARIOS', frases: ['RECIBO POR HONORARIOS', 'RECIBO HONORARIOS'], palabras: ['RH', 'RHE', 'HONORARIOS'], parecidas: ['HONORARIOS'] },
  { parece: 'COMPROBANTE (revisar)', frases: [], palabras: ['COMPROBANTE', 'COMPROBANTES', 'CPE'], parecidas: ['COMPROBANTE'] },
  { parece: 'DETRACCIÓN', frases: [], palabras: ['DETRACCION', 'DETRACCIONES', 'SPOT'], parecidas: ['DETRACCION'] },
  { parece: 'PAGO', frases: [], palabras: ['PAGO', 'PAGOS', 'VOUCHER', 'TRANSFERENCIA', 'CONSTANCIA', 'DEPOSITO', 'ABONO', 'ADELANTO'], parecidas: ['TRANSFERENCIA'] },
  { parece: 'GUÍA', frases: ['GUIA DE REMISION'], palabras: ['GUIA', 'GUIAS', 'GR', 'REMISION'], parecidas: ['REMISION'] },
  { parece: 'COTIZACIÓN', frases: [], palabras: ['COTIZACION', 'COTIZACIONES', 'PROFORMA', 'COT'], parecidas: ['COTIZACION'] },
  { parece: 'ORDEN DE COMPRA/SERVICIO', frases: ['ORDEN DE COMPRA', 'ORDEN DE SERVICIO'], palabras: ['OC', 'OS'] },
  { parece: 'REQUERIMIENTO', frases: [], palabras: ['REQUERIMIENTO', 'REQ'], parecidas: ['REQUERIMIENTO'] },
  { parece: 'DATOS BANCARIOS', frases: ['CUENTA BANCARIA', 'CUENTAS BANCARIAS'], palabras: ['CCI'] }
];

/**
 * Mira el nombre del archivo primero y, si no dice nada, la carpeta donde
 * está («Facturas / scan001.pdf» cuenta como factura).
 */
function clasificar_(nombre, ubicacion, mime) {
  var n = textoPlano_(nombre);
  var ext = (/\.([a-z0-9]{2,5})$/i.exec(nombre || '') || [])[1];
  ext = ext ? ext.toUpperCase() : '';
  var serie = serieEnNombre_(nombre);
  var pistas = pistasEn_(n);

  var parece = '';
  if (ext === 'XML' || /xml/.test(mime || '')) parece = /^R-/i.test(nombre) ? 'CDR (constancia SUNAT)' : 'XML';
  else if (ext === 'ZIP' && /^R-/i.test(nombre)) parece = 'CDR (constancia SUNAT)';
  if (!parece && pistas.length) parece = pistas[0].parece;
  if (!parece && serie) {
    parece = /^F/.test(serie) ? 'FACTURA' : /^B/.test(serie) ? 'BOLETA' : 'FACTURA o RH (serie E)';
    pistas.push({ parece: parece, palabra: serie });
  }
  if (!parece) {
    var enCarpeta = pistasEn_(textoPlano_(ubicacion));
    if (enCarpeta.length) {
      parece = enCarpeta[0].parece + ' (por la carpeta)';
      pistas = pistas.concat(enCarpeta);
    }
  }
  return {
    parece: parece || 'OTRO',
    pistas: pistas.map(function (p) { return p.palabra; }).filter(function (p, i, a) { return a.indexOf(p) === i; }),
    serie: serie
  };
}

/** Las categorías que calzan con un texto, en orden, con la palabra que las delató. */
function pistasEn_(texto) {
  var palabras = texto.split(' ').filter(Boolean);
  var salida = [];
  CATEGORIAS.forEach(function (cat) {
    var hallada = '';
    cat.frases.forEach(function (fr) { if (!hallada && (' ' + texto + ' ').indexOf(' ' + fr + ' ') !== -1) hallada = fr; });
    palabras.forEach(function (p) {
      if (hallada) return;
      if (cat.palabras.indexOf(p) !== -1) hallada = p;
      else if ((cat.parecidas || []).some(function (q) { return seParece_(p, q); })) hallada = p + ' (≈' + cat.parecidas[0] + ')';
    });
    if (hallada) salida.push({ parece: cat.parece, palabra: hallada });
  });
  return salida;
}

/** F001-00018178, E001 179, FA01_123 → «F001-18178». Vacío si el nombre no trae una. */
function serieEnNombre_(nombre) {
  var t = String(nombre || '').toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, '');
  var m = /(?:^|[^A-Z0-9])([FBE][A-Z0-9]{3})\s*[-_ ]\s*0*(\d{1,8})(?!\d)/.exec(t);
  if (!m || !/\d/.test(m[1])) return '';
  return m[1] + '-' + m[2];
}

function esFactura_(a) {
  return /^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)/.test(a.parece);
}

/** «0115-2026», «OC 115-2026» → { num: 115, anio: 2026 }. */
function numeroDeOC_(texto) {
  var m = /(\d{1,6})\s*-\s*(20\d\d)/.exec(String(texto || ''));
  return m ? { num: Number(m[1]), anio: m[2] } : null;
}

/** Si el nombre menciona la OC en cualquier orden: 0115-2026, 115-2026, 2026-0115, OC2026-0115. */
function nombreMencionaOC_(nombre, oc) {
  var t = String(nombre || '');
  var n = String(oc.num), a = oc.anio;
  var r1 = new RegExp('(^|\\D)0*' + n + '\\s*[-_ ]\\s*' + a + '(\\D|$)');
  var r2 = new RegExp('(^|\\D)' + a + '\\s*[-_ ]\\s*0*' + n + '(\\D|$)');
  return r1.test(t) || r2.test(t);
}

function consultasDeDrive_(oc) {
  var n4 = ('0000' + oc.num).slice(-4);
  var formas = [n4 + '-' + oc.anio, oc.anio + '-' + n4];
  if (String(oc.num) !== n4) formas.push(oc.num + '-' + oc.anio);
  return formas.map(function (f) { return 'title contains "' + f + '" and trashed = false'; });
}

// ── Ayudas ──

/** Sin tildes, en mayúsculas, con signos y guiones convertidos en espacios. */
function textoPlano_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, '').replace(/[^A-Z0-9]+/g, ' ')
    // «OC0115» o «FACTURA001» → se separan letras de números para ver la palabra
    .replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').trim();
}

// Palabras que se parecen a una pista pero no lo son.
var NO_SON = ['FACTOR', 'FACTORES', 'FACIL', 'FACHADA', 'BOLETIN', 'REMISOR'];

/**
 * Error de tipeo tolerado: 1 letra en palabras de 5 o más, 2 letras si además
 * empieza igual (FACUTAS → FACTURAS, FATCURA → FACTURA).
 */
function seParece_(p, q) {
  if (p.length < 5 || NO_SON.indexOf(p) !== -1) return false;
  var d = distancia_(p, q);
  return d <= 1 || (d <= 2 && p.length >= 6 && p.slice(0, 3) === q.slice(0, 3));
}

/** Cuántas letras hay que cambiar, agregar, quitar o voltear para pasar de una palabra a otra. */
function distancia_(a, b) {
  var d = [], i, j;
  for (i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (j = 0; j <= b.length; j++) { d[0][j] = j; }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Compara títulos sin tildes, espacios ni signos: «N° OC/OS» = «Nº OC / OS». */
function normalizar_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** La pestaña de compras: por su nombre o, si cambió, por sus columnas. */
function pestanaDeOrigen_(origen) {
  var porNombre = origen.getSheetByName(ORIGEN_PESTANA);
  if (porNombre) return porNombre;
  var hojas = origen.getSheets();
  var oc = normalizar_('N° OC/OS'), link = normalizar_('LINK DE CARPETA');
  for (var i = 0; i < hojas.length; i++) {
    var h = hojas[i];
    if (h.getLastRow() < 2 || h.getLastColumn() < 2) continue;
    var arriba = h.getRange(1, 1, Math.min(10, h.getLastRow()), h.getLastColumn()).getValues();
    var tiene = function (buscado) {
      return arriba.some(function (fila) { return fila.some(function (v) { return normalizar_(v) === buscado; }); });
    };
    if (tiene(oc) && tiene(link)) return h;
  }
  throw new Error('No encontré la pestaña «' + ORIGEN_PESTANA + '» ni otra con las columnas «N° OC/OS» y «LINK DE CARPETA». ' +
    'Pestañas del archivo: ' + hojas.map(function (h) { return h.getName(); }).join(' · '));
}

function buscarFilaCabecera_(valores) {
  var buscado = normalizar_('LINK DE CARPETA');
  for (var i = 0; i < Math.min(10, valores.length); i++) {
    if (valores[i].some(function (v) { return normalizar_(v) === buscado; })) return i;
  }
  throw new Error('No encontré la fila de títulos (con «LINK DE CARPETA») en las primeras 10 filas.');
}

function columna_(cab, nombre) {
  var n = normalizar_(nombre);
  for (var i = 0; i < cab.length; i++) if (normalizar_(cab[i]) === n) return i;
  throw new Error('La base no trae la columna «' + nombre + '».');
}

/** El año de la OC: la columna AÑO si es un número; si viene corrida, el de FECHA OC. */
function anioDeFila_(anio, fecha) {
  var n = Number(anio);
  if (n >= 2000 && n <= 2100) return n;
  if (fecha && typeof fecha.getFullYear === 'function') return fecha.getFullYear();
  return null;
}

function urlDeCelda_(valor, formula, rico) {
  var texto = String(valor || '');
  if (/https?:\/\//.test(texto)) return texto.trim();
  var m = /HYPERLINK\(\s*"([^"]+)"/i.exec(formula || '');
  if (m) return m[1];
  if (rico) {
    if (rico.getLinkUrl()) return rico.getLinkUrl();
    var partes = rico.getRuns();
    for (var i = 0; i < partes.length; i++) if (partes[i].getLinkUrl()) return partes[i].getLinkUrl();
  }
  return '';
}

/** Saca el ID de un enlace de Drive: …/folders/ID, …/file/d/ID, …?id=ID. */
function idDeDrive_(url) {
  var m = /\/folders\/([\w-]{20,})/.exec(url) || /\/d\/([\w-]{20,})/.exec(url) ||
    /[?&]id=([\w-]{20,})/.exec(url);
  return m ? m[1] : '';
}

function agregarSinRepetir_(lista, v) {
  var s = String(v == null ? '' : v).trim();
  if (s && s !== '-' && lista.indexOf(s) === -1) lista.push(s);
}

function tipoLegible_(mime, nombre) {
  var tipos = {
    'application/pdf': 'PDF', 'text/xml': 'XML', 'application/xml': 'XML',
    'application/zip': 'ZIP', 'image/jpeg': 'Imagen', 'image/png': 'Imagen',
    'application/vnd.google-apps.document': 'Documento de Google',
    'application/vnd.google-apps.spreadsheet': 'Hoja de Google',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word'
  };
  if (tipos[mime]) return tipos[mime];
  var ext = /\.([a-z0-9]{2,5})$/i.exec(nombre || '');
  return ext ? ext[1].toUpperCase() : mime;
}

function prepararHoja_(libro, nombre, cabeceras) {
  var h = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  h.clear();
  h.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras])
    .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
  h.setFrozenRows(1);
  return h;
}

/** El resumen son fórmulas sobre CARPETAS: se actualiza solo con cada tanda. */
function armarResumen_(libro, sinEnlace) {
  var h = libro.getSheetByName('RESUMEN') || libro.insertSheet('RESUMEN');
  h.clear();
  var filas = [
    ['Resumen de la captura', ''],
    ['', ''],
    ['Carpetas en la lista', '=COUNTA(CARPETAS!A2:A)'],
    ['Ya revisadas', '=COUNTIF(CARPETAS!G2:G,"<>PENDIENTE")-COUNTBLANK(CARPETAS!G2:G)'],
    ['Pendientes', '=COUNTIF(CARPETAS!G2:G,"PENDIENTE")'],
    ['', ''],
    ['Con factura dentro de la carpeta', '=COUNTIF(CARPETAS!I2:I,"SÍ")'],
    ['Sin factura dentro, pero encontrada fuera', '=COUNTIFS(CARPETAS!I2:I,"NO",CARPETAS!L2:L,">0")'],
    ['Sin factura en ningún lado', '=COUNTIFS(CARPETAS!I2:I,"NO",CARPETAS!L2:L,0)'],
    ['Con XML dentro', '=COUNTIF(CARPETAS!K2:K,">0")'],
    ['Carpetas vacías', '=COUNTIF(CARPETAS!G2:G,"VACÍA")'],
    ['Sin acceso', '=COUNTIF(CARPETAS!G2:G,"SIN ACCESO")'],
    ['', ''],
    ['Filas de la base sin enlace de carpeta', sinEnlace]
  ];
  h.getRange(1, 1, filas.length, 2).setValues(filas);
  h.getRange('A1').setFontWeight('bold').setFontSize(14);
  h.setColumnWidth(1, 320);
}
