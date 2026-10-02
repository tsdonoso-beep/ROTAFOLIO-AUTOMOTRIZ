/**
 * La carpeta madre de compras, en la hoja GENERAL
 * --------------------------------------------------------------------------
 *
 * Trae de la base (función carpetas_madre) lo que el robot de cada noche
 * (`scripts/carpetas-oc.mts`, 02:00) leyó de las dos carpetas madre de
 * compras: «5. Ordenes de Compra» (nacionales) e importaciones. Una fila por
 * carpeta de OC:
 *   · a quién le toca completarlo: el área (nacionales → Compras
 *     nacionales; importaciones → COMEX) y, si el legajo por OC lo sabe, el
 *     comprador, la situación del pago y la forma de pago;
 *   · su legajo: qué documentos tiene, qué le falta y su estado;
 *   · su centro de costo y de dónde salió (CG, cuadro, su carpeta de
 *     proyecto, el nombre de la carpeta o el área administrativa);
 *   · las facturas de SUNAT que ya quedaron unidas a la OC;
 *   · si está en la base de Control de Gestión (CG) y el último cambio que
 *     vio el robot (archivo nuevo, eliminado, completó, ahora le falta…).
 *
 * Y las facturas de SUNAT que no están unidas a ninguna OC pero aparentan
 * que deberían (función facturas_sin_oc): ALTA si el proveedor trabaja con
 * OC; MEDIA si el monto es alto y no es un gasto típico sin OC (bancos,
 * seguros, combustible, pasajes, comida…).
 *
 * Deja tres pestañas: CARPETA MADRE (el detalle), FACTURAS SIN OC y CARPETA
 * MADRE - RESUMEN. Las reemplaza cada vez: no escribas a mano en ellas.
 *
 * ── Para actualizar una versión anterior ──
 * Abre CarpetaMadre.gs en Apps Script, borra todo, pega esta versión y
 * guarda. Después ejecuta «instalarCarpetaMadre» una vez más: cambia el
 * horario fijo de antes por la revisión de cada hora.
 *
 * ── Instalación (una sola vez) ──
 * 1. Abre la hoja GENERAL → Extensiones → Apps Script.
 * 2. + → Script → nómbralo «CarpetaMadre» → borra lo que trae, pega esto y
 *    guarda (ícono del disquete).
 * 3. Engranaje (Configuración del proyecto) → Propiedades del script. Si ya
 *    están SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE (las
 *    usa SubirLegajo.gs), no hagas nada; si no, agrégalas con los mismos
 *    valores de SubirCapturaOC.gs / OrdenarCPE.gs.
 * 4. Arriba, en la lista de funciones, elige «instalarCarpetaMadre» → Ejecutar
 *    → acepta los permisos. Trae los datos en ese momento, agrega el menú
 *    «Carpeta madre» a la hoja y la deja revisando cada hora: apenas el
 *    robot de las carpetas lee algo nuevo (01:17 y 11:47, o cuando GitHub lo
 *    deje correr), la hoja se pone al día.
 */

var CM_HOJA = 'CARPETA MADRE';
var CM_HOJA_RESUMEN = 'CARPETA MADRE - RESUMEN';
var CM_HOJA_SIN_OC = 'FACTURAS SIN OC';
var CM_RUC = '20512201611';
// Se revisa sola cada hora, pero solo reescribe las pestañas cuando el robot
// de las carpetas leyó algo nuevo (corre a las 01:17 y a las 11:47, aunque
// GitHub a veces lo atrasa horas): así la hoja se pone al día apenas termina.
// Además, una vez al día a esta hora se reescribe igual (para el resumen y la
// hora de «traído de la base»).
var CM_HORA_SIEMPRE = 7;
// Si la última lectura del robot es más vieja que esto, alguna corrida falló:
// se avisa en el resumen (los pendientes pueden estar desactualizados).
var CM_HORAS_SIN_LECTURA = 20;
var CM_PAGINA = 1000;

var CM_COLUMNAS = [
  ['Procedencia', 'procedencia'],
  ['OC', 'oc'],
  ['Área responsable', 'area_responsable'],
  ['Comprador', 'comprador'],
  ['Situación del pago', 'situacion_pago'],
  ['Forma de pago', 'forma_pago'],
  ['Tipo', 'tipo'],
  ['Proveedor', 'proveedor'],
  ['Proyecto (carpeta)', 'proyecto_carpeta'],
  ['Carpeta de la OC', 'carpeta_nombre'],
  ['Legajo', 'estado'],
  ['Le falta', 'le_falta'],
  ['Documentos en la carpeta', 'documentos'],
  ['Archivos', 'archivos'],
  ['Comprobantes en la carpeta', 'series'],
  ['Facturas SUNAT unidas', 'facturas_sunat'],
  ['N.º facturas SUNAT', 'facturas_sunat_n'],
  ['Centro de costo (código)', 'cc_codigo'],
  ['Centro de costo', 'cc_nombre'],
  ['Centro de costo según', 'centro_costo_segun'],
  ['¿Está en CG?', 'en_cg'],
  ['Último cambio', 'ultimo_cambio'],
  ['Fecha del último cambio', 'ultimo_cambio_fecha'],
  ['La misma OC en otra carpeta', 'misma_oc_en_otra_carpeta'],
  ['Leída por el robot', 'cargado_en']
];

/** La primera vez: trae los datos, pone el menú y lo programa cada mañana. */
function instalarCarpetaMadre() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'traerCarpetaMadreSola' || f === 'menuCarpetaMadre') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('traerCarpetaMadreSola').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('menuCarpetaMadre').forSpreadsheet(libro).onOpen().create();
  var r = traerCarpetaMadre_();
  try {
    menuCarpetaMadre();
    var ui = SpreadsheetApp.getUi();
    ui.alert(r.error ? 'Instalado, pero no se pudo traer' : 'Instalado', (r.error || r.texto) +
      '\n\nSe pondrá al día sola apenas el robot lea las carpetas (revisa cada hora), y queda el menú «Carpeta madre».', ui.ButtonSet.OK);
  } catch (e) {
    // Corrido desde el editor sin la hoja abierta: no hay ventana, el resultado va al registro.
    Logger.log(r.error || r.texto);
  }
  if (r.error) throw new Error(r.error);
}

/** El menú «Carpeta madre» (se agrega solo al abrir la hoja). */
function menuCarpetaMadre() {
  SpreadsheetApp.getUi().createMenu('Carpeta madre')
    .addItem('Traer ahora de la base', 'traerCarpetaMadre')
    .addItem('Dejar de traerla sola', 'quitarCarpetaMadre')
    .addToUi();
}

function quitarCarpetaMadre() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'traerCarpetaMadreSola') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getUi().alert('Listo: ya no se trae sola. Puedes traerla a mano desde el menú «Carpeta madre».');
}

/** Desde el menú: trae y avisa. */
function traerCarpetaMadre() {
  var r = traerCarpetaMadre_();
  var ui = SpreadsheetApp.getUi();
  if (r.error) ui.alert('No se pudo traer la carpeta madre', r.error, ui.ButtonSet.OK);
  else ui.alert('Carpeta madre actualizada', r.texto, ui.ButtonSet.OK);
}

/**
 * La automática, cada hora y sin ventanas (nadie las vería): reescribe solo
 * si el robot leyó algo desde la última vez, o una vez al día a las
 * CM_HORA_SIEMPRE.
 */
function traerCarpetaMadreSola() {
  var props = PropertiesService.getDocumentProperties();
  var hora = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var obligatoria = hora === CM_HORA_SIEMPRE && props.getProperty('CM_ULTIMO_DIA') !== hoy;
  var r = traerCarpetaMadre_(obligatoria ? null : props.getProperty('CM_ULTIMA_LECTURA'));
  if (r.error) throw new Error(r.error); // queda en Ejecuciones y Google avisa por correo
  if (!r.sinCambios && obligatoria) props.setProperty('CM_ULTIMO_DIA', hoy);
}

/**
 * Trae y escribe las pestañas. Con `siNoEs` (la última lectura del robot que
 * ya está en la hoja), si el robot no leyó nada nuevo no escribe nada y
 * devuelve { sinCambios: true }.
 */
function traerCarpetaMadre_(siNoEs) {
  var cfg = configuracionCarpetaMadre_();
  var faltan = ['supabaseUrl', 'anonKey', 'robotCorreo', 'robotClave'].filter(function (k) { return !cfg[k]; });
  if (faltan.length) {
    return { error: 'Faltan las Propiedades del script: ' + faltan.join(', ') +
      '. En Apps Script → engranaje → Propiedades del script (las mismas de SubirLegajo.gs).' };
  }
  try {
    var token = sesionCarpetaMadre_(cfg);
    var filas = [];
    for (var desde = 0; ; desde += CM_PAGINA) {
      var parte = rpcCarpetaMadre_(cfg, token, 'carpetas_madre', { p_empresa_ruc: CM_RUC },
        '?order=procedencia.desc,oc,carpeta_url&limit=' + CM_PAGINA + '&offset=' + desde);
      filas = filas.concat(parte);
      if (parte.length < CM_PAGINA) break;
    }
    if (!filas.length) return { error: 'La base no devolvió carpetas: ¿ya corrió el robot de las carpetas?' };
    var ultimaLectura = filas.reduce(function (m, f) { return f.cargado_en && f.cargado_en > m ? f.cargado_en : m; }, '');
    if (siNoEs && ultimaLectura === siNoEs) return { sinCambios: true };
    // Solo las que aparentan que les falta la OC (ALTA y MEDIA).
    var sinOc = [];
    for (var d2 = 0; ; d2 += CM_PAGINA) {
      var p2 = rpcCarpetaMadre_(cfg, token, 'facturas_sin_oc', { p_empresa_ruc: CM_RUC },
        '?senal=in.(ALTA,MEDIA)&order=senal,total.desc,proveedor_ruc,serie,numero&limit=' + CM_PAGINA + '&offset=' + d2);
      sinOc = sinOc.concat(p2);
      if (p2.length < CM_PAGINA) break;
    }
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    escribirDetalleCarpetaMadre_(libro, filas);
    escribirFacturasSinOc_(libro, sinOc);
    var texto = escribirResumenCarpetaMadre_(libro, filas, sinOc);
    PropertiesService.getDocumentProperties().setProperty('CM_ULTIMA_LECTURA', ultimaLectura);
    return { texto: texto };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// ── Las pestañas ──

function escribirDetalleCarpetaMadre_(libro, filas) {
  var hoja = libro.getSheetByName(CM_HOJA) || libro.insertSheet(CM_HOJA);
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  var zona = Session.getScriptTimeZone();
  var valores = [CM_COLUMNAS.map(function (c) { return c[0]; })].concat(filas.map(function (f) {
    return CM_COLUMNAS.map(function (c) {
      var v = f[c[1]];
      if (v == null) return '';
      if (c[1] === 'en_cg') return f.procedencia === 'Importación' ? 'No aplica (cuadro)' : v ? 'Sí' : 'No';
      if (c[1] === 'comprador' && !v) return 'Por identificar';
      if (c[1] === 'ultimo_cambio_fecha' || c[1] === 'cargado_en') return Utilities.formatDate(new Date(v), zona, 'dd/MM/yyyy HH:mm');
      if (typeof v === 'string') return v.trim();
      return v;
    });
  }));
  // Todo como texto (que «0001-2026» no se vuelva fecha), menos los números.
  hoja.getRange(1, 1, valores.length, CM_COLUMNAS.length).setNumberFormat('@');
  [cmCol_('archivos'), cmCol_('facturas_sunat_n')].forEach(function (c) {
    hoja.getRange(2, c, Math.max(valores.length - 1, 1), 1).setNumberFormat('0');
  });
  hoja.getRange(1, 1, valores.length, CM_COLUMNAS.length).setValues(valores);

  // El nombre de la carpeta, con su enlace.
  var cCarpeta = cmCol_('carpeta_nombre');
  var enlaces = filas.map(function (f) {
    var t = String(f.carpeta_nombre || 'abrir').trim();
    var r = SpreadsheetApp.newRichTextValue().setText(t);
    if (f.carpeta_url) r.setLinkUrl(f.carpeta_url);
    return [r.build()];
  });
  hoja.getRange(2, cCarpeta, enlaces.length, 1).setRichTextValues(enlaces);

  // Colores del legajo, como en la vista del legajo.
  var cEstado = cmCol_('estado');
  var fondos = filas.map(function (f) {
    var color = f.estado === 'OK' ? '#d9ead3' : f.estado === 'VACÍA' ? '#efefef' : '#fce5cd';
    return CM_COLUMNAS.map(function (_, i) { return i + 1 === cEstado ? color : null; });
  });
  hoja.getRange(2, 1, fondos.length, CM_COLUMNAS.length).setBackgrounds(fondos);

  hoja.getRange(1, 1, 1, CM_COLUMNAS.length).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff').setWrap(true);
  hoja.setFrozenRows(1);
  hoja.setFrozenColumns(2);
  hoja.getRange(1, 1, valores.length, CM_COLUMNAS.length).createFilter();
  hoja.autoResizeColumns(1, 4);
  ['proyecto_carpeta', 'carpeta_nombre', 'le_falta', 'documentos', 'series', 'facturas_sunat', 'cc_nombre',
    'centro_costo_segun', 'ultimo_cambio', 'misma_oc_en_otra_carpeta'].forEach(function (k) { hoja.setColumnWidth(cmCol_(k), 220); });
}

/**
 * Si la última lectura del robot es vieja, la corrida de la noche (o la del
 * mediodía) falló o quedó a medias: lo que se subió desde entonces todavía
 * figura como pendiente. Vacío si está al día.
 */
function avisoDeLectura_(filas) {
  // La última lectura de cada carpeta madre (nacionales e importaciones
  // corren por separado: una puede fallar y la otra no).
  var ultima = {};
  filas.forEach(function (f) {
    if (f.cargado_en && (!ultima[f.procedencia] || f.cargado_en > ultima[f.procedencia])) ultima[f.procedencia] = f.cargado_en;
  });
  var viejas = Object.keys(ultima).filter(function (p) {
    return (Date.now() - new Date(ultima[p]).getTime()) / 3600000 > CM_HORAS_SIN_LECTURA;
  });
  if (!viejas.length) return '';
  return viejas.map(function (p) {
    return 'el robot no lee ' + (p === 'Importación' ? 'importaciones' : 'nacionales') + ' desde el ' +
      Utilities.formatDate(new Date(ultima[p]), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  }).join('; ') + ': lo subido desde entonces puede figurar como pendiente.';
}

function cmCol_(campo) {
  for (var i = 0; i < CM_COLUMNAS.length; i++) if (CM_COLUMNAS[i][1] === campo) return i + 1;
  throw new Error('Columna desconocida: ' + campo);
}

/** Cuántas carpetas, cuántas completas, qué falta y cuántas tienen factura de SUNAT. */
function escribirResumenCarpetaMadre_(libro, filas, sinOc) {
  var grupos = ['Nacional', 'Importación', 'Total'];
  var cuenta = {};
  grupos.forEach(function (g) {
    cuenta[g] = { carpetas: 0, ocs: {}, ok: 0, incompletas: 0, vacias: 0, conFactura: 0, enCg: 0,
      factura: 0, guia: 0, acta: 0, dam: 0, sinCc: 0, fuentes: {} };
  });
  filas.forEach(function (f) {
    [f.procedencia, 'Total'].forEach(function (g) {
      var c = cuenta[g];
      if (!c) return;
      c.carpetas++;
      c.ocs[f.oc] = true;
      if (f.estado === 'OK') c.ok++; else if (f.estado === 'VACÍA') c.vacias++; else c.incompletas++;
      if (f.facturas_sunat_n > 0) c.conFactura++;
      if (f.en_cg) c.enCg++;
      var falta = String(f.le_falta || '');
      if (/Factura/.test(falta)) c.factura++;
      if (/Guía/.test(falta)) c.guia++;
      if (/Acta/.test(falta)) c.acta++;
      if (/DAM/.test(falta)) c.dam++;
      if (!f.cc_nombre) c.sinCc++;
      var s = f.centro_costo_segun || 'Sin asignar';
      c.fuentes[s] = (c.fuentes[s] || 0) + 1;
    });
  });

  var zona = Session.getScriptTimeZone();
  var ahora = Utilities.formatDate(new Date(), zona, 'dd/MM/yyyy HH:mm');
  var aviso = avisoDeLectura_(filas);
  var fila = function (nombre, fn) { return [nombre].concat(grupos.map(function (g) { return fn(cuenta[g]); })); };
  var tabla = [
    ['Carpeta madre de compras — traído de la base el ' + ahora + (aviso ? ' — ⚠ ' + aviso : ''), '', '', ''],
    ['', 'Nacional', 'Importación', 'Total'],
    fila('Carpetas de OC', function (c) { return c.carpetas; }),
    fila('OC distintas', function (c) { return Object.keys(c.ocs).length; }),
    fila('Legajo completo', function (c) { return c.ok; }),
    fila('Legajo incompleto', function (c) { return c.incompletas; }),
    fila('Carpeta vacía', function (c) { return c.vacias; }),
    fila('   … les falta la factura', function (c) { return c.factura; }),
    fila('   … les falta la guía de remisión', function (c) { return c.guia; }),
    fila('   … les falta el acta de conformidad', function (c) { return c.acta; }),
    fila('   … les falta la DAM', function (c) { return c.dam; }),
    fila('Con factura de SUNAT unida', function (c) { return c.conFactura; }),
    fila('Están en la base de CG', function (c) { return c.enCg; }),
    fila('Sin centro de costo', function (c) { return c.sinCc; }),
    ['', '', '', ''],
    ['Centro de costo según', '', '', '']
  ];
  var fuentes = {};
  grupos.forEach(function (g) { Object.keys(cuenta[g].fuentes).forEach(function (s) { fuentes[s] = true; }); });
  Object.keys(fuentes).sort(function (a, b) { return cuenta.Total.fuentes[b] - cuenta.Total.fuentes[a]; }).forEach(function (s) {
    tabla.push(fila(s, function (c) { return c.fuentes[s] || 0; }));
  });

  // Las facturas de SUNAT que aparentan no tener OC, por área probable.
  var porArea = { 'Compras nacionales': 'Nacional', 'COMEX (importaciones)': 'Importación' };
  var sinOcDe = function (senal, campo) {
    return function (c, g) {
      return sinOc.filter(function (x) {
        return x.senal === senal && (g === 'Total' || porArea[x.area_probable] === g);
      }).reduce(function (s, x) {
        return s + (campo ? (Number(x[campo]) || 0) * (x.moneda === 'USD' ? 3.75 : 1) : 1);
      }, 0);
    };
  };
  var filaG = function (nombre, fn) { return [nombre].concat(grupos.map(function (g) { return fn(cuenta[g], g); })); };
  var titulos = [tabla.length + 1];
  tabla.push(['', '', '', '']);
  titulos.push(tabla.length + 1);
  tabla.push(['Facturas de SUNAT que aparentan no tener OC (pestaña ' + CM_HOJA_SIN_OC + ')', '', '', '']);
  tabla.push(filaG('ALTA: el proveedor trabaja con OC', sinOcDe('ALTA')));
  tabla.push(filaG('   … monto aprox. en soles (dólares × 3,75)', function (c, g) { return Math.round(sinOcDe('ALTA', 'total')(c, g)); }));
  tabla.push(filaG('MEDIA: monto alto, no es gasto típico sin OC', sinOcDe('MEDIA')));
  tabla.push(filaG('   … monto aprox. en soles (dólares × 3,75)', function (c, g) { return Math.round(sinOcDe('MEDIA', 'total')(c, g)); }));

  // Por comprador, cuando se sabe (del legajo por OC): para el ranking.
  var porComprador = {};
  filas.forEach(function (f) {
    var k = f.comprador || '';
    if (!k) return;
    var c = porComprador[k] || (porComprador[k] = { area: f.area_responsable, n: 0, ok: 0 });
    c.n++;
    if (f.estado === 'OK') c.ok++;
  });
  tabla.push(['', '', '', '']);
  titulos.push(tabla.length + 1);
  tabla.push(['Por comprador (solo las OC donde se sabe)', 'Área', 'Carpetas', '% completo']);
  Object.keys(porComprador).sort(function (a, b) {
    return porComprador[b].ok / porComprador[b].n - porComprador[a].ok / porComprador[a].n;
  }).forEach(function (k) {
    var c = porComprador[k];
    tabla.push([k, c.area, c.n, Math.round(100 * c.ok / c.n) + '%']);
  });
  var sinComprador = filas.filter(function (f) { return !f.comprador; }).length;
  tabla.push(['Comprador por identificar', '', sinComprador, '']);

  var hoja = libro.getSheetByName(CM_HOJA_RESUMEN) || libro.insertSheet(CM_HOJA_RESUMEN);
  hoja.clear();
  hoja.getRange(1, 1, tabla.length, 4).setValues(tabla);
  hoja.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  hoja.getRange(2, 1, 1, 4).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff');
  hoja.getRange(16, 1).setFontWeight('bold');
  titulos.forEach(function (r) { hoja.getRange(r, 1, 1, 4).setFontWeight('bold'); });
  hoja.setColumnWidth(1, 330);

  if (aviso) hoja.getRange(1, 1).setFontColor('#cc0000');
  var t = cuenta.Total;
  return (aviso ? '⚠ ' + aviso + '\n\n' : '') + t.carpetas + ' carpetas de OC (' + cuenta.Nacional.carpetas + ' nacionales, ' + cuenta['Importación'].carpetas +
    ' de importación): ' + t.ok + ' con el legajo completo, ' + t.incompletas + ' incompletas, ' + t.vacias +
    ' vacías; ' + t.conFactura + ' con factura de SUNAT unida.\n\n' +
    sinOc.filter(function (x) { return x.senal === 'ALTA'; }).length + ' facturas de SUNAT aparentan no tener OC (ALTA) y ' +
    sinOc.filter(function (x) { return x.senal === 'MEDIA'; }).length + ' más para revisar (MEDIA).\n\nPestañas «' + CM_HOJA + '», «' +
    CM_HOJA_SIN_OC + '» y «' + CM_HOJA_RESUMEN + '».';
}

var CM_COLUMNAS_SIN_OC = [
  ['Señal', 'senal'],
  ['Por qué', 'razon'],
  ['Área probable', 'area_probable'],
  ['Comprador probable', 'comprador_probable'],
  ['Fecha de emisión', 'fecha_emision'],
  ['RUC proveedor', 'proveedor_ruc'],
  ['Proveedor', 'proveedor_nombre'],
  ['Serie', 'serie'],
  ['Número', 'numero'],
  ['Moneda', 'moneda'],
  ['Total', 'total'],
  ['Facturas del proveedor', 'facturas_del_proveedor'],
  ['…con OC', 'con_oc_del_proveedor'],
  ['OC del proveedor', 'ocs_del_proveedor'],
  ['PDF', 'enlace_pdf']
];

/** Las facturas de SUNAT sin OC que aparentan necesitarla: primero las ALTA, de mayor a menor monto. */
function escribirFacturasSinOc_(libro, filas) {
  var hoja = libro.getSheetByName(CM_HOJA_SIN_OC) || libro.insertSheet(CM_HOJA_SIN_OC);
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  var n = CM_COLUMNAS_SIN_OC.length;
  var valores = [CM_COLUMNAS_SIN_OC.map(function (c) { return c[0]; })].concat(filas.map(function (f) {
    return CM_COLUMNAS_SIN_OC.map(function (c) {
      var v = f[c[1]];
      if (v == null) return '';
      if (c[1] === 'fecha_emision') { var p = String(v).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : v; }
      if ((c[1] === 'comprador_probable' || c[1] === 'area_probable') && !v) return 'Por identificar';
      if (c[1] === 'enlace_pdf') return v ? 'abrir' : '';
      return typeof v === 'string' ? v.trim() : v;
    });
  }));
  hoja.getRange(1, 1, valores.length, n).setNumberFormat('@');
  var col = function (k) { for (var i = 0; i < n; i++) if (CM_COLUMNAS_SIN_OC[i][1] === k) return i + 1; };
  if (filas.length) {
    hoja.getRange(2, col('total'), filas.length, 1).setNumberFormat('#,##0.00');
    hoja.getRange(2, col('facturas_del_proveedor'), filas.length, 2).setNumberFormat('0');
  }
  hoja.getRange(1, 1, valores.length, n).setValues(valores);
  if (filas.length) {
    hoja.getRange(2, col('enlace_pdf'), filas.length, 1).setRichTextValues(filas.map(function (f) {
      var r = SpreadsheetApp.newRichTextValue().setText(f.enlace_pdf ? 'abrir' : '');
      if (f.enlace_pdf) r.setLinkUrl(f.enlace_pdf);
      return [r.build()];
    }));
    hoja.getRange(2, 1, filas.length, 1).setBackgrounds(filas.map(function (f) {
      return [f.senal === 'ALTA' ? '#f4cccc' : '#fff2cc'];
    }));
  }
  hoja.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff').setWrap(true);
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, valores.length, n).createFilter();
  hoja.setColumnWidth(col('razon'), 320);
  hoja.setColumnWidth(col('proveedor_nombre'), 260);
  hoja.setColumnWidth(col('ocs_del_proveedor'), 220);
}

// ── La base ──

function configuracionCarpetaMadre_() {
  var p = PropertiesService.getScriptProperties();
  var limpio = function (k) {
    return String(p.getProperty(k) || '').trim().replace(/^["'«“]+|["'»”]+$/g, '').trim();
  };
  return {
    supabaseUrl: limpio('SUPABASE_URL').replace(/\/+$/, ''),
    anonKey: limpio('SUPABASE_ANON_KEY'),
    robotCorreo: limpio('ROBOT_CORREO'),
    robotClave: limpio('ROBOT_CLAVE')
  };
}

function sesionCarpetaMadre_(cfg) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', headers: { apikey: cfg.anonKey },
    payload: JSON.stringify({ email: cfg.robotCorreo, password: cfg.robotClave }), muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  if (codigo === 401 || codigo === 403) {
    throw new Error('La base rechazó SUPABASE_ANON_KEY (error ' + codigo + '). Cópiala exacta, sin espacios ni comillas.');
  }
  if (codigo === 400) throw new Error('La base rechazó ROBOT_CORREO o ROBOT_CLAVE.');
  if (codigo >= 300) throw new Error('No se pudo iniciar sesión con la cuenta ROBOT (error ' + codigo + ').');
  return JSON.parse(resp.getContentText()).access_token;
}

function rpcCarpetaMadre_(cfg, token, funcion, args, consulta) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + funcion + (consulta || ''), {
    method: 'post', contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
    payload: JSON.stringify(args), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error(funcion + ' falló: ' + resp.getContentText().slice(0, 300));
  return JSON.parse(resp.getContentText());
}
