import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { textoBarra, duracion } from "../comun/barra.mts";

const base = { hechos: 0, total: 100, ok: 0, consultados: 0, enEspera: 0, enVuelo: 0, subidas: 0, inicio: 0 };

describe("duracion", () => {
  test("segundos, minutos, horas", () => {
    assert.equal(duracion(9_000), "9s");
    assert.equal(duracion(125_000), "2m05s");
    assert.equal(duracion(3_725_000), "1h02m");
    assert.equal(duracion(NaN), "?");
  });
});

describe("textoBarra", () => {
  test("al empezar: 0% y ETA desconocida", () => {
    const t = textoBarra(base, 200, 1000);
    assert.match(t, /^\[░+\]\s+0% 0\/100 guardados/);
    assert.match(t, /ETA \?/);
  });
  test("a la mitad en 5 min: 10/min y ETA 5 min", () => {
    const t = textoBarra({ ...base, hechos: 50, ok: 48, consultados: 80, subidas: 30, enEspera: 3 }, 220, 300_000);
    assert.match(t, / 50% 50\/100 guardados · SUNAT 80\/100 · 30 en PDF\/Drive · 3 por reintentar · 10\/min · ETA 5m00s · 5m00s$/);
    assert.equal((t.match(/█/g) ?? []).length, (t.match(/░/g) ?? []).length);
  });
  test("SUNAT terminado pero Drive no: lo dice, y la barra NO marca 100%", () => {
    assert.match(textoBarra({ ...base, hechos: 20, consultados: 100, subidas: 80 }, 220, 60_000), /20% 20\/100 guardados · SUNAT listo · 80 en PDF\/Drive/);
  });
  test("nunca más ancha que la terminal", () => {
    assert.ok(textoBarra({ ...base, hechos: 1 }, 40, 60_000).length <= 39);
  });
  test("completa: 100% sin pasarse", () => {
    assert.match(textoBarra({ ...base, hechos: 120, consultados: 120 }, 200, 60_000), /^\[█+\] 100%/);
  });
});
