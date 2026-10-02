/**
 * Alertas del legajo por OC: un correo diario a cada comprador
 * --------------------------------------------------------------------------
 *
 * EN PAUSA (02/10/2026): todavía no se instala. Primero se completa la
 * información (el comprador se conoce en el 34% de las carpetas) y
 * Contabilidad y Finanzas validan lo que se muestra.
 *
 * El acuerdo de la reunión de resultados (octubre 2026): completar el legajo
 * es responsabilidad del comprador. Cada día hábil, a cada comprador le llega
 * UN correo con sus carpetas de OC a las que les falta algo (primero las ya
 * pagadas, que es donde se pierde la factura y la guía) y las facturas de
 * SUNAT que aparentan no tener OC, con copia a Contabilidad y Finanzas. Las
 * carpetas sin comprador conocido van al responsable de su área (Compras
 * nacionales / COMEX). Los lunes, además, el ranking por comprador.
 *
 * Lee lo mismo que la pestaña CARPETA MADRE (la base, con la cuenta ROBOT):
 * el robot de las carpetas lee dos veces al día. Si la última lectura es
 * vieja (una corrida falló), NO manda nada a los compradores —para no
 * reclamar lo que quizá ya subieron— y avisa a quien recibe las copias.
 *
 * ── Modo prueba (por omisión) ──
 * Mientras ALERTAS_MODO no sea REAL, nada llega a los compradores: llega UN
 * solo correo a la dirección de prueba con lo que recibiría cada uno. Así
 * Contabilidad revisa una semana que no haya avisos falsos.
 *
 * ── Instalación ──
 * Va en el MISMO proyecto que CarpetaMadre.gs (la hoja GENERAL): usa su
 * conexión a la base.
 * 1. Apps Script de GENERAL → + → Script → «AlertasLegajo» → pega esto → guarda.
 * 2. Ejecuta «instalarAlertas» (acepta el permiso de enviar correos). Crea la
 *    pestaña ALERTAS - CORREOS con cada comprador y cada área: escribe ahí
 *    su correo. En COPIA van Contabilidad y Finanzas. Deja programado el
 *    envío de los días hábiles a las 8:00 y manda la primera prueba.
 * 3. Cuando la prueba esté bien: engranaje → Propiedades del script →
 *    ALERTAS_MODO = REAL. (ALERTAS_PRUEBA_A: a quién van las pruebas; vacío
 *    = a quien instaló. VISTA_URL: el enlace de la vista ejecutiva, para el
 *    botón del correo.)
 */

var AL_HOJA_CORREOS = 'ALERTAS - CORREOS';
var AL_HOJA_ENVIOS = 'ALERTAS - ENVÍOS';
var AL_HORA = 8;              // días hábiles, después de la lectura de las 01:17 (o de cuando GitHub la deje correr)
var AL_ANIO = '2026';         // solo las OC de este año
var AL_MAX_FILAS = 60;        // por sección del correo; el resto, en la vista
var AL_CABECERA = ['Tipo', 'Nombre (como en el cuadro o el área)', 'Correo', '¿Recibe? (Sí/No)', 'Nota'];

// ── Instalación y menú ──

function instalarAlertas() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarAlertasDiarias') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarAlertasDiarias').timeBased().everyDays(1).atHour(AL_HORA).create();
  var r = prepararCorreosAlertas();
  var p = enviarAlertas_({ forzar: true });
  var texto = r + '\n\n' + (p.error || p.texto) + '\n\nQueda programado de lunes a viernes a las ' + AL_HORA + ':00, en modo ' + modoAlertas_() + '.';
  try { SpreadsheetApp.getUi().alert('Alertas del legajo', texto, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { Logger.log(texto); }
}

/** Desde el menú: la de hoy, ya (en el modo que esté). */
function enviarAlertasAhora() {
  var r = enviarAlertas_({ forzar: true });
  SpreadsheetApp.getUi().alert('Alertas del legajo', r.error || r.texto, SpreadsheetApp.getUi().ButtonSet.OK);
}

function quitarAlertas() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarAlertasDiarias') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getUi().alert('Listo: ya no se envían solas. Puedes enviarlas a mano desde el menú «Carpeta madre».');
}

/** El disparador de cada día (de lunes a viernes). */
function enviarAlertasDiarias() {
  var dia = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'u')); // 1 lunes … 7 domingo
  if (dia >= 6) return;
  var r = enviarAlertas_({ forzar: false });
  if (r.error) throw new Error(r.error);
}

function modoAlertas_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALERTAS_MODO') || '').trim().toUpperCase() === 'REAL' ? 'REAL' : 'PRUEBA';
}

// ── La pestaña de correos ──

/**
 * Crea (o completa) ALERTAS - CORREOS: una fila por comprador que aparece en
 * las carpetas, una por área y dos de COPIA. No borra lo que ya se escribió.
 */
function prepararCorreosAlertas() {
  var datos = datosAlertas_();
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(AL_HOJA_CORREOS) || libro.insertSheet(AL_HOJA_CORREOS);
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, AL_CABECERA.length).setValues([AL_CABECERA]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
    hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 260); hoja.setColumnWidth(5, 380);
  }
  var hay = {};
  leerCorreos_().forEach(function (d) { hay[d.tipo + '|' + d.nombre] = true; });
  var nuevas = [];
  var agregar = function (tipo, nombre, nota) {
    if (hay[tipo + '|' + nombre]) return;
    hay[tipo + '|' + nombre] = true;
    nuevas.push([tipo, nombre, '', 'Sí', nota]);
  };
  datos.compradores.forEach(function (c) { agregar('COMPRADOR', c.nombre, c.area + ' · ' + c.carpetas + ' carpetas'); });
  ['Compras nacionales', 'COMEX (importaciones)'].forEach(function (a) {
    agregar('ÁREA', a, 'Recibe las carpetas de su área sin comprador conocido');
  });
  agregar('COPIA', 'Contabilidad', 'En copia de todos los correos (puede ir más de un correo separado por comas)');
  agregar('COPIA', 'Finanzas', 'En copia de todos los correos');
  if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, AL_CABECERA.length).setValues(nuevas);
  return 'Pestaña «' + AL_HOJA_CORREOS + '»: ' + nuevas.length + ' filas nuevas. Escribe el correo de cada uno en la columna C.';
}

function leerCorreos_() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AL_HOJA_CORREOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues().map(function (f) {
    return { tipo: String(f[0]).trim().toUpperCase().replace('AREA', 'ÁREA'), nombre: String(f[1]).trim(),
             correo: String(f[2]).trim(), recibe: !/^no$/i.test(String(f[3]).trim()) };
  }).filter(function (d) { return d.nombre; });
}

// ── Qué se manda ──

/** Las carpetas de la base, agrupadas: por comprador, por área (sin comprador), y el ranking. */
function datosAlertas_() {
  var cfg = configuracionCarpetaMadre_();
  var token = sesionCarpetaMadre_(cfg);
  var carpetas = [];
  for (var desde = 0; ; desde += 1000) {
    var parte = rpcCarpetaMadre_(cfg, token, 'carpetas_madre', { p_empresa_ruc: CM_RUC },
      '?order=procedencia.desc,oc,carpeta_url&limit=1000&offset=' + desde);
    carpetas = carpetas.concat(parte);
    if (parte.length < 1000) break;
  }
  var sinOc = rpcCarpetaMadre_(cfg, token, 'facturas_sin_oc', { p_empresa_ruc: CM_RUC }, '?senal=eq.ALTA&order=total.desc&limit=1000');
  var delAnio = carpetas.filter(function (f) { return String(f.oc).slice(-4) === AL_ANIO; });
  var compradores = {};
  delAnio.forEach(function (f) {
    if (!f.comprador) return;
    var c = compradores[f.comprador] || (compradores[f.comprador] = { nombre: f.comprador, area: f.area_responsable, carpetas: 0, ok: 0 });
    c.carpetas++;
    if (f.estado === 'OK') c.ok++;
  });
  return {
    carpetas: delAnio, sinOc: sinOc,
    compradores: Object.keys(compradores).sort().map(function (k) { return compradores[k]; }),
    ultimaLectura: avisoDeLectura_(carpetas)
  };
}

/** Lo pendiente de un destinatario: sus carpetas incompletas (pagadas primero) y sus facturas sin OC. */
function pendientesDe_(datos, tipo, nombre) {
  var esSuya = tipo === 'COMPRADOR'
    ? function (f) { return f.comprador === nombre; }
    : function (f) { return !f.comprador && f.area_responsable === nombre; };
  var urgencia = function (f) {
    var pagada = /^PAGADA/.test(f.situacion_pago || '');
    return (pagada ? 0 : 2) + (/Factura/.test(f.le_falta || '') ? 0 : 1);
  };
  var carpetas = datos.carpetas.filter(function (f) { return esSuya(f) && f.estado !== 'OK'; })
    .sort(function (a, b) { return urgencia(a) - urgencia(b) || String(a.oc).localeCompare(String(b.oc)); });
  var facturas = datos.sinOc.filter(function (x) {
    return tipo === 'COMPRADOR' ? x.comprador_probable === nombre : !x.comprador_probable && x.area_probable === nombre;
  });
  return { carpetas: carpetas, facturas: facturas,
           pagadas: carpetas.filter(function (f) { return /^PAGADA/.test(f.situacion_pago || ''); }).length };
}

function enviarAlertas_(o) {
  try {
    var datos = datosAlertas_();
    var correos = leerCorreos_();
    if (!correos.length) return { error: 'Falta la pestaña «' + AL_HOJA_CORREOS + '»: ejecuta «instalarAlertas».' };
    var modo = modoAlertas_();
    var props = PropertiesService.getScriptProperties();
    var prueba = String(props.getProperty('ALERTAS_PRUEBA_A') || '').trim() || Session.getEffectiveUser().getEmail();
    var copias = correos.filter(function (d) { return d.tipo === 'COPIA' && d.correo && d.recibe; })
      .map(function (d) { return d.correo; }).join(',');
    var vista = String(props.getProperty('VISTA_URL') || '').trim();
    var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');

    // Con la lectura vieja no se reclama nada: lo subido desde entonces figuraría como pendiente.
    if (datos.ultimaLectura && !o.forzar) {
      MailApp.sendEmail({ to: modo === 'REAL' ? (copias || prueba) : prueba, subject: 'Alertas del legajo: hoy no se enviaron',
        htmlBody: '<p>Hoy (' + hoy + ') no se enviaron las alertas a los compradores: ' + esc_(datos.ultimaLectura) +
          '</p><p>Se enviarán con la próxima lectura del robot de las carpetas.</p>' });
      registrarEnvio_(modo, 'COPIA', 'aviso: lectura vieja', 0, 0);
      return { texto: 'No se enviaron: ' + datos.ultimaLectura };
    }

    var destinatarios = correos.filter(function (d) { return (d.tipo === 'COMPRADOR' || d.tipo === 'ÁREA') && d.recibe; });
    var enviados = 0, sinCorreo = [], resumenPrueba = [];
    destinatarios.forEach(function (d) {
      var p = pendientesDe_(datos, d.tipo, d.nombre);
      if (!p.carpetas.length && !p.facturas.length) return;
      var asunto = 'Legajo de tus OC: ' + p.carpetas.length + ' carpetas con documentos pendientes' + (p.pagadas ? ' (' + p.pagadas + ' ya pagadas)' : '');
      var cuerpo = correoPendientes_(d, p, vista, hoy);
      if (modo === 'PRUEBA') { resumenPrueba.push({ d: d, p: p, cuerpo: cuerpo }); return; }
      if (!d.correo) { sinCorreo.push(d.nombre); return; }
      MailApp.sendEmail({ to: d.correo, cc: copias, subject: asunto, htmlBody: cuerpo, name: 'Contabilidad · Legajo por OC' });
      registrarEnvio_(modo, d.tipo + ' ' + d.nombre, d.correo, p.carpetas.length, p.facturas.length);
      enviados++;
    });

    // Los lunes, el ranking para los que van en copia.
    var esLunes = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'u') === '1';
    var ranking = esLunes || o.forzar ? correoRanking_(datos, hoy, vista) : '';

    if (modo === 'PRUEBA') {
      var html = '<p style="font-family:Arial;font-size:13px"><b>MODO PRUEBA</b> — los compradores no recibieron nada. Esto es lo que recibiría cada uno hoy ' +
        '(con copia a: ' + esc_(copias || 'nadie todavía') + '). Para enviarlo de verdad: Propiedades del script → ALERTAS_MODO = REAL.</p>' +
        resumenPrueba.map(function (x) {
          return '<hr><p style="font-family:Arial;font-size:13px"><b>Para: ' + esc_(x.d.nombre) + '</b> (' + esc_(x.d.correo || 'SIN CORREO: no se le enviaría') + ')</p>' + x.cuerpo;
        }).join('') + (ranking ? '<hr>' + ranking : '');
      MailApp.sendEmail({ to: prueba, subject: '[PRUEBA] Alertas del legajo ' + hoy + ': ' + resumenPrueba.length + ' destinatarios', htmlBody: html,
        name: 'Contabilidad · Legajo por OC' });
      registrarEnvio_(modo, 'PRUEBA', prueba, resumenPrueba.length, 0);
      return { texto: 'Modo PRUEBA: se mandó a ' + prueba + ' lo que recibirían ' + resumenPrueba.length + ' destinatarios.' };
    }

    if (ranking && copias) {
      MailApp.sendEmail({ to: copias, subject: 'Legajo por OC: ranking de la semana (' + hoy + ')', htmlBody: ranking, name: 'Contabilidad · Legajo por OC' });
      registrarEnvio_(modo, 'RANKING', copias, 0, 0);
    }
    return { texto: 'Enviados ' + enviados + ' correos' + (sinCorreo.length ? '; sin correo en la pestaña: ' + sinCorreo.join(', ') : '') + '.' };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// ── Los correos ──

var AL_ESTILO_TABLA = 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:12.5px;width:100%';
var AL_ESTILO_TH = 'text-align:left;background:#1f4e79;color:#fff;padding:6px 8px';
var AL_ESTILO_TD = 'border-bottom:1px solid #e4e9ee;padding:6px 8px;vertical-align:top';

function correoPendientes_(d, p, vista, hoy) {
  var saludo = d.tipo === 'COMPRADOR' ? 'Hola, ' + esc_(d.nombre.split(' ')[0]) + ':' : 'Hola, equipo de ' + esc_(d.nombre) + ':';
  var filas = p.carpetas.slice(0, AL_MAX_FILAS).map(function (f) {
    var pagada = /^PAGADA/.test(f.situacion_pago || '');
    return '<tr><td style="' + AL_ESTILO_TD + '"><b>' + esc_(f.oc) + '</b><br><span style="color:#8494a8">' + esc_(String(f.proyecto_carpeta || '').trim()) + '</span></td>' +
      '<td style="' + AL_ESTILO_TD + '">' + esc_(f.proveedor || '') + '</td>' +
      '<td style="' + AL_ESTILO_TD + ';color:#c62828"><b>' + esc_(f.estado === 'VACÍA' ? 'Carpeta vacía' : f.le_falta || '') + '</b></td>' +
      '<td style="' + AL_ESTILO_TD + (pagada ? ';color:#c62828' : '') + '">' + esc_(f.situacion_pago || '—') + '</td>' +
      '<td style="' + AL_ESTILO_TD + '"><a href="' + esc_(f.carpeta_url || '') + '">Abrir carpeta</a></td></tr>';
  }).join('');
  var facturas = p.facturas.slice(0, AL_MAX_FILAS).map(function (x) {
    return '<tr><td style="' + AL_ESTILO_TD + '">' + esc_(x.serie + '-' + x.numero) + '</td><td style="' + AL_ESTILO_TD + '">' + esc_(x.proveedor_nombre || '') + '</td>' +
      '<td style="' + AL_ESTILO_TD + '">' + esc_(x.fecha_emision || '') + '</td><td style="' + AL_ESTILO_TD + ';text-align:right">' + esc_(x.moneda) + ' ' + Number(x.total).toFixed(2) + '</td>' +
      '<td style="' + AL_ESTILO_TD + '">' + (x.enlace_pdf ? '<a href="' + esc_(x.enlace_pdf) + '">PDF</a>' : '') + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial,sans-serif;font-size:13px;color:#101a24;max-width:900px">' +
    '<p>' + saludo + '</p>' +
    '<p>Al ' + hoy + ', estas carpetas de OC tienen documentos pendientes en el Drive' + (p.pagadas ? ' — <b style="color:#c62828">' + p.pagadas + ' ya están pagadas</b>: la factura debe estar el mismo día del pago y la guía en 2 a 3 días' : '') + '. ' +
    'Al subirlos a su carpeta, el robot los detecta solo en su próxima lectura (dos veces al día) y dejan de aparecer aquí.</p>' +
    (filas ? '<table style="' + AL_ESTILO_TABLA + '"><tr><th style="' + AL_ESTILO_TH + '">OC</th><th style="' + AL_ESTILO_TH + '">Proveedor</th><th style="' + AL_ESTILO_TH + '">Falta</th>' +
      '<th style="' + AL_ESTILO_TH + '">Pago</th><th style="' + AL_ESTILO_TH + '"></th></tr>' + filas + '</table>' : '') +
    (p.carpetas.length > AL_MAX_FILAS ? '<p>… y ' + (p.carpetas.length - AL_MAX_FILAS) + ' más en la vista.</p>' : '') +
    (facturas ? '<p style="margin-top:18px"><b>Facturas en SUNAT que aparentan no tener OC</b> (el proveedor suele trabajar con OC): falta la OC o subir la factura a su carpeta.</p>' +
      '<table style="' + AL_ESTILO_TABLA + '"><tr><th style="' + AL_ESTILO_TH + '">Comprobante</th><th style="' + AL_ESTILO_TH + '">Proveedor</th><th style="' + AL_ESTILO_TH + '">Fecha</th>' +
      '<th style="' + AL_ESTILO_TH + '">Total</th><th style="' + AL_ESTILO_TH + '"></th></tr>' + facturas + '</table>' : '') +
    (vista ? '<p style="margin-top:18px"><a href="' + esc_(vista) + '" style="background:#00a298;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Ver todo en la vista</a></p>' : '') +
    '<p style="color:#8494a8;font-size:11.5px;margin-top:18px">Correo automático de Contabilidad, con lo que el robot leyó en las carpetas madre de compras. ' +
    'Si algo no corresponde (por ejemplo, la OC es de un servicio y no lleva guía), responde este correo.</p></div>';
}

/** El ranking de los compradores por % de legajos completos (para la reunión de líderes). */
function correoRanking_(datos, hoy, vista) {
  var lista = datos.compradores.slice().sort(function (a, b) { return b.ok / b.carpetas - a.ok / a.carpetas || b.carpetas - a.carpetas; });
  var sin = datos.carpetas.filter(function (f) { return !f.comprador; });
  var total = datos.carpetas.length, ok = datos.carpetas.filter(function (f) { return f.estado === 'OK'; }).length;
  return '<div style="font-family:Arial,sans-serif;font-size:13px;color:#101a24;max-width:700px">' +
    '<p><b>Legajo por OC — ' + hoy + '</b>: ' + ok + ' de ' + total + ' carpetas de OC ' + AL_ANIO + ' con el legajo completo (' + Math.round(100 * ok / Math.max(total, 1)) + '%).</p>' +
    '<table style="' + AL_ESTILO_TABLA + '"><tr><th style="' + AL_ESTILO_TH + '">Comprador</th><th style="' + AL_ESTILO_TH + '">Área</th>' +
    '<th style="' + AL_ESTILO_TH + ';text-align:right">Carpetas</th><th style="' + AL_ESTILO_TH + ';text-align:right">Completas</th></tr>' +
    lista.map(function (c) {
      var p = Math.round(100 * c.ok / c.carpetas);
      return '<tr><td style="' + AL_ESTILO_TD + '">' + esc_(c.nombre) + '</td><td style="' + AL_ESTILO_TD + '">' + esc_(c.area || '') + '</td>' +
        '<td style="' + AL_ESTILO_TD + ';text-align:right">' + c.carpetas + '</td><td style="' + AL_ESTILO_TD + ';text-align:right;color:' +
        (p >= 80 ? '#1e7f4f' : p >= 50 ? '#101a24' : '#c62828') + '"><b>' + p + '%</b></td></tr>';
    }).join('') +
    '<tr><td style="' + AL_ESTILO_TD + '">Comprador por identificar</td><td style="' + AL_ESTILO_TD + '"></td><td style="' + AL_ESTILO_TD + ';text-align:right">' + sin.length +
    '</td><td style="' + AL_ESTILO_TD + ';text-align:right">' + Math.round(100 * sin.filter(function (f) { return f.estado === 'OK'; }).length / Math.max(sin.length, 1)) + '%</td></tr></table>' +
    (vista ? '<p><a href="' + esc_(vista) + '">Ver el detalle en la vista</a></p>' : '') + '</div>';
}

function registrarEnvio_(modo, a, correo, carpetas, facturas) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(AL_HOJA_ENVIOS) || libro.insertSheet(AL_HOJA_ENVIOS);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(['Fecha', 'Modo', 'A quién', 'Correo', 'Carpetas pendientes', 'Facturas sin OC']);
    hoja.getRange(1, 1, 1, 6).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  hoja.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'), modo, a, correo, carpetas, facturas]);
}

function esc_(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
