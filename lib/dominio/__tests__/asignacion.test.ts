import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { asignarPorFecha, explicar, memoDe, type MemoCandidato } from "../asignacion.ts";
import type { EstadoMemo } from "../tipos.ts";

function memo(
  correlativo: string,
  salida: string | null,
  retorno: string | null,
  estado: EstadoMemo = "ABIERTO"
): MemoCandidato {
  return { id: correlativo, correlativo, destino: null, fecha_salida: salida, fecha_retorno_prev: retorno, estado };
}

// El viaje de cuatro tramos que describió Administración: un solo viaje,
// cuatro memos, y cada comprobante tiene que caer en el que le toca.
const PIURA        = memo("M-PIURA",  "2026-09-01", "2026-09-02");
const CHACHAPOYAS  = memo("M-CHACHA", "2026-09-04", "2026-09-08");
const PAITA        = memo("M-PAITA",  "2026-09-08", "2026-09-12");
const LAMBAYEQUE   = memo("M-LAMBA",  "2026-09-14", "2026-09-16");

describe("un viaje partido en tramos", () => {
  const tramos = [PIURA, CHACHAPOYAS, PAITA, LAMBAYEQUE];

  test("cada comprobante cae en su tramo sin preguntar", () => {
    const casos: Array<[string, string]> = [
      ["2026-09-01", "M-PIURA"],
      ["2026-09-05", "M-CHACHA"],
      ["2026-09-11", "M-PAITA"],
      ["2026-09-15", "M-LAMBA"],
    ];
    for (const [fecha, esperado] of casos) {
      const r = asignarPorFecha(fecha, tramos);
      assert.equal(r.tipo, "exacta", `${fecha} debería resolverse solo`);
      assert.equal(memoDe(r)?.correlativo, esperado);
    }
  });

  test("el día en que dos tramos se tocan queda a decisión de la persona", () => {
    // El 8 es retorno de Chachapoyas y salida de Paita. Adivinar movería
    // plata de un centro de costo a otro.
    const r = asignarPorFecha("2026-09-08", tramos);
    assert.equal(r.tipo, "ambigua");
    if (r.tipo === "ambigua") {
      assert.equal(r.memos.length, 2);
      assert.deepEqual(r.memos.map(m => m.correlativo).sort(), ["M-CHACHA", "M-PAITA"]);
    }
    assert.equal(memoDe(r), null, "una ambigüedad no elige por su cuenta");
  });

  test("un hueco equidistante entre dos tramos no se resuelve solo", () => {
    // El 13 está a un día de Paita, que terminó el 12, y a un día de
    // Lambayeque, que empieza el 14. No hay razón para preferir uno.
    const r = asignarPorFecha("2026-09-13", tramos);
    assert.equal(r.tipo, "ambigua");
    if (r.tipo === "ambigua") {
      assert.deepEqual(r.memos.map(m => m.correlativo).sort(), ["M-LAMBA", "M-PAITA"]);
    }
  });

  test("un hueco con un tramo claramente más cerca sí se propone", () => {
    // El 3 está a un día de Piura (terminó el 2) y a uno de Chachapoyas
    // (empieza el 4)… también empata. Se usa un caso sin empate: quitando
    // Chachapoyas, el 3 queda a un día solo de Piura.
    const r = asignarPorFecha("2026-09-03", [PIURA, PAITA, LAMBAYEQUE]);
    assert.equal(r.tipo, "aproximada");
    if (r.tipo === "aproximada") {
      assert.equal(r.memo.correlativo, "M-PIURA");
      assert.equal(r.dias, 1);
    }
  });

  test("una fecha lejana a todo no se fuerza a ningún memo", () => {
    const r = asignarPorFecha("2026-06-15", tramos);
    assert.equal(r.tipo, "ninguna");
    assert.equal(memoDe(r), null);
  });
});

describe("holgura alrededor del viaje", () => {
  const solo = [memo("M-1", "2026-09-10", "2026-09-12")];

  test("la cena de la noche anterior entra", () => {
    const r = asignarPorFecha("2026-09-09", solo);
    assert.equal(r.tipo, "aproximada");
    if (r.tipo === "aproximada") assert.equal(r.dias, 1);
  });

  test("el taxi del día siguiente al retorno entra", () => {
    const r = asignarPorFecha("2026-09-13", solo);
    assert.equal(r.tipo, "aproximada");
  });

  test("a dos días todavía entra", () => {
    assert.equal(asignarPorFecha("2026-09-14", solo).tipo, "aproximada");
  });

  test("a tres días ya no: eso es otro viaje", () => {
    assert.equal(asignarPorFecha("2026-09-15", solo).tipo, "ninguna");
  });
});

describe("qué memos se consideran", () => {
  test("un memo ya presentado no recibe comprobantes nuevos", () => {
    // Está congelado: meterle un gasto rompería lo que el revisor ya vio.
    const presentado = memo("M-P", "2026-09-01", "2026-09-05", "PRESENTADA");
    const r = asignarPorFecha("2026-09-03", [presentado]);
    assert.equal(r.tipo, "ninguna");
    assert.match(r.tipo === "ninguna" ? r.motivo : "", /presentad/i);
  });

  test("un memo observado sí, porque vuelve a estar editable", () => {
    const observado = memo("M-O", "2026-09-01", "2026-09-05", "OBSERVADA");
    const r = asignarPorFecha("2026-09-03", [observado]);
    assert.equal(r.tipo, "exacta");
  });

  test("uno presentado y otro abierto: gana el abierto, sin ambigüedad", () => {
    const r = asignarPorFecha("2026-09-03", [
      memo("M-VIEJO", "2026-09-01", "2026-09-05", "PRESENTADA"),
      memo("M-VIVO", "2026-09-01", "2026-09-05", "ABIERTO"),
    ]);
    assert.equal(r.tipo, "exacta");
    assert.equal(memoDe(r)?.correlativo, "M-VIVO");
  });

  test("sin ningún memo, se dice claramente", () => {
    const r = asignarPorFecha("2026-09-03", []);
    assert.equal(r.tipo, "ninguna");
    assert.match(r.tipo === "ninguna" ? r.motivo : "", /no tienes memos/i);
  });
});

describe("memos sin fechas declaradas", () => {
  test("si es el único abierto, se propone", () => {
    const r = asignarPorFecha("2026-09-03", [memo("M-SF", null, null)]);
    assert.equal(r.tipo, "aproximada");
    if (r.tipo === "aproximada") assert.equal(r.dias, 0);
  });

  test("si hay varios sin fechas, elige la persona", () => {
    const r = asignarPorFecha("2026-09-03", [memo("A", null, null), memo("B", null, null)]);
    assert.equal(r.tipo, "ambigua");
  });

  test("uno con fechas que calza le gana a uno sin fechas", () => {
    const r = asignarPorFecha("2026-09-03", [
      memo("CON", "2026-09-01", "2026-09-05"),
      memo("SIN", null, null),
    ]);
    assert.equal(r.tipo, "exacta");
    assert.equal(memoDe(r)?.correlativo, "CON");
  });
});

describe("fechas inválidas", () => {
  test("sin fecha no se asigna nada", () => {
    const r = asignarPorFecha("", [PIURA]);
    assert.equal(r.tipo, "ninguna");
    assert.match(r.tipo === "ninguna" ? r.motivo : "", /fecha/i);
  });

  test("una fecha con basura tampoco", () => {
    assert.equal(asignarPorFecha("no-es-fecha", [PIURA]).tipo, "ninguna");
  });
});

describe("explicar", () => {
  test("cada caso dice por qué, no solo qué", () => {
    assert.match(explicar(asignarPorFecha("2026-09-05", [CHACHAPOYAS])), /M-CHACHA/);
    assert.match(explicar(asignarPorFecha("2026-09-08", [CHACHAPOYAS, PAITA])), /2 memos/);
    assert.match(explicar(asignarPorFecha("2026-09-13", [LAMBAYEQUE])), /1 día/);
    assert.match(explicar(asignarPorFecha("2026-01-01", [PIURA])), /sin asignar/i);
  });
});
