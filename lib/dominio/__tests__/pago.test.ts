import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cobertura, type Beneficiario, type Constancia } from "../pago.ts";

// El memo 594-2026, tal como se pagó de verdad: once personas, S/ 9,064.00,
// y una planilla de haberes que solo cubre a siete.
const once: Beneficiario[] = [
  ...["a", "b", "c", "d", "e", "f"].map(id => ({
    usuarioId: id, nombre: `BCP ${id}`, asignado: 756,
  })),
  { usuarioId: "g", nombre: "BCP g", asignado: 756 },
  ...["h", "i", "j", "k"].map(id => ({
    usuarioId: id, nombre: `Interbank ${id}`, asignado: 943,
  })),
];

// S/ 5,292.00 a siete personas: 756 cada una.
const planilla1439: Constancia = {
  id: "p1", banco: "BCP", planilla: "1439", fecha: "2026-08-08",
  lineas: ["a", "b", "c", "d", "e", "f", "g"].map(id => ({
    usuarioId: id, monto: 756, procesada: true,
  })),
};

// Los S/ 3,772.00 que salieron por otra operación contra el CCI.
const porCCI: Constancia = {
  id: "p2", banco: "Interbank", planilla: null, fecha: "2026-08-08",
  lineas: ["h", "i", "j", "k"].map(id => ({
    usuarioId: id, monto: 943, procesada: true,
  })),
};

describe("un memo se paga en más de una planilla", () => {
  it("con una sola constancia el memo NO está pagado", () => {
    const c = cobertura(once, [planilla1439], 9064);
    assert.equal(c.pagado, 5292);
    assert.equal(c.falta, 3772);   // el número que faltaba
    assert.equal(c.cubierto, false);
  });

  it("y dice quiénes son los que siguen esperando", () => {
    const c = cobertura(once, [planilla1439], 9064);
    assert.deepEqual(c.sinCobrar, [
      "Interbank h", "Interbank i", "Interbank j", "Interbank k",
    ]);
  });

  it("sumando la segunda, el memo queda cubierto", () => {
    const c = cobertura(once, [planilla1439, porCCI], 9064);
    assert.equal(c.pagado, 9064);
    assert.equal(c.falta, 0);
    assert.equal(c.cubierto, true);
    assert.deepEqual(c.sinCobrar, []);
    assert.deepEqual(c.bancos, ["BCP", "Interbank"]);
  });
});

// «La constancia trae el estado por fila. Una fila rechazada es alguien que
// no cobró y que por lo tanto no tiene nada que rendir.»
describe("una fila rechazada no es plata entregada", () => {
  const conRechazo: Constancia = {
    ...planilla1439,
    lineas: planilla1439.lineas.map(l =>
      l.usuarioId === "c" ? { ...l, procesada: false } : l),
  };

  it("no se suma a lo pagado", () => {
    const c = cobertura(once, [conRechazo], 9064);
    assert.equal(c.pagado, 4536);      // 5292 - 756
  });

  it("y se distingue de no haber intentado, porque alguien debe reenviarlo", () => {
    const c = cobertura(once, [conRechazo], 9064);
    const rechazado = c.porPersona.find(p => p.usuarioId === "c")!;
    assert.equal(rechazado.situacion, "RECHAZADO");
    assert.equal(rechazado.rechazado, 756);
    assert.equal(rechazado.cobrado, 0);

    const nuncaIntentado = c.porPersona.find(p => p.usuarioId === "h")!;
    assert.equal(nuncaIntentado.situacion, "SIN_PAGAR");
    assert.equal(nuncaIntentado.rechazado, 0);
  });
});

describe("casos que se dan en la práctica", () => {
  it("cobrar menos de lo asignado se marca, no se da por bueno", () => {
    const c = cobertura(
      [{ usuarioId: "a", nombre: "Ana", asignado: 1000 }],
      [{ id: "p", banco: "BCP", planilla: "1", fecha: null,
         lineas: [{ usuarioId: "a", monto: 400, procesada: true }] }],
      1000
    );
    assert.equal(c.porPersona[0].situacion, "PARCIAL");
    assert.equal(c.cubierto, false);
  });

  it("dos abonos a la misma persona se suman", () => {
    const c = cobertura(
      [{ usuarioId: "a", nombre: "Ana", asignado: 1000 }],
      [
        { id: "p1", banco: "BCP", planilla: "1", fecha: null,
          lineas: [{ usuarioId: "a", monto: 400, procesada: true }] },
        { id: "p2", banco: "BCP", planilla: "2", fecha: null,
          lineas: [{ usuarioId: "a", monto: 600, procesada: true }] },
      ],
      1000
    );
    assert.equal(c.porPersona[0].situacion, "PAGADO");
    assert.equal(c.cubierto, true);
  });

  it("sin ninguna constancia, nadie cobró", () => {
    const c = cobertura(once, [], 9064);
    assert.equal(c.pagado, 0);
    assert.equal(c.cubierto, false);
    assert.equal(c.sinCobrar.length, 11);
  });

  // Un memo sin anexo no se puede repartir, pero el pago sí se puede leer.
  it("sin monto asignado, cualquier cobro cuenta como pagado", () => {
    const c = cobertura(
      [{ usuarioId: "a", nombre: "Ana", asignado: null }],
      [{ id: "p", banco: "BCP", planilla: "1", fecha: null,
         lineas: [{ usuarioId: "a", monto: 1, procesada: true }] }],
      1000
    );
    assert.equal(c.porPersona[0].situacion, "PAGADO");
  });
});
