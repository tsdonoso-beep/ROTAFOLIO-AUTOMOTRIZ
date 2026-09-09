import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  elegibleParaCaja, impedimentosParaRendirCaja, periodoDeCaja, resumirCaja,
} from "../cajachica.ts";
import type { Alerta, EstadoGasto } from "../tipos.ts";

type G = Parameters<typeof resumirCaja>[0][number];

function gasto(p: {
  id?: string;
  total: number;
  fecha?: string | null;
  estado?: EstadoGasto;
  alertas?: Alerta[];
  confirmadas?: boolean;
}): G {
  return {
    id: p.id ?? "g",
    estado: p.estado ?? "VALIDADO",
    total: p.total,
    alertas: p.alertas ?? [],
    alertas_confirmadas: p.confirmadas ?? false,
    fecha_emision: p.fecha === undefined ? "2026-09-05" : p.fecha,
  } as G;
}

const alerta = (severidad: string): Alerta =>
  ({ codigo: "ARITMETICA", severidad, mensaje: "" } as unknown as Alerta);

// ════════════════════════════════════════════════════════════════

describe("resumirCaja", () => {
  test("todo lo rendido es reembolso: nadie adelantó plata", () => {
    // Es la diferencia de fondo con viáticos. En caja chica la persona puso
    // el dinero y la empresa se lo repone; no existe el "le sobró".
    const r = resumirCaja([
      gasto({ total: 45.5 }), gasto({ total: 120 }), gasto({ total: 8.9 }),
    ]);
    assert.equal(r.cantidad, 3);
    assert.equal(r.aReembolsar, 174.4);
  });

  test("los céntimos no se arrastran", () => {
    const r = resumirCaja([gasto({ total: 33.33 }), gasto({ total: 66.67 })]);
    assert.equal(r.aReembolsar, 100);
  });

  test("cuenta cuántos traen alerta y cuántos bloquean", () => {
    const r = resumirCaja([
      gasto({ total: 10 }),
      gasto({ total: 20, alertas: [alerta("alta")] }),
      gasto({ total: 30, alertas: [alerta("bloqueante")] }),
    ]);
    assert.equal(r.conAlertas, 2);
    assert.equal(r.bloqueantes, 1);
  });

  test("el rango de fechas sale de lo que se junta", () => {
    const r = resumirCaja([
      gasto({ total: 10, fecha: "2026-09-14" }),
      gasto({ total: 10, fecha: "2026-09-02" }),
      gasto({ total: 10, fecha: "2026-09-09" }),
    ]);
    assert.equal(r.desde, "2026-09-02");
    assert.equal(r.hasta, "2026-09-14");
  });

  test("los gastos sin fecha no rompen el rango", () => {
    const r = resumirCaja([
      gasto({ total: 10, fecha: null }),
      gasto({ total: 10, fecha: "2026-09-09" }),
    ]);
    assert.equal(r.desde, "2026-09-09");
    assert.equal(r.hasta, "2026-09-09");
  });

  test("una caja vacía no rompe nada", () => {
    const r = resumirCaja([]);
    assert.equal(r.cantidad, 0);
    assert.equal(r.aReembolsar, 0);
    assert.equal(r.desde, null);
  });
});

describe("impedimentosParaRendirCaja", () => {
  test("sin nada seleccionado no hay qué presentar", () => {
    const i = impedimentosParaRendirCaja([]);
    assert.equal(i.length, 1);
    assert.match(i[0].motivo, /no seleccionaste/i);
  });

  test("un duplicado impide presentar, igual que en viáticos", () => {
    const i = impedimentosParaRendirCaja([
      gasto({ total: 10, alertas: [alerta("bloqueante")] }),
    ]);
    assert.ok(i.some(x => /bloqueante|duplicad/i.test(x.motivo)));
  });

  test("una alerta sin confirmar también", () => {
    const i = impedimentosParaRendirCaja([
      gasto({ total: 10, alertas: [alerta("alta")], confirmadas: false }),
    ]);
    assert.ok(i.some(x => /sin confirmar/i.test(x.motivo)));
  });

  test("confirmada, la alerta deja pasar", () => {
    const i = impedimentosParaRendirCaja([
      gasto({ total: 10, alertas: [alerta("alta")], confirmadas: true }),
    ]);
    assert.deepEqual(i, []);
  });

  test("un gasto sin extraer impide presentar", () => {
    const i = impedimentosParaRendirCaja([gasto({ total: 10, estado: "CAPTURADO" })]);
    assert.ok(i.some(x => /sin extraer|error/i.test(x.motivo)));
  });

  test("todo en orden no deja impedimentos", () => {
    assert.deepEqual(impedimentosParaRendirCaja([gasto({ total: 10 })]), []);
  });
});

describe("elegibleParaCaja", () => {
  test("un gasto suelto sí entra", () => {
    assert.ok(elegibleParaCaja({ memo_id: null, estado: "VALIDADO" }));
    assert.ok(elegibleParaCaja({ memo_id: null, estado: "CON_ALERTA" }));
  });

  test("uno que ya pertenece a un memo, no", () => {
    // Ya tiene dueño: podría ser un viático de otra rendición.
    assert.ok(!elegibleParaCaja({ memo_id: "m1", estado: "VALIDADO" }));
  });

  test("uno ya presentado o aprobado está congelado", () => {
    for (const estado of ["PRESENTADO", "APROBADO", "CONTABILIZADO"] as EstadoGasto[]) {
      assert.ok(!elegibleParaCaja({ memo_id: null, estado }), estado);
    }
  });
});

describe("periodoDeCaja", () => {
  test("un rango se nombra por sus extremos", () => {
    const r = resumirCaja([
      gasto({ total: 10, fecha: "2026-09-02" }),
      gasto({ total: 10, fecha: "2026-09-14" }),
    ]);
    assert.equal(periodoDeCaja(r), "Caja chica 2026-09-02 a 2026-09-14");
  });

  test("un solo día no se repite", () => {
    const r = resumirCaja([gasto({ total: 10, fecha: "2026-09-02" })]);
    assert.equal(periodoDeCaja(r), "Caja chica 2026-09-02");
  });

  test("sin fechas queda el nombre a secas", () => {
    assert.equal(periodoDeCaja(resumirCaja([])), "Caja chica");
  });
});
