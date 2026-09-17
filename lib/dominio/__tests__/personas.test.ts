import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aplanar, buscarPersonas, cuadrillasSugeridas, valoresPara,
  type Cuadrilla, type Persona,
} from "../personas.ts";

// Nombres reales de la plantilla, con sus tildes y sus eñes.
const plantilla: Persona[] = [
  { id: "1", nombre: "WILMER GERARDO ZAMORA CARRILO", dni: "73218372",
    cargo: "TECNICO EN INSTALACIONES", area: null },
  { id: "2", nombre: "GEYLER KENY NIÑO HERRERA", dni: "76842508",
    cargo: "TECNICO EN INSTALACIONES", area: null },
  { id: "3", nombre: "Paulo Cesar Salas Abad", dni: "73091123",
    cargo: "SUPERVISOR", area: "IRP 10 - GESTIÓN DE PROYECTOS" },
  { id: "4", nombre: "Alonzo Huanca Dueñas", dni: "73894159",
    cargo: "SUPERVISOR", area: "IRP 10 - GESTIÓN DE PROYECTOS" },
  { id: "5", nombre: "César Alfio Luna Cavani", dni: "41519559",
    cargo: "ESPECIALISTA", area: "IRP 12 - ÁREA TÉCNICA Y CALIDAD" },
];

const ids = (r: Persona[]) => r.map(p => p.id);

describe("escribir de apuro", () => {
  it("la eñe no se escribe cuando uno busca rápido", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "nino" })), ["2"]);
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "duenas" })), ["4"]);
  });

  it("la tilde tampoco", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "cesar" })).sort(),
      ["3", "5"]);
  });

  // Escrito con tilde encuentra lo mismo que sin ella, en los dos sentidos:
  // «César» también trae a Paulo Cesar, que la lleva sin tilde.
  it("escribirlo con tilde da el mismo resultado que sin ella", () => {
    assert.deepEqual(
      ids(buscarPersonas(plantilla, { consulta: "César" })),
      ids(buscarPersonas(plantilla, { consulta: "cesar" }))
    );
  });

  it("no distingue mayúsculas: media plantilla está en mayúscula y media no", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "WILMER" })), ["1"]);
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "wilmer" })), ["1"]);
  });
});

describe("buscar por trozos", () => {
  // En el seguimiento conviven los dos órdenes, así que los dos tienen
  // que funcionar.
  it("apellido primero encuentra igual que nombre primero", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "zamora wilmer" })), ["1"]);
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "wilmer zamora" })), ["1"]);
  });

  it("tres letras ya reducen 124 nombres a uno", () => {
    assert.equal(buscarPersonas(plantilla, { consulta: "wil" }).length, 1);
  });

  it("también busca por DNI, que es como lo pide Contabilidad", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "73218372" })), ["1"]);
  });

  it("y por cargo, para armar una cuadrilla de técnicos", () => {
    assert.deepEqual(ids(buscarPersonas(plantilla, { consulta: "tecnico" })), ["1", "2"]);
  });

  it("sin consulta están todos: la lista completa siempre alcanzable", () => {
    assert.equal(buscarPersonas(plantilla, {}).length, 5);
    assert.equal(buscarPersonas(plantilla, { consulta: "   " }).length, 5);
  });

  it("lo que no existe no devuelve a nadie, en vez de devolver cualquiera", () => {
    assert.deepEqual(buscarPersonas(plantilla, { consulta: "zzz" }), []);
  });

  it("aplanar deja el texto comparable", () => {
    assert.equal(aplanar("  NIÑO Herrera  "), "nino herrera");
  });
});

describe("los filtros acotan, no obligan", () => {
  it("por área deja sólo a los de esa área", () => {
    assert.deepEqual(
      ids(buscarPersonas(plantilla, { area: "IRP 10 - GESTIÓN DE PROYECTOS" })),
      ["3", "4"]
    );
  });

  it("se combinan con lo escrito", () => {
    assert.deepEqual(
      ids(buscarPersonas(plantilla, { area: "IRP 10 - GESTIÓN DE PROYECTOS", consulta: "paulo" })),
      ["3"]
    );
  });

  // El 64% de las asignaciones son de gente sin área: sin filtro tienen que
  // seguir apareciendo.
  it("sin filtro, los que no tienen área siguen ahí", () => {
    const r = buscarPersonas(plantilla, { consulta: "tecnico" });
    assert.ok(r.every(p => p.area === null));
    assert.equal(r.length, 2);
  });
});

describe("qué chips vale la pena ofrecer", () => {
  it("sólo los que agrupan a dos o más: uno solo no ahorra nada", () => {
    assert.deepEqual(valoresPara(plantilla, "cargo"), [
      { valor: "SUPERVISOR", cuantos: 2 },
      { valor: "TECNICO EN INSTALACIONES", cuantos: 2 },
    ]);
  });

  it("«sin área» no es una categoría: es un dato que falta", () => {
    const r = valoresPara(plantilla, "area");
    assert.deepEqual(r, [{ valor: "IRP 10 - GESTIÓN DE PROYECTOS", cuantos: 2 }]);
  });
});

// Un memo de once personas no se arma eligiendo once veces de una lista.
describe("copiar la cuadrilla anterior", () => {
  const c = (memoId: string, centro: string | null, fecha: string, n: number): Cuadrilla => ({
    memoId, correlativo: `MEMO-${memoId}`, destino: null,
    centroCostoId: centro, fecha,
    personas: Array.from({ length: n }, (_, i) => `p${i}`),
  });

  const historial = [
    c("a", "ceco-1", "2026-08-09", 11),
    c("b", "ceco-2", "2026-09-01", 4),
    c("c", "ceco-1", "2026-07-20", 10),
    c("d", "ceco-1", "2026-09-10", 1),
  ];

  it("primero las del mismo proyecto: la obra se repite con la misma gente", () => {
    const r = cuadrillasSugeridas(historial, "ceco-1");
    assert.deepEqual(r.map(x => x.memoId), ["a", "c", "b"]);
  });

  it("dentro del proyecto, la más reciente primero", () => {
    const r = cuadrillasSugeridas(historial, "ceco-1");
    assert.equal(r[0].fecha, "2026-08-09");
  });

  it("copiar a una sola persona no es copiar: se descarta", () => {
    assert.ok(!cuadrillasSugeridas(historial, "ceco-1").some(x => x.memoId === "d"));
  });

  it("sin proyecto elegido, manda la fecha", () => {
    assert.deepEqual(cuadrillasSugeridas(historial, null).map(x => x.memoId),
      ["b", "a", "c"]);
  });

  it("no ofrece más de las que caben", () => {
    assert.equal(cuadrillasSugeridas(historial, "ceco-1", 2).length, 2);
  });
});
