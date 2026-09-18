import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filasCoberturaSunat, filaCoberturaDesdeRpc, CABECERAS_COBERTURA,
  filasResumenCobertura, filaResumenDesdeRpc, CABECERAS_RESUMEN_COBERTURA,
  nombreArchivoCobertura, type FilaCobertura, type FilaResumenCobertura,
} from "../cobertura-sunat.ts";

function fila(over: Partial<FilaCobertura> = {}): FilaCobertura {
  return {
    periodo: "202608", proveedorRuc: "20111111111", proveedorNombre: "PROVEEDOR SAC",
    tipoComprobante: "01", serie: "F001", numero: "123", fechaEmision: "2026-08-27",
    moneda: "PEN", totalSire: 840.75, estado: "Con detalle",
    totalDetalle: 840.75, diferencia: 0, items: 3, ...over,
  };
}

describe("filasCoberturaSunat", () => {
  const filas = filasCoberturaSunat([fila()]);

  test("la primera fila son las cabeceras", () => {
    assert.deepEqual(filas[0], CABECERAS_COBERTURA);
  });

  test("estado, ítems y montos en su columna", () => {
    const r = filas[1];
    assert.equal(r[9], "Con detalle");
    assert.equal(r[8], "840.75");
    assert.equal(r[10], "840.75");
    assert.equal(r[11], "0.00");
    assert.equal(r[12], "3");
  });

  test("sin detalle: el total y la diferencia quedan vacíos, no en cero", () => {
    const r = filasCoberturaSunat([fila({
      estado: "Sin detalle", totalDetalle: null, diferencia: null, items: 0,
    })])[1];
    assert.equal(r[9], "Sin detalle");
    assert.equal(r[10], "");
    assert.equal(r[11], "");
    assert.equal(r[12], "0");
  });
});

describe("filaCoberturaDesdeRpc", () => {
  test("convierte la fila cruda de la RPC (snake_case, números como texto)", () => {
    const f = filaCoberturaDesdeRpc({
      periodo: "202608", proveedor_ruc: "20111111111", proveedor_nombre: "X",
      tipo_comprobante: "01", serie: "F001", numero: "1", fecha_emision: "2026-08-01",
      moneda: "PEN", total_sire: "100.00", estado: "Con detalle",
      total_detalle: "100.00", diferencia: "0.00", items: "2",
    });
    assert.equal(f.totalSire, 100);
    assert.equal(f.items, 2);
    assert.equal(f.estado, "Con detalle");
  });

  test("sin detalle: total_detalle e ítems nulos no se confunden con cero", () => {
    const f = filaCoberturaDesdeRpc({
      periodo: "202608", tipo_comprobante: "01", serie: "F001", numero: "1",
      total_sire: "100.00", estado: "Sin detalle", total_detalle: null, items: 0,
    });
    assert.equal(f.totalDetalle, null);
    assert.equal(f.items, 0);
  });
});

function filaResumen(over: Partial<FilaResumenCobertura> = {}): FilaResumenCobertura {
  return { periodo: "202608", enSire: 100, conDetalle: 25, sinDetalle: 75, pctCobertura: 25.0, ...over };
}

describe("filasResumenCobertura", () => {
  test("la primera fila son las cabeceras", () => {
    assert.deepEqual(filasResumenCobertura([filaResumen()])[0], CABECERAS_RESUMEN_COBERTURA);
  });

  test("el porcentaje lleva un decimal", () => {
    const r = filasResumenCobertura([filaResumen({ pctCobertura: 8 })])[1];
    assert.equal(r[4], "8.0");
  });

  test("sin ningún comprobante en el período, el porcentaje queda vacío", () => {
    const r = filasResumenCobertura([filaResumen({ enSire: 0, conDetalle: 0, sinDetalle: 0, pctCobertura: null })])[1];
    assert.equal(r[4], "");
  });
});

describe("filaResumenDesdeRpc", () => {
  test("convierte la fila cruda de la RPC", () => {
    const f = filaResumenDesdeRpc({ periodo: "202608", en_sire: 100, con_detalle: 25, sin_detalle: 75, pct_cobertura: "25.0" });
    assert.equal(f.enSire, 100);
    assert.equal(f.pctCobertura, 25);
  });
});

describe("nombreArchivoCobertura", () => {
  test("con y sin período", () => {
    assert.equal(nombreArchivoCobertura(null), "COMPROBANTES SUNAT - COBERTURA.csv");
    assert.equal(nombreArchivoCobertura("202608"), "COMPROBANTES SUNAT - COBERTURA 202608.csv");
  });
});
