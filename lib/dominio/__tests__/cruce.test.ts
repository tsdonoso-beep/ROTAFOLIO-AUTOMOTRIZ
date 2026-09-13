import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cruzar, llaveDe, razonDeNoComparable, notasSobreLoRendido,
  type ComprobanteNuestro, type ComprobanteSunat,
} from "../cruce.ts";

const nuestro = (p: Partial<ComprobanteNuestro> = {}): ComprobanteNuestro => ({
  id: "g1", ruc: "20100055237", tipoComprobante: "01", serie: "F001",
  numero: "1234", fechaEmision: "2026-08-05", total: 1180,
  proveedorNombre: "FERRETERIA EL SOL", ...p,
});

const deSunat = (p: Partial<ComprobanteSunat> = {}): ComprobanteSunat => ({
  ruc: "20100055237", tipoComprobante: "01", serie: "F001", numero: "1234",
  fechaEmision: "2026-08-05", total: 1180, razonSocial: "FERRETERIA EL SOL S.A.C.", ...p,
});

describe("llaveDe", () => {
  test("los ceros a la izquierda no hacen dos comprobantes distintos", () => {
    assert.equal(
      llaveDe({ ruc: "20100055237", tipoComprobante: "01", serie: "F001", numero: "00001234" }),
      llaveDe({ ruc: "20100055237", tipoComprobante: "01", serie: "F001", numero: "1234" }),
    );
  });
  test("la serie se compara sin importar mayúsculas", () => {
    assert.equal(
      llaveDe({ ruc: "20100055237", tipoComprobante: "01", serie: "f001", numero: "1" }),
      llaveDe({ ruc: "20100055237", tipoComprobante: "01", serie: "F001", numero: "1" }),
    );
  });
  test("sin RUC no hay llave", () => {
    assert.equal(llaveDe({ ruc: null, tipoComprobante: "01", serie: "F001", numero: "1" }), null);
  });
});

describe("razonDeNoComparable", () => {
  test("una boleta no se puede buscar en el RCE, y lo explica", () => {
    const r = razonDeNoComparable(nuestro({ tipoComprobante: "03" }));
    assert.match(r!, /boleta/);
  });
  test("un ticket tampoco", () => {
    assert.match(razonDeNoComparable(nuestro({ tipoComprobante: "12" }))!, /ticket/);
  });
  test("una factura sin RUC leído", () => {
    assert.match(razonDeNoComparable(nuestro({ ruc: null }))!, /no se leyó el ruc/i);
  });
  test("un RUC de 10 dígitos es un RUC mal leído", () => {
    // Es el caso que tenemos hoy en la base.
    assert.match(razonDeNoComparable(nuestro({ ruc: "2010050521" }))!, /11 dígitos/);
  });
  test("una factura completa sí es comparable", () => {
    assert.equal(razonDeNoComparable(nuestro()), null);
  });
  test("una nota de crédito sí llega al RCE", () => {
    assert.equal(razonDeNoComparable(nuestro({ tipoComprobante: "07" })), null);
  });
});

describe("cruzar", () => {
  test("lo que está en los dos lados cuadra", () => {
    const c = cruzar([nuestro()], [deSunat()]);
    assert.equal(c.emparejados[0].veredicto, "CUADRA");
    assert.equal(c.resumen.cuadran, 1);
    assert.equal(c.resumen.soloEnSunat, 0);
  });

  test("empareja aunque los ceros a la izquierda difieran", () => {
    const c = cruzar([nuestro({ numero: "00001234" })], [deSunat({ numero: "1234" })]);
    assert.equal(c.emparejados[0].veredicto, "CUADRA");
  });

  test("un importe distinto se marca y se dice de cuánto", () => {
    const c = cruzar([nuestro({ total: 5000 })], [deSunat({ total: 1180 })]);
    const e = c.emparejados[0];
    assert.equal(e.veredicto, "MONTO_DISTINTO");
    assert.equal(e.diferencia, 3820);
  });

  test("un céntimo de diferencia es redondeo, no una alerta", () => {
    const c = cruzar([nuestro({ total: 1180.01 })], [deSunat({ total: 1180 })]);
    assert.equal(c.emparejados[0].veredicto, "CUADRA");
  });

  test("una factura que SUNAT no tiene se marca", () => {
    const c = cruzar([nuestro()], []);
    assert.equal(c.emparejados[0].veredicto, "NO_ESTA_EN_SUNAT");
  });

  // El punto que más importa: no acusar a una boleta de algo imposible.
  test("una boleta no se marca como ausente de SUNAT", () => {
    const c = cruzar([nuestro({ tipoComprobante: "03", serie: "B001" })], []);
    assert.equal(c.emparejados[0].veredicto, "NO_COMPARABLE");
    assert.equal(c.resumen.noEstanEnSunat, 0);
    assert.equal(c.resumen.noComparables, 1);
  });

  test("lo que SUNAT tiene y nadie rindió sale aparte, con su monto", () => {
    const c = cruzar([], [deSunat({ total: 500 }), deSunat({ numero: "9999", total: 1500 })]);
    assert.equal(c.resumen.soloEnSunat, 2);
    assert.equal(c.resumen.montoSoloEnSunat, 2000);
  });

  test("un comprobante rendido no aparece además como no rendido", () => {
    const c = cruzar([nuestro()], [deSunat(), deSunat({ numero: "9999" })]);
    assert.equal(c.resumen.cuadran, 1);
    assert.equal(c.resumen.soloEnSunat, 1);
    assert.equal(c.soloEnSunat[0].numero, "9999");
  });

  test("empareja aunque un lado no traiga el tipo", () => {
    const c = cruzar([nuestro()], [deSunat({ tipoComprobante: null })]);
    assert.equal(c.emparejados[0].veredicto, "CUADRA");
  });

  test("sin importe en un lado no se inventa una diferencia", () => {
    const c = cruzar([nuestro({ total: null })], [deSunat()]);
    assert.equal(c.emparejados[0].veredicto, "CUADRA");
    assert.equal(c.emparejados[0].diferencia, undefined);
  });

  test("dos listas vacías dan un cruce vacío, sin romperse", () => {
    const c = cruzar([], []);
    assert.equal(c.emparejados.length, 0);
    assert.equal(c.resumen.montoSoloEnSunat, 0);
  });

  test("el resumen suma exactamente lo que hay", () => {
    const c = cruzar(
      [
        nuestro({ id: "a" }),
        nuestro({ id: "b", numero: "2", total: 999 }),
        nuestro({ id: "c", numero: "3" }),
        nuestro({ id: "d", tipoComprobante: "03" }),
      ],
      [deSunat(), deSunat({ numero: "2", total: 100 }), deSunat({ numero: "77" })],
    );
    const r = c.resumen;
    assert.equal(r.cuadran + r.montoDistinto + r.noEstanEnSunat + r.noComparables, 4);
    assert.equal(r.cuadran, 1);
    assert.equal(r.montoDistinto, 1);
    assert.equal(r.noEstanEnSunat, 1);
    assert.equal(r.noComparables, 1);
    assert.equal(r.soloEnSunat, 1);
  });

  // Con los 4 comprobantes que hay hoy en la base, el cruce no puede
  // informar nada: es justamente lo que hay que poder ver en pantalla.
  test("con los datos de hoy, todo cae en «no comparable»", () => {
    const hoy = [
      nuestro({ id: "1", ruc: "2010050521", serie: "F009", numero: "00008308", total: 2.5 }),
      nuestro({ id: "2", ruc: null, tipoComprobante: "03", serie: null, numero: null, total: 45.5 }),
      nuestro({ id: "3", ruc: null, tipoComprobante: "03", serie: null, numero: null, total: 18 }),
      nuestro({ id: "4", ruc: null, tipoComprobante: "03", serie: null, numero: null, total: 62.9 }),
    ];
    const c = cruzar(hoy, [deSunat()]);
    assert.equal(c.resumen.noComparables, 4);
    assert.equal(c.resumen.cuadran, 0);
    assert.equal(c.resumen.noEstanEnSunat, 0);
  });
});

describe("notasSobreLoRendido", () => {
  const rendido = (p: Partial<ComprobanteNuestro> = {}): ComprobanteNuestro => ({
    id: "g1", ruc: "20100055237", tipoComprobante: "01", serie: "E001",
    numero: "500", fechaEmision: "2026-08-05", total: 118,
    proveedorNombre: "FERRETERIA EL SOL", ...p,
  });

  const notaDe = (p: Partial<ComprobanteSunat> = {}): ComprobanteSunat => ({
    ruc: "20100055237", tipoComprobante: "07", serie: "E001", numero: "9",
    fechaEmision: "2026-08-20", total: -118, razonSocial: "FERRETERIA EL SOL",
    modifica: { tipo: "01", serie: "E001", numero: "500" }, ...p,
  });

  test("encuentra la nota que cae sobre algo que sí se rindió", () => {
    const r = notasSobreLoRendido([rendido()], [notaDe()]);
    assert.equal(r.length, 1);
    assert.equal(r[0].nuestro.id, "g1");
  });

  test("una nota por el total entero anula el gasto", () => {
    const r = notasSobreLoRendido([rendido()], [notaDe()]);
    assert.equal(r[0].anulaTodo, true);
    assert.equal(r[0].quedaEn, 0);
  });

  test("una nota parcial dice en cuánto queda", () => {
    const r = notasSobreLoRendido([rendido()], [notaDe({ total: -18 })]);
    assert.equal(r[0].anulaTodo, false);
    assert.equal(r[0].quedaEn, 100);
  });

  // SUNAT no siempre manda el signo igual; el valor absoluto lo hace parejo.
  test("da igual si la nota viene en positivo o en negativo", () => {
    const conSigno = notasSobreLoRendido([rendido()], [notaDe({ total: -118 })]);
    const sinSigno = notasSobreLoRendido([rendido()], [notaDe({ total: 118 })]);
    assert.equal(conSigno[0].quedaEn, sinSigno[0].quedaEn);
  });

  test("los ceros a la izquierda no impiden encontrar la factura", () => {
    const r = notasSobreLoRendido(
      [rendido({ numero: "500" })],
      [notaDe({ modifica: { tipo: "01", serie: "E001", numero: "00000500" } })],
    );
    assert.equal(r.length, 1);
  });

  // El punto: una nota sobre algo que nadie rindió es asunto de Contabilidad.
  // Devolverla ahogaría el aviso que sí tiene destinatario.
  test("ignora las notas sobre comprobantes que nadie rindió", () => {
    const r = notasSobreLoRendido([], [notaDe()]);
    assert.equal(r.length, 0);
  });

  test("ignora la nota que apunta a otra factura del mismo proveedor", () => {
    const r = notasSobreLoRendido(
      [rendido({ numero: "500" })],
      [notaDe({ modifica: { tipo: "01", serie: "E001", numero: "999" } })],
    );
    assert.equal(r.length, 0);
  });

  test("una factura normal no se confunde con una nota", () => {
    const r = notasSobreLoRendido([rendido()], [
      { ...notaDe(), tipoComprobante: "01", modifica: null },
    ]);
    assert.equal(r.length, 0);
  });

  test("una nota de débito también cuenta", () => {
    const r = notasSobreLoRendido([rendido()], [notaDe({ tipoComprobante: "08", total: 20 })]);
    assert.equal(r.length, 1);
    assert.equal(r[0].quedaEn, 98);
  });

  test("sin importe no inventa en cuánto queda", () => {
    const r = notasSobreLoRendido([rendido()], [notaDe({ total: null })]);
    assert.equal(r[0].quedaEn, null);
    assert.equal(r[0].anulaTodo, false);
  });
});
