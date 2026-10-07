/**
 * Verificar contra SUNAT una lista de comprobantes antes de cargarla al CONCAR
 *
 * Para la hoja donde se arma la carga masiva (por ejemplo, la tabla que arma
 * la IA con los correos de rendiciones de Rosa). Menú «SUNAT → Verificar esta
 * pestaña»: lee las columnas de RUC, serie, número y total de la pestaña
 * abierta y escribe al costado, en cada fila:
 *
 *   SUNAT: verificación   OK: emitida en SUNAT / Ojo: tiene nota de crédito /
 *                         Ojo: ya no aparece en el SIRE (¿dada de baja?) /
 *                         Ojo: el monto de SUNAT es otro / No está en SUNAT (todavía)
 *   SUNAT: total          el total según SUNAT
 *   SUNAT: notas de crédito   las que modifican ese comprobante
 *   Duplicado             si el mismo comprobante está dos veces en la pestaña,
 *                         o ya está en la pestaña «REGISTRO CONCAR»
 *
 * Duplicados contra lo ya cargado: pegar en una pestaña llamada «REGISTRO CONCAR»
 * el registro de compras exportado del CONCAR (con columnas de RUC, serie y
 * número). Se compara DENTRO de la hoja: el registro del CONCAR no se sube a
 * ningún lado.
 *
 * Las columnas se reconocen por su título, sin importar el orden ni las
 * tildes: «RUC»; «Serie» y «Número» (o una sola columna «Comprobante» o
 * «Documento» con F001-123); «Tipo» (opcional); «Total», «Importe» o «Monto».
 *
 * Instalación (una vez):
 *   1. En la hoja: Extensiones → Apps Script → pegar este archivo.
 *   2. Engranaje → Propiedades del script: SUPABASE_URL, SUPABASE_ANON_KEY,
 *      ROBOT_CORREO y ROBOT_CLAVE (los mismos de CarpetaMadre.gs).
 *   3. Recargar la hoja: aparece el menú «SUNAT».
 *
 * La consulta es verificar_comprobantes_json (migración 064).
 */

var VC_CONCAR = 'REGISTRO CONCAR';
var VC_TITULOS = ['SUNAT: verificación', 'SUNAT: total', 'SUNAT: notas de crédito', 'Duplicado'];
var VC_LOTE = 500;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SUNAT')
    .addItem('Verificar esta pestaña', 'verificarComprobantes')
    .addToUi();
}

function verificarComprobantes() {
  var ui = SpreadsheetApp.getUi();
  var hoja = SpreadsheetApp.getActiveSheet();
  try {
    var t = leerTablaVC_(hoja);
    if (!t) {
      ui.alert('No encontré las columnas', 'La pestaña «' + hoja.getName() + '» necesita columnas con título RUC, Serie y Número ' +
        '(o una columna Comprobante con F001-123). Total es opcional.', ui.ButtonSet.OK);
      return;
    }
    // Duplicados: dentro de la pestaña y contra el registro del CONCAR (si está la pestaña).
    var vistas = {}, concar = {};
    var reg = hoja.getParent().getSheetByName(VC_CONCAR);
    if (reg && reg.getSheetId() !== hoja.getSheetId()) {
      var tc = leerTablaVC_(reg);
      if (tc) tc.filas.forEach(function (f) { if (f.clave) concar[f.clave] = concar[f.clave] || f.fila; });
    }
    var duplicado = t.filas.map(function (f) {
      if (!f.clave) return '';
      var d = [];
      if (vistas[f.clave]) d.push('Repetido en esta pestaña (fila ' + vistas[f.clave] + ')');
      else vistas[f.clave] = f.fila;
      if (concar[f.clave]) d.push('Ya está en el CONCAR (fila ' + concar[f.clave] + ' de «' + VC_CONCAR + '»)');
      return d.join(' · ');
    });

    // SUNAT, de a 500.
    var cfg = configVC_();
    var token = sesionVC_(cfg);
    var resultado = {};
    for (var i = 0; i < t.filas.length; i += VC_LOTE) {
      var lote = t.filas.slice(i, i + VC_LOTE).map(function (f, k) {
        return { i: i + k, ruc: f.ruc, tipo: f.tipo, serie: f.serie, numero: f.numero, total: f.total };
      });
      rpcVC_(cfg, token, 'verificar_comprobantes_json', { p_filas: lote }).forEach(function (r) { resultado[r.i] = r; });
    }

    // Las cuatro columnas al costado (si ya estaban, se reescriben).
    var col = t.columnas.salida;
    hoja.getRange(t.filaTitulo, col, 1, VC_TITULOS.length).setValues([VC_TITULOS]).setFontWeight('bold');
    var valores = [], fondos = [];
    t.filas.forEach(function (f, k) {
      var r = resultado[k] || {};
      var alerta = f.clave ? r.alerta || '' : '';
      valores.push([alerta, r.total_sunat == null ? '' : Number(r.total_sunat), r.notas || '', duplicado[k]]);
      var color = /^OK/.test(alerta) ? '#d9ead3' : /^Ojo/.test(alerta) ? '#fff2cc' : /^No está/.test(alerta) ? '#f4cccc' : null;
      fondos.push([color, null, null, duplicado[k] ? '#f4cccc' : null]);
    });
    if (valores.length) {
      var rango = hoja.getRange(t.filas[0].fila, col, valores.length, VC_TITULOS.length);
      rango.setValues(valores).setBackgrounds(fondos);
      hoja.getRange(t.filas[0].fila, col + 1, valores.length, 1).setNumberFormat('#,##0.00');
    }
    var cuenta = function (re) { return valores.filter(function (v) { return re.test(v[0]); }).length; };
    var dups = duplicado.filter(Boolean).length;
    ui.alert('Verificación lista', valores.length + ' comprobantes:\n' +
      '• OK: ' + cuenta(/^OK/) + '\n• Ojo (nota de crédito, monto o baja): ' + cuenta(/^Ojo/) +
      '\n• No están en SUNAT: ' + cuenta(/^No está/) + '\n• Duplicados: ' + dups +
      (reg ? '' : '\n\nPara ver duplicados contra lo ya cargado, pega el registro del CONCAR en una pestaña «' + VC_CONCAR + '».'),
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('No se pudo verificar', String(e.message || e), ui.ButtonSet.OK);
  }
}

// ── Leer la pestaña ──

/** Sin tildes, en mayúsculas y sin signos: «Número» → «NUMERO», «N°» → «N». */
function planoVC_(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Busca la fila de títulos (en las 15 primeras) y las columnas; null si no las encuentra. */
function leerTablaVC_(hoja) {
  var valores = hoja.getDataRange().getValues();
  for (var r = 0; r < Math.min(15, valores.length); r++) {
    var cab = valores[r].map(planoVC_);
    var buscar = function (prueba) { for (var c = 0; c < cab.length; c++) if (cab[c] && prueba(cab[c])) return c; return -1; };
    var col = {
      ruc: buscar(function (h) { return /\bRUC\b/.test(h) && !/RAZON|NOMBRE/.test(h); }),
      serie: buscar(function (h) { return /\bSERIE\b/.test(h) && !/NUMERO/.test(h); }),
      numero: buscar(function (h) { return /^(N|NRO|NUM|NUMERO|N DOC|NRO DOC|NUMERO DOC|NUMERO DE DOCUMENTO|NUMERO DEL COMPROBANTE|NRO COMPROBANTE|CORRELATIVO)$/.test(h); }),
      comprobante: buscar(function (h) { return /COMPROBANTE|DOCUMENTO|SERIE NUMERO|SERIE Y NUMERO/.test(h) && !/TIPO|FECHA|RUC/.test(h); }),
      tipo: buscar(function (h) { return /^(TIPO|TD|T D|TIPO DOC|TIPO DE DOC|TIPO DE DOCUMENTO|TIPO DE COMPROBANTE|TIPO COMPROBANTE)$/.test(h); }),
      total: buscar(function (h) { return /^TOTAL\b|IMPORTE TOTAL|^IMPORTE$|^MONTO|TOTAL COMPROBANTE/.test(h); })
    };
    if (col.ruc < 0 || (col.serie < 0 && col.comprobante < 0)) continue;
    if (col.serie >= 0 && col.numero < 0 && col.comprobante < 0) continue;
    // Dónde escribir: si ya están los títulos de una corrida anterior, ahí; si no, después de la última columna con título.
    var crudo = valores[r].map(function (v) { return String(v || '').trim(); });
    var previa = crudo.indexOf(VC_TITULOS[0]);
    var ultima = 0; crudo.forEach(function (v, i) { if (v) ultima = i; });
    col.salida = (previa >= 0 ? previa : ultima + 1) + 1;
    var filas = [];
    for (var f = r + 1; f < valores.length; f++) {
      var v = valores[f], ruc = String(v[col.ruc] || '').replace(/\D/g, ''), serie = '', numero = '';
      if (col.serie >= 0 && col.numero >= 0) {
        serie = String(v[col.serie] || '').trim().toUpperCase();
        numero = String(v[col.numero] || '').replace(/\D/g, '');
      } else {
        var m = /([A-Z0-9]{3,4})\s*-\s*0*(\d+)/i.exec(String(v[col.comprobante] || ''));
        if (m) { serie = m[1].toUpperCase(); numero = m[2]; }
      }
      if (!ruc && !serie && !numero) continue;
      numero = numero.replace(/^0+(?=\d)/, '');
      filas.push({
        fila: f + 1, ruc: ruc, serie: serie, numero: numero,
        tipo: col.tipo >= 0 ? String(v[col.tipo] || '') : '',
        total: col.total >= 0 && v[col.total] !== '' ? String(v[col.total]) : '',
        clave: ruc && serie && numero ? ruc + '|' + serie + '|' + numero : ''
      });
    }
    return { filaTitulo: r + 1, columnas: col, filas: filas };
  }
  return null;
}

// ── La base ──

function configVC_() {
  var p = PropertiesService.getScriptProperties();
  var limpio = function (k) { return String(p.getProperty(k) || '').trim().replace(/^["'«“]+|["'»”]+$/g, '').trim(); };
  var cfg = { url: limpio('SUPABASE_URL').replace(/\/+$/, ''), anon: limpio('SUPABASE_ANON_KEY'), correo: limpio('ROBOT_CORREO'), clave: limpio('ROBOT_CLAVE') };
  var faltan = [['url', 'SUPABASE_URL'], ['anon', 'SUPABASE_ANON_KEY'], ['correo', 'ROBOT_CORREO'], ['clave', 'ROBOT_CLAVE']]
    .filter(function (k) { return !cfg[k[0]]; }).map(function (k) { return k[1]; });
  if (faltan.length) throw new Error('Faltan las Propiedades del script: ' + faltan.join(', ') + ' (Apps Script → engranaje → Propiedades del script).');
  return cfg;
}

function sesionVC_(cfg) {
  var resp = UrlFetchApp.fetch(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', headers: { apikey: cfg.anon },
    payload: JSON.stringify({ email: cfg.correo, password: cfg.clave }), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('No se pudo entrar a la base con la cuenta ROBOT (error ' + resp.getResponseCode() + ').');
  return JSON.parse(resp.getContentText()).access_token;
}

function rpcVC_(cfg, token, funcion, args) {
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + funcion, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: cfg.anon, Authorization: 'Bearer ' + token },
    payload: JSON.stringify(args), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error(funcion + ' falló: ' + resp.getContentText().slice(0, 300));
  return JSON.parse(resp.getContentText());
}
