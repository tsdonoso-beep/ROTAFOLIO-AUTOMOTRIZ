/**
 * Vista ejecutiva de "COMPROBANTES SUNAT - DETALLE" — publicada como
 * aplicación web
 * --------------------------------------------------------------------------
 *
 * Un enlace propio (no la hoja) para compartir de forma formal: resume el
 * detalle de comprobantes —cuánto, de quién, en qué tipo, cómo se mueve mes
 * a mes— con un botón que abre la hoja real para quien necesite el
 * desglose línea por línea. Con filtros por mes, compras/ventas y moneda,
 * un buscador de TODO lo comprado (con su precio en el tiempo y el PDF de la
 * última compra), proveedores mes a mes, importaciones, centros de costo y
 * cuánto del gasto ya tiene su OC.
 *
 * El servidor ya no manda totales hechos: manda cada comprobante en forma
 * compacta (una fila de números y códigos) y el navegador arma los totales
 * según el filtro. Así los filtros responden al instante sin volver a leer la
 * hoja.
 *
 * Mismo espíritu que `TableroPadron.gs` + `TableroPadron.html`: este archivo
 * calcula los números UNA vez por visita —no tiene sentido bajar cientos de
 * filas al navegador de cada persona solo para sumarlas ahí— y
 * `VistaEjecutivaPagina.html` los pinta. `doGet()` es lo que hace posible
 * publicarlo como su propia URL, distinto de `Tablero.html` (que se abre
 * como diálogo desde el menú de la hoja).
 *
 * ── Instalación ──
 * 1. Abre "COMPROBANTES SUNAT - DETALLE" → Extensiones → Apps Script.
 * 2. Pega esto en un archivo `VistaEjecutiva` (Script) — el `+` junto a
 *    «Archivos» → Script.
 * 3. El `+` → HTML → llámalo `VistaEjecutivaPagina` (un script y un HTML NO
 *    pueden llamarse igual: Apps Script comparte un solo espacio de nombres
 *    entre todos los archivos del proyecto, sin importar el tipo) → pega el
 *    contenido de `VistaEjecutivaPagina.html`.
 * 4. Guarda.
 * 5. Implementar → Nueva implementación → tipo «Aplicación web».
 *    - Ejecutar como: Yo (tu cuenta).
 *    - Quién tiene acceso: «Cualquier usuario con el enlace» (o la variante
 *      de Workspace si solo debe verlo gente de la empresa).
 * 6. Implementar → copia la URL que termina en `/exec`. Esa es la que se
 *    comparte, no la del editor de Apps Script.
 * 7. Cada vez que cambies el código hay que volver a «Gestionar
 *    implementaciones» → el lápiz → Versión «Nueva» → Implementar: una
 *    implementación ya publicada no se actualiza sola con el código nuevo.
 * 8. Para las secciones de compras y legajo (Legajo por OC, Facturas sin OC,
 *    Cambios del robot), que leen directo de la base: engranaje
 *    (Configuración del proyecto) → Propiedades del script → SUPABASE_URL,
 *    SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE, los mismos de
 *    CarpetaMadre.gs. Sin ellas, el resto de la vista funciona igual.
 */

var HOJA_ID_VISTA = '1Kp5RS_7_dIwQDziSsK-vKbuYyCUxtG7VYktk5XkWj_A';
var NOMBRE_PESTANA_VISTA = 'COMPROBANTES SUNAT - DETALLE';
var URL_HOJA_VISTA = 'https://docs.google.com/spreadsheets/d/' + HOJA_ID_VISTA + '/edit';

/** Punto de entrada de la aplicación web. Apps Script lo llama solo al visitar la URL publicada. */
function doGet() {
  return HtmlService.createTemplateFromFile('VistaEjecutivaPagina')
    .evaluate()
    .setTitle('SUNAT · Comprobantes — Vista ejecutiva')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Lo que pide el HTML por `google.script.run`. Nunca lanza: el error viaja en el objeto. */
function datosDeLaVistaEjecutiva() {
  try {
    return datosCompactosVista_();
  } catch (e) {
    return { error: e.message };
  }
}

var VISTA_MAX_PRODUCTOS = 7000; // lo que viaja al navegador para el buscador (los de más gasto primero)

/**
 * Lee la pestaña de detalle una vez y devuelve:
 *   docs      una fila por COMPROBANTE (la hoja trae una por ítem):
 *             [período, origen, proveedor, tipo, moneda, neto, detracción, oc, centro de costo, ¿importación?,
 *              serie-número, fecha de emisión, id del PDF, id del XML,
 *              neto en soles, base gravada, IGV, no gravado, detracción a revisar, tipo de cambio]
 *             (los cuatro montos con la nota de crédito restando; base, IGV y no gravado
 *              en la moneda del comprobante; vacíos —null— si la hoja no los trae)
 *             (origen 0 recibido / 1 emitido / 2 otro; tipo F B C D O; neto con la nota de crédito restando)
 *   productos una fila por producto comprado:
 *             [descripción, unidad, moneda, proveedor, veces, gasto, [[período, precio], …], id del PDF de la última compra]
 *   dic       los textos que se repiten (proveedores, OC, centros de costo, monedas), una sola vez.
 */
function datosCompactosVista_() {
  var libro = SpreadsheetApp.openById(HOJA_ID_VISTA);
  var hoja = libro.getSheetByName(NOMBRE_PESTANA_VISTA) || libro.getSheets()[0];
  var valores = hoja.getDataRange().getValues();
  var cab = valores[0];
  var col = function (nombre) {
    var i = cab.indexOf(nombre);
    if (i === -1) throw new Error('La hoja no trae la columna "' + nombre + '".');
    return i;
  };
  var opc = function (nombre) { return cab.indexOf(nombre); };
  var c = {
    periodo: col('Período'), origen: col('Origen'), ruc: col('RUC proveedor'), proveedor: col('Proveedor'),
    tipo: col('Tipo'), serie: col('Serie'), numero: col('Número'), moneda: col('Moneda'),
    detraccion: col('Detracción'), total: col('Total del comprobante'),
    descripcion: opc('Descripción'), unidad: opc('Unidad'), cantidad: opc('Cantidad'),
    precio: opc('Precio unitario'), importe: opc('Importe'), pdf: opc('PDF'), xml: opc('XML'),
    fecha: opc('Fecha de emisión'), carpeta: opc('Carpeta de la OC'),
    oc: opc('OC (carpeta)'), cc: opc('Centro de costo (CG)'), area: opc('Área que completa el legajo'),
    legajo: opc('Legajo de la OC'), situacion: opc('Situación del pago (OC)'),
    // Desde la migración 053: el IGV desglosado, el total en soles y la detracción a revisar.
    soles: opc('Total en soles'), baseGravada: opc('Base gravada'), igv: opc('IGV del comprobante'),
    noGravado: opc('No gravado (inafecto / exonerado)'), detRevisar: opc('Detracción: revisar'), tc: opc('Tipo de cambio')
  };
  // Un número de la hoja, o null si la columna no está o la celda está vacía.
  var numOpc = function (f, i) { return i >= 0 && f[i] !== '' && f[i] != null ? Number(f[i]) : null; };
  var txt = function (f, i) { return i >= 0 ? String(f[i] == null ? '' : f[i]).trim() : ''; };

  // Diccionarios: cada texto repetido viaja una vez y las filas llevan su número.
  var dic = { prov: [], oc: [], cc: [], moneda: [] }, idx = { prov: {}, oc: {}, cc: {}, moneda: {} };
  var cod = function (tabla, clave, valor) {
    if (!clave) return -1;
    if (!(clave in idx[tabla])) { idx[tabla][clave] = dic[tabla].length; dic[tabla].push(valor === undefined ? clave : valor); }
    return idx[tabla][clave];
  };

  var vistos = {}, docs = [], productos = {};
  for (var r = 1; r < valores.length; r++) {
    var f = valores[r];
    if (!f[c.ruc] && !f[c.serie]) continue;
    var origen = txt(f, c.origen), tipo = txt(f, c.tipo), moneda = txt(f, c.moneda) || 'PEN', periodo = txt(f, c.periodo);
    var esNota = /cr[eé]dito/i.test(tipo);
    var prov = cod('prov', txt(f, c.ruc) || txt(f, c.proveedor), [txt(f, c.ruc), txt(f, c.proveedor)]);
    var mon = cod('moneda', moneda);

    // Producto (solo compras de verdad: ni ventas, ni notas, ni líneas de anticipo en negativo).
    if (origen === 'Recibido' && !/nota/i.test(tipo) && c.descripcion >= 0 && c.precio >= 0) {
      var desc = txt(f, c.descripcion).replace(/\s+/g, ' ');
      var precio = Number(f[c.precio]) || 0;
      if (desc.length >= 3 && precio > 0) {
        var unidad = txt(f, c.unidad);
        var k = desc.toUpperCase() + '|' + unidad.toUpperCase() + '|' + mon + '|' + prov;
        var p = productos[k] || (productos[k] = { desc: desc, unidad: unidad, mon: mon, prov: prov, veces: 0, gasto: 0, meses: {}, ult: '', pdf: '' });
        var cant = c.cantidad >= 0 ? Number(f[c.cantidad]) || 0 : 0;
        var imp = c.importe >= 0 ? Number(f[c.importe]) || 0 : 0;
        var m = p.meses[periodo] || (p.meses[periodo] = { cant: 0, imp: 0, suma: 0, n: 0 });
        if (cant > 0 && imp > 0) { m.cant += cant; m.imp += imp; }
        m.suma += precio; m.n++;
        p.veces++; p.gasto += imp > 0 ? imp : precio * (cant || 1);
        if (periodo >= p.ult) { p.ult = periodo; p.pdf = idDrive_(txt(f, c.pdf)) || p.pdf; }
      }
    }

    var clave = [f[c.ruc], tipo, f[c.serie], f[c.numero], origen].join('|');
    if (vistos[clave]) continue;
    vistos[clave] = true;
    var oc = txt(f, c.oc);
    var impo = /COMEX|IMPORTA/i.test(txt(f, c.area)) || oc.split(' / ').some(function (o) { return /^\d{3}-\d{4}$/.test(o.trim()); });
    docs.push([
      periodo,
      origen === 'Recibido' ? 0 : origen === 'Emitido' ? 1 : 2,
      prov,
      esNota ? 'C' : /d[eé]bito/i.test(tipo) ? 'D' : /boleta/i.test(tipo) ? 'B' : /factura/i.test(tipo) ? 'F' : 'O',
      mon,
      redondear2_((esNota ? -1 : 1) * Math.abs(Number(f[c.total]) || 0)),
      redondear2_(Number(f[c.detraccion]) || 0),
      cod('oc', oc, [oc, txt(f, c.legajo), txt(f, c.situacion), idDrive_(txt(f, c.carpeta))]),
      cod('cc', txt(f, c.cc) === '-' ? '' : txt(f, c.cc)),
      impo ? 1 : 0,
      // Para el buscador de facturas:
      txt(f, c.serie).toUpperCase() + '-' + (txt(f, c.numero).replace(/^0+(?=\d)/, '')),
      fechaTexto_(c.fecha >= 0 ? f[c.fecha] : ''),
      idDrive_(txt(f, c.pdf)),
      idDrive_(txt(f, c.xml)),
      // Todo en soles, el IGV desglosado y la detracción a revisar:
      conSigno_(esNota, moneda === 'PEN' ? Number(f[c.total]) : numOpc(f, c.soles)),
      conSigno_(esNota, numOpc(f, c.baseGravada)),
      conSigno_(esNota, numOpc(f, c.igv)),
      conSigno_(esNota, numOpc(f, c.noGravado)),
      txt(f, c.detRevisar),
      moneda === 'PEN' ? 1 : numOpc(f, c.tc)
    ]);
  }

  // Productos: los de más gasto primero, con su precio de cada mes.
  var lista = [];
  for (var kp in productos) {
    var x = productos[kp];
    var serie = Object.keys(x.meses).sort().map(function (per) {
      var mm = x.meses[per];
      return [per, redondear4_(mm.cant > 0 ? mm.imp / mm.cant : mm.suma / mm.n)];
    });
    lista.push([x.desc.slice(0, 140), x.unidad, x.mon, x.prov, x.veces, redondear2_(x.gasto), serie, x.pdf]);
  }
  lista.sort(function (a, b) { return b[5] - a[5]; });

  return {
    error: null,
    urlHoja: URL_HOJA_VISTA,
    generadoEl: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Lima', "d 'de' MMMM 'de' yyyy, HH:mm"),
    dic: dic,
    docs: docs,
    productos: lista.slice(0, VISTA_MAX_PRODUCTOS),
    totalProductos: lista.length,
    lineas: valores.length - 1
  };
}

/**
 * El detalle de UN comprobante (sus líneas), para cuando alguien lo abre en
 * el buscador de facturas. Se busca con TextFinder en la columna «Número»:
 * no hace falta volver a leer toda la hoja.
 */
function detalleDelComprobante(ruc, serie, numero) {
  try {
    var hoja = SpreadsheetApp.openById(HOJA_ID_VISTA).getSheetByName(NOMBRE_PESTANA_VISTA);
    var cab = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var i = function (n) { return cab.indexOf(n); };
    var iNum = i('Número'), iRuc = i('RUC proveedor'), iSerie = i('Serie');
    if (iNum < 0) return { error: 'La hoja no trae la columna «Número».' };
    var sinCeros = function (v) { return String(v == null ? '' : v).trim().replace(/^0+(?=\d)/, ''); };
    var celdas = hoja.getRange(2, iNum + 1, hoja.getLastRow() - 1, 1)
      // El número exacto, con o sin ceros a la izquierda («77725» o «00077725»).
      .createTextFinder('^0*' + sinCeros(numero).replace(/\D/g, '') + '$').useRegularExpression(true).findAll();
    var filas = [];
    celdas.forEach(function (celda) {
      if (sinCeros(celda.getValue()) !== sinCeros(numero)) return;
      var f = hoja.getRange(celda.getRow(), 1, 1, cab.length).getValues()[0];
      if (String(f[iRuc]).trim() !== String(ruc).trim() || String(f[iSerie]).trim().toUpperCase() !== String(serie).toUpperCase()) return;
      filas.push(f);
    });
    if (!filas.length) return { error: 'No se encontró el comprobante en la hoja.' };
    var v = function (f, n) { var k = i(n); return k >= 0 ? f[k] : ''; };
    filas.sort(function (a, b) { return (Number(v(a, 'Línea')) || 0) - (Number(v(b, 'Línea')) || 0); });
    var f0 = filas[0];
    return {
      lineas: filas.map(function (f) {
        return [String(v(f, 'Descripción')), Number(v(f, 'Cantidad')) || 0, String(v(f, 'Unidad')), Number(v(f, 'Precio unitario')) || 0, Number(v(f, 'Importe')) || 0];
      }),
      formaPago: String(v(f0, 'Forma de pago')), guia: String(v(f0, 'Guía de remisión')),
      ocProveedor: String(v(f0, 'Orden de compra')), cc: String(v(f0, 'Centro de costo (CG)')),
      comprador: String(v(f0, 'Comprador (OC)')), detraccion: Number(v(f0, 'Detracción')) || 0
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** «12/09/2026» venga como fecha o como texto. */
function fechaTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'America/Lima', 'dd/MM/yyyy');
  return String(v == null ? '' : v).trim();
}

/** El ID de un enlace de Drive (…/file/d/ID/…, …?id=ID), para no mandar la URL entera. */
function idDrive_(url) {
  var m = /\/d\/([\w-]{20,})/.exec(url) || /[?&]id=([\w-]{20,})/.exec(url);
  return m ? m[1] : '';
}

function redondear2_(n) { return Math.round(n * 100) / 100; }
/** Un monto con la nota de crédito restando; null sigue siendo null (dato que no hay). */
function conSigno_(esNota, n) { return n == null || isNaN(n) ? null : redondear2_((esNota ? -1 : 1) * Math.abs(n)); }
function redondear4_(n) { return Math.round(n * 10000) / 10000; }

// ── Compras y legajo: directo de la base ──
//
// Lo mismo que la hoja GENERAL trae con CarpetaMadre.gs, pero para la vista:
// cada carpeta de OC de las carpetas madre (carpetas_madre), las facturas de
// SUNAT que aparentan no tener OC (facturas_sin_oc) y lo que cambió en las
// carpetas (carpeta_cambio). La página lo pide aparte, después de pintar lo
// de SUNAT, para no demorar la primera carga.

var VISTA_RUC = '20512201611';

function datosDeLaBaseVista() {
  try {
    var cfg = configuracionBaseVista_();
    var faltan = ['url', 'anon', 'correo', 'clave'].filter(function (k) { return !cfg[k]; });
    if (faltan.length) {
      return { error: 'Faltan las Propiedades del script de esta vista: SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO y ROBOT_CLAVE ' +
        '(Apps Script → engranaje → Propiedades del script; los mismos valores de CarpetaMadre.gs).' };
    }
    var token = sesionBaseVista_(cfg);
    var idCarpeta = function (u) { var m = /folders\/([\w-]{10,})/.exec(u || ''); return m ? m[1] : ''; };
    var carpetas = paginasBaseVista_(cfg, token, 'rpc/carpetas_madre', { p_empresa_ruc: VISTA_RUC }, 'order=procedencia.desc,oc,carpeta_url')
      .map(function (f) {
        return [f.procedencia === 'Importación' ? 1 : 0, f.area_responsable || '', f.comprador || '', f.situacion_pago || '', f.forma_pago || '',
          f.oc, f.proveedor || '', String(f.proyecto_carpeta || '').trim(), f.carpeta_nombre || '', idCarpeta(f.carpeta_url),
          f.estado || '', f.le_falta || '', f.documentos || '', f.facturas_sunat_n || 0, f.cc_nombre || '',
          f.ultimo_cambio || '', f.ultimo_cambio_fecha || '', f.cargado_en || ''];
      });
    var sinOc = paginasBaseVista_(cfg, token, 'rpc/facturas_sin_oc', { p_empresa_ruc: VISTA_RUC },
      'senal=in.(ALTA,MEDIA)&order=senal,total.desc,proveedor_ruc,serie,numero')
      .map(function (f) {
        return [f.senal, f.razon || '', f.area_probable || '', f.comprador_probable || '', f.fecha_emision || '', f.proveedor_ruc,
          f.proveedor_nombre || '', f.serie + '-' + f.numero, f.moneda || 'PEN', Number(f.total) || 0, f.ocs_del_proveedor || '',
          idDrive_(f.enlace_pdf || '')];
      });
    var cambios = pedirBaseVista_(cfg, token, 'get', 'carpeta_cambio?select=fecha,procedencia,oc,tipo,detalle,carpeta_url' +
      '&empresa_ruc=eq.' + VISTA_RUC + '&order=fecha.desc,id.desc&limit=500')
      .map(function (f) { return [f.fecha, f.procedencia === 'Importación' ? 1 : 0, f.oc, f.tipo, f.detalle || '', idCarpeta(f.carpeta_url)]; });
    return { error: null, carpetas: carpetas, sinOc: sinOc, cambios: cambios };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/**
 * El detalle de UNA carpeta de OC (al abrir una fila de «Legajo por OC»): sus
 * archivos con el documento que es cada uno, los datos de la OC, las facturas
 * de SUNAT unidas, los cambios y las otras carpetas con el mismo número.
 */
function detalleDeCarpetaVista(idCarpeta) {
  try {
    var cfg = configuracionBaseVista_();
    if (!cfg.url || !cfg.anon || !cfg.correo || !cfg.clave) return { error: 'Faltan las Propiedades del script de la base.' };
    var d = pedirBaseVista_(cfg, sesionBaseVista_(cfg), 'post', 'rpc/detalle_de_carpeta', { p_carpeta: String(idCarpeta || '') });
    return d ? { error: null, d: d } : { error: 'La base no tiene esa carpeta.' };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function configuracionBaseVista_() {
  var p = PropertiesService.getScriptProperties();
  var limpio = function (k) { return String(p.getProperty(k) || '').trim().replace(/^["'«“]+|["'»”]+$/g, '').trim(); };
  return { url: limpio('SUPABASE_URL').replace(/\/+$/, ''), anon: limpio('SUPABASE_ANON_KEY'),
           correo: limpio('ROBOT_CORREO'), clave: limpio('ROBOT_CLAVE') };
}

function sesionBaseVista_(cfg) {
  var r = UrlFetchApp.fetch(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', headers: { apikey: cfg.anon },
    payload: JSON.stringify({ email: cfg.correo, password: cfg.clave }), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error('La base rechazó la cuenta ROBOT (error ' + r.getResponseCode() + '): revisa las Propiedades del script.');
  return JSON.parse(r.getContentText()).access_token;
}

function pedirBaseVista_(cfg, token, metodo, ruta, cuerpo) {
  var o = { method: metodo, headers: { apikey: cfg.anon, Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (cuerpo) { o.contentType = 'application/json'; o.payload = JSON.stringify(cuerpo); }
  var r = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + ruta, o);
  if (r.getResponseCode() >= 300) throw new Error(ruta.split('?')[0] + ' falló: ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

/** La base entrega como mucho 1000 filas por consulta: se piden por páginas. */
function paginasBaseVista_(cfg, token, ruta, args, consulta) {
  var todo = [];
  for (var desde = 0; ; desde += 1000) {
    var parte = pedirBaseVista_(cfg, token, 'post', ruta + '?' + consulta + '&limit=1000&offset=' + desde, args);
    todo = todo.concat(parte);
    if (parte.length < 1000) return todo;
  }
}
