import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aQuienPreguntar, situacionDeApertura, type Autorizacion, type PersonaBloqueada,
} from "../autorizacion.ts";

const persona = (usuarioId: string, nombre: string, jefeId: string | null): PersonaBloqueada =>
  ({ usuarioId, nombre, jefeId });

const solicitud = (
  jefeId: string, jefeNombre: string,
  estado: Autorizacion["estado"], respuesta: string | null = null, monto = 800
): Autorizacion => ({ id: "a-" + jefeId, jefeId, jefeNombre, estado, respuesta, monto });

// ════════════════════════════════════════════════════════════════

describe("aQuienPreguntar", () => {
  test("una sola pregunta por jefe, aunque sean varias personas", () => {
    // Tres técnicos del mismo líder no son tres solicitudes: es una.
    const r = aQuienPreguntar([
      persona("u1", "Justo", "j1"),
      persona("u2", "Pedro", "j1"),
      persona("u3", "Luis", "j1"),
    ]);
    assert.deepEqual(r.jefes, ["j1"]);
    assert.deepEqual(r.sinJefe, []);
  });

  test("dos jefes distintos son dos preguntas", () => {
    const r = aQuienPreguntar([
      persona("u1", "Justo", "j1"),
      persona("u2", "Ana", "j2"),
    ]);
    assert.deepEqual(r.jefes.sort(), ["j1", "j2"]);
  });

  test("quien no tiene jefatura registrada sale aparte, no se le inventa uno", () => {
    // Mandarle la solicitud a cualquiera con el rol sería una firma falsa.
    const r = aQuienPreguntar([persona("u1", "Justo", null)]);
    assert.deepEqual(r.jefes, []);
    assert.equal(r.sinJefe.length, 1);
    assert.equal(r.sinJefe[0].nombre, "Justo");
  });

  test("nadie se autoriza a sí mismo", () => {
    // Si el que debe la rendición es el propio jefe, la decisión sube un
    // nivel: acá no hay a quién preguntarle.
    const r = aQuienPreguntar([persona("j1", "Camila", "j1")]);
    assert.deepEqual(r.jefes, []);
    assert.equal(r.sinJefe.length, 1);
  });

  test("mezcla: se pregunta a quien se puede y se reporta al resto", () => {
    const r = aQuienPreguntar([
      persona("u1", "Justo", "j1"),
      persona("u2", "Suelto", null),
    ]);
    assert.deepEqual(r.jefes, ["j1"]);
    assert.equal(r.sinJefe.length, 1);
  });

  test("sin nadie bloqueado no hay nada que preguntar", () => {
    const r = aQuienPreguntar([]);
    assert.deepEqual(r.jefes, []);
    assert.deepEqual(r.sinJefe, []);
  });
});

describe("situacionDeApertura", () => {
  test("sin solicitudes se abre normal", () => {
    assert.equal(situacionDeApertura([]).puedeAbrir, true);
  });

  test("todas concedidas: se abre", () => {
    const r = situacionDeApertura([
      solicitud("j1", "Camila", "CONCEDIDA"),
      solicitud("j2", "Alonzo", "CONCEDIDA"),
    ]);
    assert.equal(r.puedeAbrir, true);
    assert.equal(r.motivo, "");
  });

  test("una pendiente frena y dice a quién se espera", () => {
    const r = situacionDeApertura([solicitud("j1", "Camila García", "PENDIENTE")]);
    assert.equal(r.puedeAbrir, false);
    assert.match(r.motivo, /Camila García/);
  });

  test("un solo rechazo alcanza, aunque otro haya concedido", () => {
    // No es una votación: el memo lleva un monto y un centro de costo
    // únicos, así que no puede abrirse a medias.
    const r = situacionDeApertura([
      solicitud("j1", "Camila", "CONCEDIDA"),
      solicitud("j2", "Alonzo", "RECHAZADA"),
    ]);
    assert.equal(r.puedeAbrir, false);
    assert.match(r.motivo, /Alonzo/);
  });

  test("el rechazo lleva el motivo del jefe cuando lo dio", () => {
    const r = situacionDeApertura([
      solicitud("j1", "Camila", "RECHAZADA", "Que cierre Piura primero"),
    ]);
    assert.match(r.motivo, /Que cierre Piura primero/);
  });

  test("el rechazo se explica igual sin motivo escrito", () => {
    const r = situacionDeApertura([solicitud("j1", "Camila", "RECHAZADA")]);
    assert.match(r.motivo, /Camila rechazó la apertura\./);
  });

  test("el visto bueno no sirve si después le cambiaron el monto", () => {
    // Si no, la solicitud sería una constancia y no un control: se pide
    // por S/ 800, se concede, y se abre por S/ 5000.
    const r = situacionDeApertura([solicitud("j1", "Camila", "CONCEDIDA", null, 800)], 5000);
    assert.equal(r.puedeAbrir, false);
    assert.match(r.motivo, /800\.00/);
    assert.match(r.motivo, /5000\.00/);
  });

  test("el mismo monto sí abre", () => {
    const r = situacionDeApertura([solicitud("j1", "Camila", "CONCEDIDA", null, 800)], 800);
    assert.equal(r.puedeAbrir, true);
  });

  test("los céntimos no inventan una diferencia", () => {
    const r = situacionDeApertura([solicitud("j1", "Camila", "CONCEDIDA", null, 0.1 + 0.2)], 0.3);
    assert.equal(r.puedeAbrir, true);
  });

  test("el rechazo pesa más que lo que sigue pendiente", () => {
    const r = situacionDeApertura([
      solicitud("j1", "Camila", "PENDIENTE"),
      solicitud("j2", "Alonzo", "RECHAZADA"),
    ]);
    assert.match(r.motivo, /rechazó/);
  });
});
