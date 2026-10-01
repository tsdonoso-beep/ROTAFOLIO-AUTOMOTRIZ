/**
 * La carpeta madre de compras, en la hoja GENERAL
 * --------------------------------------------------------------------------
 *
 * Trae de la base (función legajo_de_carpetas) lo que el robot de cada noche
 * (`scripts/carpetas-oc.mts`, 02:00) leyó de las dos carpetas madre de
 * compras: «5. Ordenes de Compra» (nacionales) e importaciones. Una fila por
 * carpeta de OC:
 *   · su legajo: qué documentos tiene, qué le falta y su estado;
 *   · su centro de costo y de dónde salió (CG, cuadro, su carpeta de
 *     proyecto, el nombre de la carpeta o el área administrativa);
 *   · las facturas de SUNAT que ya quedaron unidas a la OC;
 *   · si está en la base de Control de Gestión (CG) y el último cambio que
 *     vio el robot (archivo nuevo, eliminado, completó, ahora le falta…).
 *
 * Deja dos pestañas: CARPETA MADRE (el detalle) y CARPETA MADRE - RESUMEN.
 * Las reemplaza cada vez: no escribas a mano en ellas.
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
 *    «Carpeta madre» a la hoja y la deja programada cada mañana.
 */

var CM_HOJA = 'CARPETA MADRE';
var CM_HOJA_RESUMEN = 'CARPETA MADRE - RESUMEN';
var CM_RUC = '20512201611';
var CM_HORA = 7; // de la mañana: el robot de las carpetas corre a las 02:00
var CM_PAGINA = 1000;

var CM_COLUMNAS = [
  ['Procedencia', 'procedencia'],
  ['OC', 'oc'],
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
  ScriptApp.newTrigger('traerCarpetaMadreSola').timeBased().everyDays(1).atHour(CM_HORA).create();
  ScriptApp.newTrigger('menuCarpetaMadre').forSpreadsheet(libro).onOpen().create();
  var r = traerCarpetaMadre_();
  try {
    menuCarpetaMadre();
    var ui = SpreadsheetApp.getUi();
    ui.alert(r.error ? 'Instalado, pero no se pudo traer' : 'Instalado', (r.error || r.texto) +
      '\n\nSe traerá sola cada mañana a las ' + CM_HORA + ':00 y queda el menú «Carpeta madre».', ui.ButtonSet.OK);
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
    .addItem('Dejar de traerla cada mañana', 'quitarCarpetaMadre')
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

/** La de cada mañana: sin ventanas (nadie las vería). */
function traerCarpetaMadreSola() {
  var r = traerCarpetaMadre_();
  if (r.error) throw new Error(r.error); // queda en Ejecuciones y Google avisa por correo
}

function traerCarpetaMadre_() {
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
      var parte = rpcCarpetaMadre_(cfg, token, 'legajo_de_carpetas', { p_empresa_ruc: CM_RUC },
        '?order=procedencia.desc,oc,carpeta_url&limit=' + CM_PAGINA + '&offset=' + desde);
      filas = filas.concat(parte);
      if (parte.length < CM_PAGINA) break;
    }
    if (!filas.length) return { error: 'La base no devolvió carpetas: ¿ya corrió el robot de las carpetas?' };
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    escribirDetalleCarpetaMadre_(libro, filas);
    var texto = escribirResumenCarpetaMadre_(libro, filas);
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
  [5, 6, 8, 9, 11, 12, 15, 16, 18, 20].forEach(function (c) { hoja.setColumnWidth(c, 220); });
}

function cmCol_(campo) {
  for (var i = 0; i < CM_COLUMNAS.length; i++) if (CM_COLUMNAS[i][1] === campo) return i + 1;
  throw new Error('Columna desconocida: ' + campo);
}

/** Cuántas carpetas, cuántas completas, qué falta y cuántas tienen factura de SUNAT. */
function escribirResumenCarpetaMadre_(libro, filas) {
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
  var fila = function (nombre, fn) { return [nombre].concat(grupos.map(function (g) { return fn(cuenta[g]); })); };
  var tabla = [
    ['Carpeta madre de compras — traído de la base el ' + ahora, '', '', ''],
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

  var hoja = libro.getSheetByName(CM_HOJA_RESUMEN) || libro.insertSheet(CM_HOJA_RESUMEN);
  hoja.clear();
  hoja.getRange(1, 1, tabla.length, 4).setValues(tabla);
  hoja.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  hoja.getRange(2, 1, 1, 4).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff');
  hoja.getRange(16, 1).setFontWeight('bold');
  hoja.setColumnWidth(1, 330);

  var t = cuenta.Total;
  return t.carpetas + ' carpetas de OC (' + cuenta.Nacional.carpetas + ' nacionales, ' + cuenta['Importación'].carpetas +
    ' de importación): ' + t.ok + ' con el legajo completo, ' + t.incompletas + ' incompletas, ' + t.vacias +
    ' vacías; ' + t.conFactura + ' con factura de SUNAT unida.\n\nPestañas «' + CM_HOJA + '» y «' + CM_HOJA_RESUMEN + '».';
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
