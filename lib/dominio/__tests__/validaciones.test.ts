import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  distribucionValida, hayBloqueantes, rucValido, validarGasto,
  type ContextoValidacion, type GastoAValidar,
} from "../validaciones.ts";
import { PARAMETROS_POR_DEFECTO, type Parametros } from "../tipos.ts";

const params = (extra: Partial<Parametros> = {}): Parametros => ({
  ...PARAMETROS_POR_DEFECTO, ...extra,
});

const base: GastoAValidar = { clase: "COMPROBANTE" };
const ctxBase: ContextoValidacion = { parametros: params() };

const codigos = (g: GastoAValidar, c: ContextoValidacion = ctxBase) =>
  validarGasto(g, c).map(a => a.codigo);

// ════════════════════════════════════════════════════════════════
describe("RUC — módulo 11", () => {
  it("acepta RUCs reales de los comprobantes de prueba", () => {
    assert.ok(rucValido("20612077224"), "FOR ELECTRIC E.I.R.L.");
    assert.ok(rucValido("20512201611"), "INDUSTRIAS ROLAND PRINT S.A.C.");
  });

  it("rechaza un dígito verificador incorrecto", () => {
    assert.ok(!rucValido("20612077225"));
    assert.ok(!rucValido("20512201612"));
  });

  it("rechaza longitudes distintas de 11", () => {
    assert.ok(!rucValido("2061207722"));    // 10
    assert.ok(!rucValido("206120772240"));  // 12
    assert.ok(!rucValido(""));
  });

  it("rechaza lo que no son solo dígitos", () => {
    assert.ok(!rucValido("2061207722A"));
    assert.ok(!rucValido("20-61207722"));
    assert.ok(!rucValido(" 20612077224"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Aritmética", () => {
  it("no alerta cuando subtotal + IGV = total", () => {
    // Cifras exactas de la factura FE01-00002591
    const g = { ...base, subtotal: 63.56, igv: 11.44, total: 75.0 };
    assert.ok(!codigos(g).includes("ARITMETICA"));
  });

  it("alerta cuando la suma no cuadra", () => {
    const g = { ...base, subtotal: 63.56, igv: 11.44, total: 90.0 };
    assert.ok(codigos(g).includes("ARITMETICA"));
  });

  it("tolera diferencias de redondeo de hasta 5 céntimos", () => {
    const g = { ...base, subtotal: 100, igv: 18, total: 118.04 };
    assert.ok(!codigos(g).includes("ARITMETICA"));
  });

  it("no comprueba si falta algún componente", () => {
    assert.ok(!codigos({ ...base, subtotal: 100, total: 118 }).includes("ARITMETICA"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("IGV", () => {
  it("acepta el 18% correcto", () => {
    const g = { ...base, subtotal: 100, igv: 18, total: 118 };
    assert.ok(!codigos(g).includes("IGV_PORCENTAJE"));
  });

  it("alerta si el IGV no corresponde al porcentaje", () => {
    const g = { ...base, subtotal: 100, igv: 10, total: 110 };
    assert.ok(codigos(g).includes("IGV_PORCENTAJE"));
  });

  it("no alerta en operaciones exoneradas, que llegan con IGV en cero", () => {
    const g = { ...base, subtotal: 100, igv: 0, total: 100 };
    assert.ok(!codigos(g).includes("IGV_PORCENTAJE"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Duplicados — únicos bloqueantes", () => {
  it("marca el comprobante repetido como bloqueante", () => {
    const alertas = validarGasto(base, { ...ctxBase, duplicadoComprobante: true });
    assert.ok(hayBloqueantes(alertas));
    assert.equal(alertas[0].codigo, "DUPLICADO_COMPROBANTE");
  });

  it("marca la imagen repetida como bloqueante", () => {
    const alertas = validarGasto(base, { ...ctxBase, duplicadoImagen: true });
    assert.ok(hayBloqueantes(alertas));
  });

  it("sin duplicados no hay bloqueantes", () => {
    assert.ok(!hayBloqueantes(validarGasto(base, ctxBase)));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Monto autorizado", () => {
  const conMemo = (rendido_previo: number): ContextoValidacion => ({
    parametros: params(),
    memo: {
      monto_autorizado: 500,
      rendido_previo,
      fecha_salida: null,
      fecha_retorno_prev: null,
    },
  });

  it("no alerta mientras quede saldo", () => {
    assert.ok(!codigos({ ...base, total: 100 }, conMemo(300)).includes("EXCEDE_AUTORIZADO"));
  });

  it("alerta al superar el autorizado", () => {
    assert.ok(codigos({ ...base, total: 250 }, conMemo(300)).includes("EXCEDE_AUTORIZADO"));
  });

  it("no alerta al llegar justo al límite", () => {
    assert.ok(!codigos({ ...base, total: 200 }, conMemo(300)).includes("EXCEDE_AUTORIZADO"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Fecha fuera del rango del memo", () => {
  const ctx: ContextoValidacion = {
    parametros: params(),
    memo: {
      monto_autorizado: 1000, rendido_previo: 0,
      fecha_salida: "2026-03-10", fecha_retorno_prev: "2026-03-20",
    },
  };

  it("acepta una fecha dentro del rango", () => {
    assert.ok(!codigos({ ...base, fecha_emision: "2026-03-15" }, ctx).includes("FECHA_FUERA_RANGO"));
  });

  it("alerta si es muy anterior a la salida", () => {
    assert.ok(codigos({ ...base, fecha_emision: "2026-03-01" }, ctx).includes("FECHA_FUERA_RANGO"));
  });

  it("alerta si es muy posterior al retorno", () => {
    assert.ok(codigos({ ...base, fecha_emision: "2026-03-30" }, ctx).includes("FECHA_FUERA_RANGO"));
  });

  it("tolera dos días de holgura a cada lado", () => {
    assert.ok(!codigos({ ...base, fecha_emision: "2026-03-09" }, ctx).includes("FECHA_FUERA_RANGO"));
    assert.ok(!codigos({ ...base, fecha_emision: "2026-03-22" }, ctx).includes("FECHA_FUERA_RANGO"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Topes pendientes de definir (§15)", () => {
  it("no inventa un tope cuando el parámetro está en null", () => {
    const g: GastoAValidar = { clase: "DECLARACION_JURADA", total: 9_999 };
    assert.ok(!codigos(g).includes("TOPE_DJ_EXCEDIDO"));
  });

  it("aplica el tope de declaración jurada una vez definido", () => {
    const ctx = { parametros: params({ tope_declaracion_jurada_dia: 50 }) };
    const g: GastoAValidar = { clase: "DECLARACION_JURADA", total: 80 };
    assert.ok(codigos(g, ctx).includes("TOPE_DJ_EXCEDIDO"));
  });

  it("acumula el gasto del día antes de comparar contra el tope", () => {
    const ctx: ContextoValidacion = {
      parametros: params({ tope_movilidad_dia: 30 }),
      movilidad_del_dia: 25,
    };
    const g: GastoAValidar = { clase: "MOVILIDAD", total: 10 };
    assert.ok(codigos(g, ctx).includes("TOPE_MOVILIDAD"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Confianza de la extracción", () => {
  it("alerta cuando algún campo queda bajo el umbral", () => {
    const g = { ...base, confianza_extraccion: { total: 0.62, igv: 0.41 } };
    assert.ok(codigos(g).includes("CONFIANZA_BAJA"));
  });

  it("no alerta si toda la lectura fue segura", () => {
    const g = { ...base, confianza_extraccion: { total: 0.98, igv: 0.95 } };
    assert.ok(!codigos(g).includes("CONFIANZA_BAJA"));
  });

  it("nombra los campos dudosos en el mensaje", () => {
    const g = { ...base, confianza_extraccion: { total: 0.5 } };
    const a = validarGasto(g, ctxBase).find(x => x.codigo === "CONFIANZA_BAJA");
    assert.match(a!.mensaje, /total/);
  });
});

// ════════════════════════════════════════════════════════════════
describe("Distribución entre proyectos", () => {
  it("acepta porcentajes que suman 100", () => {
    assert.ok(distribucionValida([{ porcentaje: 60 }, { porcentaje: 40 }]).ok);
  });

  it("rechaza los que no suman 100", () => {
    assert.ok(!distribucionValida([{ porcentaje: 60 }, { porcentaje: 30 }]).ok);
  });

  it("acepta una lista vacía: el memo va a un solo proyecto", () => {
    assert.ok(distribucionValida([]).ok);
  });

  it("rechaza porcentajes en cero o negativos", () => {
    assert.ok(!distribucionValida([{ porcentaje: 100 }, { porcentaje: 0 }]).ok);
  });
});

// ════════════════════════════════════════════════════════════════
describe("A nombre de quién está emitido", () => {
  const NUESTRO = "20512201611";   // INDUSTRIAS ROLAND PRINT S.A.C.
  const OTRO    = "20612077224";   // otro contribuyente cualquiera
  const ctx = { ...ctxBase, rucEmpresa: NUESTRO };

  it("una factura a nombre de la empresa no alerta", () => {
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: NUESTRO };
    assert.ok(!codigos(g, ctx).includes("COMPROBANTE_AJENO"));
  });

  it("una factura emitida a otro RUC sí alerta", () => {
    // El caso que Administración descubre revisando el papel: el trabajador
    // pidió factura y salió a nombre de otro.
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: OTRO };
    assert.ok(codigos(g, ctx).includes("COMPROBANTE_AJENO"));
  });

  it("el mensaje dice a qué RUC salió y qué hacer", () => {
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: OTRO };
    const a = validarGasto(g, ctx).find(x => x.codigo === "COMPROBANTE_AJENO");
    assert.match(a!.mensaje, new RegExp(OTRO));
    assert.match(a!.mensaje, /reemitan/);
  });

  it("no alerta si no se pudo leer a nombre de quién", () => {
    // Una alerta por cada comprobante mal fotografiado enseñaría a
    // ignorarlas: la confianza de lectura ya marca esos casos.
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: "" };
    assert.ok(!codigos(g, ctx).includes("COMPROBANTE_AJENO"));
  });

  it("sin saber el RUC de la empresa no se puede comprobar nada", () => {
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: OTRO };
    assert.ok(!codigos(g, ctxBase).includes("COMPROBANTE_AJENO"));
  });

  it("ignora espacios alrededor", () => {
    const g = { ...base, tipo_comprobante: "01", adquiriente_ruc: `  ${NUESTRO} ` };
    assert.ok(!codigos(g, ctx).includes("COMPROBANTE_AJENO"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Ticket", () => {
  const NUESTRO = "20512201611";
  const ctx = { ...ctxBase, rucEmpresa: NUESTRO };

  it("un ticket sin RUC de la empresa no sustenta el gasto", () => {
    // "las lavanderías casi no dan factura, te dan ticket" — y ese ticket
    // no sirve como sustento.
    const g = { ...base, tipo_comprobante: "12" };
    assert.ok(codigos(g, ctx).includes("TICKET_SIN_RUC"));
  });

  it("un ticket que sí identifica a la empresa pasa", () => {
    const g = { ...base, tipo_comprobante: "12", adquiriente_ruc: NUESTRO };
    assert.ok(!codigos(g, ctx).includes("TICKET_SIN_RUC"));
  });

  it("una factura o una boleta no disparan la alerta de ticket", () => {
    for (const tipo of ["01", "03"]) {
      const g = { ...base, tipo_comprobante: tipo };
      assert.ok(!codigos(g, ctx).includes("TICKET_SIN_RUC"), `tipo ${tipo}`);
    }
  });

  it("el aviso propone la salida, no solo el problema", () => {
    const g = { ...base, tipo_comprobante: "12" };
    const a = validarGasto(g, ctx).find(x => x.codigo === "TICKET_SIN_RUC");
    assert.match(a!.mensaje, /factura o boleta|declaración jurada/);
  });

  it("ninguna de las dos bloquea: el gasto se registra igual", () => {
    const g = { ...base, tipo_comprobante: "12", adquiriente_ruc: "20612077224" };
    const alertas = validarGasto(g, ctx);
    assert.ok(alertas.length >= 2, "debe avisar por las dos cosas");
    assert.ok(!hayBloqueantes(alertas), "pero sin impedir el registro");
  });
});
