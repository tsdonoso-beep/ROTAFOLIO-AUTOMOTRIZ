import { test } from "node:test";
import assert from "node:assert/strict";
import { partirPorAnio } from "../servidor.ts";

const CAB = ["Período", "RUC proveedor", "Total"];

test("2026 a la principal; 2025 aparte, con la cabecera en cada una", () => {
  const { principal, anteriores } = partirPorAnio([CAB, ["202509", "1", "10"], ["202601", "2", "20"], ["202512", "3", "30"], ["202609", "4", "40"]], "202601");
  assert.deepEqual(principal, [CAB, ["202601", "2", "20"], ["202609", "4", "40"]]);
  assert.deepEqual([...anteriores.keys()], ["2025"]);
  assert.deepEqual(anteriores.get("2025"), [CAB, ["202509", "1", "10"], ["202512", "3", "30"]]);
});
test("varios años anteriores, cada uno en su hoja", () => {
  const { anteriores } = partirPorAnio([CAB, ["202412", "1", "1"], ["202501", "2", "2"]], "202601");
  assert.deepEqual([...anteriores.keys()].sort(), ["2024", "2025"]);
});
test("período con guion o vacío: con guion se entiende; vacío va a la principal", () => {
  const { principal, anteriores } = partirPorAnio([CAB, ["2025-10", "1", "1"], ["", "2", "2"]], "202601");
  assert.equal(anteriores.get("2025")?.length, 2);
  assert.deepEqual(principal, [CAB, ["", "2", "2"]]);
});
test("sin columna Período, todo a la principal", () => {
  const filas = [["RUC", "Total"], ["1", "2"]];
  assert.deepEqual(partirPorAnio(filas, "202601").principal, filas);
});
