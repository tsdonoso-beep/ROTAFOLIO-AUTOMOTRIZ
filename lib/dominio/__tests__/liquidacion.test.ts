import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { explicarNeto, liquidar, situacionDe, type MemoLiquidable } from "../liquidacion.ts";
import type { EstadoMemo } from "../tipos.ts";

function memo(p: {
  id: string;
  autorizado: number;
  rendido?: number;
  estado: EstadoMemo;
  fecha?: string;
}): MemoLiquidable {
  return {
    id: p.id,
    correlativo: p.id,
    estado: p.estado,
    destino: null,
    fecha_salida: p.fecha ?? "2026-09-01",
    monto_autorizado: p.autorizado,
    gastos: p.rendido
      ? [{ estado: "APROBADO", clase: "COMPROBANTE", total: p.rendido, alertas: [] }]
      : [],
  };
}

// ════════════════════════════════════════════════════════════════

describe("situacionDe", () => {
  test("una rendición revisada ya no cambia de monto", () => {
    assert.equal(situacionDe("APROBADA"), "liquidable");
    assert.equal(situacionDe("CONTABILIZADA"), "liquidable");
  });

  test("presentada todavía puede moverse en la revisión", () => {
    assert.equal(situacionDe("PRESENTADA"), "en_revision");
  });

  test("abierta u observada siguen en manos de la persona", () => {
    assert.equal(situacionDe("ABIERTO"), "abierta");
    assert.equal(situacionDe("OBSERVADA"), "abierta");
  });

  test("borrador y anulado no representan plata entregada", () => {
    assert.equal(situacionDe("BORRADOR"), null);
    assert.equal(situacionDe("ANULADO"), null);
  });
});

describe("el enfrentamiento de Finanzas", () => {
  test("le sobró: debe devolver", () => {
    const l = liquidar([memo({ id: "A", autorizado: 500, rendido: 380, estado: "APROBADA" })]);
    assert.equal(l.devuelve, 120);
    assert.equal(l.reembolsa, 0);
    assert.equal(l.neto, 120);
  });

  test("gastó de más: la empresa le reembolsa", () => {
    const l = liquidar([memo({ id: "A", autorizado: 300, rendido: 445, estado: "APROBADA" })]);
    assert.equal(l.devuelve, 0);
    assert.equal(l.reembolsa, 145);
    assert.equal(l.neto, -145);
  });

  test("varios viajes se compensan entre sí", () => {
    // El caso que describió Finanzas: 20 viajes, unos a favor y otros en
    // contra, y al final un solo número que pasar a pago.
    const l = liquidar([
      memo({ id: "A", autorizado: 500, rendido: 380, estado: "APROBADA", fecha: "2026-03-01" }),
      memo({ id: "B", autorizado: 300, rendido: 445, estado: "APROBADA", fecha: "2026-05-01" }),
      memo({ id: "C", autorizado: 200, rendido: 200, estado: "CONTABILIZADA", fecha: "2026-07-01" }),
    ]);
    assert.equal(l.devuelve, 120);
    assert.equal(l.reembolsa, 145);
    assert.equal(l.neto, -25, "en neto la empresa le debe 25");
    assert.equal(l.autorizado, 1000);
    assert.equal(l.rendido, 1025);
  });

  test("se lee en orden de fecha, como un estado de cuenta", () => {
    const l = liquidar([
      memo({ id: "TARDE", autorizado: 100, estado: "APROBADA", fecha: "2026-08-01" }),
      memo({ id: "TEMPRANO", autorizado: 100, estado: "APROBADA", fecha: "2026-02-01" }),
    ]);
    assert.deepEqual(l.lineas.map(x => x.correlativo), ["TEMPRANO", "TARDE"]);
  });

  test("los anulados no inflan lo entregado", () => {
    const l = liquidar([
      memo({ id: "A", autorizado: 500, rendido: 500, estado: "APROBADA" }),
      memo({ id: "X", autorizado: 9000, estado: "ANULADO" }),
      memo({ id: "B", autorizado: 1000, estado: "BORRADOR" }),
    ]);
    assert.equal(l.lineas.length, 1);
    assert.equal(l.autorizado, 500);
  });
});

describe("lo que todavía no se puede pagar", () => {
  test("un memo abierto no entra en el neto, pero sí se avisa", () => {
    // Mientras siga abierto la persona puede cargar más comprobantes: netear
    // ahora daría un número que parece exacto y no lo es.
    const l = liquidar([
      memo({ id: "CERRADO", autorizado: 500, rendido: 380, estado: "APROBADA" }),
      memo({ id: "ABIERTO", autorizado: 800, estado: "EN_RENDICION" }),
    ]);
    assert.equal(l.neto, 120, "solo cuenta lo ya revisado");
    assert.equal(l.sinCerrar, 1);
    assert.equal(l.montoSinCerrar, 800);
    assert.equal(l.liquidable, false, "no se puede pasar a pago todavía");
  });

  test("una presentada tampoco cuenta: el monto puede moverse al revisar", () => {
    const l = liquidar([
      memo({ id: "P", autorizado: 500, rendido: 500, estado: "PRESENTADA" }),
    ]);
    assert.equal(l.neto, 0);
    assert.equal(l.sinCerrar, 1);
    assert.equal(l.liquidable, false);
  });

  test("con todo cerrado sí se puede pasar a pago", () => {
    const l = liquidar([
      memo({ id: "A", autorizado: 500, rendido: 380, estado: "APROBADA" }),
      memo({ id: "B", autorizado: 200, rendido: 200, estado: "CONTABILIZADA" }),
    ]);
    assert.equal(l.sinCerrar, 0);
    assert.equal(l.liquidable, true);
  });

  test("sin ningún memo cerrado no hay nada que liquidar", () => {
    const l = liquidar([memo({ id: "A", autorizado: 500, estado: "ABIERTO" })]);
    assert.equal(l.liquidable, false);
    assert.equal(l.neto, 0);
  });

  test("sin memos, todo en cero y sin romperse", () => {
    const l = liquidar([]);
    assert.deepEqual(l.lineas, []);
    assert.equal(l.neto, 0);
    assert.equal(l.liquidable, false);
  });
});

describe("redondeo", () => {
  test("los céntimos no se arrastran en la suma", () => {
    const l = liquidar([
      memo({ id: "A", autorizado: 100, rendido: 33.33, estado: "APROBADA" }),
      memo({ id: "B", autorizado: 100, rendido: 66.67, estado: "APROBADA" }),
    ]);
    assert.equal(l.devuelve, 100);
    assert.equal(l.neto, 100);
  });
});

describe("explicarNeto", () => {
  test("dice en una frase qué hacer con el saldo", () => {
    assert.match(explicarNeto(liquidar([memo({ id: "A", autorizado: 500, rendido: 380, estado: "APROBADA" })])), /devolver 120/);
    assert.match(explicarNeto(liquidar([memo({ id: "A", autorizado: 300, rendido: 445, estado: "APROBADA" })])), /reembolsar 145/);
    assert.match(explicarNeto(liquidar([memo({ id: "A", autorizado: 500, rendido: 500, estado: "APROBADA" })])), /a cero/);
    assert.match(explicarNeto(liquidar([])), /sin memos|no tiene/i);
  });
});
