// La tubería con trabajadores falsos: sin SUNAT, sin Drive, sin base.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Tuberia, type Tarea, type Trabajador, type Resultado } from "../comun/tuberia.mts";
import type { Bitacora } from "../comun/bitacora.mts";
import type { Clase, Pendiente } from "../comun/tipos.mts";

const mudo: Bitacora = { dir: ".", corrida: "test", log() {}, jsonl() {}, http() {}, conteoHttp: () => ({}) };
const opciones = (maxIntentos = 3) => ({
  politica: { maxIntentos, esperaCaidoMs: 0, esperaReintentoMs: 0, esperaLimiteMs: 0 },
  subidasEnParalelo: 1,
  pdfEnParalelo: 1,
  loteGuardado: 100,
  umbralCaido: 2,
  pausaCaidoMs: 0,
  watchdogMs: 60_000,
});
const pend = (n: number): Pendiente => ({
  proveedorRuc: "20100",
  proveedorNombre: null,
  tipoComprobante: "01",
  serie: "F001",
  numero: String(n),
  fechaEmision: null,
  periodo: "202608",
});

/** Responde según un guion por número de comprobante; lo que no está en el guion es OK (sin xml, para no subir nada). */
function falso(id: string, guion: Record<string, Clase[]>, vistos: string[]): Trabajador {
  return {
    id,
    estado: "creado",
    desde: Date.now(),
    destrabar() {},
    async procesar(t: Tarea): Promise<Resultado> {
      vistos.push(`${id}:${t.p.numero}`);
      await new Promise(r => setTimeout(r, 1));
      const g = guion[t.p.numero];
      return { clase: g?.length ? g.shift()! : "OK" };
    },
  };
}

describe("Tuberia", () => {
  test("reparte entre varios trabajadores y procesa cada tarea una vez", async () => {
    const t = new Tuberia(mudo, [1, 2, 3, 4, 5, 6].map(pend), opciones());
    const vistos: string[] = [];
    await Promise.all([falso("a", {}, vistos), falso("b", {}, vistos)].map(w => t.correr(w, 0)));
    assert.equal(t.finales.ok, 6);
    assert.equal(vistos.length, 6);
    assert.equal(new Set(vistos.map(v => v.split(":")[1])).size, 6);
    assert.ok(vistos.some(v => v.startsWith("a:")) && vistos.some(v => v.startsWith("b:")));
  });

  test("SUNAT caído se reintenta y termina OK", async () => {
    const t = new Tuberia(mudo, [pend(1)], opciones());
    await t.correr(falso("a", { "1": ["SUNAT_CAIDO", "SUNAT_CAIDO"] }, []), 0);
    assert.equal(t.finales.ok, 1);
    assert.equal(t.porClase.SUNAT_CAIDO, 2);
  });

  test("se rinde tras el máximo de intentos, sin bucle infinito", async () => {
    const t = new Tuberia(mudo, [pend(1)], opciones(3));
    await t.correr(falso("a", { "1": ["TIMEOUT", "TIMEOUT", "TIMEOUT", "TIMEOUT", "TIMEOUT"] }, []), 0);
    assert.equal(t.finales.agotados, 1);
    assert.equal(t.porClase.TIMEOUT, 3);
    assert.equal(t.cola.length, 0);
  });

  test("SESION no gasta intentos", async () => {
    const t = new Tuberia(mudo, [pend(1)], opciones(1));
    await t.correr(falso("a", { "1": ["SESION", "SESION", "OK"] }, []), 0);
    assert.equal(t.finales.ok, 1);
  });

  test("detener corta sin tomar más tareas", async () => {
    const t = new Tuberia(mudo, [1, 2, 3].map(pend), opciones());
    t.detener = true;
    const vistos: string[] = [];
    await t.correr(falso("a", {}, vistos), 0);
    assert.equal(vistos.length, 0);
    assert.equal(t.cola.length, 3);
  });

  test("un trabajador que revienta cuenta como EXCEPCION y la tarea se reintenta", async () => {
    const t = new Tuberia(mudo, [pend(1)], opciones());
    let n = 0;
    const w: Trabajador = {
      id: "x",
      estado: "creado",
      desde: Date.now(),
      destrabar() {},
      async procesar() {
        if (n++ === 0) throw new Error("boom");
        return { clase: "OK" };
      },
    };
    await t.correr(w, 0);
    assert.equal(t.porClase.EXCEPCION, 1);
    assert.equal(t.finales.ok, 1);
  });
});
