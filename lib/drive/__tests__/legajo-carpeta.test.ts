import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clavesDeArchivo, documentosDeOC, textoDeDocumentos, asignarCentroDeCosto, agruparAdministrativo, AREA_ADMINISTRATIVA,
} from "../legajo-carpeta.ts";

test("qué documento del legajo es cada archivo", () => {
  assert.deepEqual(clavesDeArchivo("FACTURA"), ["FACTURA"]);
  assert.deepEqual(clavesDeArchivo("XML"), ["FACTURA"]);
  assert.deepEqual(clavesDeArchivo("RECIBO POR HONORARIOS"), ["FACTURA"]);
  assert.deepEqual(clavesDeArchivo("GUÍA (por la carpeta)"), ["GUIA"]);
  assert.deepEqual(clavesDeArchivo("ORDEN DE COMPRA/SERVICIO"), ["OC"]);
  assert.deepEqual(clavesDeArchivo("COTIZACIÓN"), ["COTIZACION"]);
  assert.deepEqual(clavesDeArchivo("FICHA TÉCNICA"), []);
  // Un «scan001.pdf» leído por dentro que trae factura y guía cuenta como las dos.
  assert.deepEqual(clavesDeArchivo("OTRO", ["FACTURA", "GUIA"]).sort(), ["FACTURA", "GUIA"]);
});

test("lo que le falta a una OC, como en el legajo", () => {
  const a = (...claves: string[]) => ({ claves });
  // Un bien nacional: factura y guía.
  const bien = documentosDeOC([a("OC"), a("FACTURA"), a("COTIZACION")], { servicio: false, importacion: false });
  assert.deepEqual(bien.leFalta, ["Guía de remisión"]);
  assert.equal(bien.estado, "INCOMPLETA");
  assert.equal(textoDeDocumentos(bien.cuenta), "Factura 1 · OC 1 · Cotización 1");
  // Un servicio: factura y acta, no guía.
  const servicio = documentosDeOC([a("FACTURA"), a("ACTA")], { servicio: true, importacion: false });
  assert.deepEqual(servicio.leFalta, []);
  assert.equal(servicio.estado, "OK");
  // Una importación: además la DAM.
  assert.deepEqual(documentosDeOC([a("FACTURA"), a("GUIA")], { servicio: false, importacion: true }).leFalta, ["DAM"]);
  assert.equal(textoDeDocumentos(documentosDeOC([a("GUIA")], { servicio: false, importacion: false }).cuenta), "Guía de remisión 1");
  assert.equal(documentosDeOC([], { servicio: false, importacion: false }).estado, "VACÍA");
});

// El catálogo real de CG (parte), con cuántas OC tiene cada uno.
const cc = (nombre: string, ocs: number, codigo = "-") => ({ codigo, nombre, ocs });
const CATALOGO = [
  cc("PRONIED - TALLERES ESPECIALIZADO", 908, "PROY-2025-079-5"),
  cc("PEIP - CHINA CIVIL PAQ 02 - TALLER ESPECIALIZADO", 404, "PROY-2025-012-01"),
  cc("PRONIED - TALLERES EPT I y II", 369, "PROY-2025-077-3"),
  cc("PEIP - EB GESTORES PAQ 08 - EQ INTEGRAL", 218, "PROY-2025-011-2"),
  cc("PEIP - JJC PAQ 05 - TALLER ESPECIALIZADO - LIMA", 202, "PROY-2025-004-01"),
  cc("ÁREA ADMINISTRATIVA", 177),
  cc("LP 15-2025 PRONIED - TALLER EPT - IE JUAN ESPINOZA MEDRANO - APURIMAC", 107, "PROY-2025-196"),
  cc("PEIP - JJC PAQ 05 - TALLER DE HERRAMIENTAS MECÁNICAS - LIMA", 53, "PROY-2025-004-09"),
  cc("ÁREA ADMINISTRATIVA SISTEMAS", 48),
  cc("PEIP - CHINA CIVIL PAQ 07 - EQ INTEGRAL ( ZRAFPHCO SOLUCIONES SAC )", 40, "PROY-2025-027"),
  cc("PRONIED - 53 LABORATORIOS 2026", 17, "PROY-2026-041"),
  cc("DES - MATERIAL CONCRETO PARA MATEMATICA - LIMA", 11, "PROY-2026-023"),
  cc("LP 009-2022 TALLERES", 2),
  cc("PROYECTO DE INVERSIÓN VAKIMU - INROPLAS", 1, "PROY-2026-025"),
];

test("centro de costo por lo que dice CG de las OC de la carpeta", () => {
  // TALLERES ESPECIALIZADOS: 417 de 430 OC en CG van a ese centro de costo.
  const t = asignarCentroDeCosto("01) TALLERES ESPECIALIZADOS", [
    cc("PRONIED - TALLERES ESPECIALIZADO", 417, "PROY-2025-079-5"), cc("PRONIED - TALLERES EPT I y II", 13), cc("ÁREA ADMINISTRATIVA", 3),
  ], CATALOGO);
  assert.equal(t.fuente, "CG");
  assert.equal(t.codigo, "PROY-2025-079-5");
  assert.equal(t.revisar, false);
  // «PROYECTO MATERIALES DE MATEMÁTICA»: 6 al área administrativa y 1 a pedagogía → administrativa general.
  const m = asignarCentroDeCosto("PROYECTO MATERIALES DE MATEMÁTICA", [cc("ÁREA ADMINISTRATIVA", 6), cc("ÁREA ADMINISTRATIVA PEDAGOGÍA", 1)], CATALOGO);
  assert.equal(m.fuente, "CG");
  assert.deepEqual({ codigo: m.codigo, nombre: m.nombre }, AREA_ADMINISTRATIVA);
});

test("si la mayoría de CG no es clara, manda el nombre cuando CG también lo usa", () => {
  // 15) MATERIAL CONCRETO PARA MATEMATICA: 3 OC a INTERCOMPANIES y 2 a DES - MATERIAL CONCRETO.
  const m = asignarCentroDeCosto("15)  MATERIAL CONCRETO PARA MATEMATICA",
    [cc("INTERCOMPANIES", 3), cc("DES - MATERIAL CONCRETO PARA MATEMATICA - LIMA", 2, "PROY-2026-023")], CATALOGO);
  assert.equal(m.codigo, "PROY-2026-023");
  assert.equal(m.fuente, "NOMBRE");
  assert.equal(m.revisar, true);
  // Con mayoría clara (80% o más), manda CG aunque el nombre diga otra cosa.
  assert.equal(asignarCentroDeCosto("MATERIAL CONCRETO", [cc("INTERCOMPANIES", 4), cc("DES - MATERIAL CONCRETO PARA MATEMATICA - LIMA", 1, "PROY-2026-023")], CATALOGO).nombre, "INTERCOMPANIES");
});

test("con 1 o 2 OC en CG que coinciden, también manda CG", () => {
  const p = asignarCentroDeCosto("PRONTE", [cc("PROYECTO DE INVERSIÓN VAKIMU - INROPLAS", 1, "PROY-2026-025")], CATALOGO);
  assert.equal(p.fuente, "CG");
  assert.equal(p.revisar, true);
  // 1 y 1 a distintos centros: no hay acuerdo, se sigue por el nombre.
  assert.equal(asignarCentroDeCosto("MEDRANO", [cc("STOCK", 1), cc("INTERCOMPANIES", 1)], CATALOGO).codigo, "PROY-2025-196");
});

test("las carpetas administrativas van al área administrativa general", () => {
  // «GENERAL» tiene sus OC repartidas en CG: por el nombre, administrativa.
  const g = asignarCentroDeCosto("GENERAL", [cc("ÁREA ADMINISTRATIVA DISEÑO", 3), cc("DEI - PANDERETA DE MADERA - LIMA", 2), cc("ÁREA ADMINISTRATIVA", 2), cc("DES - MATERIAL CONCRETO PARA MATEMATICA - LIMA", 2)], CATALOGO);
  assert.equal(g.fuente, "ADMINISTRATIVO");
  assert.equal(g.nombre, "ÁREA ADMINISTRATIVA");
  assert.equal(asignarCentroDeCosto("GERENCIA", [], CATALOGO).fuente, "ADMINISTRATIVO");
  assert.equal(asignarCentroDeCosto("ADM MODULO DE MATEMÁTICAS", [], CATALOGO).fuente, "ADMINISTRATIVO");
  assert.deepEqual(agruparAdministrativo({ codigo: "-", nombre: "ÁREA ADMINISTRATIVA SISTEMAS" }), AREA_ADMINISTRATIVA);
});

test("sin OC en CG, por el nombre de la carpeta", () => {
  const nombre = (p: string) => asignarCentroDeCosto(p, [], CATALOGO);
  assert.equal(nombre("MEDRANO").codigo, "PROY-2025-196");
  assert.equal(nombre("TALLERES EPT").codigo, "PROY-2025-077-3");
  assert.equal(nombre("TALLERES ESPECIALIZADO").codigo, "PROY-2025-079-5");
  assert.equal(nombre("PAQ 2 CHINA").codigo, "PROY-2025-012-01");
  assert.equal(nombre("PRONIED - 53 LABORATORIOS (MUESTRAS)").codigo, "PROY-2026-041");
  assert.equal(nombre("PROYECTO MATEMATICA (CONCRETO)").codigo, "PROY-2026-023");
  assert.equal(nombre("VAKIMU INTERCOMPANY").codigo, "PROY-2026-025");
  // «JJC PAQ 5»: varios JJC PAQ 05 empatan → el más usado, para revisar.
  const jjc = nombre("JJC PAQ 5");
  assert.equal(jjc.codigo, "PROY-2025-004-01");
  assert.equal(jjc.revisar, true);
  // Nada que ver con ningún centro de costo.
  assert.equal(nombre("CARPETA NUEVA XYZ").fuente, "SIN ASIGNAR");
});
