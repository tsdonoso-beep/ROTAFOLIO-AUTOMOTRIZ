import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aCsv } from "../csv.ts";
import { filasLiquidacion, nombreArchivoLiquidacion } from "../liquidacion.ts";
import { liquidar, type MemoLiquidable } from "../../dominio/liquidacion.ts";
import type { EstadoMemo } from "../../dominio/tipos.ts";

describe("escapado del CSV", () => {
  test("un importe negativo sigue siendo un número", () => {
    // La protección contra fórmulas de Excel antepone un apóstrofo a lo que
    // empieza por "-". Aplicada a un importe, la columna deja de sumarse, y
    // este documento va a pago.
    assert.equal(aCsv([["-40.00"]]), "-40.00");
    assert.equal(aCsv([["-1234.56"]]), "-1234.56");
    assert.equal(aCsv([["0.00"]]), "0.00");
  });

  test("una fórmula de verdad sí se neutraliza", () => {
    assert.equal(aCsv([["=SUM(A1:A9)"]]), "'=SUM(A1:A9)");
    assert.equal(aCsv([["@import"]]), "'@import");
    assert.equal(aCsv([["+49123456"]]), "'+49123456");
    // Un guion seguido de texto no es un número: se neutraliza. No lleva
    // comillas porque no contiene punto y coma ni comillas propias.
    assert.equal(aCsv([["-cmd|calc"]]), "'-cmd|calc");
    // Y si además trae un punto y coma, se entrecomilla igual.
    assert.equal(aCsv([["-a;b"]]), '"\'-a;b"');
  });

  test("el punto y coma y las comillas no rompen las columnas", () => {
    assert.equal(aCsv([["a;b"]]), '"a;b"');
    assert.equal(aCsv([['dijo "hola"']]), '"dijo ""hola"""');
  });

  test("las filas se separan con retorno de carro, como espera Excel", () => {
    assert.equal(aCsv([["a"], ["b"]]), "a\r\nb");
  });
});

// ════════════════════════════════════════════════════════════════

function memo(id: string, aut: number, rend: number, estado: EstadoMemo): MemoLiquidable {
  return {
    id, correlativo: id, estado, destino: "Piura", fecha_salida: "2026-03-04",
    monto_autorizado: aut,
    gastos: rend ? [{ estado: "APROBADO", clase: "COMPROBANTE", total: rend, alertas: [] }] : [],
  };
}

const CABECERA = {
  nombre: "Justo Lavilla", dni: "78597686",
  emitidoPor: "Rosa Aucca", emitidoEn: "2026-09-09",
};

describe("documento de liquidación", () => {
  test("identifica a la persona y a quién lo emitió", () => {
    const texto = aCsv(filasLiquidacion(CABECERA, liquidar([])));
    assert.match(texto, /Justo Lavilla/);
    assert.match(texto, /78597686/);
    assert.match(texto, /Rosa Aucca/);
  });

  test("el neto dice en qué dirección va la plata", () => {
    const debe = aCsv(filasLiquidacion(CABECERA, liquidar([memo("A", 500, 380, "APROBADA")])));
    assert.match(debe, /NETO;120\.00;A DEVOLVER POR LA PERSONA/);

    const leDeben = aCsv(filasLiquidacion(CABECERA, liquidar([memo("A", 300, 445, "APROBADA")])));
    assert.match(leDeben, /NETO;145\.00;A REEMBOLSAR POR LA EMPRESA/);
  });

  test("los importes negativos del detalle quedan sumables", () => {
    const texto = aCsv(filasLiquidacion(CABECERA, liquidar([memo("A", 300, 445, "APROBADA")])));
    assert.match(texto, /;-145\.00/, "el saldo negativo va sin apóstrofo");
    assert.ok(!texto.includes("'-145"), "no debe quedar como texto");
  });

  test("advierte cuando quedan memos sin cerrar", () => {
    const texto = aCsv(filasLiquidacion(CABECERA, liquidar([
      memo("A", 500, 380, "APROBADA"),
      memo("B", 800, 0, "EN_RENDICION"),
    ])));
    assert.match(texto, /ADVERTENCIA/);
    assert.match(texto, /1 memo\(s\) sin cerrar por 800\.00/);
    assert.match(texto, /parcial/);
  });

  test("sin memos sin cerrar no se advierte nada", () => {
    const texto = aCsv(filasLiquidacion(CABECERA, liquidar([memo("A", 500, 380, "APROBADA")])));
    assert.ok(!texto.includes("ADVERTENCIA"));
  });

  test("cada memo aparece con su situación", () => {
    const texto = aCsv(filasLiquidacion(CABECERA, liquidar([
      memo("CERRADO", 500, 380, "APROBADA"),
      memo("REVISION", 500, 500, "PRESENTADA"),
      memo("ABIERTO", 500, 0, "ABIERTO"),
    ])));
    assert.match(texto, /CERRADO;.*;CERRADO;/);
    assert.match(texto, /REVISION;.*;EN REVISIÓN;/);
    assert.match(texto, /ABIERTO;.*;ABIERTO;/);
  });
});

describe("nombreArchivoLiquidacion", () => {
  test("lleva el documento por delante para que ordene solo", () => {
    assert.equal(
      nombreArchivoLiquidacion(CABECERA),
      "liquidacion-78597686-Justo-Lavilla.csv"
    );
  });

  test("las tildes y la eñe no llegan al nombre del archivo", () => {
    assert.equal(
      nombreArchivoLiquidacion({ ...CABECERA, nombre: "Camila García Rosell" }),
      "liquidacion-78597686-Camila-Garcia-Rosell.csv"
    );
  });
});
