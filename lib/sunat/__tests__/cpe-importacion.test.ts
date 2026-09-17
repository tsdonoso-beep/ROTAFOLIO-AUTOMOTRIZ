import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { origenDe, periodoDe, prepararLote } from "../cpe-importacion.ts";
import type { ComprobanteCpe } from "../cpe-xml.ts";

const EMPRESA = "20512201611";

function comp(over: Partial<ComprobanteCpe> = {}): ComprobanteCpe {
  return {
    tipoComprobante: "01", serie: "F001", numero: "1", fechaEmision: "2026-08-15",
    moneda: "PEN", proveedorRuc: "20111111111", proveedorNombre: "PROVEEDOR SAC",
    adquirienteRuc: EMPRESA, adquirienteNombre: "INROPRIN", subtotal: 100, igv: 18,
    total: 118, items: [], ...over,
  };
}

describe("origenDe", () => {
  test("recibido cuando la empresa es el adquiriente", () => {
    assert.equal(origenDe(comp(), EMPRESA), "RECIBIDO");
  });
  test("emitido cuando la empresa es el proveedor", () => {
    assert.equal(origenDe(comp({ proveedorRuc: EMPRESA, adquirienteRuc: "20999999999" }), EMPRESA), "EMITIDO");
  });
  test("otro cuando la empresa no aparece", () => {
    assert.equal(origenDe(comp({ proveedorRuc: "20a", adquirienteRuc: "20b" }), EMPRESA), "OTRO");
  });
});

describe("periodoDe", () => {
  test("saca yyyymm de la fecha", () => {
    assert.equal(periodoDe("2026-08-27"), "202608");
  });
  test("null si no hay fecha", () => {
    assert.equal(periodoDe(null), null);
  });
});

describe("prepararLote", () => {
  test("arma el documento con origen y período derivados", () => {
    const [d] = prepararLote([comp({ items: [{ linea: 1, descripcion: "X", cantidad: 2, unidad: "NIU", precioUnitario: 50, importe: 100 }] })], EMPRESA);
    assert.equal(d.origen, "RECIBIDO");
    assert.equal(d.periodo, "202608");
    assert.equal(d.serie, "F001");
    assert.equal(d.items.length, 1);
    assert.equal(d.items[0].descripcion, "X");
  });

  test("descarta un comprobante sin serie o número", () => {
    assert.equal(prepararLote([comp({ serie: null })], EMPRESA).length, 0);
    assert.equal(prepararLote([comp({ numero: null })], EMPRESA).length, 0);
  });

  test("quita repetidos del mismo lote, quedándose con el último", () => {
    const lote = prepararLote([
      comp({ total: 100 }),
      comp({ total: 200 }), // misma identidad: tipo|serie|numero|proveedor
    ], EMPRESA);
    assert.equal(lote.length, 1);
    assert.equal(lote[0].total, 200);
  });

  test("dos comprobantes con distinto proveedor no se pisan", () => {
    const lote = prepararLote([
      comp({ proveedorRuc: "20111111111" }),
      comp({ proveedorRuc: "20222222222" }),
    ], EMPRESA);
    assert.equal(lote.length, 2);
  });
});
