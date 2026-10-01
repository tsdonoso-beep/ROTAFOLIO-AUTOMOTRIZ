/**
 * Vista del SIRE (registro de compras) — el «Código» detrás de TableroPadron.html
 * --------------------------------------------------------------------------
 *
 * Una sola vista, publicada como su propia URL, sobre la hoja COMPROBANTES
 * SUNAT (lo que trae el SIRE cada mañana): compras e IGV por mes, si cada
 * proveedor es Buen Contribuyente, un buscador de facturas, las notas de
 * crédito y los comprobantes que SUNAT cambió.
 *
 * Todo sale de la hoja, que ya trae la condición de cada RUC (columna «Buen
 * Contribuyente»): no hace falta conectarse a la base ni guardar
 * credenciales. Los montos se pasan a soles con el tipo de cambio que trae
 * el mismo SIRE, y las notas de crédito restan.
 *
 * Como en la vista del DETALLE, el servidor no manda totales hechos: manda
 * cada comprobante en forma compacta y el navegador arma los totales según
 * el mes elegido, al instante.
 *
 * Se llama distinto del HTML a propósito: Apps Script no deja que un Script
 * y un HTML tengan el mismo nombre en un proyecto.
 *
 * ── Instalación ──
 * 1. Pega esto en el archivo de Script `CodigoPadron` y `TableroPadron.html`
 *    en el HTML `TableroPadron` (sin `.html`). No necesita ningún otro archivo
 *    ni Propiedades del script.
 * 2. Guarda.
 * 3. Implementar → Nueva implementación → «Aplicación web»: Ejecutar como
 *    **Yo**; acceso: **«Cualquier usuario de tu organización»** (muestra
 *    información de proveedores, no hace falta que sea pública).
 * 4. Cada vez que cambies el código: «Gestionar implementaciones» → lápiz →
 *    Versión «Nueva» → Implementar. Una implementación publicada NO se
 *    actualiza sola con el código nuevo.
 */

/** La hoja que publica la aplicación cada mañana, y la pestaña con los datos. */
var HOJA_SIRE = '1ttW7DOAiem0bl2FVL5n06MdAcmq79Yqu-S35P-rzJK0';
var PESTANA_SIRE = 'COMPROBANTES SUNAT';
var URL_HOJA_SHEET = 'https://docs.google.com/spreadsheets/d/' + HOJA_SIRE + '/edit';

/** Punto de entrada de la aplicación web. */
function doGet() {
  return HtmlService.createTemplateFromFile('TableroPadron')
    .evaluate()
    .setTitle('SUNAT · Registro de compras — INROPRIN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Lo que pide el HTML por `google.script.run`. Nunca lanza: el error viaja en el objeto. */
function datosDeLaVistaSire() {
  try {
    return compactosSire_();
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Una fila por comprobante:
 *   [período, proveedor, tipo (F B C D O), total en soles, IGV en soles,
 *    serie-número, fecha, moneda, total en su moneda, corrige a, cambios]
 * La nota de crédito va en negativo (resta). `prov` guarda cada proveedor una
 * vez: [RUC, nombre, buen contribuyente (1 sí, 0 no, -1 sin consultar)].
 */
function compactosSire_() {
  var hoja = SpreadsheetApp.openById(HOJA_SIRE).getSheetByName(PESTANA_SIRE);
  if (!hoja) throw new Error('No se encontró la pestaña «' + PESTANA_SIRE + '».');
  var valores = hoja.getDataRange().getValues();
  var cab = valores[0].map(function (t) { return String(t).trim(); });
  var col = function (n) {
    var i = cab.indexOf(n);
    if (i === -1) throw new Error('La hoja no trae la columna «' + n + '». Puede que haya cambiado de nombre.');
    return i;
  };
  var opc = function (n) { return cab.indexOf(n); };
  var c = {
    periodo: col('Período'), ruc: col('RUC proveedor'), proveedor: col('Proveedor'), tipo: col('Tipo'),
    serie: col('Serie'), numero: col('Número'), fecha: col('Fecha de emisión'), moneda: col('Moneda'),
    tc: opc('Tipo de cambio'), igv: col('IGV'), total: col('Total'),
    corrige: opc('Corrige a'), cambios: opc('Cambios detectados'), bc: opc('Buen Contribuyente')
  };
  var zona = Session.getScriptTimeZone() || 'America/Lima';
  var txt = function (f, i) {
    if (i < 0) return '';
    var v = f[i];
    if (v instanceof Date) return Utilities.formatDate(v, zona, 'dd/MM/yyyy');
    return String(v == null ? '' : v).trim();
  };
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };

  var prov = [], idx = {}, docs = [];
  for (var r = 1; r < valores.length; r++) {
    var f = valores[r];
    var ruc = txt(f, c.ruc);
    if (!ruc && !txt(f, c.serie)) continue;
    var bcTxt = txt(f, c.bc).toUpperCase();
    var bc = /^S/.test(bcTxt) ? 1 : /^N/.test(bcTxt) ? 0 : -1;
    if (!(ruc in idx)) { idx[ruc] = prov.length; prov.push([ruc, txt(f, c.proveedor), bc]); }
    else if (bc !== -1) prov[idx[ruc]][2] = bc;

    var tipo = txt(f, c.tipo);
    var esNota = /cr[eé]dito/i.test(tipo) || tipo === '07';
    var signo = esNota ? -1 : 1;
    var moneda = txt(f, c.moneda) || 'PEN';
    var tc = moneda === 'PEN' ? 1 : num(c.tc >= 0 ? f[c.tc] : 0) || 0;
    var total = num(f[c.total]), igv = num(f[c.igv]);
    docs.push([
      txt(f, c.periodo), idx[ruc],
      esNota ? 'C' : /d[eé]bito/i.test(tipo) || tipo === '08' ? 'D' : /boleta/i.test(tipo) || tipo === '03' ? 'B' : /factura/i.test(tipo) || tipo === '01' ? 'F' : 'O',
      tc ? r2(signo * Math.abs(total) * tc) : 0,
      tc ? r2(signo * Math.abs(igv) * tc) : 0,
      txt(f, c.serie).toUpperCase() + '-' + txt(f, c.numero).replace(/^0+(?=\d)/, ''),
      txt(f, c.fecha), moneda, r2(signo * Math.abs(total)),
      txt(f, c.corrige), num(c.cambios >= 0 ? f[c.cambios] : 0)
    ]);
  }
  return {
    error: null,
    urlHoja: URL_HOJA_SHEET,
    generadoEl: Utilities.formatDate(new Date(), zona, "d 'de' MMMM 'de' yyyy, HH:mm"),
    prov: prov,
    docs: docs,
    sinTipoDeCambio: docs.filter(function (d) { return d[7] !== 'PEN' && !d[3] && d[8]; }).length
  };
}
