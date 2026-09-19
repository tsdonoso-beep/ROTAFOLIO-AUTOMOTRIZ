/**
 * Servidor del tablero SUNAT publicado — el «Código» detrás de TableroPadron.html
 * --------------------------------------------------------------------------
 *
 * Se llama distinto del HTML a propósito: Apps Script no deja que un archivo
 * de Script y uno HTML tengan el mismo nombre en un mismo proyecto —por eso
 * `Codigo.gs` y `Tablero.html` tampoco se llaman igual entre sí—. Este es el
 * equivalente de `Codigo.gs`, pero para `TableroPadron.html`.
 *
 * Trae la pestaña «Padrón de RUC»: qué proporción de los proveedores son
 * Buenos Contribuyentes, Agentes de Retención/Percepción, o «No Habido» — lo
 * que hoy vive en la tabla `padron_ruc` de Supabase, que llena el scraper de
 * Playwright (`scripts/consultar-padron-ruc.mts`).
 *
 * La otra pestaña, «Comprobantes SUNAT», también trae su propia copia de la
 * lógica de `Codigo.gs` (`datosDelTablero()` y sus ayudantes, con nombres
 * distintos para no chocar si algún día conviven en el mismo proyecto). Es
 * intencional: este archivo es **autocontenido**. No hace falta que
 * `Codigo.gs` exista en el proyecto para que el tablero publicado funcione
 * entero —ni la pestaña de Padrón ni la de Comprobantes dependen de nada
 * fuera de este archivo y de `TableroPadron.html`—.
 *
 * A diferencia de `Tablero.html` (que se abre como diálogo DESDE el menú de
 * la hoja), esto se **publica** como su propia URL: `doGet()` es lo que hace
 * eso posible.
 *
 * ── Instalación ──
 * 1. Pega esto en un archivo de **Script** llamado `CodigoPadron` (el nombre
 *    exacto no importa para que funcione, pero no puede ser `TableroPadron`
 *    —ese nombre ya lo usa el HTML—). Pega `TableroPadron.html` en un
 *    archivo **HTML** llamado exactamente `TableroPadron` (sin `.html`).
 *    Ninguno necesita ningún otro archivo del proyecto.
 * 2. **Extensiones → Configuración del proyecto → Propiedades del script**:
 *    agrega `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ROBOT_CORREO`,
 *    `ROBOT_CLAVE` (los mismos valores que usa `PadronRuc.gs`, si también
 *    lo tienes acá — si no, son los del robot de Supabase).
 * 3. Guarda.
 * 4. Implementar → Nueva implementación → tipo «Aplicación web».
 *    - Ejecutar como: **Yo** (tu cuenta) — así corre con tus permisos sin
 *      pedirle nada a quien lo abra.
 *    - Quién tiene acceso: recomendado **«Cualquier usuario de tu
 *      organización»**, no «Cualquier usuario» — esto muestra información de
 *      proveedores, no hace falta que sea público en internet.
 * 5. Implementar → copia la URL. Esa es la que se comparte.
 * 6. Cada vez que cambies el código hay que volver a «Gestionar
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

// ══════════════════════════════════════════════════════════════════
// Pestaña «Comprobantes SUNAT» — copia autocontenida de la lógica de
// Codigo.gs (datosDelTablero y sus ayudantes), con nombres propios para no
// chocar si este archivo y Codigo.gs terminan conviviendo en el mismo
// proyecto. Si ambos están, son dos implementaciones independientes de lo
// mismo: cambiar una no afecta a la otra.
// ══════════════════════════════════════════════════════════════════

/** La hoja que publica la aplicación. Se cambia solo si se muda de archivo. */
var HOJA_FUENTE_TABLERO = '1ttW7DOAiem0bl2FVL5n06MdAcmq79Yqu-S35P-rzJK0';

/** La pestaña con los datos, dentro de esa hoja. Se busca por nombre, no por posición. */
var PESTANA_DATOS_TABLERO = 'COMPROBANTES SUNAT';

var COL_TABLERO = {
  periodo:    'Período',
  ruc:        'RUC proveedor',
  proveedor:  'Proveedor',
  tipo:       'Tipo',
  serie:      'Serie',
  numero:     'Número',
  fecha:      'Fecha de emisión',
  moneda:     'Moneda',
  base:       'Base imponible',
  igv:        'IGV',
  total:      'Total',
  corrigeA:   'Corrige a',
  rindio:     'Lo rindió',
  cambios:    'Cambios detectados',
  ultimaVez:  'Visto por última vez'
};

/**
 * Trae la hoja publicada como una lista de objetos. Se guarda en caché
 * media hora: son miles de filas y la fuente se actualiza una vez al día,
 * así que un pequeño desfase no cambia ninguna decisión.
 */
function leerFuenteTablero_() {
  var cache = CacheService.getUserCache();
  var guardado = cache.get('filasTablero');
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { /* caché vieja: se relee */ }
  }

  var libro = SpreadsheetApp.openById(HOJA_FUENTE_TABLERO);
  var hoja = libro.getSheetByName(PESTANA_DATOS_TABLERO) || libro.getSheets()[0];
  var datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];

  var titulos = datos[0].map(function (t) { return String(t).trim(); });
  var donde = {};
  for (var clave in COL_TABLERO) donde[clave] = titulos.indexOf(COL_TABLERO[clave]);

  var faltan = [];
  for (var c in donde) if (donde[c] === -1) faltan.push(COL_TABLERO[c]);
  if (faltan.length) {
    throw new Error(
      'La hoja no trae estas columnas: ' + faltan.join(', ') + '.\n' +
      'Puede que hayan cambiado de nombre. Avisa a quien mantiene la aplicación.'
    );
  }

  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    filas.push({
      periodo:   String(f[donde.periodo] || ''),
      ruc:       String(f[donde.ruc] || ''),
      proveedor: String(f[donde.proveedor] || ''),
      tipo:      String(f[donde.tipo] || ''),
      comprobante: [f[donde.serie], f[donde.numero]].filter(String).join('-'),
      fecha:     aFechaTablero_(f[donde.fecha]),
      moneda:    String(f[donde.moneda] || ''),
      base:      aNumeroTablero_(f[donde.base]),
      igv:       aNumeroTablero_(f[donde.igv]),
      total:     aNumeroTablero_(f[donde.total]),
      corrigeA:  String(f[donde.corrigeA] || ''),
      rindio:    String(f[donde.rindio] || ''),
      cambios:   aNumeroTablero_(f[donde.cambios]) || 0,
      ultimaVez: aFechaTablero_(f[donde.ultimaVez])
    });
  }

  try { cache.put('filasTablero', JSON.stringify(filas), 1800); } catch (e) { /* sin caché */ }
  return filas;
}

/** La fecha como se lee en Perú: dd/mm/aaaa. Un Date puesto tal cual se imprime en inglés. */
function aFechaTablero_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) !== '[object Date]') return String(v);
  var dd = ('0' + v.getDate()).slice(-2);
  var mm = ('0' + (v.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + v.getFullYear();
}

function aNumeroTablero_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** Una nota de crédito o débito. Son las que restan crédito fiscal. */
function esNotaTablero_(f) {
  return f.tipo === 'Nota de crédito' || f.tipo === 'Nota de débito' ||
         f.tipo === '07' || f.tipo === '08';
}

/**
 * Lo que consume la pestaña «Comprobantes SUNAT»: IGV neto por mes, notas
 * de crédito, comprobantes que cambiaron y quién factura más. El nombre de
 * la función (`datosDelTablero`) es el que `TableroPadron.html` espera
 * exactamente por ese nombre, vía `google.script.run`.
 */
function datosDelTablero(periodo) {
  var filas = leerFuenteTablero_();

  var periodos = {};
  filas.forEach(function (f) { if (f.periodo) periodos[f.periodo] = true; });
  var listaPeriodos = Object.keys(periodos).sort().reverse();

  var elegido = periodo || listaPeriodos[0] || '';
  var delMes = filas.filter(function (f) { return f.periodo === elegido; });

  var porMes = listaPeriodos.slice().sort().map(function (p) {
    var f = filas.filter(function (x) { return x.periodo === p; });
    return {
      periodo: p,
      igv: redondearTablero_(f.reduce(function (a, x) { return a + (esNotaTablero_(x) ? -Math.abs(x.igv || 0) : (x.igv || 0)); }, 0)),
      comprobantes: f.length
    };
  });

  var notas = delMes.filter(esNotaTablero_).map(function (f) {
    return {
      proveedor: f.proveedor, ruc: f.ruc, comprobante: f.comprobante,
      fecha: f.fecha, monto: Math.abs(f.total || 0), igv: Math.abs(f.igv || 0),
      corrigeA: f.corrigeA, rindio: f.rindio
    };
  }).sort(function (a, b) { return b.igv - a.igv; });

  var cambiados = delMes.filter(function (f) { return f.cambios > 0; }).map(function (f) {
    return {
      proveedor: f.proveedor, comprobante: f.comprobante,
      total: f.total, cambios: f.cambios, ultimaVez: f.ultimaVez
    };
  });

  var porProveedor = {};
  delMes.forEach(function (f) {
    if (esNotaTablero_(f)) return;
    var k = f.ruc + '|' + f.proveedor;
    if (!porProveedor[k]) porProveedor[k] = { ruc: f.ruc, proveedor: f.proveedor, total: 0, n: 0 };
    porProveedor[k].total += (f.total || 0);
    porProveedor[k].n += 1;
  });
  var top = Object.keys(porProveedor).map(function (k) { return porProveedor[k]; })
    .sort(function (a, b) { return b.total - a.total; }).slice(0, 8);

  var compras = delMes.filter(function (f) { return !esNotaTablero_(f); });

  return {
    periodos: listaPeriodos,
    elegido: elegido,
    resumen: {
      comprobantes: compras.length,
      base: redondearTablero_(sumaTablero_(compras, 'base')),
      igvCompras: redondearTablero_(sumaTablero_(compras, 'igv')),
      igvNotas: redondearTablero_(notas.reduce(function (a, n) { return a + n.igv; }, 0)),
      total: redondearTablero_(sumaTablero_(compras, 'total')),
      proveedores: Object.keys(porProveedor).length,
      sinRendir: delMes.filter(function (f) { return !f.rindio; }).length,
      rendidos: delMes.filter(function (f) { return !!f.rindio; }).length
    },
    porMes: porMes,
    notas: notas,
    cambiados: cambiados,
    topProveedores: top
  };
}

function sumaTablero_(filas, campo) {
  return filas.reduce(function (a, f) { return a + (f[campo] || 0); }, 0);
}

function redondearTablero_(n) { return Math.round(n * 100) / 100; }
