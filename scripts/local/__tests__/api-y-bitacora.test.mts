import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodificarArchivo } from "../api/cliente.mts";
import { claveHttp } from "../comun/bitacora.mts";
import { claveDesdeTexto } from "../comun/config.mts";

const P = { proveedorRuc: "10181820328", tipoComprobante: "01", serie: "F002", numero: "3792" };

describe("decodificarArchivo", () => {
  test("XML en zip, base64 normal", () => {
    const zip = Buffer.from("PK\x03\x04resto", "latin1");
    const a = decodificarArchivo({ nomArchivo: "10181820328-01-F002-3792", valArchivo: zip.toString("base64") }, "XML", P);
    assert.equal(a?.nombre, "10181820328-01-F002-3792.zip");
    assert.equal(a?.tipo, "application/zip");
    assert.deepEqual(a?.datos, zip);
  });
  test("base64 url-safe y con prefijo data: (como normaliza la app)", () => {
    const datos = Buffer.from([0xfb, 0xff, 0xfe, 0x3c]);
    const url = datos.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const a = decodificarArchivo({ nomArchivo: "x", valArchivo: `data:text/plain;base64,${url}` }, "XML", P);
    assert.deepEqual(a?.datos, datos);
    assert.equal(a?.nombre, "x.xml");
  });
  test("PDF sin nombre usa la identidad del comprobante", () => {
    const a = decodificarArchivo({ valArchivo: Buffer.from("%PDF-1.4").toString("base64") }, "PDF", P);
    assert.equal(a?.nombre, "10181820328-01-F002-3792.pdf");
    assert.equal(a?.tipo, "application/pdf");
  });
  test("sin valArchivo → null", () => {
    assert.equal(decodificarArchivo({ nomArchivo: "x" }, "XML", P), null);
    assert.equal(decodificarArchivo(null, "XML", P), null);
  });
});

describe("claveHttp", () => {
  test("agrupa por servicio, no por comprobante", () => {
    assert.equal(
      claveHttp("GET", "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/10181820328-01-F002-3792-2", 500),
      "GET 500 api-cpe.sunat.gob.pe /v1/contribuyente/consultacpe/comprobantes/:id");
    assert.equal(
      claveHttp("GET", "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/20100070970-01-F001-15-2/02", 200),
      "GET 200 api-cpe.sunat.gob.pe /v1/contribuyente/consultacpe/comprobantes/:id/02");
    assert.equal(
      claveHttp("GET", "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/20512201611-01-2?fecEmisionIni=01/08/2026", 200),
      "GET 200 api-cpe.sunat.gob.pe /v1/contribuyente/consultacpe/comprobantes/:lista");
  });
});

describe("claveDesdeTexto", () => {
  const google = { type: "service_account", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", client_email: "x@y" };
  test("el .json de Google tal cual", () => {
    assert.deepEqual(JSON.parse(claveDesdeTexto(JSON.stringify(google))), google);
  });
  test("envuelto en GOOGLE_SA_PRIVATE_KEY (como secrets/sa.json)", () => {
    assert.deepEqual(JSON.parse(claveDesdeTexto(JSON.stringify({ GOOGLE_SA_PRIVATE_KEY: google }))), google);
  });
  test("con BOM de Windows", () => {
    assert.deepEqual(JSON.parse(claveDesdeTexto("﻿" + JSON.stringify(google))), google);
  });
  test("PEM suelta", () => {
    assert.equal(claveDesdeTexto("-----BEGIN PRIVATE KEY-----\nabc"), "-----BEGIN PRIVATE KEY-----\nabc");
  });
});
