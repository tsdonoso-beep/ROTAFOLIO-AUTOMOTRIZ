/**
 * Subir la captura de OC a la base
 * --------------------------------------------------------------------------
 *
 * Tercer paso, en el MISMO proyecto que CapturaCarpetasOC.gs y
 * LecturaFacturas.gs. Manda a la base de datos de la aplicación:
 *   · lo que vio la captura (pestaña ARCHIVOS), con lo leído de cada factura
 *     (pestaña LECTURA), y
 *   · el centro de costo de cada OC según la base de Control de Gestión.
 *
 * El cruce con las facturas de SUNAT lo hace la base (función vinculos_oc), y
 * la aplicación publica la OC, el centro de costo y el código CONCAR como
 * columnas nuevas en COMPROBANTES SUNAT y en el DETALLE, cada mañana.
 *
 * Cada subida REEMPLAZA a la anterior: se sube todo de nuevo, no se suma.
 *
 * ── Instalación ──
 * 1. En el proyecto de la captura: + → Script → llámalo SubirCapturaOC → pega
 *    esto → guarda.
 * 2. Engranaje (Configuración del proyecto) → Propiedades del script → agrega
 *    SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE: los mismos
 *    valores que ya usan OrdenarCPE.gs y PadronRuc.gs.
 * 3. Recarga la hoja → menú «Base de datos» → «Subir captura a la base».
 *    La primera vez Google pide un permiso nuevo («conectarse a un servicio
 *    externo»): marca todas las casillas.
 */

var RUC_EMPRESA_SUBIDA = '20512201611';
var LOTE_SUBIDA = 400;

function menuSubirCaptura_() {
  SpreadsheetApp.getUi().createMenu('Base de datos')
    .addItem('Subir captura a la base', 'subirCapturaALaBase')
    .addToUi();
}

function subirCapturaALaBase() {
  var ui = SpreadsheetApp.getUi();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = configuracionBase_();
  var faltan = ['supabaseUrl', 'anonKey', 'robotCorreo', 'robotClave'].filter(function (k) { return !cfg[k]; });
  if (faltan.length) {
    ui.alert('Faltan credenciales',
      'En Apps Script → engranaje → Propiedades del script, agrega SUPABASE_URL, SUPABASE_ANON_KEY, ' +
      'ROBOT_CORREO y ROBOT_CLAVE (los mismos de OrdenarCPE.gs).', ui.ButtonSet.OK);
    return;
  }

  libro.toast('Leyendo la captura y la base de Control de Gestión…', 'Base de datos', 20);
  var archivos = filasDeArchivos_(libro);
  var baseCg = filasDeBaseCg_();
  if (!archivos.length) {
    ui.alert('No hay captura', 'La pestaña ARCHIVOS está vacía: primero corre la captura de carpetas.', ui.ButtonSet.OK);
    return;
  }

  var token = iniciarSesionRobotSubida_(cfg);
  libro.toast('Subiendo ' + archivos.length + ' archivos y ' + baseCg.length + ' líneas de OC…', 'Base de datos', 30);
  var nA = subirPorLotes_(cfg, token, 'ARCHIVOS', archivos);
  var nB = subirPorLotes_(cfg, token, 'BASE_CG', baseCg);
  var vinculos = llamarRpc_(cfg, token, 'vinculos_oc', { p_empresa_ruc: cfg.rucEmpresa });
  var conCodigo = vinculos.filter(function (v) { return v.concar_codigo; }).length;

  ui.alert('Listo',
    nA + ' archivos y ' + nB + ' centros de costo de OC subidos.\n\n' +
    'La base unió ' + vinculos.length + ' facturas de SUNAT con su OC (' + conCodigo +
    ' ya con código CONCAR confirmado).\n\n' +
    'Las columnas nuevas aparecen en COMPROBANTES SUNAT y en el DETALLE con la próxima publicación.',
    ui.ButtonSet.OK);
}

// ── Qué se sube ──

/** Una fila por archivo de ARCHIVOS, con lo leído en LECTURA si se leyó. */
function filasDeArchivos_(libro) {
  var hojaA = libro.getSheetByName('ARCHIVOS');
  if (!hojaA || hojaA.getLastRow() < 2) return [];
  var a = hojaA.getDataRange().getValues();
  var ca = a[0];
  var ia = {
    oc: columna_(ca, 'OC'), ruc: columna_(ca, 'RUC'), prov: columna_(ca, 'Proveedor'),
    carpeta: columna_(ca, 'Enlace carpeta OC'), nombre: columna_(ca, 'Nombre del archivo'),
    url: columna_(ca, 'Enlace del archivo'), tipo: columna_(ca, 'Tipo de archivo'),
    parece: columna_(ca, 'Parece ser'), serie: columna_(ca, 'Serie-número en el nombre')
  };

  var leido = {};
  var hojaL = libro.getSheetByName('LECTURA');
  if (hojaL && hojaL.getLastRow() > 1) {
    var l = hojaL.getDataRange().getValues();
    var cl = l[0];
    var il = {
      url: columna_(cl, 'Enlace del archivo'), estado: columna_(cl, 'Estado'),
      ruc: columna_(cl, 'RUC emisor (leído)'), serie: columna_(cl, 'Serie-número (leído)')
    };
    l.slice(1).forEach(function (f) {
      leido[String(f[il.url])] = { estado: String(f[il.estado] || ''), ruc: texto_(f[il.ruc]), serie: texto_(f[il.serie]) };
    });
  }

  return a.slice(1).filter(function (f) { return f[ia.oc] && f[ia.url]; }).map(function (f) {
    var url = String(f[ia.url]);
    var lec = leido[url] || {};
    return {
      oc: texto_(f[ia.oc]), proveedorRuc: texto_(f[ia.ruc]), proveedor: texto_(f[ia.prov]),
      carpetaUrl: texto_(f[ia.carpeta]), nombre: texto_(f[ia.nombre]), url: url,
      tipoArchivo: texto_(f[ia.tipo]), parece: texto_(f[ia.parece]), serieEnNombre: texto_(f[ia.serie]),
      estadoLectura: lec.estado || '', rucLeido: lec.ruc || '', serieLeida: lec.serie || ''
    };
  });
}

/**
 * La base de Control de Gestión resumida: por OC y centro de costo, el RUC,
 * la primera fecha, la moneda, el monto y cuántas líneas. Todas las OC de la
 * empresa, de todos los años (una factura de 2026 puede ser de una OC de 2025).
 */
function filasDeBaseCg_() {
  var hoja = pestanaDeOrigen_(SpreadsheetApp.openById(ORIGEN_ID));
  var v = hoja.getDataRange().getValues();
  var fc = buscarFilaCabecera_(v);
  var cab = v[fc];
  var i = {
    oc: columna_(cab, 'N° OC/OS'), ruc: columna_(cab, 'RUC / DNI / RUT'), emp: columna_(cab, 'EMPRESA'),
    fecha: columna_(cab, 'FECHA OC'), cc: columna_(cab, 'CODIGO CENTRO DE COSTO'),
    ccn: columna_(cab, 'CENTRO DE COSTO'), moneda: columna_(cab, 'MONEDA'), monto: columna_(cab, 'MONTO TOTAL')
  };
  var zona = Session.getScriptTimeZone();
  var grupos = {};
  v.slice(fc + 1).forEach(function (f) {
    if (EMPRESAS.length && EMPRESAS.indexOf(String(f[i.emp]).trim()) === -1) return;
    var oc = texto_(f[i.oc]);
    if (!oc) return;
    var cc = texto_(f[i.cc]).replace(/\s+/g, '') || '-';
    var ccn = texto_(f[i.ccn]).replace(/\s+/g, ' ');
    var k = oc + '|' + cc + '|' + ccn;
    var g = grupos[k] || (grupos[k] = { oc: oc, ccCodigo: cc, ccNombre: ccn, proveedorRuc: '', fechaOc: '', moneda: '', monto: 0, lineas: 0 });
    var ruc = texto_(f[i.ruc]);
    if (/^\d{8,11}$/.test(ruc)) g.proveedorRuc = ruc;
    var fecha = f[i.fecha];
    if (fecha && typeof fecha.getFullYear === 'function') {
      var iso = Utilities.formatDate(fecha, zona, 'yyyy-MM-dd');
      if (!g.fechaOc || iso < g.fechaOc) g.fechaOc = iso;
    }
    var mon = texto_(f[i.moneda]);
    if (/^[A-Z]{3}$/.test(mon)) g.moneda = mon;
    g.monto += montoDe_(f[i.monto]);
    g.lineas++;
  });
  return Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    g.monto = Math.round(g.monto * 100) / 100;
    return g;
  });
}

// ── La base ──

function configuracionBase_() {
  var p = PropertiesService.getScriptProperties();
  return {
    supabaseUrl: p.getProperty('SUPABASE_URL'),
    anonKey: p.getProperty('SUPABASE_ANON_KEY'),
    robotCorreo: p.getProperty('ROBOT_CORREO'),
    robotClave: p.getProperty('ROBOT_CLAVE'),
    rucEmpresa: p.getProperty('RUC_EMPRESA') || RUC_EMPRESA_SUBIDA
  };
}

function iniciarSesionRobotSubida_(cfg) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', headers: { apikey: cfg.anonKey },
    payload: JSON.stringify({ email: cfg.robotCorreo, password: cfg.robotClave }), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('No se pudo iniciar sesión con la cuenta ROBOT: ' + resp.getContentText().slice(0, 200));
  }
  return JSON.parse(resp.getContentText()).access_token;
}

function llamarRpc_(cfg, token, funcion, args) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + funcion, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
    payload: JSON.stringify(args), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error(funcion + ' falló: ' + resp.getContentText().slice(0, 300));
  }
  return JSON.parse(resp.getContentText());
}

/** El primer lote borra lo anterior de esa parte; los siguientes agregan. */
function subirPorLotes_(cfg, token, parte, filas) {
  var total = 0;
  for (var i = 0; i < filas.length; i += LOTE_SUBIDA) {
    total += Number(llamarRpc_(cfg, token, 'cargar_captura_oc', {
      p_empresa_ruc: cfg.rucEmpresa, p_parte: parte,
      p_filas: filas.slice(i, i + LOTE_SUBIDA), p_desde_cero: i === 0
    })) || 0;
  }
  return total;
}

// ── Ayudas ──

/** Texto limpio: un RUC que la hoja guardó como número no debe volver «2.06E+10». */
function texto_(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** «S/. 6,440.68», «6,440.68» o 6440.68 → 6440.68. */
function montoDe_(v) {
  if (typeof v === 'number') return v;
  var m = /-?[\d,]+(?:\.\d+)?/.exec(String(v || ''));
  return m ? Number(m[0].replace(/,/g, '')) || 0 : 0;
}
