import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { consolidar, leerMigraciones } from "../consolidar-db.mts";

function carpeta(archivos: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "migr-"));
  for (const [n, s] of Object.entries(archivos)) writeFileSync(join(d, n), s);
  return d;
}

describe("consolidar-db", () => {
  test("en orden numérico y con cada migración marcada", () => {
    const d = carpeta({ "002_b.sql": "select 2;", "001_a.sql": "﻿select 1;\n\n", "notas.txt": "x" });
    const sql = consolidar(leerMigraciones(d));
    assert.ok(sql.indexOf("001_a.sql") < sql.indexOf("002_b.sql"));
    assert.ok(sql.indexOf("select 1;") < sql.indexOf("select 2;"));
    assert.match(sql, /2 migraciones: 001_a\.sql → 002_b\.sql/);
    assert.ok(!sql.includes("﻿"));
  });
  test("se niega si falta una migración en el medio", () => {
    const d = carpeta({ "001_a.sql": "", "003_c.sql": "" });
    assert.throws(() => leerMigraciones(d), /falta la migración 002/);
  });
  test("la huella cambia si cambia cualquier migración", () => {
    const a = consolidar([{ nombre: "001_a.sql", sql: "select 1;" }]);
    const b = consolidar([{ nombre: "001_a.sql", sql: "select 2;" }]);
    assert.notEqual(a.match(/huella: (\w+)/)?.[1], b.match(/huella: (\w+)/)?.[1]);
  });
});
