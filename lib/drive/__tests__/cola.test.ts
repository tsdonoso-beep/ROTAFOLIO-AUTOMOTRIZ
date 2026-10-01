import { test } from "node:test";
import assert from "node:assert/strict";
import { Semaforo, procesarCola } from "../cola.ts";

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

test("el semáforo nunca deja pasar más de la cuenta, y todos terminan", async () => {
  const s = new Semaforo(3);
  let dentro = 0, maximo = 0;
  const hechos = await Promise.all(Array.from({ length: 20 }, (_, i) => s.usar(async () => {
    dentro++; maximo = Math.max(maximo, dentro);
    await esperar(5 + (i % 3));
    dentro--;
    return i;
  })));
  assert.equal(maximo, 3);
  assert.deepEqual(hechos, Array.from({ length: 20 }, (_, i) => i));
});

test("un error dentro del semáforo libera el lugar", async () => {
  const s = new Semaforo(1);
  await assert.rejects(s.usar(async () => { throw new Error("x"); }));
  assert.equal(await s.usar(async () => 7), 7);
});

test("la cola crece mientras se trabaja y no espera por niveles", async () => {
  // Un árbol: 1 → 2,3 · 2 → 4,5 · 3 → 6 (lento) · 4 → 7
  const hijos: Record<number, number[]> = { 1: [2, 3], 2: [4, 5], 3: [6], 4: [7] };
  const orden: number[] = [];
  let activos = 0, maximo = 0;
  await procesarCola<number>({
    inicial: [1], trabajadores: () => 2,
    fn: async ([n]) => {
      activos++; maximo = Math.max(maximo, activos);
      await esperar(n === 3 ? 40 : 5);
      orden.push(n);
      activos--;
      return hijos[n] ?? [];
    },
    alFallar: () => {},
  });
  assert.deepEqual([...orden].sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(maximo, 2);
  // Sin niveles: el 7 (nieto del 2) termina antes que el 3, que es lento.
  assert.ok(orden.indexOf(7) < orden.indexOf(3));
});

test("lotes, y lo que falla vuelve a la cola de a uno", async () => {
  const vistos: number[][] = [];
  let tomar = 3;
  await procesarCola<number>({
    inicial: [1, 2, 3, 4, 5], trabajadores: () => 1, tomar: () => tomar,
    fn: async lote => {
      vistos.push(lote);
      if (lote.length > 1) throw new Error("de a uno");
      return [];
    },
    alFallar: lote => { tomar = 1; return lote; },
  });
  assert.deepEqual(vistos[0], [1, 2, 3]);
  assert.deepEqual(vistos.filter(l => l.length === 1).map(l => l[0]).sort(), [1, 2, 3, 4, 5]);
});
