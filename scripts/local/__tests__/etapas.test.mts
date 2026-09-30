import { test } from "node:test";
import assert from "node:assert/strict";
import { Etapas } from "../comun/etapas.mts";
import type { Bitacora } from "../comun/bitacora.mts";

const logs: string[] = [];
const b: Bitacora = {
  dir: ".",
  corrida: "t",
  log: (_n, _q, m) => {
    logs.push(m);
  },
  jsonl() {},
  http() {},
  conteoHttp: () => ({}),
};

test("las etapas cierran en orden y una sola vez", () => {
  const e = new Etapas(b);
  e.sumar("sunat", "ok", 3);
  e.cerrarSi("drive", true); // SUNAT y PDF no terminaron: no cierra
  assert.equal(e.e.drive.estado, "esperando");
  e.cerrarSi("sunat", true);
  e.cerrarSi("sunat", true); // la segunda vez no vuelve a anotar
  e.cerrarSi("pdf", false); // le queda algo: sigue abierta
  assert.equal(e.e.pdf.estado, "esperando");
  e.cerrarSi("pdf", true);
  e.cerrarSi("drive", true);
  assert.deepEqual(
    [e.e.sunat.estado, e.e.pdf.estado, e.e.drive.estado, e.e.base.estado],
    ["terminada", "terminada", "terminada", "esperando"],
  );
  assert.equal(logs.filter(l => l.includes("SUNAT (API) terminada")).length, 1);
  assert.match(logs[0], /ok 3/);
});

test("omitida cuenta como terminada para la siguiente", () => {
  const e = new Etapas(b);
  for (const k of ["sunat", "pdf", "drive"] as const) e.cerrarSi(k, true);
  e.omitir("base", "prueba");
  e.cerrarSi("hoja", true);
  assert.equal(e.e.hoja.estado, "terminada");
});
