import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  leerPropuestaRce, separadorDe, partirLinea, aNumero, aFecha,
  normalizarNumero, codigoTipo, normalizar,
} from "../rce.ts";

describe("normalizar títulos", () => {
  test("ignora acentos, mayúsculas y puntuación", () => {
    assert.equal(normalizar("Fecha de Emisión"), "fecha de emision");
    assert.equal(normalizar("Nro. CP"), "nro cp");
    assert.equal(normalizar("  RUC  "), "ruc");
  });
});

describe("separadorDe", () => {
  test("reconoce el punto y coma", () => {
    assert.equal(separadorDe("a;b;c;d"), ";");
  });
  test("reconoce el pipe", () => {
    assert.equal(separadorDe("a|b|c|d|e"), "|");
  });
  test("elige el que más columnas produce", () => {
    // Una razón social con comas dentro no debe ganarle al pipe.
    assert.equal(separadorDe("ruc|razon social, s.a.c.|total"), "|");
  });
});

describe("partirLinea", () => {
  test("respeta el separador dentro de comillas", () => {
    assert.deepEqual(
      partirLinea('20512201611;"ROLAND PRINT, S.A.C.";100.50', ";"),
      ["20512201611", "ROLAND PRINT, S.A.C.", "100.50"],
    );
  });
  test("entiende la comilla escapada", () => {
    assert.deepEqual(partirLinea('a;"di ""hola""";b', ";"), ["a", 'di "hola"', "b"]);
  });
  test("una celda vacía sigue contando", () => {
    assert.deepEqual(partirLinea("a;;c", ";"), ["a", "", "c"]);
  });
});

describe("aNumero", () => {
  test("lee el formato normal", () => {
    assert.equal(aNumero("1234.56"), 1234.56);
  });
  test("con coma de miles y punto decimal", () => {
    assert.equal(aNumero("1,234.56"), 1234.56);
  });
  test("con coma decimal", () => {
    assert.equal(aNumero("1234,56"), 1234.56);
  });
  test("vacío es null, no cero", () => {
    // Confundirlos haría que un comprobante sin monto cuadre con uno de S/ 0.
    assert.equal(aNumero(""), null);
    assert.equal(aNumero("   "), null);
  });
  test("lo que no es número es null", () => {
    assert.equal(aNumero("no aplica"), null);
  });
});

describe("aFecha", () => {
  test("dd/mm/yyyy, que es lo que manda SUNAT", () => {
    assert.equal(aFecha("18/03/2026"), "2026-03-18");
  });
  test("dd-mm-yyyy", () => {
    assert.equal(aFecha("02-09-2026"), "2026-09-02");
  });
  test("si ya viene en ISO se deja", () => {
    assert.equal(aFecha("2026-03-18"), "2026-03-18");
    assert.equal(aFecha("2026-03-18 00:00:00"), "2026-03-18");
  });
  test("lo que no se entiende es null, no una fecha inventada", () => {
    assert.equal(aFecha("marzo"), null);
    assert.equal(aFecha(""), null);
  });
});

describe("normalizarNumero", () => {
  test("quita los ceros de la izquierda para poder comparar", () => {
    assert.equal(normalizarNumero("00008308"), "8308");
  });
  test("un número que es solo ceros no desaparece", () => {
    assert.equal(normalizarNumero("0000"), "0");
  });
  test("vacío sigue siendo null", () => {
    assert.equal(normalizarNumero(""), null);
    assert.equal(normalizarNumero(null), null);
  });
});

describe("codigoTipo", () => {
  test("rellena a dos dígitos", () => {
    assert.equal(codigoTipo("1"), "01");
    assert.equal(codigoTipo("01"), "01");
  });
  test("vacío es null y no el código 00", () => {
    // "00" existe en la tabla de SUNAT; inventarlo sería peor que no saber.
    assert.equal(codigoTipo(""), null);
    assert.equal(codigoTipo("  "), null);
  });
});

describe("leerPropuestaRce", () => {
  const cabecera = "Periodo;RUC;Razón Social;Tipo CP/Doc;Serie del CDP;Nro CP;Fecha de emisión;Total CP;Moneda";
  const archivo = [
    cabecera,
    "202608;20100055237;FERRETERIA EL SOL S.A.C.;01;F001;00001234;05/08/2026;1,180.00;PEN",
    "202608;20512333444;GRIFO LA PONDEROSA;01;E001;567;12/08/2026;250.00;PEN",
  ].join("\n");

  test("saca las filas", () => {
    const r = leerPropuestaRce(archivo);
    assert.equal(r.filas.length, 2);
  });

  test("cada campo cae donde debe", () => {
    const f = leerPropuestaRce(archivo).filas[0];
    assert.equal(f.ruc, "20100055237");
    assert.equal(f.razonSocial, "FERRETERIA EL SOL S.A.C.");
    assert.equal(f.tipoComprobante, "01");
    assert.equal(f.serie, "F001");
    assert.equal(f.numero, "1234");          // sin ceros, para comparar
    assert.equal(f.fechaEmision, "2026-08-05");
    assert.equal(f.total, 1180);
    assert.equal(f.moneda, "PEN");
  });

  test("dice con qué columnas se quedó", () => {
    const r = leerPropuestaRce(archivo);
    const campos = r.mapeo.map(m => m.campo).sort();
    assert.deepEqual(campos, [
      "fechaEmision", "moneda", "numero", "razonSocial", "ruc", "serie",
      "tipoComprobante", "total",
    ]);
    assert.deepEqual(r.faltantes, []);
  });

  test("avisa de las columnas que no reconoció, en vez de callarse", () => {
    const r = leerPropuestaRce(archivo);
    assert.ok(r.sinMapear.includes("Periodo"));
  });

  test("avisa de lo que esperaba y no vino", () => {
    const r = leerPropuestaRce("RUC;Razón Social\n20100055237;ALGUIEN");
    assert.ok(r.faltantes.includes("serie"));
    assert.ok(r.faltantes.includes("total"));
  });

  test("guarda la fila cruda por si hay que mirarla", () => {
    const f = leerPropuestaRce(archivo).filas[0];
    assert.equal(f.cruda["Periodo"], "202608");
  });

  test("aguanta el BOM que trae Excel", () => {
    const r = leerPropuestaRce("﻿" + archivo);
    assert.equal(r.filas.length, 2);
    assert.equal(r.filas[0].ruc, "20100055237");
  });

  test("aguanta los saltos de línea de Windows", () => {
    const r = leerPropuestaRce(archivo.replace(/\n/g, "\r\n"));
    assert.equal(r.filas[0].moneda, "PEN");
  });

  test("descarta el pie de totales sin contarlo como comprobante", () => {
    const conPie = archivo + "\n;;;;;;;1,430.00;";
    const r = leerPropuestaRce(conPie);
    assert.equal(r.filas.length, 2);
    assert.equal(r.descartadas, 1);
  });

  test("un archivo vacío no revienta", () => {
    const r = leerPropuestaRce("");
    assert.deepEqual(r.filas, []);
    assert.equal(r.faltantes.length, 6);
  });

  // Es el motivo de mapear por título: SUNAT puede mover las columnas.
  test("si SUNAT cambia el orden o agrega columnas, sigue leyendo bien", () => {
    const otro = [
      "Fecha de emisión;Nro CP;Serie del CDP;CAR SUNAT;RUC;Tipo CP/Doc;Total CP",
      "05/08/2026;00001234;F001;XYZ-1;20100055237;01;1180.00",
    ].join("\n");
    const f = leerPropuestaRce(otro).filas[0];
    assert.equal(f.ruc, "20100055237");
    assert.equal(f.serie, "F001");
    assert.equal(f.numero, "1234");
    assert.equal(f.total, 1180);
  });

  test("también lee un archivo separado por pipes", () => {
    const conPipes = archivo.replace(/;/g, "|");
    const f = leerPropuestaRce(conPipes).filas[0];
    assert.equal(f.ruc, "20100055237");
    assert.equal(f.total, 1180);
  });
});

// El caso real del período 202608: el archivo trae DOS identidades y las dos
// encajan en «ruc» y «razón social». Quedándose con la primera y callando la
// segunda, las 3163 filas salieron a nombre de la propia empresa.
describe("el RCE trae dos identidades", () => {
  const cabecera = [
    "Periodo", "CAR SUNAT", "RUC", "Apellidos y Nombres o Razón social",
    "Fecha de emisión", "Tipo CP/Doc.", "Serie del CDP",
    "Nro CP o Doc. Nro Inicial (Rango)", "Tipo Doc Identidad", "Nro Doc Identidad",
    "Apellidos Nombres/ Razón Social", "Total CP", "Moneda",
  ].join(";");
  const fila = [
    "202608", "CAR-1", "20512201611", "INDUSTRIAS ROLAND PRINT S.A.C",
    "05/08/2026", "01", "E001", "1", "6", "20100055237",
    "FERRETERIA EL SOL S.A.C.", "23.60", "PEN",
  ].join(";");
  const r = leerPropuestaRce(cabecera + "\n" + fila);

  test("ninguna columna se pierde: todas están en alguna lista", () => {
    const contadas = r.mapeo.length + r.sinMapear.length + r.duplicadas.length;
    assert.equal(contadas, 13);
  });

  // Lo que faltaba: esta columna no aparecía en ninguna lista, así que no
  // había forma de notar que el cruce miraba la identidad equivocada.
  test("avisa de la segunda identidad en vez de descartarla callado", () => {
    const titulos = r.duplicadas.map(d => d.titulo);
    assert.ok(titulos.includes("Nro Doc Identidad"), `duplicadas: ${titulos}`);
    assert.ok(titulos.includes("Apellidos Nombres/ Razón Social"), `duplicadas: ${titulos}`);
  });

  test("guarda los títulos en orden y una fila de ejemplo", () => {
    assert.equal(r.titulos.length, 13);
    assert.equal(r.titulos[2], "RUC");
    assert.equal(r.ejemplo[2], "20512201611");
    assert.equal(r.ejemplo[10], "FERRETERIA EL SOL S.A.C.");
  });
});
