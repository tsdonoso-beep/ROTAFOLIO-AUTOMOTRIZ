import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rucValido, rucEmisorEnTexto, comprobanteEnTexto, documentosEnTexto, lecturaDeTexto, lecturaDeXml,
  prioridadDeLectura, tipoDeLectura, normalizarTexto,
} from "../lectura.ts";

test("el RUC se valida con su dígito verificador", () => {
  assert.ok(rucValido("20603268467"));
  assert.ok(rucValido("20512201611"));
  assert.ok(rucValido("10451217581"));
  assert.ok(!rucValido("20603268468"));   // un dígito mal leído
  assert.ok(!rucValido("20100000001"));
  assert.ok(!rucValido("2060326846"));
});

test("el RUC del emisor es el primero válido que no es el de Inroprin", () => {
  const P = normalizarTexto("COMERCIALIZADORA LUCY S.A.C. R.U.C. N° 20603268467 FACTURA ELECTRÓNICA F001-260 Señor(es): INDUSTRIAS ROLAND PRINT RUC 20512201611");
  assert.equal(rucEmisorEnTexto(P), "20603268467");
  // Si el cliente va primero, igual se salta Inroprin.
  assert.equal(rucEmisorEnTexto(normalizarTexto("Cliente RUC 20512201611 Emisor RUC 20603268467")), "20603268467");
  // El OCR leyó una O en medio del número.
  assert.equal(rucEmisorEnTexto(normalizarTexto("RUC: 2O6O3268467")), "20603268467");
  // Un número que no pasa la verificación no es un RUC.
  assert.equal(rucEmisorEnTexto(normalizarTexto("Cuenta 20603268468")), "");
});

test("factura electrónica impresa desde el PDF del proveedor", () => {
  const t = `COMERCIALIZADORA LUCY S.A.C.
    AV. LOS PINOS 123 - LIMA
    FACTURA ELECTRÓNICA
    RUC: 20603268467
    F001 - 00000260
    Fecha de Emisión: 12/03/2026
    Señor(es): INDUSTRIAS ROLAND PRINT S.A.C.  RUC: 20512201611
    Orden de compra: OC 2026-0200
    Guía de remisión: T001-3270
    OP. GRAVADA 1,000.00 IGV 180.00 IMPORTE TOTAL 1,180.00`;
  const d = documentosEnTexto(t);
  assert.equal(d.tipo, "FACTURA");
  assert.equal(d.serie, "F001-260");
  assert.equal(d.ruc, "20603268467");
  assert.deepEqual(d.claves, ["FACTURA"]);   // cita la guía, pero no es una
});

test("un escaneo con los errores típicos del OCR", () => {
  // «FACIURA», «FO01», «N°» y espacios de más.
  const t = "FACIURA ELECTRONICA  R.U.C. 20514038601   FO01 N° 0019112  SEÑORES INDUSTRIAS ROLAND PRINT";
  const c = comprobanteEnTexto(normalizarTexto(t));
  assert.equal(c.tipo, "FACTURA");
  assert.equal(c.serie, "F001-19112");
  assert.equal(lecturaDeTexto(t, "OCR").estado, "LEÍDO");
  assert.equal(lecturaDeTexto(t, "OCR").ruc, "20514038601");
});

test("una foto de boleta donde el OCR leyó «BOO]» por «B001»", () => {
  const t = "FERRETERIA SAN JOSE E.I.R.L.\n\nRUC 20392871536\n\nBOLETA DE VENTA ELECTRONICA\nBOO] - 0007781\n\nTotal S/ 85.00";
  const l = lecturaDeTexto(t, "OCR");
  assert.equal(l.estado, "LEÍDO");
  assert.equal(l.tipo, "BOLETA");
  assert.equal(l.serie, "B001-7781");
  assert.equal(l.ruc, "20392871536");
  assert.equal(comprobanteEnTexto(normalizarTexto("FACTURA ELECTRONICA RUC 20392871536 F0|1 - 123")).serie, "F011-123");
});

test("factura física con serie numérica", () => {
  const c = comprobanteEnTexto(normalizarTexto("FERRETERIA SAN JOSE RUC 20392871536 FACTURA 001 - N° 0031388"));
  assert.equal(c.tipo, "FACTURA");
  assert.equal(c.serie, "001-31388");
});

test("nota de crédito, boleta y recibo por honorarios", () => {
  assert.deepEqual(comprobanteEnTexto(normalizarTexto("NOTA DE CRÉDITO ELECTRÓNICA FC01-55 RUC 20603268467 Documento que modifica: F001-260")),
    { tipo: "NOTA DE CRÉDITO", serie: "FC01-55" });
  assert.deepEqual(comprobanteEnTexto(normalizarTexto("BOLETA DE VENTA ELECTRÓNICA B001-7781")), { tipo: "BOLETA", serie: "B001-7781" });
  assert.deepEqual(comprobanteEnTexto(normalizarTexto("RECIBO POR HONORARIOS ELECTRÓNICO Nro: E001-12 VARGAS DEL AGUILA JULIO RUC 10451217581")),
    { tipo: "RECIBO POR HONORARIOS", serie: "E001-12" });
});

test("la invoice del proveedor del exterior, en inglés", () => {
  const d = documentosEnTexto("NINGBO TOOLS CO., LTD. COMMERCIAL INVOICE Invoice No.: NB2026-0172 Date: 2026-03-01 Buyer: INDUSTRIAS ROLAND PRINT");
  assert.equal(d.tipo, "INVOICE");
  assert.equal(d.serie, "NB2026-0172");
  assert.equal(d.ruc, "");
  // «Invoice# SHIP TO …»: sin número, no se inventa uno.
  assert.equal(comprobanteEnTexto(normalizarTexto("Invoice # SHIP TO INDUSTRIAS ROLAND PRINT Invoice Date 2026-03-01")).serie, "");
});

test("lo que no es un comprobante no se toma por uno", () => {
  // Una OC menciona «factura» y la serie de la guía, pero no es una factura.
  const oc = lecturaDeTexto("ORDEN DE COMPRA N° 0200-2026 Proveedor: LUCY Condición: factura a 30 días. Entregar con guía T001-55", "TEXTO DEL PDF");
  assert.equal(oc.estado, "SIN COMPROBANTE");
  assert.deepEqual(oc.claves, ["OC"]);
  const guia = documentosEnTexto("GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE T001-3270 PUNTO DE PARTIDA: LIMA PUNTO DE LLEGADA: CALLAO");
  assert.equal(guia.tipo, "");
  assert.deepEqual(guia.claves, ["GUIA"]);
  assert.equal(lecturaDeTexto("   \n  ", "OCR").estado, "SIN TEXTO");
});

test("el XML del comprobante dice todo exacto; la constancia (CDR) no es el comprobante", () => {
  const xml = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
    <cbc:ID>F001-00000260</cbc:ID><cbc:IssueDate>2026-03-12</cbc:IssueDate>
    <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
    <cac:OrderReference><cbc:ID>0200-2026</cbc:ID></cac:OrderReference>
    <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20603268467</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>COMERCIALIZADORA LUCY</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20512201611</cbc:ID></cac:PartyIdentification></cac:Party></cac:AccountingCustomerParty>
    <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  </Invoice>`;
  const l = lecturaDeXml([xml], "XML");
  assert.equal(l.estado, "LEÍDO");
  assert.equal(l.tipo, "FACTURA");
  assert.equal(l.serie, "F001-260");
  assert.equal(l.ruc, "20603268467");
  assert.equal(l.ocReferencia, "0200-2026");
  // Emitida al consorcio de Inroprin: se dice así, no como «no a Inroprin».
  const alConsorcio = lecturaDeXml([xml.replace(">20512201611<", ">20614950677<")], "XML");
  assert.equal(alConsorcio.detalle, "emitido a consorcio de Inroprin (20614950677)");
  assert.equal(lecturaDeXml([xml.replace(">20512201611<", ">20100000002<")], "XML").detalle, "emitido a 20100000002, no a Inroprin");
  const cdr = `<?xml version="1.0"?><ar:ApplicationResponse xmlns:ar="urn:x"><cbc:ID>123</cbc:ID></ar:ApplicationResponse>`;
  assert.equal(lecturaDeXml([cdr], "ZIP").estado, "SIN COMPROBANTE");
  // En un ZIP con la constancia y la factura, gana la factura.
  assert.equal(lecturaDeXml([cdr, xml], "ZIP").serie, "F001-260");
});

test("qué se abre y en qué orden", () => {
  const p = (nombre: string, parece: string, serie = "", mime = "application/pdf", kb = 100, pistas: string[] = []) =>
    prioridadDeLectura({ nombre, mime, parece, serie, kb, pistas });
  assert.equal(p("factura.xml", "XML", "", "text/xml"), 4);
  assert.equal(p("FACTURA LUCY.pdf", "FACTURA"), 3);
  assert.equal(p("INVOICE.pdf", "FACTURA"), 3);
  assert.equal(p("scan001.pdf", "OTRO"), 2);
  assert.equal(p("WhatsApp Image 2026-03-02.jpeg", "CORREO / CAPTURA", "", "image/jpeg"), 2);
  assert.equal(p("docs lucy oc 0200.pdf", "ORDEN DE COMPRA/SERVICIO", "", "application/pdf", 100, ["OC"]), 2); // «docs» es genérico
  assert.equal(p("lucy oc 0200.pdf", "ORDEN DE COMPRA/SERVICIO", "", "application/pdf", 100, ["OC"]), 1);
  // No se abre: ya trae la serie, el nombre lo dice claro, no se puede leer, o es enorme.
  assert.equal(p("F001-260.pdf", "FACTURA", "F001-260"), -1);
  assert.equal(p("COTIZACION.pdf", "COTIZACIÓN"), -1);
  assert.equal(p("ORDEN DE COMPRA 0200.pdf", "ORDEN DE COMPRA/SERVICIO", "", "application/pdf", 100, ["ORDEN DE COMPRA"]), -1);
  assert.equal(p("cuadro.xlsx", "OTRO", "", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), -1);
  assert.equal(p("scan.pdf", "OTRO", "", "application/pdf", 40 * 1024), -1);
  assert.equal(p("R-20603268467-01-F001-260.zip", "CDR (constancia SUNAT)", "", "application/zip"), -1);
});

test("cómo se lee cada tipo de archivo", () => {
  assert.equal(tipoDeLectura("a.PDF", ""), "PDF");
  assert.equal(tipoDeLectura("foto.jpg", "image/jpeg"), "IMAGEN");
  assert.equal(tipoDeLectura("x", "application/vnd.google-apps.document"), "DOCUMENTO DE GOOGLE");
  assert.equal(tipoDeLectura("a.zip", ""), "ZIP");
  assert.equal(tipoDeLectura("a.heic", "image/heic"), null);
  assert.equal(tipoDeLectura("a.docx", ""), null);
});
