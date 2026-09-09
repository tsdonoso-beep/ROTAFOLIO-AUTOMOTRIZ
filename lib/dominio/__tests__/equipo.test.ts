import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { consolidarEquipo, diasDeAtraso, resumirEquipo, type MemoDeEquipo } from "../equipo.ts";
import type { EstadoMemo } from "../tipos.ts";

const HOY = new Date("2026-09-20T12:00:00Z");

function memo(p: {
  id: string;
  autorizado: number;
  retorno: string | null;
  personas: Array<[string, string]>;
  rendido?: number;
  estado?: EstadoMemo;
}): MemoDeEquipo {
  return {
    id: p.id,
    correlativo: p.id,
    estado: p.estado ?? "EN_RENDICION",
    monto_autorizado: p.autorizado,
    fecha_retorno_prev: p.retorno,
    personas: p.personas.map(([id, nombre]) => ({ id, nombre })),
    gastos: p.rendido
      ? [{ estado: "VALIDADO", clase: "COMPROBANTE", total: p.rendido, alertas: [] }]
      : [],
  };
}

// ════════════════════════════════════════════════════════════════

describe("diasDeAtraso", () => {
  test("cuenta desde la fecha de retorno", () => {
    assert.equal(diasDeAtraso("2026-09-15", HOY), 5);
  });

  test("un memo que aún no vence no está atrasado", () => {
    assert.equal(diasDeAtraso("2026-09-25", HOY), 0);
  });

  test("el día del retorno todavía no cuenta como atraso", () => {
    assert.equal(diasDeAtraso("2026-09-20", HOY), 0);
  });

  test("sin fecha de retorno no hay atraso que calcular", () => {
    assert.equal(diasDeAtraso(null, HOY), 0);
  });

  test("una fecha con basura no rompe el cálculo", () => {
    assert.equal(diasDeAtraso("no-es-fecha", HOY), 0);
  });
});

describe("consolidarEquipo", () => {
  test("agrupa por persona, no por memo", () => {
    // Justo tiene dos memos abiertos: para su líder es una sola fila.
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-18", personas: [["u1", "Justo"]] }),
      memo({ id: "B", autorizado: 300, retorno: "2026-09-19", personas: [["u1", "Justo"]] }),
    ], HOY);

    assert.equal(filas.length, 1);
    assert.equal(filas[0].nombre, "Justo");
    assert.equal(filas[0].memos, 2);
    assert.equal(filas[0].sinRendir, 800);
  });

  test("un memo grupal aparece en la fila de cada persona", () => {
    // El memo de hospedaje cubre a los cuatro que viajan juntos.
    const filas = consolidarEquipo([
      memo({ id: "H", autorizado: 400, retorno: "2026-09-19", personas: [["u1", "A"], ["u2", "B"]] }),
    ], HOY);

    assert.equal(filas.length, 2);
    for (const f of filas) assert.equal(f.memos, 1);
  });

  test("lo ya rendido deja de contar como deuda", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-18", personas: [["u1", "Justo"]], rendido: 320 }),
    ], HOY);
    assert.equal(filas[0].sinRendir, 180);
  });

  test("gastar de más no se convierte en deuda negativa", () => {
    // Si gastó más de lo autorizado, la empresa le debe a él, no al revés.
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 200, retorno: "2026-09-18", personas: [["u1", "Justo"]], rendido: 350 }),
    ], HOY);
    assert.equal(filas[0].sinRendir, 0);
  });

  test("un memo ya presentado sale del radar del líder", () => {
    // Dejó de ser deuda de la persona: ahora es trabajo del revisor.
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-10", personas: [["u1", "Justo"]], estado: "PRESENTADA" }),
    ], HOY);
    assert.deepEqual(filas, []);
  });

  test("una rendición observada vuelve al radar del líder", () => {
    // Fue devuelta por el revisor: la persona tiene que corregirla y
    // volver a presentarla. Es quien más seguimiento necesita.
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-10", personas: [["u1", "J"]], estado: "OBSERVADA" }),
    ], HOY);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].atrasoDias, 10);
  });

  test("el atraso de una persona es el de su memo más viejo", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 100, retorno: "2026-09-19", personas: [["u1", "Justo"]] }),
      memo({ id: "B", autorizado: 100, retorno: "2026-09-01", personas: [["u1", "Justo"]] }),
    ], HOY);
    assert.equal(filas[0].atrasoDias, 19);
    assert.equal(filas[0].vencidos, 2);
  });

  test("se ordena por quién debe hace más tiempo", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 100, retorno: "2026-09-19", personas: [["u1", "Reciente"]] }),
      memo({ id: "B", autorizado: 100, retorno: "2026-08-20", personas: [["u2", "Antiguo"]] }),
      memo({ id: "C", autorizado: 100, retorno: "2026-09-30", personas: [["u3", "AlDia"]] }),
    ], HOY);
    assert.deepEqual(filas.map(f => f.nombre), ["Antiguo", "Reciente", "AlDia"]);
  });

  test("a igual atraso ordena por monto: a quién llamar primero", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 100, retorno: "2026-09-15", personas: [["u1", "Poco"]] }),
      memo({ id: "B", autorizado: 900, retorno: "2026-09-15", personas: [["u2", "Mucho"]] }),
    ], HOY);
    assert.deepEqual(filas.map(f => f.nombre), ["Mucho", "Poco"]);
  });

  test("sin memos no hay equipo que mostrar", () => {
    assert.deepEqual(consolidarEquipo([], HOY), []);
  });
});

describe("resumirEquipo", () => {
  test("las cifras de cabecera salen de las filas", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-10", personas: [["u1", "Justo"]] }),
      memo({ id: "B", autorizado: 300, retorno: "2026-09-25", personas: [["u2", "Camila"]] }),
    ], HOY);

    const r = resumirEquipo(filas);
    assert.equal(r.personas, 2);
    assert.equal(r.memosAbiertos, 2);
    assert.equal(r.totalSinRendir, 800);
    assert.equal(r.mayorAtraso, 10);
    assert.equal(r.personasVencidas, 1, "solo Justo pasó su fecha de retorno");
  });

  test("un equipo al día no muestra atraso", () => {
    const filas = consolidarEquipo([
      memo({ id: "A", autorizado: 500, retorno: "2026-09-30", personas: [["u1", "Justo"]] }),
    ], HOY);
    const r = resumirEquipo(filas);
    assert.equal(r.mayorAtraso, 0);
    assert.equal(r.personasVencidas, 0);
  });
});
