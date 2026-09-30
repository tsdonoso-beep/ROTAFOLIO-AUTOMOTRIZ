/**
 * Legajo por OC — la tabla objetivo de un proyecto (o de todo 2026)
 * --------------------------------------------------------------------------
 *
 * Arma una fila por OC con lo que Contabilidad necesita para registrar la
 * compra en CONCAR, y marca qué documento está y cuál falta en la carpeta
 * (legajo) de cada OC. Dos formas de armar la lista de OC (menú):
 *   · de UN proyecto (el piloto es EPT), cruzando sus cuatro fuentes;
 *   · de TODO el cuadro de aprobaciones 2026: todos sus enlaces, de todas
 *     las unidades de negocio.
 * Los documentos que se buscan:
 *
 *   1 Factura · 2 OC · 3 SWIFT · 4 Guía de remisión · 5 DAM · 6 Requerimiento
 *   7 Contrato (CECO) · 8 Cotización · 9 Proforma · 10 Correos
 *   11 Acta de conformidad
 *
 * La fuente de verdad es el plan de compras del proyecto: de ahí salen las
 * OC. Se cruza en los dos sentidos con el cuadro de aprobaciones y con la
 * base de Control de Gestión, para que salten las que están en un lado y no
 * en el otro. Las carpetas se buscan con la misma lógica que la captura de
 * carpetas de OC: todas las subcarpetas, palabras parecidas, errores de
 * tipeo, y la carpeta donde está el archivo como pista.
 *
 * Las bases originales SOLO SE LEEN. Todo se escribe en la hoja donde está
 * pegado este script:
 *   · TABLA     una fila por OC, con ✓ / ✗ por documento (el ✓ abre el archivo).
 *   · ARCHIVOS  una fila por archivo encontrado, para revisar a mano.
 *   · RESUMEN   % de cada documento por área (Compras nacionales / COMEX) y
 *               lo que no calzó en el cruce de fuentes.
 *
 * Qué significa cada marca:
 *   ✓ n  hay n archivos de ese tipo (el enlace abre el primero)
 *   ✗    falta y le corresponde
 *   —    no le corresponde (SWIFT y DAM solo en importaciones; guía solo en
 *        bienes; acta solo en servicios; el contrato va una vez por centro
 *        de costo, no por OC)
 *   ○    no está, pero es opcional (proforma, correos)
 *
 * ── Instalación ──
 * 1. Crea una hoja NUEVA en tu unidad (no la de la captura de carpetas: este
 *    script usa nombres de funciones que chocarían con aquel).
 * 2. Extensiones → Apps Script → borra lo que haya, pega este archivo, guarda.
 * 3. Para leer por dentro los PDF escaneados sin nombre claro («docs
 *    proveedor oc150-2026.pdf»): a la izquierda, Servicios (+) → «Drive API»
 *    → Agregar. Sin esto funciona igual, solo que no los lee.
 *    Recarga la hoja: aparece el menú «Legajo por OC».
 * 4. «1. Armar tabla del proyecto» o «1. Armar tabla de TODO el cuadro de
 *    aprobaciones 2026» (la primera vez pide permisos). Para tener las dos,
 *    usa dos hojas nuevas, cada una con este script: corren a la vez.
 * 5. «Revisar solo (3 en paralelo)»: tres revisores recorren las carpetas a
 *    la vez, por tandas, y se detienen al terminar. El avance, en RESUMEN.
 * 6. «Programar actualización cada noche (20:00)»: cada noche se vuelve a
 *    leer el cuadro de aprobaciones (que está en vivo), se suman las OC
 *    nuevas, se actualizan estatus, aprobaciones y montos, y se revisan solo
 *    las carpetas nuevas o con faltantes. Lo ya revisado se conserva. Para
 *    hacerlo en el momento: «Actualizar ahora desde el cuadro».
 *
 * Las columnas del cuadro se buscan por su NOMBRE (o uno parecido), no por
 * su posición: si Compras agrega o mueve columnas, se siguen encontrando. La
 * pestaña COLUMNAS dice dónde encontró cada una.
 */

// ── Configuración ──
var PROYECTO = {
  nombre: 'EPT',
  // Plan de compras del proyecto (la fuente de verdad de sus OC).
  planId: '1xjuJjzXM9j3kGBFHnyQ0sctZATeQ3Rx-pRwzDUFN-xU',
  // Cómo se reconoce el proyecto en el cuadro de aprobaciones y en Control
  // de Gestión (columna «Proyecto» y centro de costo).
  patron: /2025-077|TALLERES EPT/i
};
// Para Talleres Especializados sería:
//   nombre: 'ESPECIALIZADO', planId: '12RxCea4e5ggM7QGn1XE3FbLQa_-QbCNdBi90OdPjRqg',
//   patron: /2025-079|TALLERES ESPECIALIZADO/i

var APROBACIONES_ID = '131xCspAwghR92k4nXAq2jtyDQgeXNJ1UQuYD1GFz-BA';
var APROBACIONES_PESTANA = 'Cuadro de aprobaciones 1';
var CG_ID = '1tsu4HEA_o_yWdvvJCF5zhlrW_ffzMXiqtzMiRzMlxCY';
var CG_PESTANA = '3. Registro Compras Grupo';
var EMPRESA = 'INROPRIN';        // (modo proyecto) las OC de Inroplas tienen otra numeración
var MINUTOS_POR_TANDA = 4;       // Apps Script corta a los 6; el resto es para escribir
var MINUTOS_ENTRE_TANDAS = 10;
var DIAS_PARA_REVISAR_FALTANTES = 7; // en la actualización nocturna, una OC a la que le falta algo se vuelve a mirar cada tantos días
var HORA_NOCTURNA = 20;          // la actualización automática desde el cuadro: 8 PM (zona horaria del proyecto)
var LIMITE_ARCHIVOS = 800;       // más que esto: el enlace es de una carpeta general, no de la OC
// Leer por dentro (OCR) los PDF e imágenes que el nombre no delata («docs
// solpack oc150-2026.pdf», «scan001.pdf»), solo si a la OC le falta factura,
// guía, DAM o acta. Necesita el servicio «Drive API» (Servicios + → Drive API).
var LEER_DOCUMENTOS = true;
var LEER_POR_OC = 6;             // cuántos archivos como mucho se leen por OC (para antes si ya no falta nada)
var CARPETA_TEMPORAL = '_lectura_legajo_temporal';

// Los 11 documentos, en el orden de la pizarra.
//   solo:     IMPO = solo importaciones · BIEN = no aplica a servicios · SERVICIO = solo servicios
//   opcional: si no está, «○» en vez de «✗»
//   porCeco:  va una vez por centro de costo; si no está en la carpeta, «—»
var DOCS = [
  { col: '1. Factura', clave: 'FACTURA' },
  { col: '2. OC', clave: 'OC' },
  { col: '3. SWIFT', clave: 'SWIFT', solo: 'IMPO' },
  { col: '4. Guía de remisión', clave: 'GUIA', solo: 'BIEN' },
  { col: '5. DAM', clave: 'DAM', solo: 'IMPO' },
  { col: '6. Requerimiento', clave: 'REQ' },
  { col: '7. Contrato (CECO)', clave: 'CONTRATO', porCeco: true },
  { col: '8. Cotización', clave: 'COTIZACION' },
  { col: '9. Proforma', clave: 'PROFORMA', opcional: true },
  { col: '10. Correos', clave: 'CORREO', opcional: true },
  { col: '11. Acta de conformidad', clave: 'ACTA', solo: 'SERVICIO' }
];

// Lo que se trae del cuadro de aprobaciones para Contabilidad. Cada campo se
// busca por el nombre de su columna, o por uno PARECIDO (ver `leerTabla_`):
// si alguien inserta, mueve o renombra un poco una columna, se sigue hallando.
// La pestaña COLUMNAS dice, en cada actualización, dónde encontró cada uno.
//   numero: se escribe como número (para poder sumar), si hay un solo valor.
var CAMPOS_APROBACIONES = [
  { col: 'Fecha OC', buscar: ['Fecha', 'Fecha OC', 'Fecha de OC'] },
  { col: 'Comprador', buscar: ['Comprador'] },
  { col: 'Concepto', buscar: ['Concepto'] },
  { col: 'Estatus (aprobaciones)', buscar: ['Estatus Compra', 'Estado de compra', 'Estatus'] },
  { col: 'Estado de aprobación', buscar: ['Estado de Aprobación'] },
  { col: 'Tipo de aprobación', buscar: ['Tipo de aprobación'] },
  { col: 'Aprobación Ppto', buscar: ['Aprobación Ppto', 'Aprobación Presupuesto'] },
  { col: 'Aprobación GOP', buscar: ['Aprobación GOP'] },
  { col: 'Aprobación GAF', buscar: ['Aprobación GAF'] },
  { col: 'VB Control de Gestión', buscar: ['VB C. GESTION', 'VB Control de Gestión', 'Check Control Gestión'] },
  { col: 'Condición', buscar: ['Condición'] },
  { col: 'Monto (con IGV)', buscar: ['Monto', 'Monto con IGV'], numero: true },
  { col: 'Moneda', buscar: ['Moneda original', 'Moneda'] },
  { col: 'Monto en soles', buscar: ['Monto en Soles'], numero: true },
  { col: 'Forma de pago', buscar: ['Forma de pago'] },
  { col: '% adelanto', buscar: ['% adelanto', 'Porcentaje de adelanto', 'Adelanto'], numero: true },
  { col: 'Días de crédito', buscar: ['Días de crédito', 'Dias credito'], numero: true },
  { col: 'Legajo para pago (aprobaciones)', buscar: ['LEGAJO PARA PAGO'] },
  { col: 'Comentario legajo incompleto', buscar: ['COMENTARIOS POR LEG. INCOMPLETO', 'Comentarios por legajo incompleto'] },
  { col: 'OC cerrada', buscar: ['OC CERRADA'] },
  { col: 'Cuadro de pagos', buscar: ['Cuadro de pagos'] },
  { col: 'Observación finanzas', buscar: ['Observación finanzas', 'Observaciones finanzas'] },
  { col: 'Criterio observación finanzas', buscar: ['Criterio de observación finanzas'] },
  { col: 'Comentarios compras', buscar: ['Comentarios compras'] },
  { col: 'Observaciones Control de Gestión', buscar: ['OBSERVACIONES CONTROL DE GESTIÓN'] }
];

var CAB_DATOS = ['OC', 'Unidad de negocio', 'Proyecto', 'Aparece en', 'Procedencia', 'Área que la completa', 'Proveedor',
  'RUC (CG)', 'N° Requerimiento', 'Centro de costo (CG)', 'Nombre del centro de costo (CG)',
  'Código SIDIGE (CG)', 'Ítems en el plan', 'Estado de compra (plan)', 'Situación del pago']
  .concat(CAMPOS_APROBACIONES.map(function (c) { return c.col; }),
    ['Bien o servicio', 'Enlace de la carpeta', 'Revisar el cruce']);
var CAB_REVISION = ['Estado de la revisión', 'Archivos'].concat(
  DOCS.map(function (d) { return d.col; }), ['Le falta', 'Revisado en']);
var CAB_TABLA = CAB_DATOS.concat(CAB_REVISION);
var COL_ESTADO = CAB_DATOS.length + 1;       // primera columna que llena la revisión
var COL_PRIMER_DOC = COL_ESTADO + 2;
var I_PROC = CAB_DATOS.indexOf('Procedencia');
var I_TIPO = CAB_DATOS.indexOf('Bien o servicio');
var I_LINK = CAB_DATOS.indexOf('Enlace de la carpeta');
var I_REQ = CAB_DATOS.indexOf('N° Requerimiento');
var I_AREA = CAB_DATOS.indexOf('Área que la completa');
var I_UNIDAD = CAB_DATOS.indexOf('Unidad de negocio');
var I_APARECE = CAB_DATOS.indexOf('Aparece en');
var I_REVISAR = CAB_DATOS.indexOf('Revisar el cruce');
var I_SITUACION = CAB_DATOS.indexOf('Situación del pago');

// Los revisores que corren a la vez. Cada uno toma una fila de cada tres.
var TRABAJADORES = ['trabajadorLegajo1', 'trabajadorLegajo2', 'trabajadorLegajo3'];
function trabajadorLegajo1() { revisarTanda_(0, TRABAJADORES.length); }
function trabajadorLegajo2() { revisarTanda_(1, TRABAJADORES.length); }
function trabajadorLegajo3() { revisarTanda_(2, TRABAJADORES.length); }

var MODO_PROYECTO = 'PROYECTO', MODO_APROBACIONES = 'APROBACIONES';

function modoActual_() {
  return PropertiesService.getDocumentProperties().getProperty('LEGAJO_MODO') || MODO_PROYECTO;
}

function tituloDelModo_(modo) {
  return modo === MODO_APROBACIONES ? 'todo el cuadro de aprobaciones 2026' : 'el proyecto ' + PROYECTO.nombre;
}

var CAB_ARCHIVOS = ['OC', 'Área', 'Enlace carpeta OC', 'Ubicación', 'Nombre del archivo',
  'Enlace del archivo', 'Tipo de archivo', 'Parece ser', 'Cuenta como', 'Pistas', 'Creado'];

var NACIONAL = 'Compras nacionales', COMEX = 'COMEX (importaciones)';

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu('Legajo por OC');
  // El tablero (VistaLegajo.gs + TableroLegajo.html), si está en el proyecto.
  if (typeof abrirTableroLegajo === 'function') menu.addItem('📊 Abrir el tablero', 'abrirTableroLegajo').addSeparator();
  menu
    .addItem('1. Armar tabla del proyecto ' + PROYECTO.nombre, 'armarTablaLegajo')
    .addItem('1. Armar tabla de TODO el cuadro de aprobaciones 2026', 'armarTablaAprobaciones')
    .addItem('2. Revisar siguiente tanda', 'revisarTandaLegajo')
    .addSeparator()
    .addItem('Actualizar ahora desde el cuadro (conserva lo revisado)', 'actualizarAhora')
    .addItem('Programar actualización cada noche (' + HORA_NOCTURNA + ':00)', 'programarActualizacionNocturna')
    .addItem('Quitar actualización nocturna', 'quitarActualizacionNocturna')
    .addSeparator()
    .addItem('Revisar solo (' + TRABAJADORES.length + ' en paralelo, cada ' + MINUTOS_ENTRE_TANDAS + ' min)', 'activarLegajoAutomatico')
    .addItem('Detener revisión automática', 'detenerLegajoAutomatico')
    .addSeparator()
    .addItem('Volver a revisar las «SIN ACCESO»', 'reintentarSinAcceso')
    .addItem('Volver a revisar las que NO tienen factura', 'reintentarSinFactura')
    .addItem('Probar la lectura por dentro (OCR)', 'probarLectura')
    .addItem('Rehacer el resumen', 'rehacerResumenLegajo');
  // La subida a la base (SubirLegajo.gs), si está en el proyecto.
  if (typeof subirLegajoALaBase === 'function') {
    menu.addSeparator().addItem('Subir el legajo a la base (hojas de SUNAT)', 'subirLegajoALaBase');
  }
  menu.addToUi();
}

/**
 * El script lee Drive con los permisos de quien lo corre (y el automático,
 * con los de quien lo activó). Las carpetas que quedaron «SIN ACCESO» vuelven
 * a PENDIENTE para que las revise otra persona que sí tenga acceso: ella usa
 * esta opción y después «Revisar solo» desde su cuenta, en esta misma hoja.
 */
function reintentarSinAcceso() {
  reintentar_(function (f) { return /^SIN ACCESO/.test(String(f[COL_ESTADO - 1])); }, '«SIN ACCESO»',
    'desde la cuenta que SÍ tiene acceso');
}

/** Para después de activar la lectura por dentro: solo las OC con la factura en ✗. */
function reintentarSinFactura() {
  var iFactura = COL_PRIMER_DOC - 1; // «1. Factura» es la primera de las 11
  reintentar_(function (f) { return String(f[iFactura]) === '✗'; }, 'sin factura',
    'con el servicio «Drive API» activado, para que lea por dentro los PDF escaneados');
}

/**
 * Devuelve a PENDIENTE las filas que cumplen `condicion`, y borra de
 * ARCHIVOS lo que se había anotado de ellas (si no, saldrían dos veces).
 */
function reintentar_(condicion, que, consejo) {
  var ui = SpreadsheetApp.getUi();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaT = libro.getSheetByName('TABLA');
  if (!hojaT || hojaT.getLastRow() < 2) return;
  // Si queda el automático (de otra persona o de antes), se detiene.
  detenerLegajoAutomatico_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(150000)) {
    ui.alert('Hay una tanda escribiendo', 'Espera un par de minutos y vuelve a intentarlo.', ui.ButtonSet.OK);
    return;
  }
  try {
    var tabla = hojaT.getRange(2, 1, hojaT.getLastRow() - 1, CAB_TABLA.length).getValues();
    var claves = {}, n = 0;
    var estados = tabla.map(function (f) {
      if (!condicion(f)) return [f[COL_ESTADO - 1]];
      claves[f[0] + '|' + f[I_LINK]] = true;
      n++;
      return ['PENDIENTE'];
    });
    hojaT.getRange(2, COL_ESTADO, estados.length, 1).setValues(estados);

    var hojaA = libro.getSheetByName('ARCHIVOS');
    if (n && hojaA && hojaA.getLastRow() > 1) {
      var filas = hojaA.getRange(2, 1, hojaA.getLastRow() - 1, CAB_ARCHIVOS.length).getValues();
      var quedan = filas.filter(function (a) { return !claves[a[0] + '|' + a[2]]; });
      if (quedan.length < filas.length) {
        hojaA.getRange(2, 1, filas.length, CAB_ARCHIVOS.length).clearContent();
        if (quedan.length) hojaA.getRange(2, 1, quedan.length, CAB_ARCHIVOS.length).setValues(quedan);
      }
    }
    actualizarResumen_(libro, n + ' OC ' + que + ' volvieron a PENDIENTE (' + Session.getActiveUser().getEmail() + ').');
  } finally {
    lock.releaseLock();
  }
  ui.alert('Listo', n + ' OC ' + que + ' vuelven a PENDIENTE.\n\n' +
    'Ahora «Revisar solo (' + TRABAJADORES.length + ' en paralelo)», ' + consejo + '.', ui.ButtonSet.OK);
}

/**
 * Prueba la lectura por dentro con un archivo de ARCHIVOS que no dice qué
 * es, y muestra lo que encontró. Sirve para confirmar que el servicio Drive
 * API y los permisos están bien antes de dejarlo corriendo.
 */
function probarLectura() {
  var ui = SpreadsheetApp.getUi();
  var lectura = prepararLectura_();
  if (!lectura.activa) {
    ui.alert('La lectura NO está activa', 'Falta el servicio «Drive API».\n\nEn Apps Script: a la izquierda, ' +
      '«Servicios» (+) → busca «Drive API» → Agregar. Guarda y vuelve a probar.', ui.ButtonSet.OK);
    return;
  }
  var hojaA = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ARCHIVOS');
  var filas = hojaA && hojaA.getLastRow() > 1 ? hojaA.getRange(2, 1, hojaA.getLastRow() - 1, CAB_ARCHIVOS.length).getValues() : [];
  var elegido = null;
  for (var i = 0; i < filas.length && !elegido; i++) {
    var nombre = textoPlano_(filas[i][4]);
    if (/PDF|Imagen/.test(filas[i][6]) && /(^| )(DOCS?|DOSC|SCAN)( |$)/.test(nombre)) elegido = filas[i];
  }
  for (var j = 0; j < filas.length && !elegido; j++) if (/PDF|Imagen/.test(filas[j][6])) elegido = filas[j];
  if (!elegido) { ui.alert('Sin archivos', 'Primero revisa algunas carpetas, para tener archivos en ARCHIVOS.', ui.ButtonSet.OK); return; }
  var r = leerPorDentro_({ id: idDeDrive_(elegido[5]) || idDeArchivo_(elegido[5]), tipo: elegido[6] }, lectura);
  ui.alert(r.error ? 'No se pudo leer' : 'La lectura funciona',
    'Archivo: ' + elegido[4] + ' (OC ' + elegido[0] + ')\n\n' +
    (r.error ? 'Error: ' + r.error + (lectura.aviso ? '\n\n' + lectura.aviso : '') :
      'Encontró: ' + (r.claves.length ? r.claves.map(nombreDeClave_).join(', ') : '(ningún documento reconocible)') +
      (r.tipo ? '\nComprobante: ' + r.tipo + ' ' + (r.serie || '(sin serie legible)') : '')), ui.ButtonSet.OK);
}

/** El ID de un enlace de archivo de Drive: …/file/d/ID/…, …?id=ID. */
function idDeArchivo_(url) {
  var m = /\/d\/([\w-]{20,})/.exec(String(url || '')) || /[?&]id=([\w-]{20,})/.exec(String(url || ''));
  return m ? m[1] : '';
}

/** «OC 2601-0001 (II)» → «2601-0001»: para las OC que no tienen forma NNNN-AAAA (Inroplas). */
function ocCruda_(texto) {
  return String(texto == null ? '' : texto).replace(/\(.*?\)/g, '').replace(/^\s*O[CS]\s*[-.:#°]?\s*/i, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Arma la tabla desde las fuentes. Con `conservar` (la actualización de cada
 * noche) no empieza de cero: las OC que ya se revisaron y siguen con la misma
 * carpeta guardan su revisión, y solo quedan PENDIENTE las nuevas, las que
 * cambiaron de carpeta, las sin acceso, las que aún no tienen factura y las
 * que tienen faltantes revisados hace más de DIAS_PARA_REVISAR_FALTANTES.
 * La revisión anterior se lee por el NOMBRE de sus columnas, así que sirve
 * aunque la tabla haya cambiado de forma entre versiones del script.
 */
function armarTabla_(libro, modo, conservar) {
  var todo2026 = modo === MODO_APROBACIONES;
  var ocs = {}, orden = [];
  // En el modo proyecto todas son de EMPRESA; en el de todo 2026 la misma OC
  // puede existir en Inroprin y en Inroplas, así que la unidad va en la clave.
  var claveDe = function (unidad, oc) { return todo2026 ? normalizar_(unidad) + '|' + oc : oc; };
  // En todo 2026, además: Inroplas repite el mismo número para compras
  // distintas (la 2601-0007 es una compra nacional, un servicio y una
  // importación, cada una con su proveedor). `distinguir` (procedencia +
  // proveedor) las separa; las partes (I), (II) de una misma OC, que tienen
  // el mismo proveedor, siguen juntas.
  var porBase = {};
  var registro = function (unidad, oc, distinguir) {
    var base = claveDe(unidad, oc);
    var k = todo2026 && distinguir ? base + '|' + distinguir : base;
    if (!ocs[k]) {
      ocs[k] = { oc: oc, base: base, unidad: [], proyecto: [], fuentes: {}, proc: [], prov: [], ruc: [], req: [], ceco: [], cecoNombre: [],
        sidige: [], items: 0, estado: [], cuadro: {}, tipo: [], otroCeco: [], otroProyBase: [],
        links: { aprob: [], planCA: [], plan: [], cg: [] } };
      agregar_(ocs[k].unidad, unidad);
      orden.push(k);
      (porBase[base] = porBase[base] || []).push(k);
    }
    return ocs[k];
  };
  var existe = function (unidad, oc) { return !!porBase[claveDe(unidad, oc)]; };
  /**
   * La OC ya registrada que corresponde a una fila de otra fuente (CG): si
   * el número es de una sola, esa; si se repite, la del proveedor parecido.
   * null si no se puede saber cuál.
   */
  var elegir = function (unidad, oc, proveedor) {
    var cands = porBase[claveDe(unidad, oc)] || [];
    if (cands.length <= 1) return cands.length ? ocs[cands[0]] : null;
    var buscado = palabrasDeTitulo_(proveedor), mejor = null, max = 0;
    cands.forEach(function (k) {
      var suyas = palabrasDeTitulo_(ocs[k].prov.join(' '));
      var comunes = buscado.filter(function (w) { return w.length > 2 && suyas.indexOf(w) !== -1; }).length;
      if (comunes > max) { max = comunes; mejor = ocs[k]; }
    });
    return mejor;
  };

  if (!todo2026) armarDesdeElPlan_(registro, existe);
  var mapeo = armarDesdeAprobaciones_(registro, existe, todo2026);
  armarDesdeControlDeGestion_(registro, existe, todo2026, elegir);

  // Las filas, como {columna: valor}. Un enlace por OC: primero el del cuadro
  // de aprobaciones (lo pone Compras al pedir la aprobación), después el del
  // plan, al final el de CG.
  var conCarpeta = 0;
  var filas = orden.map(function (k) {
    var r = ocs[k], o = {};
    var links = [].concat(r.links.aprob, r.links.planCA, r.links.plan, r.links.cg);
    var ids = [];
    links.forEach(function (u) { var id = idDeDrive_(u); if (id && ids.indexOf(id) === -1) ids.push(id); });
    var enlace = '';
    for (var i = 0; i < links.length; i++) if (idDeDrive_(links[i])) { enlace = links[i]; break; }
    if (enlace) conCarpeta++;

    var proc = procedencia_(r.proc);
    var fuentes = [];
    if (r.fuentes.plan) fuentes.push('Plan de compras');
    if (r.fuentes.base) fuentes.push('Base de OC');
    if (r.fuentes.aprob) fuentes.push('Aprobaciones');
    if (r.fuentes.cg) fuentes.push('Control de Gestión');

    var revisar = [];
    if (!todo2026) {
      if (!r.fuentes.plan) revisar.push('no está en el plan de compras');
      if (!r.fuentes.base) revisar.push('no está en la base de OC de Compras');
      else if (!r.fuentes.baseProyecto) revisar.push('en la base de OC está con otro proyecto: ' + r.otroProyBase.join(' / '));
      if (!r.fuentes.aprob) revisar.push('no está en los cuadros de aprobaciones revisados');
    }
    if (!r.fuentes.cg) revisar.push('no está en Control de Gestión');
    else if (!todo2026 && !r.fuentes.cgProyecto) revisar.push('en Control de Gestión está con otro centro de costo: ' + r.otroCeco.join(' / '));
    else if (!todo2026 && r.otroCeco.length) revisar.push('en Control de Gestión también está en: ' + r.otroCeco.join(' / '));
    if ((porBase[r.base] || []).length > 1) revisar.push('el número ' + r.oc + ' se repite en el cuadro en ' + porBase[r.base].length + ' OC distintas');
    if (!enlace) revisar.push('sin enlace de carpeta');
    if (ids.length > 1) revisar.push(ids.length + ' carpetas distintas entre las fuentes');
    if (!proc) revisar.push('sin procedencia');

    o['OC'] = r.oc;
    o['Unidad de negocio'] = r.unidad.join(' / ');
    o['Proyecto'] = r.proyecto.slice(0, 2).join(' / ');
    o['Aparece en'] = fuentes.join(' · ');
    o['Procedencia'] = proc;
    o['Área que la completa'] = proc === 'Importación' ? COMEX : proc === 'Nacional' ? NACIONAL : '';
    o['Proveedor'] = r.prov.slice(0, 2).join(' / ');
    o['RUC (CG)'] = r.ruc.join(' / ');
    o['N° Requerimiento'] = r.req.join(' / ');
    o['Centro de costo (CG)'] = r.ceco.join(' / ');
    o['Nombre del centro de costo (CG)'] = r.cecoNombre.join(' / ');
    o['Código SIDIGE (CG)'] = r.sidige.slice(0, 5).join(' / ') + (r.sidige.length > 5 ? ' …' : '');
    o['Ítems en el plan'] = r.items || '';
    o['Estado de compra (plan)'] = r.estado.join(' / ');
    CAMPOS_APROBACIONES.forEach(function (c) {
      var lista = r.cuadro[c.col] || [];
      o[c.col] = c.numero && lista.length === 1 && !isNaN(Number(lista[0])) && lista[0] !== '' ? Number(lista[0]) : lista.join(' / ');
    });
    o['Situación del pago'] = situacionDelPago_(o);
    o['Bien o servicio'] = r.tipo.indexOf('SERVICIO') !== -1 ? 'Servicio' : r.tipo.indexOf('BIEN') !== -1 ? 'Bien' : '';
    o['Enlace de la carpeta'] = enlace;
    o['Revisar el cruce'] = revisar.join('; ');
    o['Estado de la revisión'] = enlace ? 'PENDIENTE' : 'SIN CARPETA';
    return o;
  });
  // Proyecto: primero las del plan. Todo 2026: por unidad y OC.
  filas.sort(function (a, b) {
    var pa = todo2026 ? a['Unidad de negocio'] : (a['Aparece en'].indexOf('Plan') === 0 ? 0 : 1);
    var pb = todo2026 ? b['Unidad de negocio'] : (b['Aparece en'].indexOf('Plan') === 0 ? 0 : 1);
    return (pa < pb ? -1 : pa > pb ? 1 : 0) || (a.OC < b.OC ? -1 : a.OC > b.OC ? 1 : 0);
  });

  // Lo ya revisado, para no repetirlo.
  var previo = conservar ? tablaPrevia_(libro) : null;
  var cuenta = { filas: filas.length, conCarpeta: conCarpeta, nuevas: 0, aRevisar: 0, conservadas: 0, quitadas: 0, pendientes: 0 };
  var guardadas = {}; // «OC|id de carpeta» cuyas filas de ARCHIVOS se quedan
  var ricos = filas.map(function (o) {
    var viejo = previo ? previo.buscar(o['Unidad de negocio'], o.OC, idDeDrive_(o['Enlace de la carpeta'])) : null;
    if (previo && !viejo) cuenta.nuevas++;
    if (viejo) viejo.usado = true;
    if (viejo && seConserva_(viejo.valores, o)) {
      CAB_REVISION.forEach(function (h) { if (h in viejo.valores) o[h] = viejo.valores[h]; });
      guardadas[o.OC + '|' + idDeDrive_(o['Enlace de la carpeta'])] = true;
      cuenta.conservadas++;
      return viejo.ricos;
    }
    if (viejo && o['Estado de la revisión'] === 'PENDIENTE') cuenta.aRevisar++;
    return DOCS.map(function () { return rico_(''); });
  });
  if (previo) cuenta.quitadas = previo.sinUsar();
  cuenta.pendientes = filas.filter(function (o) { return o['Estado de la revisión'] === 'PENDIENTE'; }).length;

  // ARCHIVOS: se quedan solo los de las OC cuya revisión se conservó.
  var archivosQueQuedan = [];
  var hojaA = libro.getSheetByName('ARCHIVOS');
  if (previo && hojaA && hojaA.getLastRow() > 1) {
    archivosQueQuedan = hojaA.getRange(2, 1, hojaA.getLastRow() - 1, CAB_ARCHIVOS.length).getValues()
      .filter(function (a) { return guardadas[a[0] + '|' + idDeDrive_(a[2])]; });
  }

  var hojaT = prepararHoja_(libro, 'TABLA', CAB_TABLA);
  hojaA = prepararHoja_(libro, 'ARCHIVOS', CAB_ARCHIVOS);
  if (archivosQueQuedan.length) hojaA.getRange(2, 1, archivosQueQuedan.length, CAB_ARCHIVOS.length).setValues(archivosQueQuedan);
  if (filas.length) {
    // Como texto: que «0115-2026» o un RUC no se conviertan en fecha o número.
    hojaT.getRange(2, 1, filas.length, CAB_DATOS.length).setNumberFormat('@');
    CAMPOS_APROBACIONES.forEach(function (c) {
      if (!c.numero) return;
      hojaT.getRange(2, CAB_DATOS.indexOf(c.col) + 1, filas.length, 1)
        .setNumberFormat(c.col === '% adelanto' ? '0%' : c.col === 'Días de crédito' ? '0' : '#,##0.00');
    });
    hojaT.getRange(2, CAB_TABLA.length, filas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    hojaT.getRange(2, 1, filas.length, CAB_TABLA.length).setValues(filas.map(function (o) {
      return CAB_TABLA.map(function (h) { return o[h] == null ? '' : o[h]; });
    }));
    hojaT.getRange(2, COL_PRIMER_DOC, filas.length, DOCS.length).setRichTextValues(ricos);
  }
  hojaT.setFrozenColumns(1);
  hojaT.getRange(1, COL_PRIMER_DOC, 1, DOCS.length).setBackground('#375623');
  hojaT.getRange(1, I_SITUACION + 1, 1, CAMPOS_APROBACIONES.length + 1).setBackground('#7F6000');
  escribirColumnas_(libro, mapeo);

  var texto = conservar
    ? 'Actualizado desde el cuadro: ' + cuenta.filas + ' OC (' + cuenta.nuevas + ' nuevas, ' + cuenta.quitadas +
      ' ya no están). ' + cuenta.conservadas + ' conservan su revisión; ' + cuenta.pendientes + ' por revisar.'
    : 'Tabla armada. Todavía no se revisa ninguna carpeta.';
  PropertiesService.getDocumentProperties().setProperty('LEGAJO_ULTIMA_ACTUALIZACION',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' — ' + texto);
  actualizarResumen_(libro, texto);
  return cuenta;
}

/**
 * Si una OC ya revisada se queda como está. Se vuelve a revisar si cambió
 * de carpeta, si la revisión no terminó bien, si aún no tiene factura, o si
 * le falta algo y se revisó hace más de DIAS_PARA_REVISAR_FALTANTES (en ese
 * tiempo Compras pudo subirlo). Una OC anulada no se vuelve a revisar.
 */
function seConserva_(viejo, nuevo) {
  var id = idDeDrive_(nuevo['Enlace de la carpeta']);
  if (!id || id !== idDeDrive_(viejo['Enlace de la carpeta'])) return false;
  var estado = String(viejo['Estado de la revisión'] || '');
  if (!estado || /^(PENDIENTE|SIN ACCESO|SIN CARPETA|SIN TERMINAR|ERROR)/.test(estado)) return false;
  if (nuevo['Situación del pago'] === 'ANULADA') return true;
  if (String(viejo[DOCS[0].col]) === '✗') return false;
  var revisado = viejo['Revisado en'];
  var dias = revisado instanceof Date ? (Date.now() - revisado.getTime()) / 86400000 : Infinity;
  if (String(viejo['Le falta'] || '') && dias >= DIAS_PARA_REVISAR_FALTANTES) return false;
  return true;
}

/**
 * La TABLA que había: por cada OC, sus valores por nombre de columna y las
 * celdas de los 11 documentos con sus enlaces. Se busca por unidad + OC; si
 * la tabla vieja no tenía unidad, solo por OC.
 */
function tablaPrevia_(libro) {
  var hoja = libro.getSheetByName('TABLA');
  if (!hoja || hoja.getLastRow() < 2) return null;
  var n = hoja.getLastRow() - 1, ancho = hoja.getLastColumn();
  var cab = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(String);
  var valores = hoja.getRange(2, 1, n, ancho).getValues();
  var iDocs = DOCS.map(function (d) { return cab.indexOf(d.col); });
  var ricosPorDoc = iDocs.map(function (c) { return c >= 0 ? hoja.getRange(2, c + 1, n, 1).getRichTextValues() : null; });
  var iOc = cab.indexOf('OC'), iUnidad = cab.indexOf('Unidad de negocio'), iLink = cab.indexOf('Enlace de la carpeta');
  var porClave = {}, todas = [];
  valores.forEach(function (f, k) {
    var v = {};
    cab.forEach(function (h, j) { if (h) v[h] = f[j]; });
    var x = { valores: v, ricos: ricosPorDoc.map(function (rs) { return rs ? rs[k][0] : rico_(''); }), usado: false };
    todas.push(x);
    var base = normalizar_(iUnidad >= 0 ? f[iUnidad] : '') + '|' + f[iOc];
    if (iLink >= 0 && idDeDrive_(f[iLink])) porClave[base + '|' + idDeDrive_(f[iLink])] = x;
    if (!porClave[base]) porClave[base] = x;
    if (!porClave['|' + f[iOc]]) porClave['|' + f[iOc]] = x;
  });
  return {
    /** Por unidad + OC + carpeta (la OC repetida con otra carpeta es otra); si no, por unidad + OC. */
    buscar: function (unidad, oc, idCarpeta) {
      var base = normalizar_(unidad) + '|' + oc;
      return (idCarpeta && porClave[base + '|' + idCarpeta]) || porClave[base] || (iUnidad < 0 ? porClave['|' + oc] : null);
    },
    sinUsar: function () { return todas.filter(function (x) { return !x.usado; }).length; }
  };
}

/**
 * Para Contabilidad, en una palabra: ¿esta compra ya está pagada, aprobada
 * pero sin pagar, o todavía sin aprobar? Sale del estatus, el estado de
 * aprobación y la columna OC CERRADA del cuadro.
 */
function situacionDelPago_(o) {
  var est = textoPlano_(o['Estatus (aprobaciones)']), apr = textoPlano_(o['Estado de aprobación']);
  var cerrada = textoPlano_(o['OC cerrada']);
  if (/ANULAD/.test(est + ' ' + cerrada)) return 'ANULADA';
  if (/FALTA APROBACION/.test(est + ' ' + apr)) return 'FALTA APROBACIÓN';
  if (/LEGAJO INCOMPLETO/.test(est)) return 'LEGAJO INCOMPLETO';
  if (/OC PAGADA|^PAGADA/.test(est)) return 'PAGADA';
  if (/TARJETA/.test(est)) return 'PAGADA CON TARJETA';
  if (/PENDIENTE|CREDITO|LETRA|CONTRA ENTREGA|DIAS/.test(est)) return 'APROBADA, PAGO PENDIENTE';
  if (/APROBADO PARA PAGO/.test(apr)) return 'APROBADA PARA PAGO';
  if (/APROBADO/.test(apr)) return 'APROBADA PARA COMPRA';
  if (/CERRADA|^SI$/.test(cerrada)) return 'OC CERRADA';
  return String(o['Estatus (aprobaciones)'] || '');
}

/** La pestaña COLUMNAS: dónde encontró cada campo en el cuadro de aprobaciones. */
function escribirColumnas_(libro, mapeo) {
  if (!mapeo) return;
  var filas = [['Campo', 'Encabezado encontrado en el cuadro', 'Columna', 'Cómo se encontró']];
  CAMPOS_APROBACIONES.forEach(function (c) {
    var m = mapeo[c.buscar.join('|')];
    filas.push(m ? [c.col, m.encabezado, m.letra, m.como] : [c.col, '— NO ENCONTRADA —', '', 'Revisa si cambió mucho el nombre']);
  });
  Object.keys(mapeo).forEach(function (k) {
    if (/^(OC|PROVEEDOR|UNIDADDENEGOCIO|PROCEDENCIA|PROYECTO|LINK)/.test(normalizar_(k))) {
      var m = mapeo[k];
      filas.push(['(' + k.split('|')[0] + ')', m.encabezado, m.letra, m.como]);
    }
  });
  var h = prepararHoja_(libro, 'COLUMNAS', filas[0]);
  h.getRange(2, 1, filas.length - 1, 4).setValues(filas.slice(1));
  h.setColumnWidth(1, 260);
  h.setColumnWidth(2, 320);
}

/** Modo proyecto: el plan de compras, la base de OC de Compras y el cuadro de aprobaciones del plan. */
function armarDesdeElPlan_(registro, existe) {
  // a) El plan de compras: todo lo que está ahí es del proyecto.
  var plan = SpreadsheetApp.openById(PROYECTO.planId);
  var pestanasPlan = [
    { nombre: 'Plan de Compras', oc: ['N° OC'], req: ['N° Requerimiento'], proc: ['Procedencia'],
      prov: ['Proveedor'], link: ['Link Legajo'], estado: ['Estado de Compra'] },
    { nombre: 'SEGUIMIENTO NACIONALES', oc: ['N° de OC'], req: ['N° RQ'], procFija: 'NACIONAL',
      prov: ['PROVEEDOR'], link: ['LINK DE LEGAJO'], estado: ['ESTADO DE COMPRA'] },
    { nombre: 'SEGUIMIENTO IMPORTACIONES', oc: ['N° de OC'], req: ['NRO REQ'], procFija: 'INTERNACIONAL',
      prov: ['PROVEEDOR'], link: ['LINK DE LEGAJO'], estado: ['ESTADO DE COMPRA'] }
  ];
  pestanasPlan.forEach(function (p) {
    var t = leerTabla_(plan, p.nombre, p.oc);
    if (!t) return;
    t.filas.forEach(function (f, k) {
      var proc = p.procFija || valor_(f, t.col(p.proc));
      var oc = ocNormalizada_(valor_(f, t.col(p.oc)), proc);
      if (!oc) return;
      var r = registro(EMPRESA, oc);
      r.fuentes.plan = true;
      if (p.nombre === 'Plan de Compras') r.items++;
      agregar_(r.proyecto, PROYECTO.nombre);
      agregar_(r.req, valor_(f, t.col(p.req)));
      agregar_(r.proc, proc);
      agregar_(r.prov, valor_(f, t.col(p.prov)));
      agregar_(r.estado, valor_(f, t.col(p.estado)));
      agregar_(r.links.plan, t.url(k, t.col(p.link)));
    });
  });

  // b) La base de OC que emite Compras (viene dentro del plan): cada OC con
  // su proyecto, RUC, requerimiento y código SIDIGE. Trae todos los proyectos.
  var basesOc = [
    { nombre: 'BD_NAC 26', proc: 'NACIONAL' },
    { nombre: 'BASE DE DATOS NACIONAL', proc: 'NACIONAL' },
    { nombre: 'BASE DE DATOS IMPORTACIONES', proc: 'IMPORTACION' }
  ];
  basesOc.forEach(function (b) {
    var t = leerTabla_(plan, b.nombre, ['N° OC/OS', 'PROYECTO']);
    if (!t) return;
    var iOc = t.col(['N° OC/OS']), iProy = t.col(['PROYECTO']);
    t.filas.forEach(function (f) {
      var oc = ocNormalizada_(valor_(f, iOc), b.proc);
      if (!oc) return;
      var delProyecto = PROYECTO.patron.test(String(valor_(f, iProy)));
      if (!delProyecto && !existe(EMPRESA, oc)) return;
      var r = registro(EMPRESA, oc);
      r.fuentes.base = true;
      if (delProyecto) r.fuentes.baseProyecto = true;
      else agregar_(r.otroProyBase, valor_(f, iProy));
      agregar_(r.proc, b.proc);
      agregar_(r.req, valor_(f, t.col(['N° REQUERIMIENTO'])));
      agregar_(r.ruc, valor_(f, t.col(['RUC', 'TAX ID'])));
      agregar_(r.prov, valor_(f, t.col(['RAZON SOCIAL', 'RAZON SOCIAL - SUPPLIER'])));
      agregar_(r.sidige, valor_(f, t.col(['CÓDIGO SIDIGE', 'CODIGO SIDIGE', 'CODIGO PCP'])));
      var tipoDoc = String(valor_(f, t.col(['TIPO DE DOCUMENTO'])) || '');
      agregar_(r.tipo, /SERVICIO/i.test(tipoDoc) ? 'SERVICIO' : /COMPRA|PURCHA/i.test(tipoDoc) ? 'BIEN' : '');
    });
  });

  // c) El cuadro de aprobaciones que vive dentro del plan (trae las de 2025).
  var ca = leerTabla_(plan, 'CUADRO DE APROBACIONES', ['N OC']);
  if (ca) {
    var caLink = ca.col(['Link de la carpeta OC', 'Link Legajo', 'Link OC']);
    if (caLink < 0) caLink = ca.columnaConEnlaces();
    var caEmpresa = ca.col(['RAZÓN SOCIAL']);
    ca.filas.forEach(function (f, k) {
      if (caEmpresa >= 0 && normalizar_(f[caEmpresa]).indexOf(normalizar_(EMPRESA)) === -1) return;
      var oc = ocNormalizada_(valor_(f, ca.col(['N OC'])), valor_(f, ca.col(['procedencia'])));
      if (!oc) return;
      var proyecto = String(valor_(f, ca.col(['Proyecto'])) || '');
      var delProyecto = PROYECTO.patron.test(proyecto);
      if (!delProyecto && !existe(EMPRESA, oc)) return;
      var r = registro(EMPRESA, oc);
      r.fuentes.aprob = true;
      agregar_(r.proyecto, proyecto);
      agregar_(r.req, valor_(f, ca.col(['REQ N°'])));
      agregar_(r.proc, valor_(f, ca.col(['procedencia'])));
      agregar_(r.links.planCA, ca.url(k, caLink));
    });
  }
}

/**
 * El cuadro de aprobaciones general (2026). Modo proyecto: solo las OC del
 * proyecto (o las que ya están). Todo 2026: todas, de todas las unidades.
 */
function armarDesdeAprobaciones_(registro, existe, todo2026) {
  var ap = leerTabla_(SpreadsheetApp.openById(APROBACIONES_ID), APROBACIONES_PESTANA, ['OC', 'Proveedor'], true);
  if (!ap) return [];
  // El enlace de la carpeta: por su nombre, o la columna con más enlaces de Drive.
  var iLink = ap.col(['Link de la carpeta OC', 'Link carpeta OC', 'Link de carpeta', 'Carpeta OC', 'Link OC', 'Link legajo']);
  if (iLink < 0) iLink = ap.columnaConEnlaces();
  ap.filas.forEach(function (f, k) {
    var unidad = String(valor_(f, ap.col(['Unidad de negocio'])) || '').trim();
    if (!todo2026 && normalizar_(unidad) !== normalizar_(EMPRESA)) return;
    var cruda = valor_(f, ap.col(['OC']));
    var proc = valor_(f, ap.col(['Procedencia']));
    var oc = ocNormalizada_(cruda, proc) || (todo2026 ? ocCruda_(cruda) : '');
    if (!oc) return;
    var proyecto = String(valor_(f, ap.col(['Proyecto'])) || '');
    if (!todo2026 && !PROYECTO.patron.test(proyecto) && !existe(EMPRESA, oc)) return;
    var prov = String(valor_(f, ap.col(['PROVEEDOR'])) || '');
    var distinguir = (procedencia_([String(proc || '')]) === 'Importación' ? 'I' : 'N') + '|' +
      palabrasDeTitulo_(prov).slice(0, 2).join(' ');
    var r = registro(todo2026 ? unidad : EMPRESA, oc, distinguir);
    r.fuentes.aprob = true;
    agregar_(r.proyecto, proyecto);
    agregar_(r.req, valor_(f, ap.col(['N° Requerimiento'])));
    agregar_(r.proc, proc);
    agregar_(r.prov, valor_(f, ap.col(['PROVEEDOR'])));
    CAMPOS_APROBACIONES.forEach(function (c) {
      var lista = r.cuadro[c.col] || (r.cuadro[c.col] = []);
      agregar_(lista, valor_(f, ap.col(c.buscar)));
    });
    agregar_(r.tipo, /SERVICIO/i.test(String(valor_(f, ap.col(['Concepto'])))) ? 'SERVICIO' : '');
    agregar_(r.links.aprob, ap.url(k, iLink));
  });
  return ap.mapeo;
}

/**
 * Control de Gestión: centro de costo, código SIDIGE y el cruce de vuelta.
 * Modo proyecto: suma las OC del proyecto que solo están aquí. Todo 2026:
 * solo completa las que ya vienen del cuadro de aprobaciones.
 */
function armarDesdeControlDeGestion_(registro, existe, todo2026, elegir) {
  var cg = leerTabla_(SpreadsheetApp.openById(CG_ID), CG_PESTANA, ['N° OC/OS', 'LINK DE CARPETA'], true);
  if (!cg) return;
  cg.filas.forEach(function (f, k) {
    var empresa = String(valor_(f, cg.col(['EMPRESA'])) || '').trim();
    if (!todo2026 && normalizar_(empresa) !== normalizar_(EMPRESA)) return;
    var cruda = valor_(f, cg.col(['N° OC/OS']));
    var oc = ocNormalizada_(cruda, valor_(f, cg.col(['PROCEDENCIA']))) || (todo2026 ? ocCruda_(cruda) : '');
    if (!oc) return;
    var unidad = todo2026 ? empresa : EMPRESA;
    var codigo = String(valor_(f, cg.col(['CODIGO CENTRO DE COSTO'])) || '').trim();
    var nombre = String(valor_(f, cg.col(['CENTRO DE COSTO'])) || '').trim();
    var delProyecto = !todo2026 && PROYECTO.patron.test(codigo + ' ' + nombre);
    if (!delProyecto && !existe(unidad, oc)) return;
    var r = todo2026 ? elegir(unidad, oc, String(valor_(f, cg.col(['PROVEEDOR'])) || '')) : registro(unidad, oc);
    if (!r) return; // el número se repite y no se sabe de cuál es
    r.fuentes.cg = true;
    if (delProyecto || todo2026) {
      r.fuentes.cgProyecto = true;
      agregar_(r.ceco, codigo);
      agregar_(r.cecoNombre, nombre);
    } else {
      agregar_(r.otroCeco, (codigo && codigo !== '-' ? codigo + ' ' : '') + nombre);
    }
    agregar_(r.ruc, String(valor_(f, cg.col(['RUC / DNI / RUT'])) || '').replace(/\.0$/, ''));
    agregar_(r.prov, valor_(f, cg.col(['PROVEEDOR'])));
    agregar_(r.req, valor_(f, cg.col(['N° REQUERIMIENTO'])));
    agregar_(r.sidige, valor_(f, cg.col(['CODIGO SIDIGE'])));
    agregar_(r.proc, valor_(f, cg.col(['PROCEDENCIA'])));
    var tipoDoc = String(valor_(f, cg.col(['TIPO DE DOCUMENTO'])) || '');
    agregar_(r.tipo, /SERVICIO/i.test(tipoDoc) ? 'SERVICIO' : /COMPRA/i.test(tipoDoc) ? 'BIEN' : '');
    agregar_(r.links.cg, cg.url(k, cg.col(['LINK DE CARPETA'])));
  });
}

// ── 2. Revisar carpetas, por tandas ──

/** Una tanda a mano, con todas las filas. Si ya corre el automático, no hace falta. */
function revisarTandaLegajo() {
  if (hayAutomatico_()) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Ya está revisando solo, en paralelo. El avance se ve en RESUMEN.', 'Legajo por OC', 10);
    return;
  }
  revisarTanda_(0, 1);
}

/**
 * Una tanda del revisor `k` de `n`: toma las filas PENDIENTE cuyo número,
 * dividido entre n, deja resto k. Así los n revisores corren a la vez sin
 * pisarse: cada uno escribe solo sus filas.
 *
 * Las carpetas se recorren SIN candado (es lo lento, y es lo que se hace en
 * paralelo); solo la escritura va con candado, que dura segundos. Si la
 * tabla se rearmó mientras tanto (cambió la «generación»), lo recorrido se
 * descarta en vez de escribirse encima de la tabla nueva.
 */
function revisarTanda_(k, n) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  // Un revisor no se superpone consigo mismo (si una tanda se alargó).
  var marca = 'LEGAJO_OCUPADO_' + k + '_' + n;
  if (Date.now() - Number(props.getProperty(marca) || 0) < 7 * 60000) {
    try { libro.toast('Esa tanda todavía corre. Revisa RESUMEN en unos minutos.', 'Legajo por OC', 10); } catch (e) {}
    return;
  }
  props.setProperty(marca, String(Date.now()));
  try {
    var inicio = Date.now();
    var generacion = props.getProperty('LEGAJO_GEN') || '';
    var hojaT = libro.getSheetByName('TABLA');
    var hojaA = libro.getSheetByName('ARCHIVOS');
    if (!hojaT || hojaT.getLastRow() < 2) throw new Error('Primero «1. Armar tabla».');

    var tabla = hojaT.getRange(2, 1, hojaT.getLastRow() - 1, CAB_TABLA.length).getValues();
    var archivos = [], resultados = {}, hechas = 0, cache = {}, cacheArriba = {};
    var lectura = prepararLectura_();

    for (var i = k; i < tabla.length; i += n) {
      if (tabla[i][COL_ESTADO - 1] !== 'PENDIENTE') continue;
      if ((Date.now() - inicio) / 60000 > MINUTOS_POR_TANDA) break;
      var f = tabla[i];
      var id = idDeDrive_(String(f[I_LINK]));
      var limite = inicio + (MINUTOS_POR_TANDA + 0.5) * 60000;
      var ocNum = numeroDeOC_(f[0]);
      // Dos OC pueden compartir carpeta: se recorre una vez por tanda.
      var clave_ = id + '|' + f[0];
      var res = cache[clave_] || (cache[clave_] = revisarCarpeta_(id, limite, ocNum, cacheArriba));
      if (res.estado === 'SIN TERMINAR' && hechas > 0) break; // se reintenta en la próxima tanda

      res.archivos.forEach(function (a) {
        if (a.claves) return; // ya clasificado en esta tanda (carpeta compartida)
        var claves = [claveDoc_(a.parece)];
        // «scan001.pdf» dentro de «FACTURA Y GUÍA» cuenta para las dos.
        a.enCarpeta.forEach(function (p) { claves.push(claveDoc_(p)); });
        claves = claves.filter(function (c, j, t) { return c && t.indexOf(c) === j; });
        // Un PDF o imagen que no dice qué es, pero lleva el número de la OC:
        // es la OC. (Un Excel con el número suele ser el costeo, no la OC.)
        if (!claves.length && a.parece === 'OTRO' && /PDF|Imagen/.test(a.tipo) && ocNum &&
          nombreMencionaOC_(a.nombre, ocNum)) { claves = ['OC']; a.porNumero = true; }
        // En una importación, el comprobante de pago al exterior es el SWIFT.
        if (!claves.length && /^PAGO/.test(a.parece) && f[I_PROC] === 'Importación') claves = ['SWIFT'];
        a.claves = claves;
      });

      // Si falta algo que el nombre no delata, se leen por dentro los
      // archivos dudosos: un «docs solpack oc150-2026.pdf» escaneado puede
      // traer la factura y la guía, aunque el nombre diga «OC».
      var faltan = documentosQueFaltan_(res.archivos, f);
      if (faltan.length && lectura.activa) {
        var candidatos = candidatosALeer_(res.archivos);
        for (var c = 0; c < candidatos.length && lectura.activa; c++) {
          if ((Date.now() - inicio) / 60000 > MINUTOS_POR_TANDA + 0.5) break;
          var a = candidatos[c];
          if (!(a.id in lectura.hechas)) lectura.hechas[a.id] = leerPorDentro_(a, lectura);
          var leido = lectura.hechas[a.id];
          if (leido && leido.claves.length) {
            a.claves = leido.claves;
            a.leido = true;
            if (leido.serie) a.serie = leido.serie;
            if (leido.tipo) a.tipoCpe = leido.tipo;
          }
          if (!documentosQueFaltan_(res.archivos, f).length) break; // ya no falta nada que leer
        }
      }

      var porDoc = {};
      res.archivos.forEach(function (a) {
        a.claves.forEach(function (c) { (porDoc[c] = porDoc[c] || []).push(a); });
        archivos.push([f[0], f[I_AREA], f[I_LINK], a.ubicacion, a.nombre, a.url, a.tipo, a.parece,
          a.claves.map(nombreDeClave_).join(', ') + (a.leido ? ' (leído por dentro' +
            (a.tipoCpe ? ': ' + a.tipoCpe + (a.serie ? ' ' + a.serie : '') : '') + ')' : ''), a.pistas, a.creado]);
      });
      resultados[i] = { estado: res.estado, detalle: res.detalle, n: res.archivos.length, porDoc: porDoc };
      hechas++;
    }

    // Escribir: con candado, porque los otros revisores también agregan
    // filas a ARCHIVOS. Todo junto al final: si la tanda se corta, no queda
    // una OC marcada como revisada sin sus archivos.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(60000)) throw new Error('Otra tanda ocupó la hoja más de un minuto; esta se reintenta sola.');
    try {
      if ((props.getProperty('LEGAJO_GEN') || '') !== generacion) return; // la tabla se rearmó
      if (archivos.length) {
        hojaA.getRange(hojaA.getLastRow() + 1, 1, archivos.length, CAB_ARCHIVOS.length).setValues(archivos);
      }
      Object.keys(resultados).forEach(function (j) {
        escribirRevision_(hojaT, Number(j) + 2, tabla[j], resultados[j]);
      });
      // Lo pendiente se cuenta de nuevo: los otros revisores también avanzaron.
      var pendientes = hojaT.getRange(2, COL_ESTADO, hojaT.getLastRow() - 1, 1).getValues()
        .filter(function (v) { return v[0] === 'PENDIENTE'; }).length;
      if (pendientes === 0) { detenerLegajoAutomatico_(); programarSubidaDelLegajo_(); }
      var texto = 'Revisor ' + (k + 1) + ' de ' + n + ': ' + hechas + ' OC, ' + archivos.length +
        ' archivos, ' + Object.keys(lectura.hechas).length + ' leídos por dentro. Faltan ' + pendientes +
        ' en total' + (pendientes === 0 ? ' — TERMINADO.' : '.') + (lectura.aviso ? ' OJO: ' + lectura.aviso : '');
      actualizarResumen_(libro, texto);
      try { libro.toast(texto, 'Legajo por OC', 10); } catch (e) {}
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    anotarError_(libro, 'ERROR: ' + (e.message || e));
    throw e;
  } finally {
    props.deleteProperty(marca);
  }
}

/** Las marcas ✓ / ✗ / — / ○ de una OC, con el enlace al primer archivo de cada documento. */
function escribirRevision_(hoja, fila, datos, res) {
  var proc = datos[I_PROC], tipo = datos[I_TIPO], req = String(datos[I_REQ] || '');
  var falta = [];
  var celdas = DOCS.map(function (d) {
    var hallados = res.porDoc[d.clave] || [];
    if (hallados.length) {
      // En la factura, la serie-número (del nombre o leída): la que Contabilidad busca.
      var conSerie = d.clave === 'FACTURA' ? hallados.filter(function (a) { return a.serie; })[0] : null;
      if (conSerie) return rico_('✓ ' + hallados.length + ' · ' + conSerie.serie, conSerie.url);
      return rico_('✓ ' + hallados.length, hallados[0].url);
    }
    if (res.estado === 'SIN ACCESO') return rico_('?');
    if (d.clave === 'REQ' && req) return rico_('✓ N° ' + req.split(' / ')[0]);
    var aplica = !(d.solo === 'IMPO' && proc === 'Nacional') &&
      !(d.solo === 'BIEN' && tipo === 'Servicio') &&
      !(d.solo === 'SERVICIO' && tipo !== 'Servicio');
    if (d.porCeco || !aplica) return rico_('—');
    if (d.opcional) return rico_('○');
    falta.push(d.col.replace(/^\d+\.\s*/, ''));
    return rico_('✗');
  });
  var estado = res.estado + (res.detalle ? ' — ' + res.detalle : '');
  hoja.getRange(fila, COL_ESTADO, 1, 2).setValues([[estado, res.n]]);
  hoja.getRange(fila, COL_PRIMER_DOC, 1, DOCS.length).setRichTextValues([celdas]);
  hoja.getRange(fila, COL_PRIMER_DOC + DOCS.length, 1, 2)
    .setValues([[res.estado === 'SIN ACCESO' ? '(sin acceso a la carpeta)' : falta.join(', '), new Date()]]);
}

function rico_(texto, url) {
  var b = SpreadsheetApp.newRichTextValue().setText(texto);
  if (url) b.setLinkUrl(url);
  return b.build();
}

/** Qué documento de la lista es lo que `clasificar_` dijo que parece el archivo. */
function claveDoc_(parece) {
  var p = String(parece || '').replace(/ \(por la carpeta\)$/, '');
  if (/^(FACTURA|COMPROBANTE|RECIBO POR|BOLETA|XML$)/.test(p)) return 'FACTURA';
  var mapa = {
    'ORDEN DE COMPRA/SERVICIO': 'OC', 'SWIFT': 'SWIFT', 'GUÍA': 'GUIA', 'DAM': 'DAM',
    'REQUERIMIENTO': 'REQ', 'CONTRATO': 'CONTRATO', 'COTIZACIÓN': 'COTIZACION',
    'PROFORMA': 'PROFORMA', 'CORREO / CAPTURA': 'CORREO', 'ACTA DE CONFORMIDAD': 'ACTA'
  };
  return mapa[p] || '';
}

// ── Leer por dentro (OCR) los archivos que el nombre no delata ──

/** Lo que le falta a la OC de lo que se puede reconocer leyendo: factura, guía, DAM, acta. */
function documentosQueFaltan_(archivos, f) {
  var hay = {};
  archivos.forEach(function (a) { (a.claves || []).forEach(function (c) { hay[c] = true; }); });
  var falta = [];
  if (!hay.FACTURA) falta.push('FACTURA');
  if (!hay.GUIA && f[I_TIPO] !== 'Servicio') falta.push('GUIA');
  if (!hay.DAM && f[I_PROC] === 'Importación') falta.push('DAM');
  if (!hay.ACTA && f[I_TIPO] === 'Servicio') falta.push('ACTA');
  return falta;
}

// Palabras de nombres que no dicen nada: «docs», «scan», «CamScanner»…
var NOMBRES_GENERICOS = ['DOC', 'DOCS', 'DOSC', 'DCOS', 'DOCUMENTO', 'DOCUMENTOS', 'SCAN', 'ESCANEO', 'ESCANEADO', 'CAMSCANNER',
  'IMG', 'IMAGEN', 'ADJUNTO', 'ADJUNTOS', 'WHATSAPP', 'SUSTENTO', 'SUSTENTOS', 'ARCHIVO', 'NUEVO'];

/**
 * Los PDF e imágenes que vale la pena leer, en orden: primero los de nombre
 * genérico o sin clasificar, después los que pasaron por OC solo por decir
 * «OC» o llevar su número (un escaneo de la factura suele llamarse «docs
 * proveedor oc150-2026»). Lo que el nombre ya dice claro (cotización,
 * requerimiento, pago, ficha…) no se lee.
 */
function candidatosALeer_(archivos) {
  var puntaje = function (a) {
    if (!/PDF|Imagen|Documento de Google/.test(a.tipo) || a.leido) return -1;
    var palabras = textoPlano_(a.nombre).split(' ');
    var generico = palabras.some(function (p) { return NOMBRES_GENERICOS.indexOf(p) !== -1; });
    if (a.parece === 'OTRO' || / \(por la carpeta\)$/.test(a.parece) || generico) return 2;
    var ocSoloPorPalabra = a.parece === 'ORDEN DE COMPRA/SERVICIO' && !/ORDEN DE|PURCHASE ORDER/.test(a.pistas);
    if (ocSoloPorPalabra || a.porNumero) return 1;
    return -1;
  };
  return archivos.map(function (a) { return { a: a, p: puntaje(a) }; })
    .filter(function (x) { return x.p > 0; })
    .sort(function (x, y) { return y.p - x.p; })
    .slice(0, LEER_POR_OC)
    .map(function (x) { return x.a; });
}

/** Si se puede leer: hace falta el servicio Drive API. Si no, se sigue sin leer. */
function prepararLectura_() {
  var lectura = { activa: false, hechas: {}, temporal: '', aviso: '' };
  if (!LEER_DOCUMENTOS) return lectura;
  if (typeof Drive === 'undefined') {
    lectura.aviso = 'para leer PDF escaneados, activa el servicio «Drive API» (Apps Script → Servicios + → Drive API).';
    return lectura;
  }
  var it = DriveApp.getFoldersByName(CARPETA_TEMPORAL);
  lectura.temporal = (it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_TEMPORAL)).getId();
  lectura.activa = true;
  return lectura;
}

/**
 * Copia el archivo como documento de Google (Drive le hace OCR), saca el
 * texto, borra la copia y dice qué documentos trae. El original no se toca.
 * Un error de permiso apaga la lectura por el resto de la tanda.
 */
function leerPorDentro_(a, lectura) {
  var copia = null, id = a.id;
  try {
    if (a.tipo === 'Documento de Google') return documentosEnTexto_(DocumentApp.openById(id).getBody().getText());
    var v2 = typeof Drive.Files.insert === 'function'; // el servicio puede estar en v2 o v3
    copia = v2
      ? Drive.Files.copy({ title: 'lectura ' + id, parents: [{ id: lectura.temporal }] }, id,
          { convert: true, ocr: true, ocrLanguage: 'es', supportsAllDrives: true })
      : Drive.Files.copy({ name: 'lectura ' + id, mimeType: 'application/vnd.google-apps.document', parents: [lectura.temporal] }, id,
          { ocrLanguage: 'es', supportsAllDrives: true });
    return documentosEnTexto_(textoDeDocumento_(copia.id));
  } catch (e) {
    var msg = String(e.message || e);
    if (/permiso|permission|autoriza|authoriz/i.test(msg)) {
      lectura.activa = false;
      lectura.aviso = 'falta un permiso para leer PDF (' + msg.slice(0, 80) + '). Corre «autorizarLecturaLegajo» desde el editor.';
    }
    return { claves: [], error: msg.slice(0, 150) };
  } finally {
    if (copia) {
      try { Drive.Files.remove(copia.id); } catch (e) {
        try { DriveApp.getFileById(copia.id).setTrashed(true); } catch (e2) {}
      }
    }
  }
}

/**
 * Para correr UNA vez desde el editor de Apps Script (elegirla arriba y
 * «Ejecutar») si la lectura avisa que falta un permiso: Google vuelve a
 * pedirlos. Hay que marcar TODAS las casillas, en especial «Documentos».
 */
function autorizarLecturaLegajo() {
  DriveApp.getRootFolder().getName();
  DocumentApp.getActiveDocument();
  Logger.log('Permisos listos.');
}

/** El texto de la copia: con DocumentApp o, si no hay ese permiso, exportado por Drive. */
function textoDeDocumento_(idDoc) {
  try {
    return DocumentApp.openById(idDoc).getBody().getText();
  } catch (e) {
    if (!/permiso|permission|autoriza|authoriz/i.test(String(e.message || e))) throw e;
    try {
      var r = Drive.Files.export(idDoc, 'text/plain', { alt: 'media' });
      if (typeof r === 'string' && r) return r;
      if (r && typeof r.getDataAsString === 'function') return r.getDataAsString();
      if (r && r.length) return Utilities.newBlob(r).getDataAsString();
    } catch (e2) {
      // no hubo segundo camino: vale el error de permiso de arriba
    }
    throw e;
  }
}

/**
 * Qué documentos trae un texto leído, y la serie-número del comprobante. Un
 * PDF puede traer varios (factura en la hoja 1 y guía en la 2). Se pide el
 * rasgo propio de cada uno, no solo la palabra: una factura CITA su guía
 * («Tipo de G.R.: Guía de Remisión Remitente, T001-73313»), pero solo la guía
 * trae punto de partida y de llegada; y una OC dice «factura a 30 días» sin
 * ser una factura.
 *   → { claves: ['FACTURA', 'GUIA'], tipo: 'FACTURA', serie: 'F001-113668' }
 */
function documentosEnTexto_(texto) {
  var P = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  var hay = [];
  var cpe = comprobanteEnTexto_(P);
  if (cpe.tipo) hay.push('FACTURA');
  if (/PUNTO\s+DE\s+PARTIDA|PUNTO\s+DE\s+LLEGADA|MOTIVO\s+DEL?\s+TRASLADO|DATOS\s+DEL\s+TRASLADO/.test(P)) hay.push('GUIA');
  if (/DECLARACION\s+ADUANERA\s+DE\s+MERCANCIAS|\bDAM\b[^A-Z]{0,20}\d{3}\s*-\s*20\d\d\s*-\s*10\s*-\s*\d{3,6}/.test(P)) hay.push('DAM');
  if (/ACTA\s+DE\s+(CONFORMIDAD|RECEPCION)|CONFORMIDAD\s+DEL?\s+SERVICIO/.test(P)) hay.push('ACTA');
  if (/\bMT\s?103\b|SWIFT\s+(COPY|MESSAGE)|:32A:/.test(P)) hay.push('SWIFT');
  if (!hay.length && /^.{0,300}ORDEN\s+DE\s+(COMPRA|SERVICIO)/.test(P)) hay.push('OC');
  return { claves: hay, tipo: cpe.tipo, serie: cpe.serie };
}

// «FACTURA» aunque el OCR la parta o confunda letras: «FACTUR A», «FACTURA»,
// «FAC TURA», «FACIURA», «FACTUPA».
var RE_FACTURA = /F\s?A\s?[CG]\s?[TI1]\s?U\s?[RP]\s?A/;

/**
 * El comprobante que trae un texto (ya en mayúsculas y sin tildes): tipo y
 * serie-número. Reconoce las electrónicas (F001-00113668, con los errores
 * típicos del OCR: FO01, F0O1, «F001 - 113668», «F001 N° 113668»), las
 * físicas (FACTURA 001- N° 0031388) y la «commercial invoice» del exterior.
 * Las series de guía (T001, EG07) se saltan: un comprobante suele citarlas.
 */
function comprobanteEnTexto_(P) {
  var esFactura = RE_FACTURA.test(P), esBoleta = /BOLETA\s+DE\s+VENTA/.test(P);
  var esRH = /RECIBO\s+POR\s+HONORARIOS/.test(P);
  var esNota = /NOTA\s+DE\s+(CREDITO|DEBITO)\s+ELECTRONICA/.test(P);
  // Serie electrónica: letra + 3, con guion o «N°» antes del número.
  var re = /(?:^|[^A-Z0-9])([FBE][A-Z0-9]{3})\s*(?:[-–—_]\s*(?:N\s*[°ºO.]\s*)?|N\s*[°º.]\s*)0*(\d{1,8})(?!\d)/g, m, serie = '';
  while ((m = re.exec(P))) {
    var s = m[1][0] + m[1].slice(1).replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!/^[FBE][A-Z]?\d{2,3}$/.test(s) || /^EG/.test(s)) continue;
    serie = s + '-' + m[2];
    break;
  }
  // Factura física: «FACTURA … 001 - N° 0031388».
  if (!serie && (esFactura || esBoleta)) {
    var f = /(?:FACTURA|BOLETA)[^]{0,80}?(?:^|[^A-Z0-9])(\d{3,4})\s*[-–—]\s*(?:N\s*[°ºO.]\s*)?0*(\d{3,8})(?!\d)/.exec(P);
    if (f && !/^20\d\d$/.test(f[1])) serie = f[1] + '-' + f[2];
  }
  var tipo = '';
  if (esNota) tipo = /CREDITO/.test(P) ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO';
  else if (esRH && /^E/.test(serie)) tipo = 'RECIBO POR HONORARIOS';
  else if (esFactura && (/F\s?A\s?C\s?T\s?U\s?R\s?A\s+E\s?L\s?E\s?C\s?T\s?R\s?O\s?N\s?I\s?C\s?A/.test(P) ||
    (serie && /R\s?\.?\s?U\s?\.?\s?C/.test(P)))) tipo = 'FACTURA';
  else if (esBoleta && /^B/.test(serie)) tipo = 'BOLETA';
  else if (/COMMERCIAL\s+INVOICE|\bINVOICE\s*(NO\b|N[°º]|#|NUMBER|DATE)/.test(P)) {
    tipo = 'INVOICE';
    var inv = /INVOICE\s*(?:NO\.?|N[°º]|#|NUMBER)\s*[:.]?\s*([A-Z0-9][A-Z0-9\/-]{2,20})/.exec(P);
    serie = inv ? inv[1] : '';
  }
  return { tipo: tipo, serie: tipo ? serie : '' };
}

function nombreDeClave_(clave) {
  for (var i = 0; i < DOCS.length; i++) if (DOCS[i].clave === clave) return DOCS[i].col;
  return '';
}

/**
 * Los archivos de la carpeta de la OC y todas sus subcarpetas. Nunca lanza:
 * el problema va en `estado`.
 *
 * Hay enlaces que apuntan a una SUBCARPETA del legajo («01 PROVEEDOR»,
 * «003 Orden de compra») y no a la carpeta de la OC: la factura, la DAM o el
 * desaduanaje quedan una carpeta más arriba. Por eso primero se sube hasta
 * la carpeta de la OC (ver `carpetaDeLaOC_`). Y si aun así no hay factura,
 * se miran los archivos sueltos de la carpeta de arriba que nombran la OC.
 */
function revisarCarpeta_(id, limite, ocNum, cacheArriba) {
  var archivos = [], carpeta, nota = '';
  if (!id) return { estado: 'SIN CARPETA', archivos: [], detalle: '' };
  try {
    carpeta = DriveApp.getFolderById(id);
    carpeta.getName(); // obliga a comprobar el acceso aquí y no más abajo
  } catch (e) {
    try {
      var suelto = DriveApp.getFileById(id);
      archivos.push(datosDeArchivo_(suelto, '(el enlace es un archivo, no una carpeta)', ''));
      return { estado: 'ES UN ARCHIVO', archivos: archivos, detalle: '' };
    } catch (e2) {
      return { estado: 'SIN ACCESO', archivos: [], detalle: String(e.message || e) };
    }
  }
  var deLaOC = carpetaDeLaOC_(carpeta, ocNum);
  if (deLaOC.getId() !== carpeta.getId()) {
    nota = 'el enlace apunta a la subcarpeta «' + carpeta.getName() + '»; se revisó desde «' + deLaOC.getName() + '»';
    carpeta = deLaOC;
  }
  try {
    recorrer_(carpeta, carpeta.getName(), '', {}, archivos, limite || Infinity);
    if (ocNum && !archivos.some(function (a) { return claveDoc_(a.parece) === 'FACTURA'; })) {
      var arriba = archivosDeArriba_(carpeta, ocNum, cacheArriba || {});
      if (arriba.length) {
        archivos = archivos.concat(arriba);
        nota = (nota ? nota + '; ' : '') + arriba.length + ' archivo(s) con el número de la OC en la carpeta de arriba (confirmar)';
      }
    }
    return { estado: archivos.length ? 'OK' : 'VACÍA', archivos: archivos, detalle: nota };
  } catch (e) {
    if (e === DEMASIADO_GRANDE) {
      return { estado: 'MUY GRANDE', archivos: archivos,
        detalle: 'más de ' + LIMITE_ARCHIVOS + ' archivos: el enlace parece de una carpeta general, no de la OC' };
    }
    if (e === SIN_TIEMPO) {
      return { estado: 'SIN TERMINAR', archivos: archivos,
        detalle: 'no alcanzó el tiempo de una tanda; se anotó lo que se vio (' + archivos.length + ' archivos)' };
    }
    return { estado: 'ERROR A MEDIAS', archivos: archivos, detalle: String(e.message || e) };
  }
}

var DEMASIADO_GRANDE = { motivo: 'demasiado grande' };
var SIN_TIEMPO = { motivo: 'sin tiempo' };

// Nombres de subcarpeta del legajo que no son de ningún documento de la lista.
var SUBCARPETAS_TIPICAS = ['PROVEEDOR', 'PROVEEDORES', 'DOCUMENTOS', 'ADJUNTOS', 'SUSTENTO', 'SUSTENTOS',
  'ANEXOS', 'ARCHIVOS', 'OTROS', 'VALIDACION', 'DESADUANAJE', 'COMPRA', 'COMPRAS', 'LEGAJO'];

/**
 * Sube desde la carpeta del enlace hasta la carpeta de la OC, como mucho dos
 * niveles. Sube si la de arriba lleva el número de la OC, o si la del enlace
 * tiene nombre de subcarpeta («003 Orden de compra», «PROVEEDOR», «FACTURAS»)
 * y la de arriba no es una carpeta general con muchas OC.
 */
function carpetaDeLaOC_(carpeta, ocNum) {
  var actual = carpeta;
  try {
    for (var nivel = 0; nivel < 2; nivel++) {
      var padres = actual.getParents();
      if (!padres.hasNext()) break;
      var padre = padres.next();
      var nombre = actual.getName();
      var padreDeLaOC = !!ocNum && nombreMencionaOC_(padre.getName(), ocNum);
      var pareceSub = !(ocNum && nombreMencionaOC_(nombre, ocNum)) && esNombreDeSubcarpeta_(nombre);
      if (!padreDeLaOC && !(pareceSub && !esCarpetaGeneral_(padre, ocNum))) break;
      actual = padre;
    }
  } catch (e) {
    // sin permiso sobre la de arriba: se queda la del enlace
  }
  return actual;
}

function esNombreDeSubcarpeta_(nombre) {
  if (/^\s*0\d{1,2}[\s._-]/.test(nombre)) return true; // «001 Requerimiento», «03 ORDEN DE COMPRA»
  var t = textoPlano_(nombre);
  if (pistasEn_(t).length) return true;
  return t.split(' ').some(function (p) { return SUBCARPETAS_TIPICAS.indexOf(p) !== -1; });
}

/**
 * Una carpeta con subcarpetas de dos o más OC distintas, o con muchas
 * subcarpetas (un legajo trae unas pocas), es la de un proyecto, no la de una OC.
 */
function esCarpetaGeneral_(carpeta, ocNum) {
  var otras = {}, n = 0, it = carpeta.getFolders();
  while (it.hasNext()) {
    if (++n > 15) return true;
    var m = /(\d{1,6})\s*-\s*(20\d\d)|(20\d\d)\s*-\s*(\d{1,6})/.exec(it.next().getName());
    if (!m) continue;
    var clave = m[1] ? Number(m[1]) + '-' + m[2] : Number(m[4]) + '-' + m[3];
    if (!ocNum || clave !== ocNum.num + '-' + ocNum.anio) otras[clave] = true;
    if (Object.keys(otras).length >= 2) return true;
  }
  return false;
}

/** Archivos sueltos de la carpeta de arriba que llevan el número de la OC en el nombre. */
function archivosDeArriba_(carpeta, ocNum, cache) {
  var salida = [];
  try {
    var padres = carpeta.getParents();
    while (padres.hasNext()) {
      var p = padres.next(), pid = p.getId();
      if (!cache[pid]) {
        var lista = [], it = p.getFiles(), n = 0;
        while (it.hasNext() && n++ < 500) { var f = it.next(); lista.push({ f: f, nombre: f.getName() }); }
        cache[pid] = { nombre: p.getName(), lista: lista };
      }
      cache[pid].lista.forEach(function (x) {
        if (nombreMencionaOC_(x.nombre, ocNum)) {
          salida.push(datosDeArchivo_(x.f, 'CARPETA DE ARRIBA (confirmar) / ' + cache[pid].nombre, ''));
        }
      });
    }
  } catch (e) {
    // es una ayuda: si falla, queda lo de adentro
  }
  return salida;
}

/**
 * `sub` son solo las subcarpetas debajo de la de la OC: el nombre de la
 * carpeta principal («OC 0115-2026 …») no sirve de pista, porque diría
 * «orden de compra» de todo lo que tiene adentro.
 */
function recorrer_(carpeta, ruta, sub, vistas, salida, limite) {
  if (Date.now() > limite) throw SIN_TIEMPO;
  var id = carpeta.getId();
  if (vistas[id]) return;
  vistas[id] = true;
  var fs = carpeta.getFiles();
  while (fs.hasNext()) {
    if (salida.length >= LIMITE_ARCHIVOS) throw DEMASIADO_GRANDE;
    if (Date.now() > limite) throw SIN_TIEMPO;
    salida.push(datosDeArchivo_(fs.next(), ruta, sub));
  }
  var subs = carpeta.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    recorrer_(s, ruta + ' / ' + s.getName(), (sub ? sub + ' / ' : '') + s.getName(), vistas, salida, limite);
  }
}

function datosDeArchivo_(f, ubicacion, pistaCarpeta) {
  var nombre = f.getName(), mime = f.getMimeType(), url = f.getUrl(), id = f.getId();
  if (mime === 'application/vnd.google-apps.shortcut') {
    try {
      var real = DriveApp.getFileById(f.getTargetId());
      nombre = real.getName() + ' (acceso directo)';
      mime = real.getMimeType();
      url = real.getUrl();
      id = real.getId();
    } catch (e) {
      nombre += ' (acceso directo sin acceso)';
    }
  }
  var c = clasificar_(nombre, pistaCarpeta, mime);
  // Si lo que dice qué es el archivo es la carpeta, todas sus pistas cuentan.
  var enCarpeta = / \(por la carpeta\)$/.test(c.parece) ?
    pistasEn_(textoPlano_(pistaCarpeta)).map(function (p) { return p.parece; }) : [];
  return { id: id, ubicacion: ubicacion, nombre: nombre, url: url, tipo: tipoLegible_(mime, nombre),
    parece: c.parece, serie: c.serie, enCarpeta: enCarpeta, pistas: c.pistas.join(', '), creado: f.getDateCreated() };
}

// ── Revisión automática ──

/**
 * Cada revisor tiene su reloj cada MINUTOS_ENTRE_TANDAS minutos, y además
 * un arranque único al minuto (escalonados) para no esperar el primer reloj.
 */
function activarLegajoAutomatico() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaT = libro.getSheetByName('TABLA');
  if (!hojaT || hojaT.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Falta un paso', 'Primero usa «1. Armar tabla».',
      SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  if (LEER_DOCUMENTOS && typeof Drive === 'undefined') {
    var ui = SpreadsheetApp.getUi();
    var r = ui.alert('Falta activar la lectura por dentro',
      'Sin el servicio «Drive API» no se leen los PDF escaneados («DOCS proveedor OC…»), y ahí suele estar la factura.\n\n' +
      'Para activarlo: Apps Script → «Servicios» (+) → «Drive API» → Agregar.\n\n¿Seguir igual, sin leerlos?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  arrancarRevisores_();
  libro.toast('En un minuto arrancan ' + TRABAJADORES.length + ' revisores a la vez. Siguen solos cada ' +
    MINUTOS_ENTRE_TANDAS + ' minutos y se detienen al terminar. El avance se ve en RESUMEN.', 'Legajo por OC', 15);
}

/** Los relojes de los revisores: cada MINUTOS_ENTRE_TANDAS, más un arranque único al minuto. */
function arrancarRevisores_() {
  detenerLegajoAutomatico_();
  TRABAJADORES.forEach(function (fn, k) {
    ScriptApp.newTrigger(fn).timeBased().everyMinutes(MINUTOS_ENTRE_TANDAS).create();
    ScriptApp.newTrigger(fn).timeBased().after(60000 + k * 20000).create();
  });
}

// ── Actualización desde el cuadro de aprobaciones (cada noche o a mano) ──

/**
 * Lo que corre cada noche: vuelve a leer el cuadro de aprobaciones (que está
 * en vivo), suma las OC nuevas, actualiza estatus, aprobaciones y montos de
 * todas, conserva lo ya revisado y arranca los revisores para lo pendiente.
 */
function actualizacionNocturna() {
  actualizarDesdeElCuadro_();
}

/** Lo mismo, a mano, desde el menú. */
function actualizarAhora() {
  var ui = SpreadsheetApp.getUi();
  var c = actualizarDesdeElCuadro_();
  ui.alert('Actualizado desde el cuadro', c.filas + ' OC en total: ' + c.nuevas + ' nuevas, ' + c.quitadas +
    ' que ya no están en el cuadro.\n' + c.conservadas + ' conservan su revisión.\n' + c.pendientes +
    ' por revisar' + (c.pendientes ? ': los revisores arrancan en un minuto.' : '.'), ui.ButtonSet.OK);
}

function actualizarDesdeElCuadro_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  detenerLegajoAutomatico_();
  props.setProperty('LEGAJO_GEN', String(Date.now())); // lo de una tanda a medias se descarta
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(150000)) throw new Error('Una tanda estaba escribiendo; la actualización se reintenta en la próxima.');
  var c;
  try {
    c = armarTabla_(libro, modoActual_(), true);
  } catch (e) {
    anotarError_(libro, 'ERROR al actualizar desde el cuadro: ' + (e.message || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
  if (c.pendientes) arrancarRevisores_();
  else programarSubidaDelLegajo_(); // sin carpetas por revisar, igual cambió el estatus de las OC
  return c;
}

/**
 * La subida del legajo a la base (SubirLegajo.gs), en su propia ejecución
 * un minuto después: la tanda que termina ya gastó casi todo su tiempo.
 * Solo si SubirLegajo.gs está en el proyecto y tiene sus credenciales.
 */
function programarSubidaDelLegajo_() {
  if (typeof subirLegajo_ !== 'function' || !hayCredencialesDeLaBase_()) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'subidaAutomaticaDelLegajo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('subidaAutomaticaDelLegajo').timeBased().after(60000).create();
}

function subidaAutomaticaDelLegajo() {
  var r = subirLegajo_();
  actualizarResumen_(SpreadsheetApp.getActiveSpreadsheet(), r.error ? 'ERROR al subir el legajo a la base: ' + r.error : r.texto);
}

function programarActualizacionNocturna() {
  quitarActualizacionNocturna_();
  ScriptApp.newTrigger('actualizacionNocturna').timeBased().atHour(HORA_NOCTURNA).nearMinute(0).everyDays(1).create();
  SpreadsheetApp.getUi().alert('Programado', 'Cada día entre las ' + HORA_NOCTURNA + ':00 y las ' + HORA_NOCTURNA +
    ':59 (zona horaria: ' + Session.getScriptTimeZone() + ') se vuelve a leer el cuadro de aprobaciones y se revisa lo nuevo.\n\n' +
    'Si la zona no es America/Lima: Apps Script → Configuración del proyecto (engranaje) → Zona horaria.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function quitarActualizacionNocturna() {
  quitarActualizacionNocturna_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Actualización nocturna quitada.', 'Legajo por OC', 5);
}

function quitarActualizacionNocturna_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizacionNocturna') ScriptApp.deleteTrigger(t);
  });
}

function hayActualizacionNocturna_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'actualizacionNocturna'; });
}

function detenerLegajoAutomatico() {
  detenerLegajoAutomatico_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Revisión automática detenida.', 'Legajo por OC', 5);
}

// «revisarTandaLegajo» es el reloj de la versión anterior (un solo revisor).
function detenerLegajoAutomatico_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'revisarTandaLegajo' || TRABAJADORES.indexOf(fn) !== -1) ScriptApp.deleteTrigger(t);
  });
}

function hayAutomatico_() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return TRABAJADORES.indexOf(t.getHandlerFunction()) !== -1;
  });
}

function rehacerResumenLegajo() {
  actualizarResumen_(SpreadsheetApp.getActiveSpreadsheet(), 'Resumen rehecho a mano.');
}

// ── Resumen: % de cada documento por área, y el cruce de fuentes ──

/**
 * Números calculados aquí, no fórmulas: una fórmula con comas da #ERROR! en
 * una hoja en español (que separa con «;»).
 */
function actualizarResumen_(libro, resultado) {
  var hojaT = libro.getSheetByName('TABLA');
  var tabla = hojaT && hojaT.getLastRow() > 1 ?
    hojaT.getRange(2, 1, hojaT.getLastRow() - 1, CAB_TABLA.length).getValues() : [];

  var cruce = { total: tabla.length, plan: 0, aprob: 0, cg: 0, soloFuera: 0, sinAprob: 0, sinCg: 0,
    sinBase: 0, otroCeco: 0, sinCarpeta: 0, variasCarpetas: 0 };
  var rev = { pendientes: 0, revisadas: 0, sinAcceso: 0, vacias: 0, grandes: 0, subidas: 0 };
  var areas = [NACIONAL, COMEX, 'Total'];
  var cuenta = {};
  areas.forEach(function (a) { cuenta[a] = { ocs: 0, docs: DOCS.map(function () { return { si: 0, aplica: 0 }; }) }; });

  var porUnidad = {}, porSituacion = {}, anuladas = 0;
  tabla.forEach(function (f) {
    var aparece = String(f[I_APARECE]), revisar = String(f[I_REVISAR]);
    var situacion = String(f[I_SITUACION] || '(sin dato)');
    porSituacion[situacion] = (porSituacion[situacion] || 0) + 1;
    if (aparece.indexOf('Plan') !== -1) cruce.plan++; else cruce.soloFuera++;
    if (aparece.indexOf('Aprobaciones') !== -1) cruce.aprob++; else cruce.sinAprob++;
    if (aparece.indexOf('Control') !== -1) cruce.cg++; else cruce.sinCg++;
    if (aparece.indexOf('Base de OC') === -1) cruce.sinBase++;
    if (/otro centro de costo/.test(revisar)) cruce.otroCeco++;
    if (/carpetas distintas/.test(revisar)) cruce.variasCarpetas++;
    var unidad = String(f[I_UNIDAD] || '(sin unidad)');
    porUnidad[unidad] = (porUnidad[unidad] || 0) + 1;

    var estado = String(f[COL_ESTADO - 1]);
    if (estado === 'SIN CARPETA') { cruce.sinCarpeta++; return; }
    if (estado === 'PENDIENTE') { rev.pendientes++; return; }
    rev.revisadas++;
    if (/^SIN ACCESO/.test(estado)) { rev.sinAcceso++; return; }
    if (/^VACÍA/.test(estado)) rev.vacias++;
    if (/^MUY GRANDE/.test(estado)) rev.grandes++;
    if (/subcarpeta/.test(estado)) rev.subidas++;
    // Una OC anulada no debe documentos: no cuenta en los porcentajes.
    if (situacion === 'ANULADA') { anuladas++; return; }

    [f[I_AREA] || '', 'Total'].forEach(function (a) {
      if (!cuenta[a]) return;
      cuenta[a].ocs++;
      DOCS.forEach(function (d, j) {
        var marca = String(f[COL_PRIMER_DOC - 1 + j]);
        var c = cuenta[a].docs[j];
        if (marca.indexOf('✓') === 0) { c.si++; c.aplica++; }
        else if (marca === '✗' || marca === '○') c.aplica++;
      });
    });
  });

  var modo = modoActual_();
  var pct = function (c) { return c.aplica ? Math.round(100 * c.si / c.aplica) + '%  (' + c.si + ' de ' + c.aplica + ')' : '—'; };
  var filas = [], negritas = [];
  var titulo = function (t, b, c, d) { negritas.push(filas.length + 1); filas.push([t, b || '', c || '', d || '']); };
  var fila = function (t, v) { filas.push([t, v, '', '']); };
  filas.push(['Legajo por OC — ' + tituloDelModo_(modo), '', '', ''], ['', '', '', '']);
  titulo('Cruce de fuentes');
  fila('OC en la tabla', cruce.total);
  if (modo === MODO_APROBACIONES) {
    Object.keys(porUnidad).sort().forEach(function (u) { fila('   ' + u, porUnidad[u]); });
  } else {
    fila('Están en el plan de compras', cruce.plan);
    fila('NO están en el plan (solo en otra fuente)', cruce.soloFuera);
    fila('NO están en la base de OC de Compras', cruce.sinBase);
    fila('NO están en los cuadros de aprobaciones revisados', cruce.sinAprob);
  }
  fila('NO están en Control de Gestión', cruce.sinCg);
  if (modo !== MODO_APROBACIONES) fila('En Control de Gestión con otro centro de costo', cruce.otroCeco);
  fila('Con carpetas distintas entre fuentes', cruce.variasCarpetas);
  fila('Sin enlace de carpeta', cruce.sinCarpeta);
  filas.push(['', '', '', '']);
  titulo('Situación del pago (del cuadro de aprobaciones)');
  Object.keys(porSituacion).sort(function (a, b) { return porSituacion[b] - porSituacion[a]; })
    .forEach(function (k) { fila('   ' + k, porSituacion[k]); });
  filas.push(['', '', '', '']);
  titulo('Revisión de carpetas');
  fila('Revisadas', rev.revisadas);
  fila('Pendientes', rev.pendientes);
  fila('Sin acceso', rev.sinAcceso);
  fila('Vacías', rev.vacias);
  fila('El enlace era de una subcarpeta (se revisó desde la carpeta de la OC)', rev.subidas);
  fila('Enlace a una carpeta general (muy grande)', rev.grandes);
  filas.push(['', '', '', '']);
  titulo('Documento (% de las OC a las que les corresponde; sin las ' + anuladas + ' anuladas)', NACIONAL, COMEX, 'Total');
  filas.push(['OC revisadas', cuenta[NACIONAL].ocs, cuenta[COMEX].ocs, cuenta.Total.ocs]);
  DOCS.forEach(function (d, j) {
    filas.push([d.col + (d.opcional ? ' (opcional)' : ''),
      pct(cuenta[NACIONAL].docs[j]), pct(cuenta[COMEX].docs[j]), pct(cuenta.Total.docs[j])]);
  });
  var props = PropertiesService.getDocumentProperties();
  filas.push(['', '', '', ''],
    ['Última actualización desde el cuadro', props.getProperty('LEGAJO_ULTIMA_ACTUALIZACION') || '(todavía ninguna)', '', ''],
    ['Actualización cada noche', hayActualizacionNocturna_() ? 'SÍ, a las ' + HORA_NOCTURNA + ':00' : 'NO (menú: «Programar actualización cada noche»)', '', ''],
    ['Última subida a la base (hojas de SUNAT)', props.getProperty('LEGAJO_ULTIMA_SUBIDA') || '(todavía ninguna)', '', ''],
    ['Última tanda', new Date(), '', ''], ['Resultado de la última tanda', resultado, '', '']);

  var h = libro.getSheetByName('RESUMEN') || libro.insertSheet('RESUMEN');
  h.clear();
  h.getRange(1, 1, filas.length, 4).setValues(filas);
  h.getRange('A1').setFontWeight('bold').setFontSize(14);
  negritas.forEach(function (r) { h.getRange(r, 1, 1, 4).setFontWeight('bold'); });
  h.getRange(filas.length - 1, 2).setNumberFormat('dd/mm/yyyy hh:mm');
  h.setColumnWidth(1, 380);
  h.setColumnWidths(2, 3, 190);
}

function anotarError_(libro, texto) {
  try {
    var h = libro.getSheetByName('RESUMEN');
    if (h) {
      var ult = h.getLastRow();
      h.getRange(ult - 1, 1, 2, 2).setValues([['Última tanda', new Date()], ['Resultado de la última tanda', texto]]);
    }
  } catch (e) {
    // si ni esto se puede escribir, el error igual queda en «Ejecuciones»
  }
}

// ── Leer una pestaña de otra hoja ──

/**
 * La pestaña por su nombre. Con `buscarSiNoEsta`, si no está, la primera que
 * tenga las columnas `requeridas` (para las bases externas, que pueden
 * renombrarla). La fila de títulos se busca en las primeras 10 filas.
 * Devuelve null si el archivo no tiene esa pestaña (no todos los planes
 * tienen las mismas).
 */
function leerTabla_(libro, nombre, requeridas, buscarSiNoEsta) {
  var hoja = libro.getSheetByName(nombre);
  if (!hoja && buscarSiNoEsta) {
    var hojas = libro.getSheets();
    for (var i = 0; i < hojas.length && !hoja; i++) {
      var h = hojas[i];
      if (h.getLastRow() < 2 || h.getLastColumn() < 2) continue;
      if (filaDeTitulos_(h.getRange(1, 1, Math.min(10, h.getLastRow()), h.getLastColumn()).getValues(), requeridas) >= 0) hoja = h;
    }
  }
  if (!hoja || hoja.getLastRow() < 2) return null;
  var valores = hoja.getDataRange().getValues();
  var filaCab = filaDeTitulos_(valores.slice(0, 10), requeridas);
  if (filaCab < 0) throw new Error('En «' + libro.getName() + '» / «' + hoja.getName() +
    '» no encontré la fila de títulos con: ' + requeridas.join(', '));
  var titulos = valores[filaCab];
  var filas = valores.slice(filaCab + 1);
  var ricosPorCol = {}, halladas = {}, mapeo = {};
  return {
    filas: filas,
    mapeo: mapeo,
    /**
     * La columna de un campo, por su título: primero igual (sin tildes ni
     * espacios), y si no, el más PARECIDO (ver `parecidoDeTitulos_`). Así una
     * columna que se movió o cambió un poco de nombre se sigue encontrando.
     * -1 si ninguna se parece lo suficiente.
     */
    col: function (nombres) {
      var clave = nombres.join('|');
      if (clave in halladas) return halladas[clave];
      var mejor = -1, puntaje = 0, como = '';
      for (var j = 0; j < nombres.length && mejor < 0; j++) {
        for (var c = 0; c < titulos.length; c++) {
          if (normalizar_(titulos[c]) && normalizar_(titulos[c]) === normalizar_(nombres[j])) { mejor = c; como = 'igual'; break; }
        }
      }
      if (mejor < 0) {
        nombres.forEach(function (n) {
          titulos.forEach(function (t, c) {
            var p = parecidoDeTitulos_(n, t);
            if (p > puntaje) { puntaje = p; mejor = c; }
          });
        });
        if (puntaje < PARECIDO_MINIMO) mejor = -1;
        else como = 'parecido (' + Math.round(puntaje * 100) + '%)';
      }
      halladas[clave] = mejor;
      if (mejor >= 0) mapeo[clave] = { encabezado: String(titulos[mejor]).trim(), letra: letraDeColumna_(mejor + 1), como: como };
      return mejor;
    },
    /** La columna con más enlaces de Drive, para las que no tienen título. */
    columnaConEnlaces: function () {
      var mejor = -1, max = 0;
      for (var c = 0; c < titulos.length; c++) {
        var n = 0;
        for (var r = 0; r < Math.min(filas.length, 200); r++) if (/drive\.google\.com/.test(String(filas[r][c]))) n++;
        if (n > max) { max = n; mejor = c; }
      }
      return mejor;
    },
    /** El enlace de una celda, esté como texto, =HYPERLINK() o detrás de un texto. */
    url: function (k, c) {
      if (c < 0) return '';
      var v = filas[k][c];
      if (/https?:\/\//.test(String(v || ''))) return String(v).trim();
      if (!v) return '';
      if (!ricosPorCol[c]) {
        var rango = hoja.getRange(filaCab + 2, c + 1, filas.length, 1);
        ricosPorCol[c] = { ricos: rango.getRichTextValues(), formulas: rango.getFormulas() };
      }
      return urlDeCelda_(v, ricosPorCol[c].formulas[k][0], ricosPorCol[c].ricos[k][0]);
    }
  };
}

/** La fila (de las primeras) donde están todos los títulos `requeridas`, iguales o parecidos. */
function filaDeTitulos_(valores, requeridas) {
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var estan = requeridas.every(function (b) {
      return fila.some(function (v) { return parecidoDeTitulos_(b, v) >= PARECIDO_MINIMO; });
    });
    if (estan) return i;
  }
  return -1;
}

// Palabras que no ayudan a distinguir un título.
var PALABRAS_VACIAS = ['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'EN', 'POR', 'PARA', 'A', 'N', 'NO', 'NRO', 'NUM', 'NUMERO'];
var PARECIDO_MINIMO = 0.75;

function palabrasDeTitulo_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9%]+/g, ' ').replace(/%/g, ' ').trim().split(' ')
    .filter(function (p) { return p && PALABRAS_VACIAS.indexOf(p) === -1; })
    .map(function (p) { return p.length > 5 ? p.replace(/(ES|S)$/, '') : p; });
}

/**
 * Cuánto se parecen dos títulos de columna, de 0 a 1: la parte de sus
 * palabras que coinciden, sin contar «de», «la», «N°»… y aceptando plurales
 * y un error de tipeo en palabras largas. «Link de la carpeta OC» y «Link
 * carpeta OC» → 1; «Estatus Compra» y «Estatus de compra» → 1. Pero
 * «Aprobación GAF» y «Aprobación GOP» → 0,5: se parecen en letras, no en lo
 * que dicen, y no se confunden.
 */
function parecidoDeTitulos_(a, b) {
  var na = normalizar_(a), nb = normalizar_(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var pa = palabrasDeTitulo_(a), pb = palabrasDeTitulo_(b);
  if (!pa.length || !pb.length) return 0;
  var usadas = {}, iguales = 0;
  pa.forEach(function (x) {
    for (var j = 0; j < pb.length; j++) {
      if (usadas[j]) continue;
      var y = pb[j];
      if (x === y || (x.length >= 5 && y.length >= 5 && distancia_(x, y) <= 1)) { usadas[j] = true; iguales++; return; }
    }
  });
  return iguales / Math.max(pa.length, pb.length);
}

function letraDeColumna_(n) {
  var s = '';
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function valor_(fila, i) { return i >= 0 ? fila[i] : ''; }

// ── Qué parece ser cada archivo ──

// En orden: gana la primera que calce. «PAGO SWIFT» sale SWIFT y no PAGO;
// «FACTURA OC 0123» sale factura. En «Pistas» quedan todas las palabras.
var CATEGORIAS = [
  { parece: 'NOTA DE CRÉDITO', frases: ['NOTA DE CREDITO', 'NOTA CREDITO'], palabras: ['NC'] },
  { parece: 'NOTA DE DÉBITO', frases: ['NOTA DE DEBITO', 'NOTA DEBITO'], palabras: ['ND'] },
  // Antes que FACTURA: una «proforma invoice» o «factura proforma» no es la factura.
  { parece: 'PROFORMA', frases: ['PROFORMA INVOICE', 'PERFORMA INVOICE', 'PRO FORMA'], palabras: ['PROFORMA', 'PROFORMAS', 'PERFORMA'], parecidas: ['PROFORMA'] },
  // «INVOICE» es la factura del proveedor del exterior.
  { parece: 'FACTURA', frases: ['FACTURA ELECTRONICA', 'COMMERCIAL INVOICE'], palabras: ['FACTURA', 'FACTURAS', 'FACT', 'FAC', 'FACTU', 'FACTS', 'FE', 'INVOICE', 'INVOICES', 'INV'], parecidas: ['FACTURA', 'FACTURAS', 'FACTURACION', 'INVOICE'] },
  // «FT_…» resultó ser ficha técnica, no factura (así las nombran los proveedores).
  { parece: 'FICHA TÉCNICA', frases: ['FICHA TECNICA', 'FICHAS TECNICAS'], palabras: ['FT', 'FTS'] },
  { parece: 'BOLETA', frases: [], palabras: ['BOLETA', 'BOLETAS', 'BV'], parecidas: ['BOLETA'] },
  { parece: 'RECIBO POR HONORARIOS', frases: ['RECIBO POR HONORARIOS', 'RECIBO HONORARIOS', 'R X H'], palabras: ['RH', 'RHE', 'RXH', 'HONORARIOS'], parecidas: ['HONORARIOS'] },
  { parece: 'COMPROBANTE (revisar)', frases: [], palabras: ['COMPROBANTE', 'COMPROBANTES', 'CPE'], parecidas: ['COMPROBANTE'] },
  { parece: 'DETRACCIÓN', frases: [], palabras: ['DETRACCION', 'DETRACCIONES', 'SPOT'], parecidas: ['DETRACCION'] },
  { parece: 'SWIFT', frases: ['TT COPY', 'BANK SLIP', 'PAYMENT SLIP', 'TRANSFERENCIA INTERNACIONAL', 'MT 103'], palabras: ['SWIFT', 'MT103', 'TT'], parecidas: ['SWIFT'] },
  { parece: 'DAM', frases: ['DECLARACION ADUANERA', 'DECLARACION ADUANERA DE MERCANCIAS'], palabras: ['DAM', 'DAMS', 'DUA', 'LEVANTE'] },
  { parece: 'PAGO', frases: [], palabras: ['PAGO', 'PAGOS', 'VOUCHER', 'TRANSFERENCIA', 'CONSTANCIA', 'DEPOSITO', 'ABONO', 'ADELANTO'], parecidas: ['TRANSFERENCIA'] },
  { parece: 'GUÍA', frases: ['GUIA DE REMISION', 'GUIA REMISION'], palabras: ['GUIA', 'GUIAS', 'GR', 'GRE', 'REMISION'], parecidas: ['REMISION'] },
  { parece: 'ACTA DE CONFORMIDAD', frases: ['ACTA DE CONFORMIDAD', 'ACTA CONFORMIDAD', 'CONFORMIDAD DE SERVICIO', 'ACTA DE RECEPCION'], palabras: ['ACTA', 'ACTAS', 'CONFORMIDAD'], parecidas: ['CONFORMIDAD'] },
  { parece: 'DOCUMENTO DE IMPORTACIÓN', frases: ['BILL OF LADING', 'PACKING LIST', 'AGENTE DE ADUANA'], palabras: ['BL', 'AWB', 'PACKING', 'DESADUANAJE', 'ADUANA', 'ADUANAS'] },
  { parece: 'CONTRATO', frases: [], palabras: ['CONTRATO', 'CONTRATOS'], parecidas: ['CONTRATO'] },
  { parece: 'COTIZACIÓN', frases: [], palabras: ['COTIZACION', 'COTIZACIONES', 'COT', 'QUOTATION', 'QUOTE'], parecidas: ['COTIZACION'] },
  { parece: 'ORDEN DE COMPRA/SERVICIO', frases: ['ORDEN DE COMPRA', 'ORDEN DE SERVICIO', 'PURCHASE ORDER'], palabras: ['OC', 'OS', 'PO'] },
  { parece: 'REQUERIMIENTO', frases: [], palabras: ['REQUERIMIENTO', 'REQ', 'RQ'], parecidas: ['REQUERIMIENTO'] },
  { parece: 'CORREO / CAPTURA', frases: ['CAPTURA DE PANTALLA', 'SCREEN SHOT'], palabras: ['CORREO', 'CORREOS', 'EMAIL', 'MAIL', 'GMAIL', 'OUTLOOK', 'CAPTURA', 'PANTALLAZO', 'SCREENSHOT', 'WHATSAPP'], parecidas: ['CORREO'] },
  { parece: 'DATOS BANCARIOS', frases: ['CUENTA BANCARIA', 'CUENTAS BANCARIAS'], palabras: ['CCI'] }
];

/**
 * Mira el nombre del archivo primero y, si no dice nada, la carpeta donde
 * está («Guías / scan001.pdf» cuenta como guía).
 */
function clasificar_(nombre, ubicacion, mime) {
  var n = textoPlano_(nombre);
  var ext = (/\.([a-z0-9]{2,5})$/i.exec(nombre || '') || [])[1];
  ext = ext ? ext.toUpperCase() : '';
  var serie = serieEnNombre_(nombre);
  var pistas = pistasEn_(n);

  var parece = '';
  // Solo el XML de verdad: el tipo interno de un Excel también contiene «xml».
  var esXml = ext === 'XML' || mime === 'text/xml' || mime === 'application/xml';
  if (esXml) parece = /^R-/i.test(nombre) ? 'CDR (constancia SUNAT)' : 'XML';
  else if (ext === 'ZIP' && /^R-/i.test(nombre)) parece = 'CDR (constancia SUNAT)';
  if (!parece && (ext === 'EML' || ext === 'MSG')) parece = 'CORREO / CAPTURA';
  // Número de DAM: aduana-año-régimen-número (118-2025-10-123456).
  if (!parece && /(^|\D)\d{3}[- _]20\d\d[- _]10[- _]\d{4,6}(\D|$)/.test(String(nombre))) {
    parece = 'DAM';
    pistas.unshift({ parece: 'DAM', palabra: 'número de DAM' });
  }
  // Nombre como lo baja SUNAT, RUC-TIPO-SERIE-NÚMERO: el tipo lo dice todo.
  var sunat = TIPO_SUNAT[(/(?:^|\D)[12]\d{10}[-_ ](01|03|07|08|09|R01)[-_ ]/.exec(String(nombre).toUpperCase()) || [])[1]];
  if (!parece && sunat) { parece = sunat; pistas.unshift({ parece: sunat, palabra: 'tipo SUNAT en el nombre' }); }
  if (!parece && pistas.length) parece = pistas[0].parece;
  // «FT F001-123» o «PROFORMA F001-123» con serie de SUNAT sí son factura.
  if ((parece === 'FICHA TÉCNICA' && serie && !/^EG/.test(serie)) ||
    (parece === 'PROFORMA' && /^F/.test(serie))) parece = 'FACTURA';
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

var TIPO_SUNAT = { '01': 'FACTURA', '03': 'BOLETA', '07': 'NOTA DE CRÉDITO', '08': 'NOTA DE DÉBITO',
  '09': 'GUÍA', 'R01': 'RECIBO POR HONORARIOS' };

/**
 * F001-00018178, E001 179, FE010001380 → «F001-18178». Vacío si no trae una.
 * En «PDF-DOC-E001-37320547523939» SUNAT pega el RUC del emisor al número:
 * se le quitan esos 11 dígitos del final.
 */
function serieEnNombre_(nombre) {
  var t = String(nombre || '').toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, '');
  // «01F0010031388»: el tipo de SUNAT (01, 03, 07, 08) pegado a serie y número.
  var pegado = /(?:^|[^A-Z0-9])0[1378]([FBE][A-Z]?\d{2,3})(\d{4,8})(?!\d)/.exec(t);
  if (pegado && pegado[1].length === 4) return pegado[1] + '-' + pegado[2].replace(/^0+(?=\d)/, '');
  var m = /(?:^|[^A-Z0-9])([FBE][A-Z0-9]{3})(\s*[-_ ]?\s*)(\d{1,19})(?!\d)/.exec(t);
  if (!m || !/\d/.test(m[1])) return '';
  if (!/[-_ ]/.test(m[2]) && !/^[FBE][A-Z]?0\d{1,2}$/.test(m[1])) return '';
  var num = m[3];
  if (num.length > 11 && /[12]\d{10}$/.test(num)) num = num.slice(0, -11);
  num = num.replace(/^0+(?=\d)/, '');
  if (num.length > 8) return '';
  return m[1] + '-' + num;
}

/**
 * La OC como clave. Nacionales e importaciones llevan numeraciones
 * DISTINTAS que se cruzan: la nacional «0172-2026» (4 dígitos) no es la
 * importación «172-2026» (3 dígitos). Por eso se respeta la procedencia:
 * nacional → 4 dígitos, importación → 3. Si la fuente no dice la
 * procedencia, se decide por cuántos dígitos trae.
 *   («OC 115-2026», nacional) → «0115-2026» · («172-2026», importación) → «172-2026»
 */
function ocNormalizada_(texto, proc) {
  var s = String(texto == null ? '' : texto);
  var num, anio, m = /(\d{1,6})\s*-\s*(202\d)(?!\d)/.exec(s);
  if (m) { num = m[1]; anio = m[2]; }
  else if ((m = /(?:^|\D)(202\d)\s*-\s*(\d{1,6})(?!\d)/.exec(s))) { num = m[2]; anio = m[1]; }
  else return '';
  var p = String(proc || '').toUpperCase();
  var impo = /IMPO|INTERNAC|EXTRANJ/.test(p) ? true : /NAC/.test(p) ? false : num.length <= 3;
  var n = String(Number(num)), ancho = impo ? 3 : 4;
  while (n.length < ancho) n = '0' + n;
  return n + '-' + anio;
}

/** «0115-2026» → { num: 115, anio: 2026 }. */
function numeroDeOC_(texto) {
  var m = /(\d{1,6})\s*-\s*(20\d\d)/.exec(String(texto || ''));
  return m ? { num: Number(m[1]), anio: m[2] } : null;
}

/** Si el nombre menciona la OC en cualquier orden: 0115-2026, 115-2026, 2026-0115. */
function nombreMencionaOC_(nombre, oc) {
  var t = String(nombre || '');
  var r1 = new RegExp('(^|\\D)0*' + oc.num + '\\s*[-_ ]\\s*' + oc.anio + '(\\D|$)');
  var r2 = new RegExp('(^|\\D)' + oc.anio + '\\s*[-_ ]\\s*0*' + oc.num + '(\\D|$)');
  return r1.test(t) || r2.test(t);
}

/** «NAC», «NACIONAL» → Nacional; «Impo», «INTERNACIONAL» → Importación. */
function procedencia_(lista) {
  var t = lista.join(' ').toUpperCase();
  if (/IMPO|INTERNAC|EXTRANJ/.test(t)) return 'Importación';
  if (/NAC/.test(t)) return 'Nacional';
  return '';
}

// ── Ayudas ──

function textoPlano_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, '').replace(/[^A-Z0-9]+/g, ' ')
    .replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').trim();
}

var NO_SON = ['FACTOR', 'FACTORES', 'FACIL', 'FACHADA', 'BOLETIN', 'REMISOR', 'CONTRATISTA', 'CORRER'];

/** Error de tipeo tolerado: 1 letra en palabras de 5 o más, 2 si además empieza igual. */
function seParece_(p, q) {
  if (p.length < 5 || NO_SON.indexOf(p) !== -1) return false;
  var d = distancia_(p, q);
  return d <= 1 || (d <= 2 && p.length >= 6 && p.slice(0, 3) === q.slice(0, 3));
}

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
  var u = String(url || '');
  var m = /\/folders\/([\w-]{20,})/.exec(u) || /\/d\/([\w-]{20,})/.exec(u) || /[?&]id=([\w-]{20,})/.exec(u);
  return m ? m[1] : '';
}

function agregar_(lista, v) {
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  if (v === true || v === false) v = v ? 'Sí' : 'No'; // las casillas del cuadro
  var s = String(v == null ? '' : v).trim();
  if (s && s !== '-' && s !== '#N/A' && s !== '#REF!' && lista.indexOf(s) === -1) lista.push(s);
}

function tipoLegible_(mime, nombre) {
  var tipos = {
    'application/pdf': 'PDF', 'text/xml': 'XML', 'application/xml': 'XML',
    'application/zip': 'ZIP', 'image/jpeg': 'Imagen', 'image/png': 'Imagen',
    'application/vnd.google-apps.document': 'Documento de Google',
    'application/vnd.google-apps.spreadsheet': 'Hoja de Google',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'message/rfc822': 'Correo'
  };
  if (tipos[mime]) return tipos[mime];
  var ext = /\.([a-z0-9]{2,5})$/i.exec(nombre || '');
  return ext ? ext[1].toUpperCase() : mime;
}

function prepararHoja_(libro, nombre, cabeceras) {
  var h = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  h.clear();
  h.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras])
    .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF').setWrap(true);
  h.setFrozenRows(1);
  return h;
}
