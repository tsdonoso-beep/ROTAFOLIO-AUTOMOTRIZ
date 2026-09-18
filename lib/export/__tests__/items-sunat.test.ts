import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filasItemsSunat, CABECERAS_ITEMS, nombreArchivoItems, type FilaDetalleCpe,
} from "../items-sunat.ts";

function fila(over: Partial<FilaDetalleCpe> = {}): FilaDetalleCpe {
  return {
    periodo: "202608", origen: "RECIBIDO", proveedorRuc: "20111111111",
    proveedorNombre: "PROVEEDOR SAC", tipoComprobante: "01", serie: "F001",
    numero: "123", fechaEmision: "2026-08-27", moneda: "PEN", linea: 1,
    descripcion: "RESINA ABS", cantidad: 250, unidad: "NIU",
    precioUnitario: 2.85, importe: 712.5, totalComprobante: 840.75,
    enlacePdf: "https://drive.google.com/file/d/pdf/view",
    enlaceXml: "https://drive.google.com/file/d/xml/view",
    formaPago: "Credito", guiaRemision: "T001-1", ordenCompra: "OC-9",
    documentoRelacionado: "F001-9", tipoDocumentoRelacionado: "ANTICIPO", anticipoAplicado: 500,
    detraccionPorcentaje: 12, detraccionMonto: 85.5,
    detraccionCuentaBanco: "00002003147", detraccionCodigoBienServicio: "037",
    ...over,
  };
}

describe("filasItemsSunat", () => {
  const filas = filasItemsSunat([fila()]);

  test("la primera fila son las cabeceras", () => {
    assert.deepEqual(filas[0], CABECERAS_ITEMS);
  });

  test("traduce el tipo y el origen a algo legible", () => {
    const r = filas[1];
    assert.equal(r[1], "Recibido");
    assert.equal(r[4], "Factura");
  });

  test("la fecha sale en formato español y la serie como texto", () => {
    const r = filas[1];
    assert.equal(r[7], "27/08/2026");
    assert.equal(r[5], "F001");
    assert.equal(r[6], "123");
  });

  test("el precio unitario lleva cuatro decimales; el importe, dos", () => {
    const r = filas[1];
    assert.equal(r[23], "2.8500");
    assert.equal(r[24], "712.50");
  });

  test("un importe ausente queda vacío, no en cero", () => {
    const r = filasItemsSunat([fila({ importe: null })])[1];
    assert.equal(r[24], "");
  });

  test("el PDF y el XML archivados en Drive van al final, PDF primero", () => {
    const r = filas[1];
    assert.equal(r[26], "https://drive.google.com/file/d/pdf/view");
    assert.equal(r[27], "https://drive.google.com/file/d/xml/view");
  });

  test("sin enlace archivado queda vacío, no como texto 'null'", () => {
    const r = filasItemsSunat([fila({ enlacePdf: null, enlaceXml: null })])[1];
    assert.equal(r[26], "");
    assert.equal(r[27], "");
  });

  test("forma de pago, guía, OC, documento relacionado y anticipo van entre la moneda y las líneas", () => {
    const r = filas[1];
    assert.equal(r[9], "Credito");
    assert.equal(r[10], "T001-1");
    assert.equal(r[11], "OC-9");
    assert.equal(r[12], "F001-9");
    assert.equal(r[13], "ANTICIPO");
    assert.equal(r[14], "500.00");
  });

  test("la detracción trae porcentaje, monto, cuenta y código de bien/servicio", () => {
    const r = filas[1];
    assert.equal(r[15], "12.00");
    assert.equal(r[16], "85.50");
    assert.equal(r[17], "00002003147");
    assert.equal(r[18], "037");
  });

  test("sin detracción ni anticipo, los campos quedan vacíos, no en cero", () => {
    const r = filasItemsSunat([fila({
      formaPago: null, guiaRemision: null, ordenCompra: null,
      documentoRelacionado: null, tipoDocumentoRelacionado: null, anticipoAplicado: null,
      detraccionPorcentaje: null, detraccionMonto: null,
      detraccionCuentaBanco: null, detraccionCodigoBienServicio: null,
    })])[1];
    assert.equal(r[9], "");
    assert.equal(r[12], "");
    assert.equal(r[14], "");
    assert.equal(r[15], "");
    assert.equal(r[17], "");
    assert.equal(r[18], "");
  });
});

describe("nombreArchivoItems", () => {
  test("con y sin período, sin pisar el de cabeceras", () => {
    assert.equal(nombreArchivoItems(null), "COMPROBANTES SUNAT - DETALLE.csv");
    assert.equal(nombreArchivoItems("202608"), "COMPROBANTES SUNAT - DETALLE 202608.csv");
  });
});
