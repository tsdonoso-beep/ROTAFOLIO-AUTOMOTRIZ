import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarOCs, ccPrincipalPorOc, catalogoDeCG } from "../analisis-carpetas.ts";

const CATALOGO = [
  { codigo: "PROY-2025-079-5", nombre: "PRONIED - TALLERES ESPECIALIZADO", ocs: 908 },
  { codigo: "PROY-2025-196", nombre: "LP 15-2025 PRONIED - TALLER EPT - IE JUAN ESPINOZA MEDRANO - APURIMAC", ocs: 107 },
  { codigo: "-", nombre: "ÁREA ADMINISTRATIVA", ocs: 177 },
];
const TALLERES = { codigo: "PROY-2025-079-5", nombre: "PRONIED - TALLERES ESPECIALIZADO" };

test("cada OC: su centro de costo de CG; si no está, el de su carpeta de proyecto", () => {
  const { porOc, proyectos } = analizarOCs({
    importacion: false,
    ccPorOc: new Map([["0200-2026", TALLERES], ["0201-2026", TALLERES], ["0202-2026", TALLERES]]),
    manual: new Map(),
    catalogo: CATALOGO,
    ocs: [
      { clave: "a", oc: "0200-2026", tipo: "OC", proyectoCarpeta: "01) TALLERES ESPECIALIZADOS ", archivos: [{ claves: ["FACTURA"] }, { claves: ["GUIA"] }] },
      { clave: "b", oc: "0201-2026", tipo: "OC", proyectoCarpeta: "01) TALLERES ESPECIALIZADOS", archivos: [{ claves: ["OC"] }] },
      { clave: "c", oc: "0202-2026", tipo: "OS", proyectoCarpeta: "01) TALLERES ESPECIALIZADOS", archivos: [{ claves: ["FACTURA"] }] },
      // No está en CG: toma el de la carpeta (que CG respalda con 3 de 3).
      { clave: "d", oc: "0999-2026", tipo: "OC", proyectoCarpeta: "01) TALLERES ESPECIALIZADOS", archivos: [] },
      // Carpeta administrativa, sin OC en CG.
      { clave: "e", oc: "0998-2026", tipo: "OC", proyectoCarpeta: "02) ADMINISTRACION", archivos: [{ claves: ["FACTURA", "GUIA"] }] },
    ],
  });
  assert.deepEqual(porOc.get("a")!.cc, { ...TALLERES, fuente: "CG" });
  assert.equal(porOc.get("a")!.docs.estado, "OK");
  assert.deepEqual(porOc.get("b")!.docs.leFalta, ["Factura", "Guía"]);
  assert.deepEqual(porOc.get("c")!.docs.leFalta, ["Acta de conformidad"]);   // servicio: acta, no guía
  assert.deepEqual(porOc.get("d")!.cc, { ...TALLERES, fuente: "CG" });       // regla de la carpeta, que viene de CG
  assert.equal(porOc.get("d")!.docs.estado, "VACÍA");
  assert.equal(porOc.get("e")!.cc.nombre, "ÁREA ADMINISTRATIVA");
  assert.equal(porOc.get("e")!.cc.fuente, "ADMINISTRATIVO");
  assert.deepEqual(proyectos.map(p => [p.proyectoCarpeta, p.ocs, p.ocsEnCg, p.fuente]), [
    ["01) TALLERES ESPECIALIZADOS", 4, 3, "CG"],
    ["02) ADMINISTRACION", 1, 0, "ADMINISTRATIVO"],
  ]);
});

test("lo corregido a mano manda sobre la regla automática", () => {
  const { porOc, proyectos } = analizarOCs({
    importacion: true, ccPorOc: new Map(), catalogo: CATALOGO,
    manual: new Map([["MEDRANO", { codigo: "X-1", nombre: "OTRO CENTRO" }]]),
    ocs: [{ clave: "a", oc: "032-2026", tipo: "OC", proyectoCarpeta: "MEDRANO", archivos: [{ claves: ["FACTURA", "GUIA"] }] }],
  });
  assert.deepEqual(porOc.get("a")!.cc, { codigo: "X-1", nombre: "OTRO CENTRO", fuente: "MANUAL" });
  assert.deepEqual(porOc.get("a")!.docs.leFalta, ["DAM"]);   // importación: también la DAM
  assert.equal(proyectos[0].manual, true);
});

test("el centro de costo principal de una OC en CG y el catálogo", () => {
  const filas = [
    { oc: "0200-2026", cc_codigo: "A", cc_nombre: "CC A", lineas: 1 },
    { oc: "0200-2026", cc_codigo: "B", cc_nombre: "CC B", lineas: 5 },
    { oc: "0201-2026", cc_codigo: "A", cc_nombre: "CC A", lineas: 2 },
    { oc: "0202-2026", cc_codigo: "-", cc_nombre: null, lineas: 2 },
  ];
  assert.deepEqual(ccPrincipalPorOc(filas).get("0200-2026"), { codigo: "B", nombre: "CC B" });
  assert.equal(ccPrincipalPorOc(filas).has("0202-2026"), false);
  assert.deepEqual(catalogoDeCG(filas).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [{ codigo: "A", nombre: "CC A", ocs: 2 }, { codigo: "B", nombre: "CC B", ocs: 1 }]);
});
