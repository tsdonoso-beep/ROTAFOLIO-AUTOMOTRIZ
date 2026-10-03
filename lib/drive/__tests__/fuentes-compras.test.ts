import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comexPorOc, comprasPorOc, estadoDeCopia, fecha, leerFuentes, limpiarDam, normalizarOc, numero, valesDeAlmacen,
} from "../fuentes-compras.ts";

test("la OC como en la carpeta madre: nacional con 4 dígitos, importación con 3", () => {
  assert.equal(normalizarOc("1364-2026", "Nacional"), "1364-2026");
  assert.equal(normalizarOc("00098-2026", "Nacional"), "0098-2026");
  assert.equal(normalizarOc("0068.1-2026", "Nacional"), "0068-2026");
  assert.equal(normalizarOc("OC 200 - 2026", "Nacional"), "0200-2026");
  assert.equal(normalizarOc("625-2025(III)", "Importación"), "625-2025");
  assert.equal(normalizarOc("001-2026 (I)", "Importación"), "001-2026");
  assert.equal(normalizarOc("0164-2026", "Importación"), "164-2026");
  assert.equal(normalizarOc("2023-040 (69)", "Importación"), "040-2023");
  assert.equal(normalizarOc("", "Nacional"), null);
  assert.equal(normalizarOc("ANULADO", "Nacional"), null);
  assert.equal(normalizarOc("2604-0002", "Importación"), null);
});

test("fechas y números de las celdas", () => {
  assert.equal(fecha(46297), "2026-10-02");             // número de serie de Sheets
  assert.equal(fecha(46297.75), "2026-10-02");
  assert.equal(fecha("02/10/2026"), "2026-10-02");
  assert.equal(fecha("2026-10-02T08:26:18"), "2026-10-02");
  assert.equal(fecha("POR CONFIRMAR"), null);
  assert.equal(fecha(""), null);
  assert.equal(numero(1250.5), 1250.5);
  assert.equal(numero("1,250.50"), 1250.5);
  assert.equal(numero("1.250,50"), 1250.5);
  assert.equal(numero("S/ 750"), 750);
  assert.equal(numero(""), null);
});

test("la DAM limpia, aunque venga con comillas o dos en una celda", () => {
  assert.deepEqual(limpiarDam('"03819266'), ["03819266"]);
  assert.deepEqual(limpiarDam("023467 // 023468"), ["023467", "023468"]);
  assert.deepEqual(limpiarDam("DUA 118-2026-10-151461"), ["118-2026-10-151461"]);
  assert.deepEqual(limpiarDam("*03480820"), ["03480820"]);
  assert.deepEqual(limpiarDam("PENDIENTE"), []);
});

const NAC = [
  ["FECHA", "EMPRESA", "TIPO DE DOCUMENTO", "N° OC/OS", "N° REQUERIMIENTO", "RUC", "RAZON SOCIAL", "PROYECTO", "CONCEPTO",
    "MONEDA", "COSTO TOTAL", "COSTO TOTAL (SOLES)", "FORMA DE PAGO", "DIAS O PORCENTAJE", "SOLICITADO", "ELABORADO"],
  [46294, "INDUSTRIAS ROLAND PRINT S.A.C.", "ORDEN DE COMPRA", "0200-2026", "2026-0700", 20600650859, "RGV SAC", "TALLERES", "Bienes",
    "Dólares", 100, 375, "Crédito", 30, "PCP", "Omar Luque"],
  [46293, "INDUSTRIAS ROLAND PRINT S.A.C.", "ORDEN DE COMPRA", "200-2026", "2026-0700", "20600650859", "RGV SAC", "TALLERES", "Bienes",
    "Dólares", 50.5, 189.38, "Crédito", 30, "PCP", "Omar Luque"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  [46290, "CONSORCIO INDUSTRIAS ROLAND PRINT S.A.C. - INROPLASTICOS S.A.C.", "ORDEN DE SERVICIO", "0201-2026", "", "20111111111", "OTRO", "", "",
    "Soles", 10, 10, "Contado", "", "", "Ana"],
];

test("compras nacionales: una fila por OC, con el total sumado y la primera fecha", () => {
  const r = comprasPorOc(NAC, "Nacional");
  assert.equal(r.length, 2);
  const a = r.find(x => x.oc === "0200-2026")!;
  assert.equal(a.items, 2);
  assert.equal(a.total, 150.5);
  assert.equal(a.totalSoles, 564.38);
  assert.equal(a.fecha, "2026-09-28");
  assert.equal(a.proveedorRuc, "20600650859");
  assert.equal(a.elaborado, "Omar Luque");
  assert.equal(a.ocOriginal, "0200-2026 / 200-2026");
  assert.equal(r.find(x => x.oc === "0201-2026")!.empresa, "CONSORCIO INDUSTRIAS ROLAND PRINT S.A.C. - INROPLASTICOS S.A.C.");
});

test("COMEX: STATUS por OC (sin INROPLAS) con sus DUA", () => {
  const status = [
    ["EMPRESA", "NRO OC", "COMPRADOR", "ESTADO DE COMPRA", "FECHA OC", "ETA", "FECHA REAL EN PLANTA", "DAM", "COSTEO"],
    ["INROPRIN", "012-2026", "GEYDI", "PLANTA PP", 46034, 46110, 46119, "151461", "COSTEADO"],
    ["INROPRIN", "012-2026(II)", "GEYDI", "EN TRANSITO", 46034, "POR CONFIRMAR", "", "", ""],
    ["INROPLAS", "012-2026", "OTRO", "PLANTA PP", 46034, "", "", "999999", "COSTEADO"],
  ];
  const duas = [
    ["N° OC", "DUA", "FECHA AFECTACION", "ENCARGADO", "¿SUBIO OC?", "FECHA DE SUBIDA", "OBSERVACION"],
    ["012-2026", "DUA 118-2026-10-151461", 46112, "VICTOR", true, 46120, ""],
    ["050-2026", "DUA 118-2026-10-200000", 46200, "DIEGO", false, "", ""],
  ];
  const r = comexPorOc(status, duas);
  const a = r.find(x => x.oc === "012-2026")!;
  assert.equal(a.comprador, "GEYDI");
  assert.equal(a.embarques, 2);
  assert.equal(a.estadoCompra, "PLANTA PP / EN TRANSITO");
  assert.equal(a.dam, "151461");
  assert.equal(a.costeo, "COSTEADO");
  assert.equal(a.eta, "2026-03-29 / POR CONFIRMAR");
  assert.deepEqual(a.duas.map(d => [d.dua, d.subioOc]), [["118-2026-10-151461", "SI"]]);
  // Una OC que solo está en DUAS también entra.
  assert.equal(r.find(x => x.oc === "050-2026")!.embarques, 0);
});

test("vales de Almacén: cabecera + productos, con la OC según la operación", () => {
  const vales = [
    ["ID", "VALE DE ALMACEN", "FECHA REGISTRO", "FECHA OPERACION", "TIPO DE MOVIMIENTO", "TIPO DE OPERACION", "TIPO ANEXO", "DESCRIPCION",
      "TIPO DOCUMENTO", "NUMERO DOCUMENTO", "TIPO DE ORDEN", "NUMERO ORDEN", "DOCUMENTO", "ENLACE DOCUMENTO"],
    ["a1", "001-5067", 46296.6, 46296, "INGRESO", "COMPRA NACIONAL", "PROVEEDOR ", "EMERGENCY", "GUIA REMISIÓN", "eg07-617", "COMPRA", "1343-2026",
      "DOCUMENTO_Files_/a1.pdf", "https://drive/x"],
    ["a2", "001-5068", 46297, 46297, "INGRESO", "COMPRA IMPORTADA", "PROVEEDOR", "SHENZHEN", "FACTURA", "INV-1", "COMPRA", "0164-2026", "", ""],
  ];
  const kardex = [
    ["ID", "ID DOCUMENTO", "VALE DE ALMACEN", "TIPO DE MOVIMIENTO", "TIPO DE OPERACION", "NUMERO ORDEN", "INGRESO"],
    ["k1", "a1", "001-5067", "INGRESO", "COMPRA NACIONAL", "1343-2026", 10],
    ["k2", "a1", "001-5067", "INGRESO", "COMPRA NACIONAL", "1343-2026", "2.5"],
    ["k3", "a9", "001-5100", "ANULADO", "ANULADO", "ANULADO", ""],
  ];
  const r = valesDeAlmacen(vales, kardex);
  const a = r.find(v => v.id === "a1")!;
  assert.equal(a.oc, "1343-2026");
  assert.equal(a.procedencia, "Nacional");
  assert.equal(a.numeroDocumento, "EG07-617");
  assert.equal(a.tipoDocumento, "GUIA REMISION");
  assert.equal(a.proveedor, "EMERGENCY");
  assert.equal(a.items, 2);
  assert.equal(a.cantidad, 12.5);
  assert.equal(a.documentoUrl, "https://drive/x");
  assert.equal(a.fechaRegistro, "2026-10-01");
  const b = r.find(v => v.id === "a2")!;
  assert.equal(b.oc, "164-2026");
  assert.equal(b.procedencia, "Importación");
  // Un vale anulado que solo está en el KARDEX también entra, sin OC.
  const c = r.find(v => v.id === "a9")!;
  assert.equal(c.movimiento, "ANULADO");
  assert.equal(c.oc, null);
});

test("todo junto: avisa de las pestañas que faltan y lee el estado de la copia", () => {
  const r = leerFuentes({
    "NACIONALES": NAC,
    "COPIA - ESTADO": [["Pestaña", "Origen", "Filas copiadas", "Columnas que no se encontraron", "Inicio", "Fin", "Resultado"],
      ["NACIONALES", "BD › BD-2026", 3381, "", 46297.5, 46297.5001, "OK"]],
  });
  assert.equal(r.compras.length, 2);
  assert.ok(r.avisos.some(a => a.includes("KARDEX")));
  assert.equal(r.estado[0].filas, 3381);
  assert.equal(r.estado[0].inicio, "2026-10-02T17:00:00.000Z");
  assert.deepEqual(estadoDeCopia(undefined), []);
});
