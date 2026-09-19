/**
 * Condición del RUC en el Sheet — Buen Contribuyente / Agente de Retención
 * --------------------------------------------------------------------------
 *
 * El registro de compras no dice si a un proveedor le corresponde o no la
 * retención del IGV: eso depende de si está en el Padrón de Buenos
 * Contribuyentes o en el de Agentes de Retención/Percepción de SUNAT, algo
 * que hoy Contabilidad revisa a mano, RUC por RUC, en
 * e-consultaruc.sunat.gob.pe.
 *
 * ESTA CONSULTA NO SE PUEDE HACER DESDE APPS SCRIPT: se probó primero con
 * `UrlFetchApp` (una versión anterior de este archivo) y falló — esa pantalla
 * tiene reCAPTCHA v3. El campo «token» del formulario llega vacío del
 * servidor y solo se llena cuando `grecaptcha.execute(...)` corre en un
 * navegador de verdad, al hacer clic en «Buscar». `UrlFetchApp` no ejecuta
 * JavaScript, así que no hay forma de conseguir ese token desde acá.
 *
 * Por eso la consulta la hace un scraper de Playwright
 * (`scripts/consultar-padron-ruc.mts`), corriendo en GitHub Actions —un
 * navegador real resuelve el captcha en silencio, igual que lo haría una
 * persona— y guarda cada resultado en la tabla `padron_ruc` de la base.
 *
 * El trabajo de ESTE archivo es más simple: traer esa tabla a una pestaña
 * PADRÓN RUC de esta misma hoja, para que Contabilidad la vea ahí mismo, sin
 * entrar a la aplicación ni a Supabase.
 *
 * IMPORTANTE: esto solo muestra la condición del proveedor. Si corresponde
 * retenerle o no depende además de si INROPRIN está designada Agente de
 * Retención, de si la operación supera S/ 700, y de si no está sujeta a
 * detracción — ese cálculo no lo hace este archivo.
 */

// ── Configuración ──────────────────────────────────────────────────

/** La pestaña donde se refleja el padrón. No es la de datos: sobrevive a la publicación diaria. */
var PESTANA_PADRON = 'PADRÓN RUC';

var CABECERAS_PADRON = [
  'RUC', 'Razón social', 'Estado', 'Condición',
  'Buen Contribuyente', 'Agente de Retención', 'Agente de Percepción',
  'Padrones (detalle)', 'Consultado el'
];

/**
 * Las credenciales de la base, desde Propiedades del script (Extensiones →
 * Propiedades del proyecto → Propiedades del script). Son las mismas que usa
 * `OrdenarCPE.gs`: SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO, ROBOT_CLAVE.
 * No van escritas en el código porque esto se guarda en un repositorio.
 */
function configuracionPadron_() {
  var p = PropertiesService.getScriptProperties();
  return {
    supabaseUrl: p.getProperty('SUPABASE_URL'),
    anonKey: p.getProperty('SUPABASE_ANON_KEY'),
    robotCorreo: p.getProperty('ROBOT_CORREO'),
    robotClave: p.getProperty('ROBOT_CLAVE')
  };
}

// ── Menú (se engancha desde onOpen de Codigo.gs) ──────────────────

/** Los ítems de este archivo. Codigo.gs lo llama desde su onOpen. */
function itemsMenuPadron_(menu) {
  return menu
    .addSeparator()
    .addItem('Traer el padrón de RUC desde la base', 'sincronizarPadronRuc')
    .addItem('Activar sincronización automática diaria', 'instalarPadronAutomatico')
    .addItem('Desactivar sincronización automática', 'quitarPadronAutomatico');
}

// ── Orquestación ──────────────────────────────────────────────────

/**
 * Trae la tabla `padron_ruc` completa de la base y reemplaza la pestaña con
 * ella. Se reescribe entera —no fila por fila— porque la base ya es la
 * fuente de verdad: es más simple y más correcto que ir upseando acá también.
 */
function sincronizarPadronRuc() {
  var cfg = configuracionPadron_();
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.robotCorreo || !cfg.robotClave) {
    var faltan = 'Faltan credenciales de la base. En Extensiones → Propiedades del proyecto → ' +
      'Propiedades del script, agrega SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE ' +
      '(los mismos valores que usa OrdenarCPE.gs).';
    Logger.log(faltan);
    try { SpreadsheetApp.getUi().alert(faltan); } catch (e) {}
    return;
  }

  try {
    var token = iniciarSesionRobotPadron_(cfg);
    var filas = padronDesdeBase_(cfg, token);
    escribirPadronCompleto_(filas);

    var msg = filas.length + ' RUC en el padrón, traídos de la base.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  } catch (e) {
    Logger.log('Error: ' + e.message);
    try { SpreadsheetApp.getUi().alert('No se pudo traer el padrón: ' + e.message); } catch (e2) {}
  }
}

function iniciarSesionRobotPadron_(cfg) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.anonKey },
    payload: JSON.stringify({ email: cfg.robotCorreo, password: cfg.robotClave }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('No se pudo iniciar sesión con la cuenta ROBOT: ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).access_token;
}

/** Toda la tabla `padron_ruc`, ordenada por RUC. La RLS ya la deja de solo lectura por REST. */
function padronDesdeBase_(cfg, token) {
  var resp = UrlFetchApp.fetch(
    cfg.supabaseUrl + '/rest/v1/padron_ruc?select=*&order=ruc.asc&limit=5000',
    {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    }
  );
  if (resp.getResponseCode() >= 300) {
    throw new Error('No se pudo leer el padrón de la base: ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

function hojaPadron_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(PESTANA_PADRON);
  if (!hoja) hoja = libro.insertSheet(PESTANA_PADRON);
  return hoja;
}

function escribirPadronCompleto_(filas) {
  var hoja = hojaPadron_();
  hoja.clear();
  hoja.appendRow(CABECERAS_PADRON);
  hoja.setFrozenRows(1);
  if (!filas || filas.length === 0) return;

  var valores = filas.map(function (r) {
    return [
      r.ruc || '', r.razon_social || '', r.estado || '', r.condicion || '',
      r.buen_contribuyente ? 'Sí' : 'No',
      r.agente_retencion ? 'Sí' : 'No',
      r.agente_percepcion ? 'Sí' : 'No',
      r.padrones_detalle || '',
      r.consultado_en ? new Date(r.consultado_en) : ''
    ];
  });
  hoja.getRange(2, 1, valores.length, CABECERAS_PADRON.length).setValues(valores);
}

// ── El disparador automático ────────────────────────────────────────

function instalarPadronAutomatico() {
  quitarPadronAutomatico();
  ScriptApp.newTrigger('sincronizarPadronRuc').timeBased().atHour(8).everyDays(1).create();
  SpreadsheetApp.getUi().alert(
    'Listo. Todos los días a las 8 de la mañana esta pestaña se pone al día con lo que haya ' +
    'consultado el scraper de SUNAT hasta ese momento.'
  );
}

function quitarPadronAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarPadronRuc') ScriptApp.deleteTrigger(t);
  });
}
