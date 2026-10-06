import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { armarDireccion, leerLineaPadron, lugarDeUbigeo, ubigeosDesdeLista } from "../padron-reducido.ts";

// Líneas tal como vienen en padron_reducido_ruc.txt (ya en UTF-8).
const INROPRIN = "20512201611|INDUSTRIAS ROLAND PRINT S.A.C - INROPRIN S.A.C|ACTIVO|HABIDO|150120|JR.|CUZCO|-|-|343|-|-|-|-|-|";
const CON_ZONA = "20330033313|PERUANA DE ESTACIONES DE SERVICIOS S.A.C|BAJA DEFINITIVA|HABIDO|150140|AV.|CIRCUNVALACIÓN DEL CLUB G|URB.|CLUB EL GOLF LOS INCAS|134|1801|-|205|-|-|";
const SIN_VIA = "20600662458|A TODO GAS PERU E.I.R.L.|BAJA DE OFICIO|HABIDO|150108|-|-|URB.|LAS DELICIAS DE VILLA|-|-|10|-|F14|-|";
const KILOMETRO = "20462604735|CORPORACION GTM DEL PERU S.A.|ACTIVO|HABIDO|150123|CAR.|PANAMERICANA SUR|Z.I.|CONCHAN|-|-|-|-|-|25|";
const VIA_SIN_TIPO = "20330791412|ORYGEN PERU S.A.A.|ACTIVO|HABIDO|150130|----|PASEO DEL BOSQUE|URB.|CHACARILLA DEL ESTANQUE|500|-|-|-|-|-|";
const PERSONA = "10452159428|GARCIA CHANCO CARLOS AUGUSTO|ACTIVO|HABIDO|-|-|-|-|-|-|-|-|-|-|-|";
const CABECERA = "RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO|";

describe("leerLineaPadron", () => {
  test("una empresa con su dirección", () => {
    assert.deepEqual(leerLineaPadron(INROPRIN), {
      ruc: "20512201611", razonSocial: "INDUSTRIAS ROLAND PRINT S.A.C - INROPRIN S.A.C", estado: "ACTIVO",
      condicion: "HABIDO", ubigeo: "150120", direccion: "JR. CUZCO NRO. 343",
    });
  });

  test("interior, departamento y zona, en el orden de la Consulta RUC", () => {
    assert.equal(leerLineaPadron(CON_ZONA)?.direccion, "AV. CIRCUNVALACIÓN DEL CLUB G NRO. 134 INT. 1801 DPTO. 205 URB. CLUB EL GOLF LOS INCAS");
  });

  test("sin vía: manzana, lote y zona", () => {
    assert.equal(leerLineaPadron(SIN_VIA)?.direccion, "MZA. F14 LOTE. 10 URB. LAS DELICIAS DE VILLA");
  });

  test("carretera con kilómetro", () => {
    assert.equal(leerLineaPadron(KILOMETRO)?.direccion, "CAR. PANAMERICANA SUR KM. 25 Z.I. CONCHAN");
  });

  test("«----» como tipo de vía no se escribe", () => {
    assert.equal(leerLineaPadron(VIA_SIN_TIPO)?.direccion, "PASEO DEL BOSQUE NRO. 500 URB. CHACARILLA DEL ESTANQUE");
  });

  test("persona natural: SUNAT no publica su dirección", () => {
    const p = leerLineaPadron(PERSONA);
    assert.equal(p?.ubigeo, "");
    assert.equal(p?.direccion, "");
    assert.equal(p?.estado, "ACTIVO");
  });

  test("la cabecera y las líneas rotas no son datos", () => {
    assert.equal(leerLineaPadron(CABECERA), null);
    assert.equal(leerLineaPadron(""), null);
    assert.equal(leerLineaPadron("20512201611|INROPRIN"), null);
  });
});

describe("ubigeo", () => {
  const nombres = ubigeosDesdeLista([
    { departamento: "15", provincia: "00", distrito: "00", nombre: "Lima" },
    { departamento: "15", provincia: "01", distrito: "00", nombre: "Lima" },
    { departamento: "15", provincia: "01", distrito: "20", nombre: "Magdalena del Mar" },
    { departamento: "07", provincia: "00", distrito: "00", nombre: "Callao" },
    { departamento: "07", provincia: "01", distrito: "00", nombre: "Callao" },
    { departamento: "07", provincia: "01", distrito: "06", nombre: "Ventanilla" },
  ]);

  test("de seis dígitos a departamento, provincia y distrito", () => {
    assert.deepEqual(lugarDeUbigeo("150120", nombres), { departamento: "Lima", provincia: "Lima", distrito: "Magdalena del Mar" });
    assert.deepEqual(lugarDeUbigeo("070106", nombres), { departamento: "Callao", provincia: "Callao", distrito: "Ventanilla" });
  });

  test("sin ubigeo o desconocido: vacío, sin inventar", () => {
    assert.deepEqual(lugarDeUbigeo("", nombres), { departamento: "", provincia: "", distrito: "" });
    assert.deepEqual(lugarDeUbigeo("159999", nombres), { departamento: "Lima", provincia: "", distrito: "" });
  });

  test("armarDireccion con todo vacío", () => {
    assert.equal(armarDireccion(["-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]), "");
  });
});
