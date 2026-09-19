/**
 * Tablero del padrón de RUC — publicado como aplicación web
 * --------------------------------------------------------------------------
 *
 * Muestra qué proporción de los proveedores son Buenos Contribuyentes,
 * Agentes de Retención/Percepción, o «No Habido» —la información que hoy
 * vive en la tabla `padron_ruc` de Supabase, que llena el scraper de
 * Playwright (`scripts/consultar-padron-ruc.mts`)— con un enlace directo a
 * la hoja de cálculo.
 *
 * A diferencia de `Tablero.html` (que se abre como diálogo DESDE el menú de
 * la hoja), este se **publica** como su propia URL: `doGet()` es lo que hace
 * eso posible. Vive en el mismo proyecto que `PadronRuc.gs` —reusa sus mismas
 * Propiedades del script—, pero es independiente: no toca el menú ni el otro
 * tablero.
 *
 * ── Instalación ──
 * 1. Pega esto en un archivo `TableroPadron` (Script) y `TableroPadron.html`
 *    en el otro archivo, en el MISMO proyecto de Apps Script donde ya está
 *    `PadronRuc.gs` (así hereda SUPABASE_URL, SUPABASE_ANON_KEY,
 *    ROBOT_CORREO, ROBOT_CLAVE de Propiedades del script — Extensiones →
 *    Configuración del proyecto). Si no están, agrégalas ahí.
 * 2. Guarda.
 * 3. Implementar → Nueva implementación → tipo «Aplicación web».
 *    - Ejecutar como: **Yo** (tu cuenta) — así corre con tus permisos sin
 *      pedirle nada a quien lo abra.
 *    - Quién tiene acceso: recomendado **«Cualquier usuario de tu
 *      organización»**, no «Cualquier usuario» — esto muestra información de
 *      proveedores, no hace falta que sea público en internet.
 * 4. Implementar → copia la URL. Esa es la que se comparte.
 * 5. Cada vez que cambies el código hay que volver a «Gestionar
 *    implementaciones» → editar (lápiz) → Versión «Nueva» → Implementar: una
 *    implementación ya publicada NO se actualiza sola con el código nuevo.
 */

/** La hoja a la que enlaza el botón «Abrir la hoja». */
var URL_HOJA_SHEET = 'https://docs.google.com/spreadsheets/d/1ttW7DOAiem0bl2FVL5n06MdAcmq79Yqu-S35P-rzJK0/edit';

/** Punto de entrada de la aplicación web. Apps Script lo llama solo al visitar la URL publicada. */
function doGet() {
  return HtmlService.createTemplateFromFile('TableroPadron')
    .evaluate()
    .setTitle('Padrón de RUC — INROPRIN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Las credenciales de la base, desde Propiedades del script.
 *
 * Repetido de `PadronRuc.gs` a propósito: si este archivo se pega en un
 * proyecto donde `PadronRuc.gs` no está, igual funciona solo. Si los dos
 * están en el mismo proyecto, son dos declaraciones idénticas —Apps Script
 * no se queja, la segunda simplemente no cambia nada—.
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

/** Toda la tabla `padron_ruc`, ordenada por RUC. */
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

/**
 * Cuántos RUC de proveedor del registro de compras TODAVÍA no tienen ni una
 * fila en padron_ruc —con una vigencia enorme, para que solo cuente «nunca
 * consultado», no «vencido»—. Sirve para la cobertura: cuánto del registro
 * ya se revisó contra cuánto falta.
 */
function pendientesDePadron_(cfg, token) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + '/rest/v1/rpc/rucs_por_actualizar_en_padron', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
    // Un número de días enorme: así ningún RUC ya consultado cuenta como
    // «vencido», solo los que de verdad nunca se revisaron.
    payload: JSON.stringify({ p_dias_vigencia: 36500 }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) return null;
  var data = JSON.parse(resp.getContentText());
  return Array.isArray(data) ? data.length : null;
}

/**
 * Lo que consume el tablero: totales, porcentajes y la lista completa.
 *
 * Se calcula acá y no en el HTML porque son los mismos números para
 * cualquiera que abra la página; no tiene sentido bajar 500 filas al
 * navegador de cada visitante solo para sumarlas ahí.
 */
function datosDelPadron() {
  var cfg = configuracionPadron_();
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.robotCorreo || !cfg.robotClave) {
    return {
      error: 'Faltan credenciales de la base en Propiedades del script: SUPABASE_URL, ' +
        'SUPABASE_ANON_KEY, ROBOT_CORREO, ROBOT_CLAVE.'
    };
  }

  try {
    var token = iniciarSesionRobotPadron_(cfg);
    var filas = padronDesdeBase_(cfg, token);
    var pendientes = pendientesDePadron_(cfg, token);

    var total = filas.length;
    var contar = function (campo) {
      return filas.reduce(function (n, f) { return n + (f[campo] ? 1 : 0); }, 0);
    };
    var pct = function (n) { return total ? Math.round((n / total) * 1000) / 10 : 0; };

    var buenContribuyente = contar('buen_contribuyente');
    var agenteRetencion = contar('agente_retencion');
    var agentePercepcion = contar('agente_percepcion');
    var noHabido = filas.reduce(function (n, f) {
      return n + (f.condicion && f.condicion.toUpperCase().indexOf('NO HABIDO') >= 0 ? 1 : 0);
    }, 0);

    return {
      error: null,
      actualizadoEl: new Date().toISOString(),
      total: total,
      cobertura: {
        consultados: total,
        pendientes: pendientes,
        porcentaje: (pendientes == null || (total + pendientes) === 0)
          ? null : Math.round((total / (total + pendientes)) * 1000) / 10
      },
      categorias: [
        { nombre: 'Buen Contribuyente', cuenta: buenContribuyente, pct: pct(buenContribuyente) },
        { nombre: 'Agente de Retención', cuenta: agenteRetencion, pct: pct(agenteRetencion) },
        { nombre: 'Agente de Percepción', cuenta: agentePercepcion, pct: pct(agentePercepcion) }
      ],
      noHabido: noHabido,
      urlHoja: URL_HOJA_SHEET,
      filas: filas.map(function (f) {
        return {
          ruc: f.ruc,
          razonSocial: f.razon_social || '',
          estado: f.estado || '',
          condicion: f.condicion || '',
          buenContribuyente: !!f.buen_contribuyente,
          agenteRetencion: !!f.agente_retencion,
          agentePercepcion: !!f.agente_percepcion,
          consultadoEl: f.consultado_en || null
        };
      })
    };
  } catch (e) {
    return { error: e.message };
  }
}
