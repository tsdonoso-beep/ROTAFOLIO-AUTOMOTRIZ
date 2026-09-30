/**
 * Subir el legajo por OC a la base
 * --------------------------------------------------------------------------
 *
 * Va en el MISMO proyecto que LegajoPorOC.gs (usa sus constantes y
 * funciones). Manda a la base de la aplicación, para la empresa del
 * legajo (Inroprin, la que tiene comprobantes de SUNAT):
 *   · una fila por OC (tabla oc_legajo): situación del pago, comprador,
 *     área, centro de costo, qué documento le falta, la carpeta;
 *   · los archivos que sirven para unir la OC con su factura de SUNAT
 *     (tabla oc_archivo, origen LEGAJO): los que cuentan como factura o
 *     traen una serie-número, del nombre o leída por dentro.
 *
 * La base los cruza con SUNAT (vinculos_oc) y la aplicación publica en
 * COMPROBANTES SUNAT y en el DETALLE, al final: situación del pago (OC),
 * comprador, área que completa el legajo, legajo de la OC y su carpeta.
 * No toca lo que subió la captura de carpetas: cada una reemplaza lo suyo.
 *
 * Se sube solo cada noche, cuando los revisores terminan. También a mano:
 * menú «Legajo por OC» → «Subir el legajo a la base (hojas de SUNAT)».
 *
 * ── Instalación ──
 * 1. En el proyecto de Apps Script de la hoja: + → Script → «SubirLegajo» →
 *    pega esto → guarda.
 * 2. Engranaje (Configuración del proyecto) → Propiedades del script:
 *    SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE, los mismos
 *    de SubirCapturaOC.gs / OrdenarCPE.gs.
 */

var LEGAJO_RUC_POR_UNIDAD = { INROPRIN: '20512201611' };
var LEGAJO_LOTE = 300;

function subirLegajoALaBase() {
  var ui = SpreadsheetApp.getUi();
  var r = subirLegajo_();
  if (r.error) { ui.alert('No se pudo subir', r.error, ui.ButtonSet.OK); return; }
  ui.alert('Legajo subido', r.texto + '\n\nLas columnas aparecen en COMPROBANTES SUNAT y en el DETALLE con la próxima publicación diaria.',
    ui.ButtonSet.OK);
}

/**
 * Sube el legajo. No lanza: devuelve { texto } o { error }, para que la
 * subida automática de la noche no tumbe la tanda que la llama.
 */
function subirLegajo_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = configuracionLegajo_();
  var faltan = ['supabaseUrl', 'anonKey', 'robotCorreo', 'robotClave'].filter(function (k) { return !cfg[k]; });
  if (faltan.length) {
    return { error: 'Faltan las Propiedades del script: ' + faltan.join(', ') +
      '. En Apps Script → engranaje → Propiedades del script (las mismas de SubirCapturaOC.gs).' };
  }
  try {
    var datos = filasDelLegajo_(libro);
    var token = sesionRobotLegajo_(cfg);
    var textos = [];
    Object.keys(datos).forEach(function (ruc) {
      var d = datos[ruc];
      var nL = subirLotesLegajo_(cfg, token, ruc, 'LEGAJO', d.ocs);
      var nA = subirLotesLegajo_(cfg, token, ruc, 'ARCHIVOS', d.archivos);
      textos.push(nL + ' OC y ' + nA + ' archivos de factura');
    });
    var vinculos = rpcLegajo_(cfg, token, 'vinculos_oc', { p_empresa_ruc: LEGAJO_RUC_POR_UNIDAD.INROPRIN });
    var conLegajo = vinculos.filter(function (v) { return v.legajo; }).length;
    var texto = 'Subido a la base: ' + textos.join('; ') + '. ' + vinculos.length + ' facturas de SUNAT unidas con su OC, ' +
      conLegajo + ' con el legajo de la OC.';
    PropertiesService.getDocumentProperties().setProperty('LEGAJO_ULTIMA_SUBIDA',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' — ' + texto);
    return { texto: texto };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/** ¿Están las credenciales? Para que la subida automática no avise de más. */
function hayCredencialesDeLaBase_() {
  var c = configuracionLegajo_();
  return !!(c.supabaseUrl && c.anonKey && c.robotCorreo && c.robotClave);
}

// ── Qué se sube ──

/**
 * Por empresa (RUC): las OC de la TABLA y sus archivos útiles de ARCHIVOS.
 * Se lee por el NOMBRE de las columnas, no por su posición.
 */
function filasDelLegajo_(libro) {
  var hojaT = libro.getSheetByName('TABLA');
  if (!hojaT || hojaT.getLastRow() < 2) throw new Error('Todavía no hay TABLA: primero arma el legajo.');
  var t = hojaT.getDataRange().getValues();
  var cab = t[0].map(String);
  var c = function (n) { return cab.indexOf(n); };
  var zona = Session.getScriptTimeZone();
  var txt = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, zona, 'dd/MM/yyyy');
    return v == null ? '' : String(v).trim();
  };

  var porRuc = {}, deQuien = {}; // «OC|id de carpeta» → { ruc, proveedor, rucProveedor }
  t.slice(1).forEach(function (f) {
    var ruc = LEGAJO_RUC_POR_UNIDAD[normalizar_(f[c('Unidad de negocio')])];
    var oc = txt(f[c('OC')]);
    if (!ruc || !oc) return;
    var carpeta = txt(f[c('Enlace de la carpeta')]);
    var documentos = {};
    DOCS.forEach(function (d) { documentos[d.col] = txt(f[c(d.col)]); });
    var revisado = f[c('Revisado en')];
    var d = porRuc[ruc] || (porRuc[ruc] = { ocs: [], archivos: [] });
    d.ocs.push({
      oc: oc, carpetaUrl: carpeta, unidad: txt(f[c('Unidad de negocio')]), proyecto: txt(f[c('Proyecto')]),
      proveedor: txt(f[c('Proveedor')]), proveedorRuc: txt(f[c('RUC (CG)')]), comprador: txt(f[c('Comprador')]),
      area: txt(f[c('Área que la completa')]), procedencia: txt(f[c('Procedencia')]),
      situacionPago: txt(f[c('Situación del pago')]), estatus: txt(f[c('Estatus (aprobaciones)')]),
      estadoAprobacion: txt(f[c('Estado de aprobación')]), fechaOc: txt(f[c('Fecha OC')]),
      montoSoles: typeof f[c('Monto en soles')] === 'number' ? f[c('Monto en soles')] : '',
      formaPago: txt(f[c('Forma de pago')]),
      ccCodigo: txt(f[c('Centro de costo (CG)')]), ccNombre: txt(f[c('Nombre del centro de costo (CG)')]),
      estadoRevision: txt(f[c('Estado de la revisión')]).split(' — ')[0], leFalta: txt(f[c('Le falta')]),
      documentos: documentos,
      revisadoEn: revisado instanceof Date ? revisado.toISOString() : ''
    });
    deQuien[oc + '|' + idDeDrive_(carpeta)] = { ruc: ruc, proveedor: txt(f[c('Proveedor')]), rucProveedor: txt(f[c('RUC (CG)')]) };
  });

  var hojaA = libro.getSheetByName('ARCHIVOS');
  if (hojaA && hojaA.getLastRow() > 1) {
    var a = hojaA.getDataRange().getValues();
    var ca = a[0].map(String);
    var ia = function (n) { return ca.indexOf(n); };
    a.slice(1).forEach(function (f) {
      var oc = txt(f[ia('OC')]), carpeta = txt(f[ia('Enlace carpeta OC')]);
      var q = deQuien[oc + '|' + idDeDrive_(carpeta)];
      if (!q) return;
      var nombre = txt(f[ia('Nombre del archivo')]), cuenta = txt(f[ia('Cuenta como')]);
      var esFactura = /(^|, )1\. Factura/.test(cuenta);
      // La serie leída por dentro va en «Cuenta como»; si no, la del nombre.
      var leida = /leído por dentro: [^)]*?\b([FBE][A-Z0-9]{3}-\d{1,8})\b/.exec(cuenta);
      var serie = leida ? leida[1] : serieEnNombre_(nombre);
      if (!esFactura && !serie) return; // solo lo que sirve para unir con SUNAT
      porRuc[q.ruc].archivos.push({
        oc: oc, url: txt(f[ia('Enlace del archivo')]), carpetaUrl: carpeta, nombre: nombre,
        tipoArchivo: txt(f[ia('Tipo de archivo')]), parece: esFactura ? 'FACTURA' : txt(f[ia('Parece ser')]),
        serie: serie, proveedor: q.proveedor, proveedorRuc: q.rucProveedor
      });
    });
  }
  return porRuc;
}

// ── La base ──

function configuracionLegajo_() {
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

function sesionRobotLegajo_(cfg) {
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

function rpcLegajo_(cfg, token, funcion, args) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + funcion, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
    payload: JSON.stringify(args), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error(funcion + ' falló: ' + resp.getContentText().slice(0, 300));
  return JSON.parse(resp.getContentText());
}

/** El primer lote borra lo anterior de esa parte; los siguientes agregan. */
function subirLotesLegajo_(cfg, token, ruc, parte, filas) {
  var total = 0;
  if (!filas.length) {
    return Number(rpcLegajo_(cfg, token, 'cargar_legajo_oc', { p_empresa_ruc: ruc, p_parte: parte, p_filas: [], p_desde_cero: true })) || 0;
  }
  for (var i = 0; i < filas.length; i += LEGAJO_LOTE) {
    total += Number(rpcLegajo_(cfg, token, 'cargar_legajo_oc', {
      p_empresa_ruc: ruc, p_parte: parte, p_filas: filas.slice(i, i + LEGAJO_LOTE), p_desde_cero: i === 0
    })) || 0;
  }
  return total;
}
