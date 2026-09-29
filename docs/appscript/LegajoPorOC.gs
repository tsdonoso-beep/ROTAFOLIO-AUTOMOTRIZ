/**
 * Legajo por OC — la tabla objetivo de un proyecto
 * --------------------------------------------------------------------------
 *
 * Arma, para UN proyecto (el piloto es EPT), una fila por OC con lo que
 * Contabilidad necesita para registrar la compra en CONCAR, y marca qué
 * documento está y cuál falta en la carpeta (legajo) de cada OC:
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
 * 3. Recarga la hoja: aparece el menú «Legajo por OC».
 * 4. «1. Armar tabla del proyecto» (la primera vez pide permisos).
 * 5. «Revisar solo cada 10 minutos»: recorre las carpetas por tandas y se
 *    detiene al terminar. El avance se ve en RESUMEN.
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
var EMPRESA = 'INROPRIN';        // las OC de Inroplas tienen otra numeración
var MINUTOS_POR_TANDA = 4.5;     // Apps Script corta a los 6
var LIMITE_ARCHIVOS = 800;       // más que esto: el enlace es de una carpeta general, no de la OC

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

var CAB_DATOS = ['OC', 'Aparece en', 'Procedencia', 'Área que la completa', 'Proveedor',
  'RUC (CG)', 'N° Requerimiento', 'Centro de costo (CG)', 'Nombre del centro de costo (CG)',
  'Código SIDIGE (CG)', 'Ítems en el plan', 'Estado de compra (plan)',
  'Estatus (aprobaciones)', 'Legajo para pago (aprobaciones)', 'Comentario legajo incompleto',
  'Bien o servicio', 'Enlace de la carpeta', 'Revisar el cruce'];
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

var CAB_ARCHIVOS = ['OC', 'Área', 'Enlace carpeta OC', 'Ubicación', 'Nombre del archivo',
  'Enlace del archivo', 'Tipo de archivo', 'Parece ser', 'Cuenta como', 'Pistas', 'Creado'];

var NACIONAL = 'Compras nacionales', COMEX = 'COMEX (importaciones)';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Legajo por OC')
    .addItem('1. Armar tabla del proyecto', 'armarTablaLegajo')
    .addItem('2. Revisar siguiente tanda', 'revisarTandaLegajo')
    .addSeparator()
    .addItem('Revisar solo cada 10 minutos', 'activarLegajoAutomatico')
    .addItem('Detener revisión automática', 'detenerLegajoAutomatico')
    .addSeparator()
    .addItem('Rehacer el resumen', 'rehacerResumenLegajo')
    .addToUi();
}

// ── 1. La tabla: las OC del proyecto, cruzadas entre las tres fuentes ──

function armarTablaLegajo() {
  var ui = SpreadsheetApp.getUi();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaT = libro.getSheetByName('TABLA');
  if (hojaT && hojaT.getLastRow() > 1) {
    var r = ui.alert('Ya hay una tabla',
      'Armarla de nuevo borra TABLA y ARCHIVOS y empieza desde cero. ¿Seguir?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  // Una tanda que siga corriendo escribiría encima de la tabla nueva.
  detenerLegajoAutomatico_();
  var lock = LockService.getScriptLock();
  libro.toast('Si hay una tanda corriendo, espero a que termine (hasta 5 minutos)…', 'Legajo por OC', 10);
  if (!lock.tryLock(330000)) {
    ui.alert('Hay una tanda ocupada', 'No terminó a tiempo. Espera unos minutos y vuelve a intentarlo.', ui.ButtonSet.OK);
    return;
  }
  try {
    var n = armarTabla_(libro);
    ui.alert('Tabla armada',
      n.filas + ' OC del proyecto ' + PROYECTO.nombre + '.\n' +
      n.conCarpeta + ' tienen enlace de carpeta y se van a revisar.\n\n' +
      'Sigue con «Revisar solo cada 10 minutos».', ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function armarTabla_(libro) {
  var ocs = {}, orden = [];
  var registro = function (oc) {
    if (!ocs[oc]) {
      ocs[oc] = { oc: oc, fuentes: {}, proc: [], prov: [], ruc: [], req: [], ceco: [], cecoNombre: [],
        sidige: [], items: 0, estado: [], estatus: [], legajo: [], coment: [], tipo: [], otroCeco: [], otroProyBase: [],
        links: { aprob: [], planCA: [], plan: [], cg: [] } };
      orden.push(oc);
    }
    return ocs[oc];
  };

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
      var r = registro(oc);
      r.fuentes.plan = true;
      if (p.nombre === 'Plan de Compras') r.items++;
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
      if (!delProyecto && !ocs[oc]) return;
      var r = registro(oc);
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
      var delProyecto = PROYECTO.patron.test(String(valor_(f, ca.col(['Proyecto']))));
      if (!delProyecto && !ocs[oc]) return;
      var r = registro(oc);
      r.fuentes.aprob = true;
      if (delProyecto) r.fuentes.planCA = true;
      agregar_(r.req, valor_(f, ca.col(['REQ N°'])));
      agregar_(r.proc, valor_(f, ca.col(['procedencia'])));
      agregar_(r.links.planCA, ca.url(k, caLink));
    });
  }

  // d) El cuadro de aprobaciones general (2026).
  var ap = leerTabla_(SpreadsheetApp.openById(APROBACIONES_ID), APROBACIONES_PESTANA, ['OC', 'Link de la carpeta OC'], true);
  if (ap) {
    ap.filas.forEach(function (f, k) {
      if (normalizar_(valor_(f, ap.col(['Unidad de negocio']))) !== normalizar_(EMPRESA)) return;
      var oc = ocNormalizada_(valor_(f, ap.col(['OC'])), valor_(f, ap.col(['Procedencia'])));
      if (!oc) return;
      var delProyecto = PROYECTO.patron.test(String(valor_(f, ap.col(['Proyecto']))));
      if (!delProyecto && !ocs[oc]) return;
      var r = registro(oc);
      r.fuentes.aprob = true;
      agregar_(r.req, valor_(f, ap.col(['N° Requerimiento'])));
      agregar_(r.proc, valor_(f, ap.col(['Procedencia'])));
      agregar_(r.prov, valor_(f, ap.col(['PROVEEDOR'])));
      agregar_(r.estatus, valor_(f, ap.col(['Estatus Compra'])));
      agregar_(r.legajo, valor_(f, ap.col(['LEGAJO PARA PAGO'])));
      agregar_(r.coment, valor_(f, ap.col(['COMENTARIOS POR LEG. INCOMPLETO'])));
      agregar_(r.tipo, /SERVICIO/i.test(String(valor_(f, ap.col(['Concepto'])))) ? 'SERVICIO' : '');
      agregar_(r.links.aprob, ap.url(k, ap.col(['Link de la carpeta OC'])));
    });
  }

  // e) Control de Gestión: centro de costo, código SIDIGE y el cruce de vuelta.
  var cg = leerTabla_(SpreadsheetApp.openById(CG_ID), CG_PESTANA, ['N° OC/OS', 'LINK DE CARPETA'], true);
  if (cg) {
    cg.filas.forEach(function (f, k) {
      if (normalizar_(valor_(f, cg.col(['EMPRESA']))) !== normalizar_(EMPRESA)) return;
      var oc = ocNormalizada_(valor_(f, cg.col(['N° OC/OS'])), valor_(f, cg.col(['PROCEDENCIA'])));
      if (!oc) return;
      var codigo = String(valor_(f, cg.col(['CODIGO CENTRO DE COSTO'])) || '').trim();
      var nombre = String(valor_(f, cg.col(['CENTRO DE COSTO'])) || '').trim();
      var delProyecto = PROYECTO.patron.test(codigo + ' ' + nombre);
      if (!delProyecto && !ocs[oc]) return;
      var r = registro(oc);
      r.fuentes.cg = true;
      if (delProyecto) {
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

  // Las filas. Un enlace por OC: primero el del cuadro de aprobaciones (lo
  // pone Compras al pedir la aprobación), después el del plan, al final el de CG.
  var conCarpeta = 0;
  var filas = orden.map(function (oc) {
    var r = ocs[oc];
    var links = [].concat(r.links.aprob, r.links.planCA, r.links.plan, r.links.cg);
    var ids = [];
    links.forEach(function (u) { var id = idDeDrive_(u); if (id && ids.indexOf(id) === -1) ids.push(id); });
    var enlace = '';
    for (var i = 0; i < links.length; i++) if (idDeDrive_(links[i])) { enlace = links[i]; break; }
    if (enlace) conCarpeta++;

    var proc = procedencia_(r.proc);
    var tipo = r.tipo.indexOf('SERVICIO') !== -1 ? 'Servicio' : r.tipo.indexOf('BIEN') !== -1 ? 'Bien' : '';
    var fuentes = [];
    if (r.fuentes.plan) fuentes.push('Plan de compras');
    if (r.fuentes.base) fuentes.push('Base de OC');
    if (r.fuentes.aprob) fuentes.push('Aprobaciones');
    if (r.fuentes.cg) fuentes.push('Control de Gestión');

    var revisar = [];
    if (!r.fuentes.plan) revisar.push('no está en el plan de compras');
    if (!r.fuentes.base) revisar.push('no está en la base de OC de Compras');
    else if (!r.fuentes.baseProyecto) revisar.push('en la base de OC está con otro proyecto: ' + r.otroProyBase.join(' / '));
    if (!r.fuentes.aprob) revisar.push('no está en los cuadros de aprobaciones revisados');
    if (!r.fuentes.cg) revisar.push('no está en Control de Gestión');
    else if (!r.fuentes.cgProyecto) revisar.push('en Control de Gestión está con otro centro de costo: ' + r.otroCeco.join(' / '));
    else if (r.otroCeco.length) revisar.push('en Control de Gestión también está en: ' + r.otroCeco.join(' / '));
    if (!enlace) revisar.push('sin enlace de carpeta');
    if (ids.length > 1) revisar.push(ids.length + ' carpetas distintas entre las fuentes');
    if (!proc) revisar.push('sin procedencia');

    return [oc, fuentes.join(' · '), proc, proc === 'Importación' ? COMEX : proc === 'Nacional' ? NACIONAL : '',
      r.prov.slice(0, 2).join(' / '), r.ruc.join(' / '), r.req.join(' / '), r.ceco.join(' / '),
      r.cecoNombre.join(' / '), r.sidige.slice(0, 5).join(' / ') + (r.sidige.length > 5 ? ' …' : ''),
      r.items || '', r.estado.join(' / '), r.estatus.join(' / '), r.legajo.join(' / '),
      r.coment.join(' / '), tipo, enlace, revisar.join('; ')]
      .concat([enlace ? 'PENDIENTE' : 'SIN CARPETA'], CAB_REVISION.slice(1).map(function () { return ''; }));
  });
  // Primero las del plan, después las que solo aparecen en otra fuente.
  filas.sort(function (a, b) {
    var pa = a[1].indexOf('Plan') === 0 ? 0 : 1, pb = b[1].indexOf('Plan') === 0 ? 0 : 1;
    return pa - pb || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  });

  var hojaT = prepararHoja_(libro, 'TABLA', CAB_TABLA);
  prepararHoja_(libro, 'ARCHIVOS', CAB_ARCHIVOS);
  if (filas.length) {
    // Como texto: que «0115-2026» o un RUC no se conviertan en fecha o número.
    hojaT.getRange(2, 1, filas.length, CAB_DATOS.length).setNumberFormat('@');
    hojaT.getRange(2, CAB_TABLA.length, filas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    hojaT.getRange(2, 1, filas.length, CAB_TABLA.length).setValues(filas);
  }
  hojaT.setFrozenColumns(1);
  hojaT.getRange(1, COL_PRIMER_DOC, 1, DOCS.length).setBackground('#375623');
  actualizarResumen_(libro, 'Tabla armada. Todavía no se revisa ninguna carpeta.');
  return { filas: filas.length, conCarpeta: conCarpeta };
}

// ── 2. Revisar carpetas, por tandas ──

function revisarTandaLegajo() {
  var lock = LockService.getScriptLock();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  if (!lock.tryLock(1000)) {
    try { libro.toast('Ya hay una tanda corriendo. Sigue sola: revisa RESUMEN en unos minutos.', 'Legajo por OC', 10); } catch (e) {}
    return;
  }
  try {
    var inicio = Date.now();
    var hojaT = libro.getSheetByName('TABLA');
    var hojaA = libro.getSheetByName('ARCHIVOS');
    if (!hojaT || hojaT.getLastRow() < 2) throw new Error('Primero «1. Armar tabla del proyecto».');

    var tabla = hojaT.getRange(2, 1, hojaT.getLastRow() - 1, CAB_TABLA.length).getValues();
    var archivos = [], resultados = {}, hechas = 0, cache = {}, cacheArriba = {};

    for (var i = 0; i < tabla.length; i++) {
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

      var porDoc = {};
      res.archivos.forEach(function (a) {
        var claves = [claveDoc_(a.parece)];
        // «scan001.pdf» dentro de «FACTURA Y GUÍA» cuenta para las dos.
        a.enCarpeta.forEach(function (p) { claves.push(claveDoc_(p)); });
        claves = claves.filter(function (c, i, t) { return c && t.indexOf(c) === i; });
        // Un PDF o imagen que no dice qué es, pero lleva el número de la OC:
        // es la OC. (Un Excel con el número suele ser el costeo, no la OC.)
        if (!claves.length && a.parece === 'OTRO' && /PDF|Imagen/.test(a.tipo) && ocNum &&
          nombreMencionaOC_(a.nombre, ocNum)) claves = ['OC'];
        // En una importación, el comprobante de pago al exterior es el SWIFT.
        if (!claves.length && /^PAGO/.test(a.parece) && f[I_PROC] === 'Importación') claves = ['SWIFT'];
        claves.forEach(function (c) { (porDoc[c] = porDoc[c] || []).push(a); });
        archivos.push([f[0], f[I_AREA], f[I_LINK], a.ubicacion, a.nombre, a.url, a.tipo, a.parece,
          claves.map(nombreDeClave_).join(', '), a.pistas, a.creado]);
      });
      resultados[i] = { estado: res.estado, detalle: res.detalle, n: res.archivos.length, porDoc: porDoc };
      hechas++;
    }

    // Todo junto al final: si la tanda se corta, no queda una OC marcada
    // como revisada sin sus archivos.
    if (archivos.length) {
      hojaA.getRange(hojaA.getLastRow() + 1, 1, archivos.length, CAB_ARCHIVOS.length).setValues(archivos);
    }
    Object.keys(resultados).forEach(function (k) {
      escribirRevision_(hojaT, Number(k) + 2, tabla[k], resultados[k]);
    });

    var pendientes = tabla.filter(function (f, k) {
      return f[COL_ESTADO - 1] === 'PENDIENTE' && !resultados[k];
    }).length;
    if (pendientes === 0) detenerLegajoAutomatico_();
    var texto = hechas + ' OC revisadas en esta tanda, ' + archivos.length + ' archivos. Faltan ' +
      pendientes + (pendientes === 0 ? ' — TERMINADO.' : '.');
    actualizarResumen_(libro, texto);
    libro.toast(texto, 'Legajo por OC', 10);
  } catch (e) {
    anotarError_(libro, 'ERROR: ' + (e.message || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Las marcas ✓ / ✗ / — / ○ de una OC, con el enlace al primer archivo de cada documento. */
function escribirRevision_(hoja, fila, datos, res) {
  var proc = datos[I_PROC], tipo = datos[I_TIPO], req = String(datos[I_REQ] || '');
  var falta = [];
  var celdas = DOCS.map(function (d) {
    var hallados = res.porDoc[d.clave] || [];
    if (hallados.length) return rico_('✓ ' + hallados.length, hallados[0].url);
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
  var nombre = f.getName(), mime = f.getMimeType(), url = f.getUrl();
  if (mime === 'application/vnd.google-apps.shortcut') {
    try {
      var real = DriveApp.getFileById(f.getTargetId());
      nombre = real.getName() + ' (acceso directo)';
      mime = real.getMimeType();
      url = real.getUrl();
    } catch (e) {
      nombre += ' (acceso directo sin acceso)';
    }
  }
  var c = clasificar_(nombre, pistaCarpeta, mime);
  // Si lo que dice qué es el archivo es la carpeta, todas sus pistas cuentan.
  var enCarpeta = / \(por la carpeta\)$/.test(c.parece) ?
    pistasEn_(textoPlano_(pistaCarpeta)).map(function (p) { return p.parece; }) : [];
  return { ubicacion: ubicacion, nombre: nombre, url: url, tipo: tipoLegible_(mime, nombre),
    parece: c.parece, enCarpeta: enCarpeta, pistas: c.pistas.join(', '), creado: f.getDateCreated() };
}

// ── Revisión automática ──

function activarLegajoAutomatico() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hojaT = libro.getSheetByName('TABLA');
  if (!hojaT || hojaT.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Falta un paso', 'Primero usa «1. Armar tabla del proyecto».',
      SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  detenerLegajoAutomatico_();
  ScriptApp.newTrigger('revisarTandaLegajo').timeBased().everyMinutes(10).create();
  libro.toast('Empieza la primera tanda (unos 5 minutos). Después sigue sola cada 10 minutos ' +
    'y se detiene al terminar. El avance se ve en RESUMEN.', 'Legajo por OC', 15);
  revisarTandaLegajo();
}

function detenerLegajoAutomatico() {
  detenerLegajoAutomatico_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Revisión automática detenida.', 'Legajo por OC', 5);
}

function detenerLegajoAutomatico_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarTandaLegajo') ScriptApp.deleteTrigger(t);
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
  var rev = { pendientes: 0, revisadas: 0, sinAcceso: 0, vacias: 0, grandes: 0 };
  var areas = [NACIONAL, COMEX, 'Total'];
  var cuenta = {};
  areas.forEach(function (a) { cuenta[a] = { ocs: 0, docs: DOCS.map(function () { return { si: 0, aplica: 0 }; }) }; });

  tabla.forEach(function (f) {
    var aparece = String(f[1]), revisar = String(f[CAB_DATOS.length - 1]);
    if (aparece.indexOf('Plan') !== -1) cruce.plan++; else cruce.soloFuera++;
    if (aparece.indexOf('Aprobaciones') !== -1) cruce.aprob++; else cruce.sinAprob++;
    if (aparece.indexOf('Control') !== -1) cruce.cg++; else cruce.sinCg++;
    if (aparece.indexOf('Base de OC') === -1) cruce.sinBase++;
    if (/otro centro de costo/.test(revisar)) cruce.otroCeco++;
    if (/carpetas distintas/.test(revisar)) cruce.variasCarpetas++;

    var estado = String(f[COL_ESTADO - 1]);
    if (estado === 'SIN CARPETA') { cruce.sinCarpeta++; return; }
    if (estado === 'PENDIENTE') { rev.pendientes++; return; }
    rev.revisadas++;
    if (/^SIN ACCESO/.test(estado)) { rev.sinAcceso++; return; }
    if (/^VACÍA/.test(estado)) rev.vacias++;
    if (/^MUY GRANDE/.test(estado)) rev.grandes++;

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

  var pct = function (c) { return c.aplica ? Math.round(100 * c.si / c.aplica) + '%  (' + c.si + ' de ' + c.aplica + ')' : '—'; };
  var filas = [
    ['Legajo por OC — ' + PROYECTO.nombre, '', '', ''],
    ['', '', '', ''],
    ['Cruce de fuentes', '', '', ''],
    ['OC en la tabla', cruce.total, '', ''],
    ['Están en el plan de compras', cruce.plan, '', ''],
    ['NO están en el plan (solo en otra fuente)', cruce.soloFuera, '', ''],
    ['NO están en la base de OC de Compras', cruce.sinBase, '', ''],
    ['NO están en los cuadros de aprobaciones revisados', cruce.sinAprob, '', ''],
    ['NO están en Control de Gestión', cruce.sinCg, '', ''],
    ['En Control de Gestión con otro centro de costo', cruce.otroCeco, '', ''],
    ['Con carpetas distintas entre fuentes', cruce.variasCarpetas, '', ''],
    ['Sin enlace de carpeta', cruce.sinCarpeta, '', ''],
    ['', '', '', ''],
    ['Revisión de carpetas', '', '', ''],
    ['Revisadas', rev.revisadas, '', ''],
    ['Pendientes', rev.pendientes, '', ''],
    ['Sin acceso', rev.sinAcceso, '', ''],
    ['Vacías', rev.vacias, '', ''],
    ['Enlace a una carpeta general (muy grande)', rev.grandes, '', ''],
    ['', '', '', ''],
    ['Documento (% de las OC a las que les corresponde)', NACIONAL, COMEX, 'Total'],
    ['OC revisadas', cuenta[NACIONAL].ocs, cuenta[COMEX].ocs, cuenta.Total.ocs]
  ];
  DOCS.forEach(function (d, j) {
    filas.push([d.col + (d.opcional ? ' (opcional)' : ''),
      pct(cuenta[NACIONAL].docs[j]), pct(cuenta[COMEX].docs[j]), pct(cuenta.Total.docs[j])]);
  });
  filas.push(['', '', '', ''], ['Última tanda', new Date(), '', ''], ['Resultado de la última tanda', resultado, '', '']);

  var h = libro.getSheetByName('RESUMEN') || libro.insertSheet('RESUMEN');
  h.clear();
  h.getRange(1, 1, filas.length, 4).setValues(filas);
  h.getRange('A1').setFontWeight('bold').setFontSize(14);
  [3, 14, 21].forEach(function (r) { h.getRange(r, 1, 1, 4).setFontWeight('bold'); });
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
  var cab = valores[filaCab].map(normalizar_);
  var filas = valores.slice(filaCab + 1);
  var ricosPorCol = {};
  return {
    filas: filas,
    /** El índice de la primera columna cuyo título calce con alguno de `nombres`; -1 si no hay. */
    col: function (nombres) {
      for (var j = 0; j < nombres.length; j++) {
        var k = cab.indexOf(normalizar_(nombres[j]));
        if (k !== -1) return k;
      }
      return -1;
    },
    /** La columna con más enlaces de Drive, para las que no tienen título. */
    columnaConEnlaces: function () {
      var mejor = -1, max = 0;
      for (var c = 0; c < cab.length; c++) {
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

function filaDeTitulos_(valores, requeridas) {
  var buscadas = requeridas.map(normalizar_);
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i].map(normalizar_);
    if (buscadas.every(function (b) { return fila.indexOf(b) !== -1; })) return i;
  }
  return -1;
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
  var num, anio, m = /(\d{1,6})\s*-\s*(20\d\d)(?!\d)/.exec(s);
  if (m) { num = m[1]; anio = m[2]; }
  else if ((m = /(20\d\d)\s*-\s*(\d{1,6})/.exec(s))) { num = m[2]; anio = m[1]; }
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
