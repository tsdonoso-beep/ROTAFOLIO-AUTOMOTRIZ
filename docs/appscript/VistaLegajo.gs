/**
 * Tablero del legajo por OC
 * --------------------------------------------------------------------------
 *
 * Una vista para leer, no para editar: arriba el estado de la lectura (la de
 * cada noche a las 8 PM y los revisores), la analítica general con filtros,
 * y abajo un buscador de OC que dice qué documento le falta a cada una y a
 * qué área le toca completarlo.
 *
 * Va EN EL MISMO PROYECTO que `LegajoPorOC.gs` (usa sus constantes: DOCS,
 * HORA_NOCTURNA, los revisores…) y lee las pestañas TABLA y RESUMEN de la
 * hoja. No escribe nada.
 *
 * ── Instalación ──
 * 1. En el proyecto de Apps Script de la hoja: + → Script → «VistaLegajo» →
 *    pega este archivo. Y + → HTML → «VistaLegajo» → pega VistaLegajo.html.
 * 2. Para verlo dentro de la hoja: menú «Legajo por OC» → «Abrir el tablero».
 * 3. Para tener un enlace propio (y compartirlo con Contabilidad):
 *    Implementar → Nueva implementación → tipo «Aplicación web» →
 *    Ejecutar como: Yo · Quién tiene acceso: cualquier usuario de tu
 *    organización → Implementar. Copia la URL.
 *    Quien abra el enlace ve los datos de la hoja sin necesitar permiso sobre
 *    ella (corre con los permisos de quien lo implementó).
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('VistaLegajo')
    .setTitle('Legajo por OC · Control documentario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Desde el menú de la hoja: el tablero en una ventana grande. */
function abrirTableroLegajo() {
  var html = HtmlService.createHtmlOutputFromFile('VistaLegajo').setWidth(1280).setHeight(860);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Legajo por OC · Control documentario');
}

/**
 * Todo lo que pinta el tablero, en un solo viaje. Las cuentas (porcentajes,
 * barras, quién debe qué) las hace la página, para que los filtros respondan
 * al instante sin volver a pedir nada.
 */
function datosDelTableroLegajo() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName('TABLA');
  if (!hoja || hoja.getLastRow() < 2) {
    return { error: 'Todavía no hay tabla. En la hoja: menú «Legajo por OC» → «1. Armar tabla…».' };
  }
  var n = hoja.getLastRow() - 1, ancho = hoja.getLastColumn();
  var cab = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(String);
  var valores = hoja.getRange(2, 1, n, ancho).getValues();
  var col = function (nombre) { return cab.indexOf(nombre); };
  var iDocs = DOCS.map(function (d) { return col(d.col); });
  // Los enlaces de cada ✓ (el archivo que lo sustenta).
  var primerDoc = iDocs[0];
  var ricos = primerDoc >= 0 ? hoja.getRange(2, primerDoc + 1, n, DOCS.length).getRichTextValues() : [];

  var zona = Session.getScriptTimeZone();
  var texto = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, zona, 'dd/MM/yyyy');
    return v == null ? '' : String(v).trim();
  };
  var numero = function (v) {
    if (typeof v === 'number') return v;
    var x = Number(String(v || '').replace(/[^\d.-]/g, ''));
    return isNaN(x) ? 0 : x;
  };

  var ocs = valores.map(function (f, k) {
    var marcas = [], enlaces = [], serie = '';
    iDocs.forEach(function (c, j) {
      var t = c >= 0 ? texto(f[c]) : '';
      marcas.push(codigoDeMarca_(t));
      if (j === 0 && /·/.test(t)) serie = t.split('·')[1].trim();
      enlaces.push(ricos.length ? enlaceDeRico_(ricos[k][j]) : '');
    });
    var area = texto(f[col('Área que la completa')]);
    return {
      oc: texto(f[col('OC')]),
      un: texto(f[col('Unidad de negocio')]),
      py: texto(f[col('Proyecto')]),
      pv: texto(f[col('Proveedor')]),
      ru: texto(f[col('RUC (CG)')]),
      cp: texto(f[col('Comprador')]),
      ar: area === NACIONAL ? 'N' : area === COMEX ? 'I' : '',
      si: texto(f[col('Situación del pago')]),
      ms: numero(f[col('Monto en soles')]),
      fe: texto(f[col('Fecha OC')]),
      rq: texto(f[col('N° Requerimiento')]),
      cc: texto(f[col('Nombre del centro de costo (CG)')]) || texto(f[col('Centro de costo (CG)')]),
      es: texto(f[col('Estado de la revisión')]),
      lf: texto(f[col('Le falta')]),
      rv: texto(f[col('Revisar el cruce')]),
      ca: texto(f[col('Enlace de la carpeta')]),
      d: marcas,
      u: enlaces,
      fs: serie
    };
  });

  return {
    titulo: typeof tituloDelModo_ === 'function' ? tituloDelModo_(modoActual_()) : '',
    urlHoja: libro.getUrl(),
    docs: DOCS.map(function (d) {
      return { nombre: d.col.replace(/^\d+\.\s*/, ''), num: d.col.split('.')[0], opcional: !!d.opcional, solo: d.solo || '' };
    }),
    areas: { N: NACIONAL, I: COMEX },
    lectura: estadoDeLaLectura_(libro, ocs),
    ocs: ocs,
    generadoEl: Utilities.formatDate(new Date(), zona, "dd/MM/yyyy 'a las' HH:mm")
  };
}

/** «✓ 2 · F001-123» → s · «✗» → n · «—» → x · «○» → o · «?» → q · vacío (pendiente) → ''. */
function codigoDeMarca_(t) {
  if (!t) return '';
  if (t.charAt(0) === '✓') return 's';
  if (t === '✗') return 'n';
  if (t === '—') return 'x';
  if (t === '○') return 'o';
  if (t === '?') return 'q';
  return '';
}

function enlaceDeRico_(r) {
  if (!r) return '';
  if (r.getLinkUrl()) return r.getLinkUrl();
  var partes = r.getRuns();
  for (var i = 0; i < partes.length; i++) if (partes[i].getLinkUrl()) return partes[i].getLinkUrl();
  return '';
}

/**
 * Cómo va la lectura: si la actualización de cada noche está programada,
 * cuándo es la próxima, cuándo fue la última, y si los revisores están
 * trabajando ahora. Los relojes que ve Apps Script son los de quien corre
 * esto: por eso el tablero se implementa «como yo» (el dueño de los relojes).
 */
function estadoDeLaLectura_(libro, ocs) {
  var zona = Session.getScriptTimeZone();
  var props = PropertiesService.getDocumentProperties();
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, zona, 'yyyy-MM-dd');
  var hora = Number(Utilities.formatDate(ahora, zona, 'H'));
  var proxima = Utilities.parseDate(hoy + ' ' + HORA_NOCTURNA + ':00', zona, 'yyyy-MM-dd H:mm');
  if (hora >= HORA_NOCTURNA) proxima = new Date(proxima.getTime() + 86400000);

  // La última tanda y su resultado, de las dos últimas filas de RESUMEN.
  var ultimaTanda = '', resultado = '';
  var r = libro.getSheetByName('RESUMEN');
  if (r && r.getLastRow() > 1) {
    r.getRange(1, 1, r.getLastRow(), 2).getValues().forEach(function (f) {
      if (f[0] === 'Última tanda') ultimaTanda = f[1] instanceof Date ? Utilities.formatDate(f[1], zona, 'dd/MM/yyyy HH:mm') : String(f[1]);
      if (f[0] === 'Resultado de la última tanda') resultado = String(f[1]);
    });
  }
  var pendientes = ocs.filter(function (o) { return o.es === 'PENDIENTE'; }).length;
  return {
    nocturna: hayActualizacionNocturna_(),
    hora: HORA_NOCTURNA,
    zona: zona,
    proximaMs: proxima.getTime(),
    // «hoy»/«mañana» lo pone la página: Apps Script escribe los días en inglés.
    proximaEsHoy: hora < HORA_NOCTURNA,
    ultimaActualizacion: props.getProperty('LEGAJO_ULTIMA_ACTUALIZACION') || '',
    revisoresActivos: hayAutomatico_(),
    revisores: TRABAJADORES.length,
    cadaMinutos: MINUTOS_ENTRE_TANDAS,
    ultimaTanda: ultimaTanda,
    resultadoTanda: resultado,
    pendientes: pendientes,
    total: ocs.length
  };
}
