import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aSerieDeFecha, aNumeroDeCelda, aCeldas, aTabla, columnasDeFecha,
} from "../celdas.ts";
import type { TipoColumna } from "../../export/comprobantes-sunat.ts";

test("la fecha se cuenta desde el 30/12/1899, como toda hoja de cálculo", () => {
  assert.equal(aSerieDeFecha("31/12/1899"), 1);
  assert.equal(aSerieDeFecha("01/01/1900"), 2);
  // Excel cree que 1900 fue bisiesto; Sheets lo arrastra. 01/03/1900 = 61.
  assert.equal(aSerieDeFecha("01/01/2000"), 36526);
});

test("el caso que la hoja venía interpretando al revés", () => {
  // 11 de diciembre y 12 de noviembre son días distintos, y en una hoja en
  // inglés «11/12/2025» se leía como el segundo.
  const once = aSerieDeFecha("11/12/2025");
  const doce = aSerieDeFecha("12/11/2025");
  assert.notEqual(once, doce);
  assert.equal(once! - doce!, 29);
});

test("dos fechas seguidas están a un día de distancia", () => {
  assert.equal(aSerieDeFecha("29/02/2024")! - aSerieDeFecha("28/02/2024")!, 1);
  assert.equal(aSerieDeFecha("01/03/2024")! - aSerieDeFecha("29/02/2024")!, 1);
  assert.equal(aSerieDeFecha("01/01/2026")! - aSerieDeFecha("31/12/2025")!, 1);
});

test("lo que no es una fecha no se convierte en una", () => {
  assert.equal(aSerieDeFecha("29/02/2025"), null); // 2025 no es bisiesto
  assert.equal(aSerieDeFecha("31/04/2025"), null); // abril tiene 30
  assert.equal(aSerieDeFecha("00/01/2025"), null);
  assert.equal(aSerieDeFecha("13/13/2025"), null);
  assert.equal(aSerieDeFecha("2025-12-11"), null);
  assert.equal(aSerieDeFecha(""), null);
  assert.equal(aSerieDeFecha("pendiente"), null);
});

test("vacío no es cero", () => {
  assert.equal(aNumeroDeCelda(""), null);
  assert.equal(aNumeroDeCelda("   "), null);
  assert.equal(aNumeroDeCelda("0"), 0);
  assert.equal(aNumeroDeCelda("-40.00"), -40);
  assert.equal(aNumeroDeCelda("3.368"), 3.368);
  assert.equal(aNumeroDeCelda("S/ 120"), null);
});

const TIPOS: TipoColumna[] = ["texto", "texto", "fecha", "numero"];

test("los identificadores se quedan como texto y no pierden los ceros", () => {
  const [periodo, serie] = aCeldas(["202601", "0001", "", ""], TIPOS);
  assert.equal(periodo, "202601");
  assert.equal(serie, "0001");
  assert.equal(typeof serie, "string");
});

test("los importes van como números para que la columna se sume", () => {
  const fila = aCeldas(["202601", "F001", "11/12/2025", "35216.18"], TIPOS);
  assert.equal(fila[3], 35216.18);
  assert.equal(typeof fila[2], "number");
});

test("un valor que no calza con su tipo se deja ver, no se fuerza", () => {
  const fila = aCeldas(["202601", "F001", "sin fecha", "—"], TIPOS);
  assert.equal(fila[2], "sin fecha");
  assert.equal(fila[3], "—");
});

test("un texto que empieza por = no se vuelve fórmula", () => {
  assert.equal(aCeldas(["=1+1", "", "", ""], TIPOS)[0], "'=1+1");
  // Pero un importe negativo sigue siendo un número que se suma.
  assert.equal(aCeldas(["", "", "", "-40.00"], TIPOS)[3], -40);
});

test("la cabecera no se convierte", () => {
  const tabla = aTabla([["Período", "Serie", "Fecha", "Total"], ["202601", "F001", "11/12/2025", "10"]], TIPOS);
  assert.deepEqual(tabla[0], ["Período", "Serie", "Fecha", "Total"]);
  assert.equal(typeof tabla[1][2], "number");
});

test("se sabe qué columnas hay que formatear como fecha", () => {
  assert.deepEqual(columnasDeFecha(TIPOS), [2]);
  assert.deepEqual(columnasDeFecha(["fecha", "numero", "fecha"]), [0, 2]);
});
