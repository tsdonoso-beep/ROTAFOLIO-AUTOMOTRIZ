/**
 * Tablero de comprobantes de SUNAT — Contabilidad
 *
 * Vive en una hoja APARTE de la que publica la aplicación. La nuestra se
 * reescribe entera todos los días con lo que trae SUNAT: cualquier cosa que
 * alguien agregue encima —una fórmula, una columna, este mismo script— se
 * perdería sin aviso. Esta hoja solo la lee.
 *
 * Todo se busca por el NOMBRE de la columna, nunca por su posición. Si un día
 * se agrega una columna al medio, esto sigue funcionando; y si desaparece una
 * que hace falta, lo dice en vez de leer la de al lado.
 */

/** La hoja que publica la aplicación. Se cambia solo si se muda de archivo. */
var HOJA_FUENTE = "1ttW7DOAiem0bl2FVL5n06MdAcmq79Yqu-S35P-rzJK0";

// La pestaña con los datos. Es la que reescribe la aplicación cada mañana;
// esta de acá al lado no la toca. Se busca por nombre y no por posición
// porque las pestañas se arrastran sin querer.
var PESTANA_DATOS = "COMPROBANTES SUNAT";

/** A quién avisar. Vacío = a quien sea dueño de esta hoja. */
var AVISAR_A = "";

var COL = {
  periodo:    "Período",
  ruc:        "RUC proveedor",
  proveedor:  "Proveedor",
  tipo:       "Tipo",
  serie:      "Serie",
  numero:     "Número",
  fecha:      "Fecha de emisión",
  moneda:     "Moneda",
  base:       "Base imponible",
  igv:        "IGV",
  total:      "Total",
  corrigeA:   "Corrige a",
  rindio:     "Lo rindió",
  cambios:    "Cambios detectados",
  ultimaVez:  "Visto por última vez"
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monitoreo SUNAT')
    .addItem('Abrir tablero', 'abrirTablero')
    .addSeparator()
    .addItem('Enviarme el resumen ahora', 'enviarResumen')
    .addItem('Avisarme todos los días', 'instalarAvisoDiario')
    .addItem('Dejar de avisarme', 'quitarAvisoDiario')
    .addToUi();
}

function abrirTablero() {
  var html = HtmlService.createHtmlOutputFromFile('Tablero')
    .setWidth(1180)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Monitoreo SUNAT');
}

// ────────────────────────────────────────────────────────────────
// Leer la fuente

/**
 * Trae la hoja publicada como una lista de objetos.
 *
 * Se guarda en caché media hora: son trece mil filas y abrir el tablero no
 * debería costar una espera cada vez. La fuente se actualiza una vez al día,
 * así que media hora de desfase no cambia ninguna decisión.
 */
function leerFuente_() {
  var cache = CacheService.getUserCache();
  var guardado = cache.get('filas');
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { /* caché vieja: se relee */ }
  }

  var libro = SpreadsheetApp.openById(HOJA_FUENTE);
  var hoja = libro.getSheetByName(PESTANA_DATOS) || libro.getSheets()[0];
  var datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];

  var titulos = datos[0].map(function (t) { return String(t).trim(); });
  var donde = {};
  for (var clave in COL) donde[clave] = titulos.indexOf(COL[clave]);

  var faltan = [];
  for (var c in donde) if (donde[c] === -1) faltan.push(COL[c]);
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
      fecha:     aFecha_(f[donde.fecha]),
      moneda:    String(f[donde.moneda] || ''),
      base:      aNumero_(f[donde.base]),
      igv:       aNumero_(f[donde.igv]),
      total:     aNumero_(f[donde.total]),
      corrigeA:  String(f[donde.corrigeA] || ''),
      rindio:    String(f[donde.rindio] || ''),
      cambios:   aNumero_(f[donde.cambios]) || 0,
      ultimaVez: aFecha_(f[donde.ultimaVez])
    });
  }

  // La caché tiene un tope de tamaño; si no entra, se relee y ya está.
  try { cache.put('filas', JSON.stringify(filas), 1800); } catch (e) { /* sin caché */ }
  return filas;
}

/**
 * La fecha como se lee en Perú: dd/mm/aaaa.
 *
 * Desde que la aplicación escribe por la API, estas columnas llegan como
 * fechas de verdad y no como texto. Es mejor —se ordenan y se filtran—, pero
 * un Date puesto en una tabla se imprime como «Thu Dec 11 2025 00:00:00
 * GMT-0500». Acá se vuelve a dejar legible.
 */
function aFecha_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) !== '[object Date]') return String(v);
  var dd = ('0' + v.getDate()).slice(-2);
  var mm = ('0' + (v.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + v.getFullYear();
}

function aNumero_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** Una nota de crédito o débito. Son las que restan crédito fiscal. */
function esNota_(f) {
  return f.tipo === 'Nota de crédito' || f.tipo === 'Nota de débito' ||
         f.tipo === '07' || f.tipo === '08';
}

// ────────────────────────────────────────────────────────────────
// Lo que consume el tablero

function datosDelTablero(periodo) {
  var filas = leerFuente_();

  var periodos = {};
  filas.forEach(function (f) { if (f.periodo) periodos[f.periodo] = true; });
  var listaPeriodos = Object.keys(periodos).sort().reverse();

  var elegido = periodo || listaPeriodos[0] || '';
  var delMes = filas.filter(function (f) { return f.periodo === elegido; });

  // La evolución usa todos los meses: el valor de una serie está en la
  // comparación, no en el número suelto.
  var porMes = listaPeriodos.slice().sort().map(function (p) {
    var f = filas.filter(function (x) { return x.periodo === p; });
    return {
      periodo: p,
      igv: redondear_(f.reduce(function (a, x) { return a + (esNota_(x) ? -Math.abs(x.igv || 0) : (x.igv || 0)); }, 0)),
      comprobantes: f.length
    };
  });

  var notas = delMes.filter(esNota_).map(function (f) {
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
    if (esNota_(f)) return;
    var k = f.ruc + '|' + f.proveedor;
    if (!porProveedor[k]) porProveedor[k] = { ruc: f.ruc, proveedor: f.proveedor, total: 0, n: 0 };
    porProveedor[k].total += (f.total || 0);
    porProveedor[k].n += 1;
  });
  var top = Object.keys(porProveedor).map(function (k) { return porProveedor[k]; })
    .sort(function (a, b) { return b.total - a.total; }).slice(0, 8);

  var compras = delMes.filter(function (f) { return !esNota_(f); });

  return {
    periodos: listaPeriodos,
    elegido: elegido,
    resumen: {
      comprobantes: compras.length,
      base: redondear_(suma_(compras, 'base')),
      igvCompras: redondear_(suma_(compras, 'igv')),
      igvNotas: redondear_(notas.reduce(function (a, n) { return a + n.igv; }, 0)),
      total: redondear_(suma_(compras, 'total')),
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

function suma_(filas, campo) {
  return filas.reduce(function (a, f) { return a + (f[campo] || 0); }, 0);
}

function redondear_(n) { return Math.round(n * 100) / 100; }

// ────────────────────────────────────────────────────────────────
// El aviso

/**
 * Manda el resumen solo si hay algo que contar.
 *
 * Un correo diario que casi siempre dice «todo bien» se aprende a archivar
 * sin abrir, y el día que trae algo tampoco se abre. Si no hay notas nuevas
 * ni comprobantes cambiados, no sale nada.
 */
function enviarResumen() {
  var d = datosDelTablero(null);
  var hayNotas = d.notas.length > 0;
  var hayCambios = d.cambiados.length > 0;

  if (!hayNotas && !hayCambios) {
    Logger.log('Sin novedades en ' + d.elegido + ': no se manda correo.');
    return;
  }

  var para = AVISAR_A || Session.getEffectiveUser().getEmail();
  var s = soles_;

  var cuerpo = [];
  cuerpo.push('<p style="font:15px/1.6 system-ui,sans-serif;color:#0b0b0b">');
  cuerpo.push('Período <b>' + d.elegido + '</b>');
  cuerpo.push('</p>');

  if (hayNotas) {
    var igvNotas = d.notas.reduce(function (a, n) { return a + n.igv; }, 0);
    cuerpo.push('<p style="font:15px/1.6 system-ui,sans-serif;color:#0b0b0b">');
    cuerpo.push('<b>' + d.notas.length + ' notas de crédito</b> restan ');
    cuerpo.push('<b>' + s(igvNotas) + '</b> del crédito fiscal.');
    cuerpo.push('</p>');
    cuerpo.push(tablaCorreo_(
      ['Proveedor', 'Nota', 'Corrige a', 'IGV que resta'],
      d.notas.slice(0, 15).map(function (n) {
        return [n.proveedor, n.comprobante, n.corrigeA || '—', s(n.igv)];
      })
    ));
  }

  if (hayCambios) {
    cuerpo.push('<p style="font:15px/1.6 system-ui,sans-serif;color:#0b0b0b">');
    cuerpo.push('<b>' + d.cambiados.length + ' comprobantes llegaron distintos</b> de como estaban.');
    cuerpo.push('</p>');
    cuerpo.push(tablaCorreo_(
      ['Proveedor', 'Comprobante', 'Total'],
      d.cambiados.slice(0, 15).map(function (c) {
        return [c.proveedor, c.comprobante, s(c.total)];
      })
    ));
  }

  cuerpo.push('<p style="font:13px/1.6 system-ui,sans-serif;color:#52514e">');
  cuerpo.push('Abre el tablero desde el menú <b>Monitoreo SUNAT</b> de la hoja.');
  cuerpo.push('</p>');

  MailApp.sendEmail({
    to: para,
    subject: 'SUNAT ' + d.elegido + ': ' + d.notas.length + ' notas de crédito',
    htmlBody: cuerpo.join('')
  });
}

function tablaCorreo_(titulos, filas) {
  var t = ['<table style="border-collapse:collapse;font:13px system-ui,sans-serif">'];
  t.push('<tr>' + titulos.map(function (h) {
    return '<th style="text-align:left;padding:6px 14px 6px 0;border-bottom:1px solid #d9d8d4;'
      + 'color:#52514e;font-weight:600">' + h + '</th>';
  }).join('') + '</tr>');
  filas.forEach(function (f) {
    t.push('<tr>' + f.map(function (c) {
      return '<td style="padding:6px 14px 6px 0;border-bottom:1px solid #eeede9">' + c + '</td>';
    }).join('') + '</tr>');
  });
  t.push('</table>');
  return t.join('');
}

function soles_(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function instalarAvisoDiario() {
  quitarAvisoDiario();
  ScriptApp.newTrigger('enviarResumen').timeBased().atHour(9).everyDays(1).create();
  SpreadsheetApp.getUi().alert(
    'Listo. Vas a recibir un correo a las 9 de la mañana, pero solo los días que haya algo: '
    + 'notas de crédito nuevas o comprobantes que cambiaron.'
  );
}

function quitarAvisoDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarResumen') ScriptApp.deleteTrigger(t);
  });
}
