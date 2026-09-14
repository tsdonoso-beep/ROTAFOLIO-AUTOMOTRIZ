import { test } from "node:test";
import assert from "node:assert/strict";
import {
  letraColumna, citarPestana, rangoA1, enBloques, anchoMaximo, elegirPestana,
} from "../rangos.ts";

test("las letras de columna no tienen cifra cero", () => {
  assert.equal(letraColumna(1), "A");
  assert.equal(letraColumna(21), "U");   // las 21 columnas de la hoja SUNAT
  assert.equal(letraColumna(26), "Z");
  assert.equal(letraColumna(27), "AA");  // acá se equivoca la base 26 ingenua
  assert.equal(letraColumna(52), "AZ");
  assert.equal(letraColumna(53), "BA");
});

test("una columna que no existe es un error, no una letra rara", () => {
  assert.throws(() => letraColumna(0));
  assert.throws(() => letraColumna(-3));
  assert.throws(() => letraColumna(1.5));
});

test("el nombre de la pestaña va citado", () => {
  assert.equal(citarPestana("COMPROBANTES SUNAT"), "'COMPROBANTES SUNAT'");
  assert.equal(citarPestana("Bob's"), "'Bob''s'");
});

test("el rango cubre exactamente las filas que se mandan", () => {
  assert.equal(rangoA1("Datos", 1, 3, 21), "'Datos'!A1:U3");
  assert.equal(rangoA1("Datos", 5001, 5000, 21), "'Datos'!A5001:U10000");
});

test("una hoja vacía sigue siendo un rango válido", () => {
  assert.equal(rangoA1("Datos", 1, 0, 0), "'Datos'!A1:A1");
});

test("los bloques dicen en qué fila de la hoja empieza cada uno", () => {
  const filas = Array.from({ length: 12 }, (_, i) => i);
  const bloques = enBloques(filas, 5);

  assert.deepEqual(bloques.map(b => b.desde), [1, 6, 11]);
  assert.deepEqual(bloques.map(b => b.filas.length), [5, 5, 2]);
  // Y no se pierde ni se repite ninguna fila por el camino.
  assert.deepEqual(bloques.flatMap(b => b.filas), filas);
});

test("sin filas no hay nada que mandar", () => {
  assert.deepEqual(enBloques([], 5000), []);
});

test("el ancho lo manda la fila más larga", () => {
  assert.equal(anchoMaximo([["a"], ["a", "b", "c"], ["a", "b"]]), 3);
  assert.equal(anchoMaximo([]), 0);
});

const P = (titulo: string, id: number) => ({ titulo, id, filas: 1000, columnas: 26 });

test("escribe en la pestaña que se llama como el archivo", () => {
  const pestanas = [P("TABLERO SUNAT", 7), P("COMPROBANTES SUNAT", 0)];
  assert.equal(elegirPestana(pestanas, "COMPROBANTES SUNAT").id, 0);
});

test("si la renombraron, escribe en la primera y no en el tablero", () => {
  const pestanas = [P("Datos", 0), P("TABLERO SUNAT", 7)];
  assert.equal(elegirPestana(pestanas, "COMPROBANTES SUNAT").id, 0);
});

test("una hoja sin pestañas es un error y no la pestaña cero", () => {
  assert.throws(() => elegirPestana([], "COMPROBANTES SUNAT"));
});
