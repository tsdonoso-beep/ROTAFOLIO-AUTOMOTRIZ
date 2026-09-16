import test from "node:test";
import assert from "node:assert/strict";
import { revisarAnexo, sumar, tramos, type FilaDeAnexo } from "../anexo";

const fila = (
  id: string, nombre: string, monto: number | null,
  desde: string | null = "2026-08-09", hasta: string | null = "2026-08-10"
): FilaDeAnexo => ({ usuarioId: id, nombre, monto, fechaDesde: desde, fechaHasta: hasta });

// El memo 594-2026, tal como está en el Word: once personas, tres tramos.
const memo594: FilaDeAnexo[] = [
  ...Array.from({ length: 4 }, (_, i) =>
    fila(`c${i}`, `Corto ${i}`, 212, "2026-08-09", "2026-08-10")),
  ...Array.from({ length: 6 }, (_, i) =>
    fila(`l${i}`, `Largo ${i}`, 1164, "2026-08-09", "2026-08-19")),
  fila("t1", "Tardío", 1232, "2026-08-10", "2026-08-19"),
];

test("el total del 594-2026 sale del anexo, no de un número tecleado", () => {
  const r = revisarAnexo(memo594);
  assert.equal(r.total, 9064);          // el mismo del párrafo del memo
  assert.deepEqual(r.reparos, []);
});

test("la cabecera abarca a todos: sale el primero, vuelve el último", () => {
  const r = revisarAnexo(memo594);
  assert.equal(r.desde, "2026-08-09");
  assert.equal(r.hasta, "2026-08-19");
});

test("los tres tramos se leen agrupados, como en el papel", () => {
  const t = tramos(memo594).sort((a, b) => a.personas - b.personas);
  assert.deepEqual(t.map(x => [x.personas, x.montoCadaUno]), [
    [1, 1232], [4, 212], [6, 1164],
  ]);
});

test("sin nadie asignado no hay memo", () => {
  assert.ok(revisarAnexo([]).reparos[0].includes("al menos una persona"));
});

test("el monto que falta se nombra con su dueño", () => {
  const r = revisarAnexo([fila("a", "Ana", 212), fila("b", "Beto", null)]);
  assert.ok(r.reparos.some(x => x === "Falta el monto de Beto."));
});

test("dos personas sin monto se listan sin coma antes de la y", () => {
  const r = revisarAnexo([
    fila("a", "Ana", null), fila("b", "Beto", null), fila("c", "Cleo", null),
  ]);
  assert.ok(r.reparos.some(x => x === "Falta el monto de Ana, Beto y Cleo."));
});

test("la misma persona dos veces son dos deudas contra el mismo nombre", () => {
  const r = revisarAnexo([fila("a", "Ana", 212), fila("a", "Ana", 300)]);
  assert.ok(r.reparos.some(x => x.includes("asignada dos veces")));
});

// El 546-2026 trae esto en sus diez filas, y es lo que rechaza el CHECK.
test("volver antes de salir se dice en castellano, no con un error de Postgres", () => {
  const r = revisarAnexo([fila("a", "Ana", 212, "2026-08-10", "2026-08-09")]);
  assert.ok(r.reparos.some(x => x.includes("vuelve antes de salir")));
});

test("un tramo de un solo día es válido: se sale y se vuelve el mismo día", () => {
  const r = revisarAnexo([fila("a", "Ana", 212, "2026-08-09", "2026-08-09")]);
  assert.deepEqual(r.reparos, []);
});

test("sin fechas no hay reparo: el seguimiento tiene memos sin ellas", () => {
  const r = revisarAnexo([fila("a", "Ana", 212, null, null)]);
  assert.deepEqual(r.reparos, []);
  assert.equal(r.desde, null);
});

test("el monto cero no es un monto", () => {
  assert.ok(revisarAnexo([fila("a", "Ana", 0)]).reparos.some(x => x.includes("Falta el monto")));
});

// Con coma flotante, 0.1 + 0.2 da 0.30000000000000004 y el memo no cuadra
// contra su propio anexo por una milésima invisible.
test("la suma es exacta en céntimos", () => {
  assert.equal(sumar([0.1, 0.2]), 0.3);
  assert.equal(sumar([212.55, 1164.45]), 1377);
  assert.equal(sumar([]), 0);
  assert.equal(sumar([null, 212]), 212);
});
