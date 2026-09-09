import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aCsv, CABECERAS, filasCsv } from "../csv.ts";
import { filasLiquidacion, nombreArchivoLiquidacion } from "../liquidacion.ts";
import { liquidar, type MemoLiquidable } from "../../dominio/liquidacion.ts";
import type { EstadoMemo } from "../../dominio/tipos.ts";

describe("estructura del archivo de Contabilidad", () => {
  const ctx = {
    correlativo: "M-1", empresa: "INROPRIN", centroCodigo: "CC-1",
    centroNombre: "Proyecto", destino: "Piura", rendidor: "Justo",
    aprobadoPor: "Alonzo",
  };

  const gasto = {
    id: "g1", client_id: "c1", memo_id: "m1", proyecto_id: null, usuario_id: "u1",
    estado: "APROBADO", clase: "COMPROBANTE", categoria: null,
    proveedor_ruc: "20100128056", proveedor_nombre: "FOR ELECTRIC",
    adquiriente_ruc: "20601030013", tipo_comprobante: "01",
    serie: "F001", numero: "00002591", fecha_emision: "2026-05-14",
    moneda: "PEN", tipo_cambio: null, subtotal: 254.24, igv: 45.76, total: 300,
    forma_pago: "EFECTIVO", detalle: "Cable", dj_motivo: null, dj_lugar: null,
    mov_origen: null, mov_destino: null, confianza_extraccion: null,
    alertas: [], alertas_confirmadas: false, validacion_sunat: null,
    hash_imagen: null, observacion: null, storage_key: null,
    drive_url: null, drive_error: null, capturado_en: null,
    sincronizado_en: null, registrado_en: null, creado_en: "2026-05-14",
  } as unknown as Parameters<typeof filasCsv>[1][number];

  test("cada fila trae exactamente tantas columnas como cabeceras", () => {
    // Un desfase acá corre todas las columnas del archivo que recibe
    // Contabilidad, y no se nota hasta que alguien concilia a mano.
    const filas = filasCsv(ctx, [gasto, gasto]);
    for (const [i, fila] of filas.entries()) {
      assert.equal(fila.length, CABECERAS.length, `la fila ${i} está desalineada`);
    }
  });

  test("el RUC a nombre de quién se emitió llega a Contabilidad", () => {
    const texto = aCsv(filasCsv(ctx, [gasto]));
    assert.match(texto, /RUC Adquiriente/);
    assert.match(texto, /20601030013/);
  });

  test("la primera fila son las cabeceras", () => {
    assert.deepEqual(filasCsv(ctx, [])[0], [...CABECERAS]);
  });
});

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
