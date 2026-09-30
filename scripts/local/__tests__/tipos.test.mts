import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clave, clasificarTexto, clasificarHttp, decidir, idApi, expiracionJwt } from "../comun/tipos.mts";

const POL = { maxIntentos: 3, esperaCaidoMs: 300_000, esperaReintentoMs: 20_000, esperaLimiteMs: 60_000 };

describe("clave", () => {
  test("normaliza serie y ceros a la izquierda", () => {
    assert.equal(clave({ proveedorRuc: "20100", tipoComprobante: "01", serie: "f001", numero: "000123" }), "20100|01|F001|123");
    assert.equal(clave({ proveedorRuc: "20100", tipoComprobante: "01", serie: "F001", numero: "0" }), "20100|01|F001|0");
  });
});

describe("clasificarTexto", () => {
  test("el modal real de SUNAT (30/09/2026) es SUNAT_CAIDO", () => {
    assert.equal(clasificarTexto(["Error del Servidor", "Señor contribuyente disculpe la molestia, en estos momentos no se puede acceder a los servicios de SUNAT, por favor reintentar en 5 minutos"]), "SUNAT_CAIDO");
  });
  test("el cuerpo crudo del 500 de api-cpe también", () => {
    assert.equal(clasificarTexto(['{"code":500,"message":"There was an error processing your request. It has been logged (ID 561168407dcfa701)."}']), "SUNAT_CAIDO");
  });
  test("no existe / sesión / validación", () => {
    assert.equal(clasificarTexto(["El comprobante no existe"]), "NO_EXISTE");
    assert.equal(clasificarTexto(["Usted esta saliendo del Menú SOL. Debe cerrar esta ventana."]), "SESION");
    assert.equal(clasificarTexto(["El tipo de comprobante es obligatorio"]), "VALIDACION");
  });
  test("vacío o irreconocible → null", () => {
    assert.equal(clasificarTexto([]), null);
    assert.equal(clasificarTexto(["Resultado"]), null);
  });
});

describe("clasificarHttp", () => {
  test("por estado", () => {
    assert.equal(clasificarHttp(200, "{}"), "OK");
    assert.equal(clasificarHttp(401, ""), "SESION");
    assert.equal(clasificarHttp(403, ""), "SESION");
    assert.equal(clasificarHttp(404, ""), "NO_EXISTE");
    assert.equal(clasificarHttp(429, ""), "LIMITE");
    assert.equal(clasificarHttp(500, ""), "SUNAT_CAIDO");
    assert.equal(clasificarHttp(503, ""), "SUNAT_CAIDO");
    assert.equal(clasificarHttp(302, ""), "DESCONOCIDO");
  });
  test("422 mira el cuerpo", () => {
    assert.equal(clasificarHttp(422, '{"errors":[{"desError":"El comprobante no existe"}]}'), "NO_EXISTE");
    assert.equal(clasificarHttp(422, '{"errors":[{"desError":"Serie inválida"}]}'), "VALIDACION");
  });
});

describe("decidir", () => {
  test("OK y NO_EXISTE terminan", () => {
    assert.deepEqual(decidir("OK", 1, POL), { accion: "fin", motivo: "ok" });
    assert.deepEqual(decidir("NO_EXISTE", 1, POL), { accion: "fin", motivo: "no_existe" });
  });
  test("SUNAT caído espera lo que pide SUNAT (5 min)", () => {
    assert.deepEqual(decidir("SUNAT_CAIDO", 1, POL), { accion: "reintentar", esperaMs: 300_000, cuentaIntento: true });
  });
  test("SESION no gasta intento, ni aunque ya se hayan agotado", () => {
    assert.deepEqual(decidir("SESION", 99, POL), { accion: "reintentar", esperaMs: 0, cuentaIntento: false });
  });
  test("se rinde al llegar al máximo", () => {
    assert.deepEqual(decidir("TIMEOUT", 3, POL), { accion: "fin", motivo: "agotado" });
  });
  test("espera creciente para lo demás", () => {
    assert.deepEqual(decidir("TIMEOUT", 2, POL), { accion: "reintentar", esperaMs: 40_000, cuentaIntento: true });
    assert.deepEqual(decidir("LIMITE", 2, POL), { accion: "reintentar", esperaMs: 120_000, cuentaIntento: true });
  });
});

describe("idApi", () => {
  test("igual que la URL que armó la app en la corrida real", () => {
    assert.equal(idApi({ proveedorRuc: "10181820328", tipoComprobante: "01", serie: "F002", numero: "3792" }), "10181820328-01-F002-3792-2");
  });
  test("número sin ceros y serie en mayúsculas", () => {
    assert.equal(idApi({ proveedorRuc: "20100", tipoComprobante: "07", serie: "fc01", numero: "00045" }), "20100-07-FC01-45-2");
  });
});

describe("expiracionJwt", () => {
  test("lee exp del payload", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1790790000 })).toString("base64url");
    assert.equal(expiracionJwt(`Bearer aaa.${payload}.zzz`), 1790790000);
  });
  test("null si no es JWT", () => {
    assert.equal(expiracionJwt("Bearer abc"), null);
  });
});
