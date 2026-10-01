import { test } from "node:test";
import assert from "node:assert/strict";
import { compararFotos, type FotoOC, type FotoArchivo } from "../cambios-carpetas.ts";

const oc = (n: string, leFalta = "", nombre = `OC 2026 - ${n} LUCY`): FotoOC =>
  ({ oc: `${n}-2026`, carpetaUrl: `c${n}`, carpetaNombre: nombre, proveedor: "LUCY", leFalta, estado: leFalta ? "INCOMPLETA" : "OK" });
const ar = (n: string, url: string, nombre: string, modificado = "2026-03-01T00:00:00Z"): FotoArchivo =>
  ({ oc: `${n}-2026`, carpetaUrl: `c${n}`, url, nombre, modificado });

test("sin cambios, no hay nada que contar", () => {
  const foto = { ocs: [oc("0200")], archivos: [ar("0200", "u1", "F001-1.pdf")] };
  assert.deepEqual(compararFotos(foto, foto), []);
});

test("OC nuevas, que ya no están y renombradas", () => {
  const c = compararFotos(
    { ocs: [oc("0200"), oc("0201")], archivos: [] },
    { ocs: [oc("0200", "", "OC 2026 - 0200 COMERCIALIZADORA LUCY"), oc("0202", "Guía")], archivos: [] },
  );
  assert.deepEqual(c.map(x => [x.oc, x.tipo]), [
    ["0200-2026", "OC RENOMBRADA"], ["0201-2026", "OC YA NO ESTÁ"], ["0202-2026", "OC NUEVA"],
  ]);
  assert.match(c[2].detalle, /le falta: Guía/);
});

test("archivos nuevos, eliminados, modificados y renombrados", () => {
  const c = compararFotos(
    { ocs: [oc("0200")], archivos: [ar("0200", "u1", "scan.pdf"), ar("0200", "u2", "guia.pdf"), ar("0200", "u3", "oc.pdf")] },
    { ocs: [oc("0200")], archivos: [ar("0200", "u1", "FACTURA F001-1.pdf"), ar("0200", "u3", "oc.pdf", "2026-04-01T00:00:00Z"), ar("0200", "u4", "acta.pdf")] },
  );
  assert.deepEqual(c.map(x => [x.tipo, x.detalle]).sort(), [
    ["ARCHIVO ELIMINADO", "guia.pdf"],
    ["ARCHIVO MODIFICADO", "oc.pdf"],
    ["ARCHIVO NUEVO", "acta.pdf"],
    ["ARCHIVO RENOMBRADO", "«scan.pdf» → «FACTURA F001-1.pdf»"],
  ]);
});

test("lo que llegó y lo que ahora falta", () => {
  const c = compararFotos(
    { ocs: [oc("0200", "Factura, Guía"), oc("0201", "Guía"), oc("0202")], archivos: [] },
    { ocs: [oc("0200", "Guía"), oc("0201"), oc("0202", "Factura")], archivos: [] },
  );
  assert.deepEqual(c.map(x => [x.oc, x.tipo, x.detalle]), [
    ["0200-2026", "COMPLETÓ", "llegó: Factura — aún falta: Guía"],
    ["0201-2026", "LEGAJO COMPLETO", "llegó: Guía"],
    ["0202-2026", "AHORA LE FALTA", "Factura (antes estaba)"],
  ]);
});

test("los archivos de una OC nueva no se cuentan uno por uno", () => {
  const c = compararFotos({ ocs: [], archivos: [] }, { ocs: [oc("0300")], archivos: [ar("0300", "u9", "F001-9.pdf")] });
  assert.deepEqual(c.map(x => x.tipo), ["OC NUEVA"]);
});
