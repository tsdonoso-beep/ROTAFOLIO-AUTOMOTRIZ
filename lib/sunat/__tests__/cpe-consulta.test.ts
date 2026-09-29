import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOGO, consultaDe, conMenuDeBoletas, normalizar,
  aFecha, aTexto, tandasPorMes, periodosDelRango, nombreDeHojaDelRango,
} from "../cpe-consulta.ts";

describe("el catálogo de tipos de consulta", () => {
  test("mantiene los seis tipos que ya estaban probados", () => {
    for (const n of ["FE Emitidas", "FE Recibidas", "NC Emitidas", "NC Recibidas", "ND Emitidas", "ND Recibidas"]) {
      const c = consultaDe(n);
      assert.ok(c, `falta ${n}`);
      assert.equal(c!.confirmado, true);
    }
  });

  // Los códigos están confirmados contra el portal real (ver el dossier del
  // scraper). Si alguien los cambia sin haberlo vuelto a mirar, esto avisa.
  test("conserva los códigos confirmados de SUNAT", () => {
    assert.equal(consultaDe("FE Emitidas")!.codigo, "10");
    assert.equal(consultaDe("FE Recibidas")!.codigo, "11");
    assert.equal(consultaDe("NC Emitidas")!.codigo, "13");
    assert.equal(consultaDe("NC Recibidas")!.codigo, "14");
    assert.equal(consultaDe("ND Emitidas")!.codigo, "15");
    assert.equal(consultaDe("ND Recibidas")!.codigo, "16");
  });

  // Las cuatro etiquetas son las que ofrece el desplegable del portal, leídas
  // de la captura real. Si alguien las "arregla" de memoria, esto avisa.
  test("trae las cuatro boletas con las etiquetas del portal real", () => {
    const boletas = CATALOGO.filter(c => c.pantalla === "boletas").map(c => c.nombre);
    assert.deepEqual(boletas, ["BVE Emitidas", "BVE Recibidas", "NC-BVE Emitidas", "ND-BVE Emitidas"]);
  });

  // No es un olvido: el portal no ofrece esas dos. Inventarlas «por simetría»
  // serían dos consultas que fallan siempre.
  test("no inventa notas de boleta recibidas, que el portal no tiene", () => {
    assert.equal(consultaDe("NC-BVE Recibidas"), null);
    assert.equal(consultaDe("ND-BVE Recibidas"), null);
  });

  // Salieron de los enlaces «Imprimir» del portal, que llevan tipoConsulta en
  // la URL. Si alguien los cambia de memoria, esto avisa.
  test("conserva los códigos de boleta leídos del portal", () => {
    assert.equal(consultaDe("BVE Emitidas")!.codigo, "17");
    assert.equal(consultaDe("BVE Recibidas")!.codigo, "18");
    assert.equal(consultaDe("NC-BVE Emitidas")!.codigo, "20");
  });

  // El último que faltaba. Se dejó en null hasta verlo de verdad en el portal,
  // en vez de anotar la conjetura; el run del 28/09/2026 lo confirmó.
  test("ND-BVE Emitidas ya tiene su código, visto en el portal", () => {
    assert.equal(consultaDe("ND-BVE Emitidas")!.codigo, "22");
  });

  test("los diez tipos tienen código", () => {
    for (const c of CATALOGO) assert.ok(c.codigo, `${c.nombre} sin código`);
  });

  test("ningún código se repite: dos tipos con el mismo bajarían lo mismo", () => {
    const codigos = CATALOGO.map(c => c.codigo).filter(c => c !== null);
    assert.equal(new Set(codigos).size, codigos.length);
  });

  test("cada tipo sabe en qué pantalla vive", () => {
    assert.equal(consultaDe("FE Recibidas")!.pantalla, "facturas");
    assert.equal(consultaDe("BVE Recibidas")!.pantalla, "boletas");
  });

  // El camino de menú de las boletas no tiene acceso directo: es el árbol
  // entero, y cada texto tiene que ser el del portal.
  test("las boletas llevan el camino completo del menú", () => {
    assert.deepEqual(consultaDe("BVE Recibidas")!.menu, [
      "Empresas", "Comprobantes de pago", "SEE - SOL",
      "Boleta de Venta Electrónica", "Consultar Boleta de Venta y Nota",
    ]);
  });

  test("encuentra el tipo aunque venga con otra caja o con acentos raros", () => {
    assert.equal(consultaDe("fe recibidas")!.nombre, "FE Recibidas");
    assert.equal(consultaDe("  BVE EMITIDAS  ")!.nombre, "BVE Emitidas");
  });

  // El error que no se ve mirando el resultado: "NC-BVE Emitidas" CONTIENE
  // "BVE Emitidas". Con una comparación floja, pedir la nota de crédito
  // elegiría la boleta y nadie lo notaría.
  test("no confunde una nota de boleta con la boleta, aunque una contenga a la otra", () => {
    assert.equal(consultaDe("BVE Emitidas")!.nombre, "BVE Emitidas");
    assert.equal(consultaDe("NC-BVE Emitidas")!.nombre, "NC-BVE Emitidas");
    assert.notEqual(consultaDe("NC-BVE Emitidas")!.nombre, consultaDe("BVE Emitidas")!.nombre);
  });

  // El punto que más importa de todo el módulo: un nombre mal escrito en el
  // workflow no puede terminar bajando otro tipo.
  test("un nombre que no existe da null, no un tipo parecido", () => {
    assert.equal(consultaDe("Boletas"), null);
    assert.equal(consultaDe("FE"), null);
    assert.equal(consultaDe("BE Recibidas"), null, "la etiqueta que se había adivinado antes de ver el portal");
    assert.equal(consultaDe(""), null);
  });

  test("normalizar quita acentos y espacios de más", () => {
    assert.equal(normalizar("  Consulta  Integrada "), "consulta integrada");
    assert.equal(normalizar("Facturación"), "facturacion");
  });
});

describe("el menú de las boletas, sobreescribible", () => {
  test("cambia solo el de las boletas y deja intacto el de facturas y notas", () => {
    const c = conMenuDeBoletas(["Empresas", "Otra pantalla"]);
    const fe = c.find(x => x.nombre === "FE Recibidas")!;
    const be = c.find(x => x.nombre === "BVE Recibidas")!;
    assert.deepEqual(be.menu, ["Empresas", "Otra pantalla"]);
    assert.deepEqual(fe.menu, consultaDe("FE Recibidas")!.menu);
  });

  test("sin menú nuevo devuelve el catálogo tal cual", () => {
    assert.equal(conMenuDeBoletas([]), CATALOGO);
  });

  test("alcanza a las cuatro boletas, no solo a una", () => {
    const c = conMenuDeBoletas(["Empresas", "Otra pantalla"]);
    for (const b of c.filter(x => x.pantalla === "boletas")) {
      assert.deepEqual(b.menu, ["Empresas", "Otra pantalla"]);
    }
  });

  test("no muta el catálogo original", () => {
    const antes = consultaDe("BVE Recibidas")!.menu.join("/");
    conMenuDeBoletas(["Empresas", "Pantalla distinta"]);
    assert.equal(consultaDe("BVE Recibidas")!.menu.join("/"), antes);
  });
});

describe("leer y escribir fechas dd/mm/yyyy", () => {
  test("va y vuelve sin corrimientos", () => {
    assert.equal(aTexto(aFecha("01/08/2026")!), "01/08/2026");
    assert.equal(aTexto(aFecha("30/09/2026")!), "30/09/2026");
  });

  test("rellena con cero a la izquierda", () => {
    assert.equal(aTexto(aFecha("1/8/2026")!), "01/08/2026");
  });

  test("rechaza lo que no es una fecha", () => {
    assert.equal(aFecha("2026-08-01"), null);
    assert.equal(aFecha("31/02/2026"), null, "el 31 de febrero no existe");
    assert.equal(aFecha("00/08/2026"), null);
    assert.equal(aFecha("01/13/2026"), null);
    assert.equal(aFecha(""), null);
  });
});

describe("partir el rango en tandas por mes", () => {
  // El caso que motivó todo esto: agosto y setiembre completos.
  test("agosto y setiembre salen como dos tandas completas", () => {
    assert.deepEqual(tandasPorMes("01/08/2026", "30/09/2026"), [
      { desde: "01/08/2026", hasta: "31/08/2026" },
      { desde: "01/09/2026", hasta: "30/09/2026" },
    ]);
  });

  test("un rango dentro de un solo mes queda en una sola tanda, sin estirarse", () => {
    assert.deepEqual(tandasPorMes("05/08/2026", "12/08/2026"), [
      { desde: "05/08/2026", hasta: "12/08/2026" },
    ]);
  });

  test("respeta los bordes: no empieza antes del desde ni termina después del hasta", () => {
    assert.deepEqual(tandasPorMes("20/07/2026", "10/09/2026"), [
      { desde: "20/07/2026", hasta: "31/07/2026" },
      { desde: "01/08/2026", hasta: "31/08/2026" },
      { desde: "01/09/2026", hasta: "10/09/2026" },
    ]);
  });

  test("un solo día es una tanda de un día", () => {
    assert.deepEqual(tandasPorMes("15/08/2026", "15/08/2026"), [
      { desde: "15/08/2026", hasta: "15/08/2026" },
    ]);
  });

  test("cruza el fin de año sin perderse", () => {
    assert.deepEqual(tandasPorMes("15/12/2026", "02/01/2027"), [
      { desde: "15/12/2026", hasta: "31/12/2026" },
      { desde: "01/01/2027", hasta: "02/01/2027" },
    ]);
  });

  test("febrero de un año bisiesto termina el 29", () => {
    assert.deepEqual(tandasPorMes("01/02/2028", "01/03/2028"), [
      { desde: "01/02/2028", hasta: "29/02/2028" },
      { desde: "01/03/2028", hasta: "01/03/2028" },
    ]);
  });

  // Que no se cuelgue ni se invente nada: si el rango no tiene sentido, lo
  // devuelve tal cual y el script decide qué hacer.
  test("un rango al revés o ilegible vuelve como una sola tanda", () => {
    assert.deepEqual(tandasPorMes("30/09/2026", "01/08/2026"), [
      { desde: "30/09/2026", hasta: "01/08/2026" },
    ]);
    assert.deepEqual(tandasPorMes("ayer", "hoy"), [{ desde: "ayer", hasta: "hoy" }]);
  });

  test("ninguna tanda queda vacía ni se solapa con la siguiente", () => {
    const tandas = tandasPorMes("17/03/2026", "04/11/2026");
    assert.equal(tandas.length, 9);
    for (const t of tandas) assert.ok(aFecha(t.desde)! <= aFecha(t.hasta)!);
    for (let i = 1; i < tandas.length; i++) {
      assert.ok(aFecha(tandas[i].desde)! > aFecha(tandas[i - 1].hasta)!);
    }
  });
});

describe("los períodos que abarca un rango", () => {
  test("agosto y setiembre", () => {
    assert.deepEqual(periodosDelRango("01/08/2026", "30/09/2026"), ["202608", "202609"]);
  });

  test("un rango corto dentro de un mes da ese período", () => {
    assert.deepEqual(periodosDelRango("05/08/2026", "12/08/2026"), ["202608"]);
  });

  test("cuenta el mes aunque el rango lo toque por un día", () => {
    assert.deepEqual(periodosDelRango("31/07/2026", "01/08/2026"), ["202607", "202608"]);
  });

  test("cruza el año", () => {
    assert.deepEqual(periodosDelRango("15/12/2026", "02/01/2027"), ["202612", "202701"]);
  });

  test("un rango ilegible no da períodos", () => {
    assert.deepEqual(periodosDelRango("ayer", "hoy"), []);
  });
});

describe("el nombre de la hoja del rango", () => {
  // Estable: la misma corrida tiene que reemplazar la hoja anterior, no dejar
  // una nueva al lado.
  test("dos meses llevan el rango en el nombre", () => {
    assert.equal(
      nombreDeHojaDelRango(["202608", "202609"]),
      "COMPROBANTES SUNAT - DETALLE 2026-08 a 2026-09",
    );
  });

  test("un solo mes no dice «a»", () => {
    assert.equal(nombreDeHojaDelRango(["202608"]), "COMPROBANTES SUNAT - DETALLE 2026-08");
  });

  test("no depende del orden en que lleguen los períodos", () => {
    assert.equal(
      nombreDeHojaDelRango(["202609", "202608"]),
      nombreDeHojaDelRango(["202608", "202609"]),
    );
  });

  test("se distingue de la hoja histórica, que trae todo", () => {
    assert.notEqual(nombreDeHojaDelRango(["202608"]), "COMPROBANTES SUNAT - DETALLE");
  });

  test("sin períodos no hay hoja", () => {
    assert.equal(nombreDeHojaDelRango([]), null);
  });
});
