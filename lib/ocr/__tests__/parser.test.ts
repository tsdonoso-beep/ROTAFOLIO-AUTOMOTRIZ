import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aNumero, normalizarTexto, parsearComprobante } from "../parser.ts";

// RUC de prueba, válidos según módulo 11.
const RUC_PROVEEDOR = "20100128056";  // persona jurídica
const RUC_PROPIO = "20601030013";

// ════════════════════════════════════════════════════════════════
//  Importes: las dos convenciones que se ven en Perú
// ════════════════════════════════════════════════════════════════

describe("aNumero", () => {
  test("formato con coma de millar y punto decimal", () => {
    assert.equal(aNumero("1,234.56"), 1234.56);
  });

  test("formato con punto de millar y coma decimal", () => {
    assert.equal(aNumero("1.234,56"), 1234.56);
  });

  test("sin separador de millar", () => {
    assert.equal(aNumero("45.90"), 45.9);
    assert.equal(aNumero("45,90"), 45.9);
  });

  test("entero sin decimales", () => {
    assert.equal(aNumero("120"), 120);
  });

  test("arrastra el símbolo de moneda sin romperse", () => {
    assert.equal(aNumero("S/ 89.00"), 89);
  });

  test("texto sin dígitos no es un número", () => {
    assert.equal(aNumero("TOTAL"), null);
  });
});

describe("normalizarTexto", () => {
  test("quita tildes y sube a mayúsculas", () => {
    assert.equal(normalizarTexto("Panadería Ángel"), "PANADERIA ANGEL");
  });

  test("conserva los saltos de línea", () => {
    assert.equal(normalizarTexto("uno\ndos"), "UNO\nDOS");
  });
});

// ════════════════════════════════════════════════════════════════
//  Factura electrónica bien impresa
// ════════════════════════════════════════════════════════════════

const FACTURA = `
FOR ELECTRIC S.A.C.
AV. ARGENTINA 2085 - LIMA
RUC: ${RUC_PROVEEDOR}
FACTURA ELECTRONICA
F001-00002591
FECHA DE EMISION: 14/05/2026
SEÑOR(ES): INDUSTRIAS ROLAND PRINT S.A.C.
RUC: ${RUC_PROPIO}
CANTIDAD DESCRIPCION IMPORTE
2 CABLE NH-80 2.5MM 254.24
OP. GRAVADA S/ 254.24
IGV 18% S/ 45.76
IMPORTE TOTAL S/ 300.00
FORMA DE PAGO: CONTADO
`;

describe("factura electrónica", () => {
  const r = parsearComprobante(FACTURA, { rucPropio: RUC_PROPIO });

  test("toma el RUC del emisor, no el nuestro", () => {
    assert.equal(r.proveedor_ruc, RUC_PROVEEDOR);
    assert.ok(r._confianza.proveedor_ruc >= 0.9);
  });

  test("separa serie de número y rellena el correlativo", () => {
    assert.equal(r.serie, "F001");
    assert.equal(r.numero, "00002591");
  });

  test("lee la fecha en ISO", () => {
    assert.equal(r.fecha_emision, "2026-05-14");
  });

  test("lee los tres importes desde sus etiquetas", () => {
    assert.equal(r.total, 300);
    assert.equal(r.subtotal, 254.24);
    assert.equal(r.igv, 45.76);
    assert.ok(r._confianza.total >= 0.9);
  });

  test("la aritmética cierra", () => {
    assert.equal(Math.round((r.subtotal + r.igv) * 100) / 100, r.total);
  });

  test("reconoce el tipo, la moneda y la forma de pago", () => {
    assert.equal(r.tipo_comprobante, "01");
    assert.equal(r.moneda, "PEN");
    assert.equal(r.forma_pago, "EFECTIVO");
  });

  test("no declara ilegible nada que sí leyó", () => {
    assert.ok(!r._no_legibles.includes("total"));
    assert.ok(!r._no_legibles.includes("proveedor_ruc"));
  });
});

// ════════════════════════════════════════════════════════════════
//  Boleta de ticket térmico, con el ruido típico del OCR
// ════════════════════════════════════════════════════════════════

const BOLETA_SUCIA = `
GRIFO REPSOL SELVA
RUC 2O1OO128O56
BOLETA DE VENTA ELECTRONICA
B002-00013847
08/09/2026
GASOLINA 90 - 5.2 GAL
TOTAL S/ 120.00
VISA
`;

describe("boleta con OCR sucio", () => {
  const r = parsearComprobante(BOLETA_SUCIA, { rucPropio: RUC_PROPIO });

  test("repara las letras que el OCR confundió por dígitos", () => {
    // El módulo 11 es lo que permite aceptar la reparación.
    assert.equal(r.proveedor_ruc, RUC_PROVEEDOR);
    assert.ok(r._confianza.proveedor_ruc < 0.9, "y lo marca con menos confianza");
  });

  test("lee serie y número de la boleta", () => {
    assert.equal(r.serie, "B002");
    assert.equal(r.numero, "00013847");
    assert.equal(r.tipo_comprobante, "03");
  });

  test("con solo el total, desagrega la base con la tasa vigente", () => {
    assert.equal(r.total, 120);
    assert.equal(r.subtotal, 101.69);
    assert.equal(r.igv, 18.31);
    assert.ok(
      r._confianza.igv < r._confianza.total,
      "lo derivado vale menos que lo leído"
    );
  });

  test("respeta una tasa de IGV distinta", () => {
    const otra = parsearComprobante(BOLETA_SUCIA, { igvPorcentaje: 10 });
    assert.equal(otra.subtotal, 109.09);
    assert.equal(otra.igv, 10.91);
  });

  test("detecta pago con tarjeta", () => {
    assert.equal(r.forma_pago, "TARJETA");
  });
});

// ════════════════════════════════════════════════════════════════
//  Lo que NO debe hacer: inventar
// ════════════════════════════════════════════════════════════════

describe("cuando no se puede leer", () => {
  test("un RUC que no pasa el módulo 11 se descarta", () => {
    const r = parsearComprobante("RUC: 20100128055\nTOTAL S/ 50.00");
    assert.equal(r.proveedor_ruc, "");
    assert.ok(r._no_legibles.includes("proveedor_ruc"));
  });

  test("texto ilegible no produce campos inventados", () => {
    const r = parsearComprobante("~~~ ### ??? \n xxxx");
    assert.equal(r.proveedor_ruc, "");
    assert.equal(r.serie, "");
    assert.equal(r.fecha_emision, "");
    assert.equal(r.total, 0);
    for (const campo of ["proveedor_ruc", "serie", "fecha_emision", "total"]) {
      assert.ok(r._no_legibles.includes(campo), `${campo} debe quedar declarado ilegible`);
    }
  });

  test("una fecha imposible se rechaza", () => {
    const r = parsearComprobante("EMISION 31/02/2026\nTOTAL 10.00");
    assert.equal(r.fecha_emision, "");
  });

  test("un año fuera de rango se rechaza", () => {
    const r = parsearComprobante("EMISION 14/05/1823\nTOTAL 10.00");
    assert.equal(r.fecha_emision, "");
  });

  test("sin etiqueta de total, el mayor importe se marca como inferido", () => {
    const r = parsearComprobante("ALGO 12.00\nOTRA COSA 340.00");
    assert.equal(r.total, 340);
    assert.ok(r._confianza.total < 0.6, "una inferencia no vale como lectura");
  });

  test("el correlativo del documento no se confunde con un importe", () => {
    // Caso real: sobre una foto degradada el OCR no alcanzó a leer la línea
    // "IMPORTE TOTAL S/ 300.00", y el respaldo del mayor número tomaba el
    // 2591 de "F001-00002591" como si fuera el monto del gasto.
    const r = parsearComprobante("FACTURA\nF001-00002591\nCABLE NH-80 254.24");
    assert.notEqual(r.total, 2591);
    assert.equal(r.total, 254.24);
  });

  test("un número sin decimales no califica como importe de respaldo", () => {
    // "AV. ARGENTINA 2085" es una dirección, no un monto.
    const r = parsearComprobante("AV. ARGENTINA 2085 - LIMA\nCONSUMO 45.90");
    assert.equal(r.total, 45.9);
  });

  test("sin ningún importe con forma de dinero, el total queda ilegible", () => {
    // Preferible pedirlo que inventarlo.
    const r = parsearComprobante("FACTURA\nF001-00002591\nAV. ARGENTINA 2085");
    assert.equal(r.total, 0);
    assert.ok(r._no_legibles.includes("total"));
  });

  test("el detalle nunca se adivina", () => {
    const r = parsearComprobante(FACTURA);
    assert.equal(r.detalle, "");
    assert.ok(r._no_legibles.includes("detalle"));
  });
});

// ════════════════════════════════════════════════════════════════
//  Casos de borde del formato peruano
// ════════════════════════════════════════════════════════════════

describe("bordes del formato", () => {
  test("serie preimpresa numérica, con menos confianza que la electrónica", () => {
    const r = parsearComprobante("RECIBO\n001-0000456\nTOTAL 30.00");
    assert.equal(r.serie, "001");
    assert.equal(r.numero, "00000456");
    assert.ok(r._confianza.serie < 0.8);
  });

  test("una fecha no se confunde con una serie preimpresa", () => {
    const r = parsearComprobante("FECHA 14-05-2026\nTOTAL 30.00");
    assert.equal(r.serie, "");
  });

  test("serie de cuatro con dos letras, como FE01", () => {
    const r = parsearComprobante("FACTURA\nFE01-00002591\nTOTAL 30.00");
    assert.equal(r.serie, "FE01");
  });

  test("formato aaaa-mm-dd", () => {
    const r = parsearComprobante("EMISION 2026-05-14\nTOTAL 30.00");
    assert.equal(r.fecha_emision, "2026-05-14");
  });

  test("dólares se detectan por el símbolo", () => {
    const r = parsearComprobante("FACTURA\nIMPORTE TOTAL US$ 250.00");
    assert.equal(r.moneda, "USD");
  });

  test("sin la palabra impresa, el tipo sale del prefijo de la serie", () => {
    const r = parsearComprobante(`RUC ${RUC_PROVEEDOR}\nF001-00000123\nTOTAL 30.00`);
    assert.equal(r.tipo_comprobante, "01");
    assert.ok(r._confianza.tipo_comprobante < 0.9, "deducir vale menos que leer");
  });

  test("nota de crédito antes que factura", () => {
    const r = parsearComprobante("NOTA DE CREDITO ELECTRONICA\nF001-00000123\nTOTAL 30.00");
    assert.equal(r.tipo_comprobante, "07");
  });

  test("si el único RUC del comprobante es el nuestro, no hay proveedor", () => {
    const r = parsearComprobante(`RUC: ${RUC_PROPIO}\nTOTAL 30.00`, { rucPropio: RUC_PROPIO });
    assert.equal(r.proveedor_ruc, "");
  });
});
