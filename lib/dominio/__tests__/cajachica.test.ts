import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  elegibleParaCaja, estadoDeLaCaja, impedimentosParaRendirCaja, periodoDeCaja,
  resumirCaja, siguienteCiclo, type CicloDeCaja,
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

// ════════════════════════════════════════════════════════════════
// El fondo y sus ciclos
// ════════════════════════════════════════════════════════════════
//
// Los seis ciclos reales de la caja de Gestión de Proyectos, del seguimiento
// de Control de Gestión: 11 y 23 de julio, 4, 13 y 25 de agosto, 3 de
// setiembre. Se repuso cada 8 a 12 días, no una vez al mes.

describe("el fondo y sus ciclos", () => {
  const ciclo = (
    id: string, ciclo: string, estado: string,
    monto: number, rendido: number, fecha: string | null
  ): CicloDeCaja => ({ id, correlativo: `CCH-${id}`, ciclo, estado, monto, rendido, fecha });

  const gestionDeProyectos = [
    ciclo("1", "001-2026", "CERRADO", 2000, 2000, "2026-07-11"),
    ciclo("2", "002-2026", "CERRADO", 2000, 1950, "2026-07-23"),
    ciclo("3", "003-2026", "CERRADO", 2000, 2000, "2026-08-04"),
    ciclo("4", "004-2026", "CERRADO", 2000, 1800, "2026-08-13"),
    ciclo("5", "005-2026", "CERRADO", 2000, 2000, "2026-08-25"),
    ciclo("6", "006-2026", "ABIERTO", 2000, 1250, "2026-09-03"),
  ];

  it("encuentra el ciclo vivo y calcula su saldo", () => {
    const e = estadoDeLaCaja(gestionDeProyectos);
    assert.equal(e.abierto?.ciclo, "006-2026");
    assert.equal(e.saldo, 750);
    assert.equal(e.cerrados.length, 5);
  });

  it("mide la cadencia real, que no es mensual", () => {
    const e = estadoDeLaCaja(gestionDeProyectos);
    // Del 11 de julio al 3 de setiembre son 54 días entre seis ciclos.
    assert.equal(e.cadenciaDias, 11);
  });

  it("suma todo lo repuesto en la vida del fondo", () => {
    assert.equal(estadoDeLaCaja(gestionDeProyectos).repuestoTotal, 12000);
  });

  it("una caja recién abierta no tiene cadencia que medir", () => {
    const e = estadoDeLaCaja([gestionDeProyectos[0]]);
    assert.equal(e.cadenciaDias, null);
  });

  it("sin ciclo abierto el saldo es cero, no el del último cerrado", () => {
    const e = estadoDeLaCaja(gestionDeProyectos.slice(0, 5));
    assert.equal(e.abierto, null);
    assert.equal(e.saldo, 0);
  });

  it("una caja sin ningún ciclo todavía no dice nada raro", () => {
    const e = estadoDeLaCaja([]);
    assert.equal(e.abierto, null);
    assert.equal(e.repuestoTotal, 0);
    assert.equal(e.cadenciaDias, null);
  });
});

// Hay dos numeraciones sin reconciliar: el memo 194-2026 escribe «CAJA CHICA
// N° 36» y el seguimiento usa 001-2025. El código continúa la que encuentre.
describe("el número del ciclo siguiente", () => {
  it("continúa la numeración del seguimiento", () => {
    assert.equal(siguienteCiclo("005-2026", 2026), "006-2026");
  });

  it("continúa la del memo, que va sin año", () => {
    assert.equal(siguienteCiclo("36", 2026), "37");
  });

  it("conserva los ceros a la izquierda", () => {
    assert.equal(siguienteCiclo("009", 2026), "010");
  });

  it("una caja nueva empieza en uno", () => {
    assert.equal(siguienteCiclo(null, 2026), "001-2026");
  });

  it("si el último no trae ningún número, se empieza de nuevo en vez de adivinar", () => {
    assert.equal(siguienteCiclo("CAJA CHICA", 2026), "001-2026");
  });

  it("al cambiar de año, el número sigue y el año se actualiza", () => {
    assert.equal(siguienteCiclo("012-2025", 2026), "013-2026");
  });
});
