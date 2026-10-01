import { test } from "node:test";
import assert from "node:assert/strict";
import { carpetaDeOC, clasificarArchivo, rucsEnNombre, serieEnNombre, esComprobante } from "../carpetas-oc.ts";

test("las carpetas de la carpeta madre, como las nombra Compras", () => {
  assert.deepEqual(carpetaDeOC("OC 2026 - 0200 COMERCIALIZADORA LUCY - TALLERES ESPECIALIZADOS"), {
    tipo: "OC", oc: "0200-2026", proveedor: "COMERCIALIZADORA LUCY", proyecto: "TALLERES ESPECIALIZADOS",
  });
  assert.deepEqual(carpetaDeOC("OS 0911 -2026 SERVICIOS GENERALES J.VARGAS - TALLERES ESPECIALIZADOS"), {
    tipo: "OS", oc: "0911-2026", proveedor: "SERVICIOS GENERALES J.VARGAS", proyecto: "TALLERES ESPECIALIZADOS",
  });
});

test("otras formas de escribir la OC", () => {
  assert.equal(carpetaDeOC("OC 0115-2026 FERRETERIA SAN JOSE")?.oc, "0115-2026");
  assert.equal(carpetaDeOC("OC N° 115-2026 FERRETERIA")?.oc, "0115-2026");
  assert.equal(carpetaDeOC("O.C. 2026-115 - X - Y")?.oc, "0115-2026");
  assert.equal(carpetaDeOC("ORDEN DE SERVICIO 0050-2026 TRANSPORTES")?.tipo, "OS");
  assert.equal(carpetaDeOC("oc 2026-0200 lucy")?.oc, "0200-2026");
  // Partes de la misma OC: «1296.1-2025» es la 1296, no la 1.
  assert.equal(carpetaDeOC("OC 1296.1-2025 PROVEEDOR")?.oc, "1296-2025");
  assert.equal(carpetaDeOC("0200-2026 LUCY")?.oc, "0200-2026");
  assert.equal(carpetaDeOC("OC 2026 - 0200")?.proveedor, "");
});

test("lo que no es la carpeta de una OC", () => {
  assert.equal(carpetaDeOC("01) TALLERES ESPECIALIZADOS"), null);
  assert.equal(carpetaDeOC("Factura y Guía"), null);
  assert.equal(carpetaDeOC("2026-01 ENERO"), null);
  assert.equal(carpetaDeOC("OCTUBRE 2026"), null);
  // Estricto: sin OC/OS delante no cuenta (subcarpetas dentro de una OC).
  assert.equal(carpetaDeOC("0200-2026 LUCY", true), null);
  assert.equal(carpetaDeOC("OC 0201-2026 LUCY", true)?.oc, "0201-2026");
});

test("la serie del comprobante en el nombre del archivo", () => {
  assert.equal(serieEnNombre("20603268467-01-F001-260.pdf"), "F001-260");
  assert.equal(serieEnNombre("F001-00018178.pdf"), "F001-18178");
  assert.equal(serieEnNombre("FACTURA E001 179.pdf"), "E001-179");
  assert.equal(serieEnNombre("PDF-DOC-E001-49010402136150.pdf"), "E001-490");
  assert.equal(serieEnNombre("01F0010031388.pdf"), "F001-31388");
  assert.equal(serieEnNombre("cotizacion final.pdf"), "");
});

test("qué parece cada archivo", () => {
  assert.equal(clasificarArchivo("20603268467-01-F001-260.pdf").parece, "FACTURA");
  assert.equal(clasificarArchivo("20603268467-09-T001-260 (1).pdf").parece, "GUÍA");
  assert.equal(clasificarArchivo("20603268467-01-F001-260.xml").parece, "XML");
  assert.equal(clasificarArchivo("R-20603268467-01-F001-260.zip").parece, "CDR (constancia SUNAT)");
  assert.equal(clasificarArchivo("PROFORMA INVOICE 123.pdf").parece, "PROFORMA");
  assert.equal(clasificarArchivo("FT_motor.pdf").parece, "FICHA TÉCNICA");
  assert.equal(clasificarArchivo("scan001.pdf", "Guías").parece, "GUÍA (por la carpeta)");
  assert.equal(clasificarArchivo("scan001.pdf").parece, "OTRO");
  assert.equal(clasificarArchivo("Factrua lucy.pdf").parece, "FACTURA");
});

test("los RUC del nombre, sin el de Inroprin", () => {
  assert.deepEqual(rucsEnNombre("20603268467-01-F001-260.pdf"), ["20603268467"]);
  assert.deepEqual(rucsEnNombre("20512201611 OC 0200.pdf"), []);
  assert.deepEqual(rucsEnNombre("RH 10451217581 E001-12.pdf"), ["10451217581"]);
});

test("qué cuenta como comprobante", () => {
  assert.ok(esComprobante("FACTURA"));
  assert.ok(esComprobante("XML"));
  assert.ok(esComprobante("FACTURA o RH (serie E)"));
  assert.ok(!esComprobante("GUÍA"));
  assert.ok(!esComprobante("CDR (constancia SUNAT)"));
});
