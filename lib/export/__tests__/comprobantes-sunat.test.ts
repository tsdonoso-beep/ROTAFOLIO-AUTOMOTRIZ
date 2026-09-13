import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filasComprobantesSunat, nombreDeTipo, fechaCorta, nombreArchivoSunat,
  CABECERAS_SUNAT, type ComprobanteHistorico,
} from "../comprobantes-sunat.ts";
import { aCsv } from "../csv.ts";

const c = (p: Partial<ComprobanteHistorico> = {}): ComprobanteHistorico => ({
  periodo: "202608", proveedorRuc: "20100055237", proveedorNombre: "FERRETERIA EL SOL",
  tipoComprobante: "01", serie: "E001", numero: "500",
  fechaEmision: "2026-08-05", total: 118, moneda: "PEN", estado: "1",
  tipoNota: null, modificaTipo: null, modificaSerie: null, modificaNumero: null,
  carSunat: "CAR-100", primeraVez: "2026-09-01T10:00:00Z", ultimaVez: "2026-09-13T10:00:00Z",
  rendidoPor: null, cambios: 0, ...p,
});

describe("nombreDeTipo", () => {
  test("traduce los códigos de SUNAT", () => {
    assert.equal(nombreDeTipo("01"), "Factura");
    assert.equal(nombreDeTipo("07"), "Nota de crédito");
  });
  test("un código desconocido se deja como vino, no se inventa", () => {
    assert.equal(nombreDeTipo("99"), "99");
    assert.equal(nombreDeTipo(null), "");
  });
});

describe("fechaCorta", () => {
  test("la escribe como la lee Excel en español", () => {
    assert.equal(fechaCorta("2026-08-05"), "05/08/2026");
  });
  test("sirve igual con una marca de tiempo", () => {
    assert.equal(fechaCorta("2026-09-13T10:00:00Z"), "13/09/2026");
  });
  test("sin fecha, celda vacía y no una fecha inventada", () => {
    assert.equal(fechaCorta(null), "");
  });
});

describe("filasComprobantesSunat", () => {
  test("la primera fila son los títulos", () => {
    assert.deepEqual(filasComprobantesSunat([])[0], CABECERAS_SUNAT);
  });

  test("cada fila tiene tantas celdas como títulos", () => {
    const f = filasComprobantesSunat([c(), c({ numero: "501" })]);
    for (const fila of f) assert.equal(fila.length, CABECERAS_SUNAT.length);
  });

  test("el importe va con dos decimales, para que Excel lo sume", () => {
    const f = filasComprobantesSunat([c({ total: 118 })]);
    assert.equal(f[1][8], "118.00");
  });

  // Quien lee la hoja busca «E001-500», no un tipo y una serie sueltos.
  test("a qué corrige una nota se lee como un comprobante", () => {
    const f = filasComprobantesSunat([c({
      tipoComprobante: "07", tipoNota: "01",
      modificaTipo: "01", modificaSerie: "E001", modificaNumero: "500",
    })]);
    assert.equal(f[1][11], "Factura E001-500");
  });

  test("una factura normal deja esa celda vacía", () => {
    assert.equal(filasComprobantesSunat([c()])[1][11], "");
  });

  test("sin cambios la celda va vacía, no un cero que se lee como dato", () => {
    assert.equal(filasComprobantesSunat([c({ cambios: 0 })])[1][13], "");
    assert.equal(filasComprobantesSunat([c({ cambios: 2 })])[1][13], "2");
  });

  test("dice quién lo rindió, que es lo que SUNAT no sabe", () => {
    const f = filasComprobantesSunat([c({ rendidoPor: "Annie Ramos" })]);
    assert.equal(f[1][12], "Annie Ramos");
  });

  test("un comprobante sin datos no rompe la hoja", () => {
    const vacio = filasComprobantesSunat([c({
      proveedorRuc: null, proveedorNombre: null, tipoComprobante: null,
      serie: null, numero: null, fechaEmision: null, total: null,
      moneda: null, estado: null, carSunat: null,
    })]);
    assert.equal(vacio[1].length, CABECERAS_SUNAT.length);
    assert.equal(vacio[1][8], "");
  });
});

describe("la hoja pasa por el mismo CSV que el resto", () => {
  test("el punto y coma separa, para Excel en español", () => {
    const texto = aCsv(filasComprobantesSunat([c()]));
    assert.ok(texto.split("\r\n")[0].includes(";"));
  });

  test("un nombre con punto y coma no desarma las columnas", () => {
    const texto = aCsv(filasComprobantesSunat([c({ proveedorNombre: "A; B S.A.C." })]));
    assert.ok(texto.includes('"A; B S.A.C."'));
  });

  // Un importe negativo —una nota de crédito— no debe volverse texto: la
  // columna dejaría de sumarse, que es peor que el riesgo que se evita.
  test("un importe negativo sigue siendo número", () => {
    const texto = aCsv(filasComprobantesSunat([c({ total: -118 })]));
    assert.ok(texto.includes(";-118.00;"), texto);
    assert.ok(!texto.includes("'-118.00"));
  });
});

describe("nombreArchivoSunat", () => {
  test("lleva el período, para que ordenen solos", () => {
    assert.equal(nombreArchivoSunat("202608"), "COMPROBANTES SUNAT 202608.csv");
  });
  test("sin período, el histórico completo", () => {
    assert.match(nombreArchivoSunat(null), /historico/);
  });
});
