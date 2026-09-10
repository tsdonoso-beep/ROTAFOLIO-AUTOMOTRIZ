import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRANSICIONES_MEMO } from "../estados.ts";

// La tabla de transiciones vive dos veces: acá en TypeScript, para que la
// interfaz sepa qué botones mostrar, y en SQL, porque la base es la que de
// verdad autoriza. Dos copias de la misma verdad se separan solas; esto es
// lo que lo impide.
//
// Se lee la migración en vez de consultar la base: una prueba que necesita
// credenciales no se corre, y una que no se corre no protege nada.

const MIGRACION = new URL(
  "../../../db/migrations/011_transiciones_de_memo_por_rol.sql", import.meta.url
);

function transicionesDelSql(): Map<string, string[]> {
  const sql = readFileSync(MIGRACION, "utf8");
  const bloque = sql.slice(
    sql.indexOf("insert into transiciones_memo"),
    sql.indexOf(";", sql.indexOf("insert into transiciones_memo"))
  );

  const fila = /\(\s*'([A-Z_]+)',\s*'([A-Z_]+)',\s*'\{([A-Z_,]+)\}'\s*\)/g;
  const mapa = new Map<string, string[]>();
  for (const m of bloque.matchAll(fila)) {
    mapa.set(`${m[1]}→${m[2]}`, m[3].split(",").map(r => r.trim()).sort());
  }
  return mapa;
}

describe("la tabla de transiciones no se separa de la de la base", () => {
  const sql = transicionesDelSql();

  // Si esto falla, la expresión regular dejó de encontrar el bloque —no que
  // la migración esté vacía—. Sin esto, la prueba pasaría comparando nada
  // contra nada.
  test("la migración se pudo leer", () => {
    assert.ok(sql.size >= 8, `solo se leyeron ${sql.size} transiciones del SQL`);
  });

  const conRoles = TRANSICIONES_MEMO.filter(t => !t.automatica);

  test("son exactamente las mismas transiciones", () => {
    const enTs = conRoles.map(t => `${t.desde}→${t.hacia}`).sort();
    assert.deepEqual([...sql.keys()].sort(), enTs);
  });

  for (const t of conRoles) {
    test(`${t.desde} → ${t.hacia}: los mismos roles`, () => {
      assert.deepEqual(sql.get(`${t.desde}→${t.hacia}`), [...t.roles].sort());
    });
  }

  test("las automáticas no están en el SQL: no las pide una persona", () => {
    for (const t of TRANSICIONES_MEMO.filter(x => x.automatica)) {
      assert.equal(sql.has(`${t.desde}→${t.hacia}`), false, `${t.desde}→${t.hacia}`);
    }
  });
});
