import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  diasExcedidos, faltasDelDesplazamiento, porDia, revisarPlanilla,
  type Desplazamiento, type Trabajador,
} from "../movilidad.ts";

// La planilla 010212, la que usó Wilmer Zamora en el memo 594-2026. En la
// rendición aparece como una sola línea de S/ 20.90; acá es lo que la ley
// pide que sea: una fila por desplazamiento.
const wilmer: Trabajador = { nombre: "Wilmer Gerardo Zamora Carrilo", dni: "73218372" };

const d = (
  id: string, fecha: string | null, motivo: string | null,
  destino: string | null, monto: number | null
): Desplazamiento => ({ id, fecha, motivo, destino, monto });

describe("qué hace válido a un desplazamiento", () => {
  const completo = d("1", "2026-08-10", "VISITA TÉCNICA", "OFICINA - DOMICILIO", 20.90);

  it("con los seis datos, sustenta", () => {
    assert.deepEqual(faltasDelDesplazamiento(completo, wilmer), []);
  });

  it("nombra lo que falta en el orden del texto legal", () => {
    const faltas = faltasDelDesplazamiento(d("1", null, null, null, null), {
      nombre: null, dni: null,
    });
    assert.deepEqual(faltas, [
      "la fecha en que se incurrió en el gasto",
      "los nombres y apellidos del trabajador",
      "el número de DNI",
      "el motivo del desplazamiento",
      "el destino del desplazamiento",
      "el monto gastado",
    ]);
  });

  it("el motivo y el destino son cosas distintas: la ley los nombra aparte", () => {
    const sinMotivo = d("1", "2026-08-10", "  ", "OFICINA - DOMICILIO", 20.90);
    assert.deepEqual(faltasDelDesplazamiento(sinMotivo, wilmer),
      ["el motivo del desplazamiento"]);
  });

  it("un DNI provisional es un relleno nuestro, no un documento", () => {
    const faltas = faltasDelDesplazamiento(completo, {
      nombre: "Alguien", dni: "00000001", dniProvisional: true,
    });
    assert.deepEqual(faltas, ["el número de DNI"]);
  });

  it("el monto cero no es un monto gastado", () => {
    assert.deepEqual(faltasDelDesplazamiento(d("1", "2026-08-10", "m", "d", 0), wilmer),
      ["el monto gastado"]);
  });
});

// El corazón del modelo: se cae la fila, no la planilla.
describe("una fila mala no tumba la planilla", () => {
  const planilla = [
    d("1", "2026-08-10", "VISITA TÉCNICA", "OFICINA - OBRA", 10.00),
    d("2", "2026-08-10", "VISITA TÉCNICA", "OBRA - OFICINA", 10.90),
    d("3", "2026-08-11", null, "OBRA - DOMICILIO", 15.00),   // sin motivo
  ];

  it("sustenta lo bueno y aparta lo malo, en vez de rechazarlo todo", () => {
    const r = revisarPlanilla(planilla, wilmer);
    assert.equal(r.total, 35.90);        // salió plata igual
    assert.equal(r.sustentado, 20.90);   // esto se puede deducir
    assert.equal(r.enRiesgo, 15.00);     // esto no, hasta que le pongan motivo
    assert.equal(r.sinSustentar, 1);
  });

  it("cada fila dice lo suyo", () => {
    const r = revisarPlanilla(planilla, wilmer);
    assert.deepEqual(r.filas.map(f => f.sustenta), [true, true, false]);
    assert.deepEqual(r.filas[2].faltas, ["el motivo del desplazamiento"]);
  });

  it("si al trabajador le falta el DNI, se caen todas: el dato es de la persona", () => {
    const r = revisarPlanilla(planilla, { nombre: "Wilmer", dni: null });
    assert.equal(r.sustentado, 0);
    assert.equal(r.sinSustentar, 3);
    assert.equal(r.total, 35.90, "pero la plata salió igual");
  });

  it("una planilla vacía no es un error, es una planilla recién abierta", () => {
    const r = revisarPlanilla([], wilmer);
    assert.deepEqual(r.filas, []);
    assert.equal(r.total, 0);
  });
});

describe("el tope es por día, no por planilla", () => {
  const mes = [
    d("1", "2026-08-10", "m", "d", 18.00),
    d("2", "2026-08-10", "m", "d", 12.00),   // el día 10 suma 30.00
    d("3", "2026-08-11", "m", "d", 15.00),
  ];

  it("suma por día, que es como la ley mide", () => {
    const m = porDia(mes);
    assert.equal(m.get("2026-08-10"), 30);
    assert.equal(m.get("2026-08-11"), 15);
  });

  it("una planilla de S/ 45 no se pasa de un tope de 25 si ningún día lo pasa", () => {
    assert.deepEqual(diasExcedidos([mes[2]], 25), []);
  });

  it("nombra el día que se pasó y por cuánto", () => {
    assert.deepEqual(diasExcedidos(mes, 25), [
      { fecha: "2026-08-10", gastado: 30, exceso: 5 },
    ]);
  });

  // El porcentaje de la RMV lo debe confirmar Contabilidad. Mientras no esté,
  // inventar un tope sería peor que no comprobarlo.
  it("con el tope sin definir no se inventa un número", () => {
    assert.deepEqual(diasExcedidos(mes, null), []);
  });

  it("un desplazamiento sin fecha no cuenta para ningún día", () => {
    assert.equal(porDia([d("x", null, "m", "d", 99)]).size, 0);
  });
});
