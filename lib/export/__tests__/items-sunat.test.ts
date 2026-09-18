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
    enlace: "https://drive.google.com/file/d/abc/view", ...over,
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
    assert.equal(r[13], "2.8500");
    assert.equal(r[14], "712.50");
  });

  test("un importe ausente queda vacío, no en cero", () => {
    const r = filasItemsSunat([fila({ importe: null })])[1];
    assert.equal(r[14], "");
  });

  test("el enlace al XML archivado en Drive va de última columna", () => {
    const r = filas[1];
    assert.equal(r[16], "https://drive.google.com/file/d/abc/view");
  });

  test("sin enlace archivado queda vacío, no como texto 'null'", () => {
    const r = filasItemsSunat([fila({ enlace: null })])[1];
    assert.equal(r[16], "");
  });
});

describe("nombreArchivoItems", () => {
  test("con y sin período, sin pisar el de cabeceras", () => {
    assert.equal(nombreArchivoItems(null), "COMPROBANTES SUNAT - DETALLE.csv");
    assert.equal(nombreArchivoItems("202608"), "COMPROBANTES SUNAT - DETALLE 202608.csv");
  });
});
