import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  camposPendientes, completarImportes, estaCompleto,
  fusionar, importesCuadran, vacio,
} from "../fusion.ts";
import type { ResultadoExtraccion } from "../../dominio/tipos.ts";

function conCampos(
  campos: Partial<ResultadoExtraccion>,
  confianza: Record<string, number>
): ResultadoExtraccion {
  return { ...vacio(), ...campos, _confianza: confianza };
}

// ════════════════════════════════════════════════════════════════
//  Fusión OCR + IA
// ════════════════════════════════════════════════════════════════

describe("fusionar", () => {
  test("sin IA, el OCR llena lo que pudo leer", () => {
    const ocr = conCampos(
      { proveedor_ruc: "20100128056", total: 300 },
      { proveedor_ruc: 0.95, total: 0.9 }
    );
    const { valores, origen } = fusionar(ocr, null);

    assert.equal(valores.proveedor_ruc, "20100128056");
    assert.equal(valores.total, 300);
    assert.equal(origen.proveedor_ruc, "ocr");
  });

  test("sin OCR, la IA sola también sirve (caso PDF)", () => {
    const ia = conCampos({ proveedor_nombre: "FOR ELECTRIC SAC" }, { proveedor_nombre: 0.8 });
    const { valores, origen } = fusionar(null, ia);

    assert.equal(valores.proveedor_nombre, "FOR ELECTRIC SAC");
    assert.equal(origen.proveedor_nombre, "ia");
  });

  test("cada campo se decide por separado: gana quien tenga más confianza", () => {
    const ocr = conCampos(
      { proveedor_ruc: "20100128056", proveedor_nombre: "F0R ELECTR1C" },
      { proveedor_ruc: 0.95, proveedor_nombre: 0.4 }
    );
    const ia = conCampos(
      { proveedor_ruc: "20999999999", proveedor_nombre: "FOR ELECTRIC S.A.C." },
      { proveedor_ruc: 0.7, proveedor_nombre: 0.9 }
    );

    const { valores, origen } = fusionar(ocr, ia);

    // El RUC verificado por módulo 11 le gana al del modelo…
    assert.equal(valores.proveedor_ruc, "20100128056");
    assert.equal(origen.proveedor_ruc, "ocr");
    // …y la razón social, que el OCR solo intuye, se la lleva la IA.
    assert.equal(valores.proveedor_nombre, "FOR ELECTRIC S.A.C.");
    assert.equal(origen.proveedor_nombre, "ia");
  });

  test("empatados gana el OCR, porque sus campos están verificados", () => {
    const ocr = conCampos({ serie: "F001" }, { serie: 0.8 });
    const ia = conCampos({ serie: "F002" }, { serie: 0.8 });

    const { valores, origen } = fusionar(ocr, ia);
    assert.equal(valores.serie, "F001");
    assert.equal(origen.serie, "ocr");
  });

  test("un campo que ninguna fuente leyó queda vacío y sin origen", () => {
    const { valores, origen } = fusionar(conCampos({}, {}), null);
    assert.equal(valores.serie, "");
    assert.equal(origen.serie, undefined);
  });

  test("no se aceptan importes en cero aunque vengan con confianza", () => {
    const ocr = conCampos({ total: 0 }, { total: 0.9 });
    const { valores, origen } = fusionar(ocr, null);
    assert.equal(valores.total, 0);
    assert.equal(origen.total, undefined);
  });

  test("la confianza que sobrevive es la del campo que ganó", () => {
    const ocr = conCampos({ serie: "F001" }, { serie: 0.92 });
    const ia = conCampos({ detalle: "Cable NH-80" }, { detalle: 0.85 });

    const { valores } = fusionar(ocr, ia);
    assert.equal(valores._confianza.serie, 0.92);
    assert.equal(valores._confianza.detalle, 0.85);
  });

  test("las dos fuentes vacías dan un resultado vacío, no un error", () => {
    const { valores } = fusionar(null, null);
    assert.equal(valores.total, 0);
    assert.equal(valores.moneda, "PEN");
  });
});

// ════════════════════════════════════════════════════════════════
//  Aritmética
// ════════════════════════════════════════════════════════════════

describe("completarImportes", () => {
  const factura = { igvPorcentaje: 18, tipoComprobante: "01" };

  test("con solo el total, desagrega la base y el IGV", () => {
    const r = completarImportes({ total: 118, subtotal: 0, igv: 0 }, factura);
    assert.equal(r.subtotal, 100);
    assert.equal(r.igv, 18);
    assert.ok(importesCuadran(r));
  });

  test("una boleta no discrimina IGV", () => {
    const r = completarImportes(
      { total: 120, subtotal: 0, igv: 0 },
      { igvPorcentaje: 18, tipoComprobante: "03" }
    );
    assert.equal(r.subtotal, 120);
    assert.equal(r.igv, 0);
    assert.ok(importesCuadran(r));
  });

  test("un ticket tampoco", () => {
    const r = completarImportes(
      { total: 50, subtotal: 0, igv: 0 },
      { igvPorcentaje: 18, tipoComprobante: "12" }
    );
    assert.equal(r.igv, 0);
  });

  test("si la persona escribe el subtotal, ese manda y el IGV se ajusta", () => {
    const r = completarImportes(
      { total: 300, subtotal: 254.24, igv: 0 },
      { ...factura, editado: "subtotal" }
    );
    assert.equal(r.subtotal, 254.24);
    assert.equal(r.igv, 45.76);
    assert.ok(importesCuadran(r));
  });

  test("si escribe el IGV, se respeta y el subtotal se ajusta", () => {
    const r = completarImportes(
      { total: 300, subtotal: 0, igv: 45.76 },
      { ...factura, editado: "igv" }
    );
    assert.equal(r.subtotal, 254.24);
    assert.equal(r.igv, 45.76);
  });

  test("sin total no hay nada que derivar", () => {
    const r = completarImportes({ total: 0, subtotal: 0, igv: 0 }, factura);
    assert.equal(r.total, 0);
    assert.equal(r.subtotal, 0);
  });

  test("respeta una tasa de IGV distinta a la actual", () => {
    const r = completarImportes(
      { total: 110, subtotal: 0, igv: 0 },
      { igvPorcentaje: 10, tipoComprobante: "01" }
    );
    assert.equal(r.subtotal, 100);
    assert.equal(r.igv, 10);
  });

  test("el redondeo no descuadra la suma", () => {
    // 33.33 no se reparte exacto: el IGV toma la diferencia para que cierre.
    const r = completarImportes({ total: 33.33, subtotal: 0, igv: 0 }, factura);
    assert.ok(importesCuadran(r), `${r.subtotal} + ${r.igv} != ${r.total}`);
  });
});

describe("importesCuadran", () => {
  test("tolera un céntimo de redondeo", () => {
    assert.ok(importesCuadran({ subtotal: 100, igv: 18, total: 118.01 }));
  });

  test("no tolera una diferencia real", () => {
    assert.ok(!importesCuadran({ subtotal: 100, igv: 18, total: 130 }));
  });
});

// ════════════════════════════════════════════════════════════════
//  Completitud
// ════════════════════════════════════════════════════════════════

describe("camposPendientes", () => {
  test("un comprobante vacío debe todos los obligatorios", () => {
    const p = camposPendientes(vacio());
    for (const campo of ["proveedor_ruc", "proveedor_nombre", "serie", "numero", "fecha_emision", "total"]) {
      assert.ok(p.includes(campo), `falta ${campo}`);
    }
  });

  test("un comprobante completo no debe nada", () => {
    const lleno = {
      ...vacio(),
      proveedor_ruc: "20100128056",
      proveedor_nombre: "FOR ELECTRIC S.A.C.",
      serie: "F001",
      numero: "00002591",
      fecha_emision: "2026-05-14",
      total: 300,
    };
    assert.deepEqual(camposPendientes(lleno), []);
    assert.ok(estaCompleto(lleno));
  });

  test("un total en cero cuenta como pendiente", () => {
    const r = { ...vacio(), total: 0 };
    assert.ok(camposPendientes(r).includes("total"));
  });

  test("espacios en blanco no llenan un campo", () => {
    const r = { ...vacio(), serie: "   " };
    assert.ok(camposPendientes(r).includes("serie"));
  });
});
