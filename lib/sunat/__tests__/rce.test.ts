import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  leerPropuestaRce, separadorDe, partirLinea, aNumero, aFecha,
  normalizarNumero, codigoTipo, normalizar, revisarIdentidad, partirCsv, type FilaRce,
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
    // Un archivo con una sola identidad: sus columnas son las del generador,
    // y la fila las usa como contraparte por respaldo.
    assert.deepEqual(campos, [
      "fechaEmision", "moneda", "numero", "razonGenerador", "rucGenerador",
      "serie", "tipoComprobante", "total",
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
    assert.equal(contadas, r.titulos.length);
    assert.equal(contadas, 13);
  });

  // El fallo que dio 3163 filas a nombre de la propia empresa.
  test("el RUC es el del proveedor, no el de quien genera el registro", () => {
    assert.equal(r.filas[0].ruc, "20100055237");
    assert.equal(r.filas[0].razonSocial, "FERRETERIA EL SOL S.A.C.");
  });

  test("la identidad del generador se guarda aparte, sin pisar la del proveedor", () => {
    assert.equal(r.filas[0].rucGenerador, "20512201611");
    assert.equal(r.filas[0].razonGenerador, "INDUSTRIAS ROLAND PRINT S.A.C");
  });

  test("las dos identidades se mapean, ninguna queda como duplicada", () => {
    const campos = r.mapeo.map(m => m.campo);
    for (const c of ["ruc", "razonSocial", "rucGenerador", "razonGenerador"]) {
      assert.ok(campos.includes(c as never), `falta ${c} en ${campos}`);
    }
    assert.deepEqual(r.duplicadas, []);
  });

  test("con este archivo la comprobación de identidad no salta", () => {
    assert.equal(revisarIdentidad(r.filas, "20512201611").ok, true);
  });

  test("guarda los títulos en orden y una fila de ejemplo", () => {
    assert.equal(r.titulos.length, 13);
    assert.equal(r.titulos[2], "RUC");
    assert.equal(r.ejemplo[2], "20512201611");
    assert.equal(r.ejemplo[10], "FERRETERIA EL SOL S.A.C.");
  });
});

describe("revisarIdentidad", () => {
  const fila = (ruc: string | null): FilaRce => ({
    ruc, razonSocial: "X", rucGenerador: "20512201611", razonGenerador: "INROPRIN",
    tipoComprobante: "01", serie: "E001", numero: "1",
    fechaEmision: "2026-08-05", total: 10, moneda: "PEN", cruda: {},
    carSunat: null, estado: "1", tipoNota: null, modifica: null,
    impuestos: { baseDg: null, igvDg: null, baseDgng: null, igvDgng: null,
                 baseDng: null, igvDng: null },
    detraccion: null, tipoCambio: null,
  });

  // Lo que pasó con el período 202608 antes de separar las dos identidades.
  test("denuncia cuando todo sale a nombre de la propia empresa", () => {
    const r = revisarIdentidad(Array.from({ length: 3163 }, () => fila("20512201611")), "20512201611");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.motivo, /imposible/);
      assert.equal(r.cuantas, 3163);
    }
  });

  test("con proveedores de verdad no dice nada", () => {
    const filas = [fila("20100055237"), fila("20512333444"), fila("10456789012")];
    assert.equal(revisarIdentidad(filas, "20512201611").ok, true);
  });

  // Una empresa sí puede emitirse algún comprobante a sí misma.
  test("unos pocos propios no son un problema", () => {
    const filas = [fila("20512201611"), ...Array.from({ length: 30 }, () => fila("20100055237"))];
    assert.equal(revisarIdentidad(filas, "20512201611").ok, true);
  });

  test("sin filas no inventa un problema", () => {
    assert.equal(revisarIdentidad([], "20512201611").ok, true);
    assert.equal(revisarIdentidad([fila(null)], "20512201611").ok, true);
  });
});

// Lo que hace falta para avisar «la factura que rendiste ya no vale».
describe("notas de crédito y estado del comprobante", () => {
  const cabecera = [
    "Periodo", "CAR SUNAT", "RUC", "Apellidos y Nombres o Razón social",
    "Fecha de emisión", "Tipo CP/Doc.", "Serie del CDP",
    "Nro CP o Doc. Nro Inicial (Rango)", "Nro Doc Identidad",
    "Apellidos Nombres/ Razón Social", "Total CP", "Moneda", "Tipo de Nota",
    "Fecha Emisión Doc Modificado", "Tipo CP Modificado", "Serie CP Modificado",
    "Nro CP Modificado", "Est. Comp.",
  ].join(";");

  const factura = [
    "202608", "CAR-100", "20512201611", "INROPRIN", "05/08/2026", "01", "E001",
    "500", "20100055237", "FERRETERIA EL SOL", "118.00", "PEN", "", "", "", "", "", "1",
  ].join(";");

  const nota = [
    "202608", "CAR-200", "20512201611", "INROPRIN", "20/08/2026", "07", "E001",
    "9", "20100055237", "FERRETERIA EL SOL", "-118.00", "PEN", "01",
    "05/08/2026", "01", "E001", "00000500", "1",
  ].join(";");

  const r = leerPropuestaRce([cabecera, factura, nota].join("\n"));

  test("una factura normal no dice que modifica nada", () => {
    assert.equal(r.filas[0].modifica, null);
    assert.equal(r.filas[0].tipoNota, null);
  });

  test("la nota de crédito apunta a la factura que corrige", () => {
    const n = r.filas[1];
    assert.equal(n.tipoComprobante, "07");
    assert.deepEqual(n.modifica, {
      tipo: "01", serie: "E001", numero: "500", fechaEmision: "2026-08-05",
    });
  });

  // El número llega con ceros de un lado y sin ellos del otro: si no se
  // normaliza, la nota nunca encuentra su factura.
  test("el número de la factura modificada queda comparable con el de la factura", () => {
    assert.equal(r.filas[1].modifica?.numero, r.filas[0].numero);
  });

  test("guarda el identificador que SUNAT le pone a cada comprobante", () => {
    assert.equal(r.filas[0].carSunat, "CAR-100");
    assert.equal(r.filas[1].carSunat, "CAR-200");
  });

  test("guarda el estado del comprobante", () => {
    assert.equal(r.filas[0].estado, "1");
  });

  test("las columnas de la nota ya no se descartan como duplicadas", () => {
    assert.deepEqual(r.duplicadas, []);
    const campos = r.mapeo.map(m => m.campo);
    for (const c of ["carSunat", "estado", "tipoNota", "modificaTipo",
                     "modificaSerie", "modificaNumero", "modificaFecha"]) {
      assert.ok(campos.includes(c as never), `falta ${c}`);
    }
  });
});

// Los impuestos deciden el crédito fiscal, que es el trabajo de Contabilidad.
describe("impuestos, detracción y tipo de cambio", () => {
  const cabecera = [
    "RUC", "Apellidos y Nombres o Razón social", "Fecha de emisión",
    "Tipo CP/Doc.", "Serie del CDP", "Nro CP o Doc. Nro Inicial (Rango)",
    "BI Gravado DG", "IGV / IPM DG", "BI Gravado DGNG", "IGV / IPM DGNG",
    "BI Gravado DNG", "IGV / IPM DNG", "Detracción", "Tipo de Cambio",
    "Total CP", "Moneda",
  ].join(";");
  const fila = [
    "20100055237", "FERRETERIA EL SOL", "05/08/2026", "01", "E001", "500",
    "100.00", "18.00", "50.00", "9.00", "25.00", "0.00",
    "12.00", "3.752", "202.00", "PEN",
  ].join(";");
  const r = leerPropuestaRce(cabecera + "\n" + fila);
  const f = r.filas[0];

  test("lee el IGV de operaciones gravadas", () => {
    assert.equal(f.impuestos.igvDg, 18);
    assert.equal(f.impuestos.baseDg, 100);
  });

  // «igv ipm dg» está contenido dentro de «igv ipm dgng»: si el emparejado
  // por contenido ganara, los tres IGV serían el mismo número.
  test("no confunde DG con DGNG ni con DNG", () => {
    assert.equal(f.impuestos.igvDgng, 9);
    assert.equal(f.impuestos.baseDgng, 50);
    assert.equal(f.impuestos.igvDng, 0);
    assert.equal(f.impuestos.baseDng, 25);
  });

  test("lee la detracción y el tipo de cambio", () => {
    assert.equal(f.detraccion, 12);
    assert.equal(f.tipoCambio, 3.752);
  });

  test("cero no es lo mismo que vacío", () => {
    // Un IGV de 0 es una operación exonerada; uno vacío es un dato que no
    // vino. Confundirlos haría que una exoneración parezca un hueco.
    assert.equal(f.impuestos.igvDng, 0);
    const sinImpuestos = leerPropuestaRce(
      "RUC;Serie del CDP;Nro CP o Doc. Nro Inicial (Rango);Total CP\n20100055237;E001;1;10"
    ).filas[0];
    assert.equal(sinImpuestos.impuestos.igvDg, null);
    assert.equal(sinImpuestos.detraccion, null);
  });

  test("todas las columnas quedan reconocidas, ninguna suelta", () => {
    assert.deepEqual(r.sinMapear, []);
    assert.deepEqual(r.duplicadas, []);
  });
});

// Dos filas de marzo de 2026 salieron con la fecha en la columna del CAR, el
// nombre del proveedor en la del RUC y una serie en la del tipo. La causa era
// cortar por saltos de línea antes de mirar las comillas: una razón social
// con un salto adentro parte el registro en dos y todo queda corrido.
describe("un salto de línea dentro de un campo", () => {
  const cabecera = [
    "CAR SUNAT", "RUC", "Apellidos y Nombres o Razón social", "Fecha de emisión",
    "Tipo CP/Doc.", "Serie del CDP", "Nro CP o Doc. Nro Inicial (Rango)", "Total CP",
  ].join(";");

  const conSalto = [
    "CAR-1", "20512201611", '"INSTITUTO NACIONAL\nDE CALIDAD"',
    "13/03/2026", "01", "F001", "123", "51.97",
  ].join(";");

  const normal = ["CAR-2", "20100055237", "FERRETERIA EL SOL", "14/03/2026", "01", "E001", "9", "10.00"].join(";");

  const r = leerPropuestaRce([cabecera, conSalto, normal].join("\n"));

  test("el registro no se parte en dos", () => {
    assert.equal(r.filas.length, 2);
  });

  test("las columnas no se corren: el tipo sigue siendo el tipo", () => {
    assert.equal(r.filas[0].tipoComprobante, "01");
    assert.equal(r.filas[0].serie, "F001");
    assert.equal(r.filas[0].carSunat, "CAR-1");
  });

  test("el nombre conserva su salto en vez de romper la fila", () => {
    assert.match(r.filas[0].razonGenerador ?? "", /INSTITUTO NACIONAL/);
    assert.match(r.filas[0].razonGenerador ?? "", /DE CALIDAD/);
  });

  test("la fila siguiente tampoco se contamina", () => {
    assert.equal(r.filas[1].carSunat, "CAR-2");
    assert.equal(r.filas[1].total, 10);
  });
});

describe("partirCsv", () => {
  test("separa campos y registros", () => {
    assert.deepEqual(partirCsv("a;b\nc;d", ";"), [["a", "b"], ["c", "d"]]);
  });

  test("respeta el separador dentro de comillas", () => {
    assert.deepEqual(partirCsv('a;"b;c";d', ";"), [["a", "b;c", "d"]]);
  });

  test("respeta el salto de línea dentro de comillas", () => {
    assert.deepEqual(partirCsv('a;"b\nc";d', ";"), [["a", "b\nc", "d"]]);
  });

  test("entiende la comilla escapada", () => {
    assert.deepEqual(partirCsv('a;"di ""hola"""', ";"), [["a", 'di "hola"']]);
  });

  test("los saltos de Windows cuentan como uno solo", () => {
    assert.deepEqual(partirCsv("a;b\r\nc;d", ";"), [["a", "b"], ["c", "d"]]);
  });

  test("las líneas en blanco no se cuelan como registros", () => {
    assert.deepEqual(partirCsv("a;b\n\n\nc;d\n", ";"), [["a", "b"], ["c", "d"]]);
  });

  test("un campo vacío al final sigue contando", () => {
    assert.deepEqual(partirCsv("a;b;", ";"), [["a", "b", ""]]);
  });
});
