import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32, escaparXml } from "../zip.ts";
import {
  aFechaPeruana, generarMemo, limpiarParaArchivo, nombreDeArchivo, totalDelAnexo,
  type PersonaDelAnexo,
} from "../memo.ts";

// El anexo del 594-2026, el mismo de siempre: 4 x 212 + 6 x 1164 + 1 x 1232.
const anexo594: PersonaDelAnexo[] = [
  ...Array.from({ length: 4 }, (_, i) => ({
    nombre: `Corto ${i}`, dni: `0000000${i}`, monto: 212,
    fechaDesde: "2026-08-09", fechaHasta: "2026-08-10",
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    nombre: `Largo ${i}`, dni: `1000000${i}`, monto: 1164,
    fechaDesde: "2026-08-09", fechaHasta: "2026-08-19",
  })),
  {
    nombre: "Paulo Cesar Salas Abad", dni: "73091123", monto: 1232,
    fechaDesde: "2026-08-10", fechaHasta: "2026-08-19",
  },
];

// «Es el nombre del adjunto —no el asunto— lo que el MemoTracker lee»: en
// 341 de 422 memos el asunto ni siquiera trae el número.
describe("el nombre del adjunto, que es lo que se lee", () => {
  it("arma el formato exacto", () => {
    assert.equal(
      nombreDeArchivo({
        numero: "594-2026",
        concepto: "Gastos de viáticos",
        area: "Talleres Especializados",
      }),
      "Memo 594-2026 - GASTOS DE VIÁTICOS - Talleres Especializados"
    );
  });

  it("una barra no parte el nombre en dos carpetas", () => {
    const n = nombreDeArchivo({
      numero: "311-2026", concepto: "VIATICOS/PASAJES", area: "PM",
    });
    assert.ok(!n.includes("/"));
    assert.ok(n.includes("VIATICOS PASAJES"), "y no las pega: " + n);
  });

  it("quita lo que Windows rechaza, sin comerse las palabras", () => {
    assert.equal(limpiarParaArchivo('A: B*C?D"E<F>G|H'), "A B C D E F G H");
  });

  it("sin área, no deja un guion colgando al final", () => {
    assert.equal(
      nombreDeArchivo({ numero: "1-2026", concepto: "CAJA CHICA", area: "" }),
      "Memo 1-2026 - CAJA CHICA"
    );
  });
});

describe("el total sale del anexo", () => {
  it("el 594-2026 da los S/ 9,064.00 del papel", () => {
    assert.equal(totalDelAnexo(anexo594), 9064);
  });

  it("suma en céntimos: dos decimales no se pierden por el camino", () => {
    assert.equal(totalDelAnexo([
      { nombre: "a", dni: "1", monto: 0.1, fechaDesde: null, fechaHasta: null },
      { nombre: "b", dni: "2", monto: 0.2, fechaDesde: null, fechaHasta: null },
    ]), 0.3);
  });
});

describe("el documento", () => {
  const docx = generarMemo({
    numero: "594-2026",
    concepto: "Gastos de viáticos",
    area: "Talleres Especializados",
    empresa: "INDUSTRIAS ROLAND PRINT S.A.C.",
    destino: "Barranca",
    firmante: "José Haertel",
    cargoFirmante: "Project Manager",
    dirigidoA: "Gerencia de Administración y Finanzas",
    fecha: "08/08/2026",
    personas: anexo594,
  });

  it("es un ZIP: Word no abre otra cosa", () => {
    assert.deepEqual([...docx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  });

  it("trae las tres partes que exige el formato", () => {
    const texto = Buffer.from(docx).toString("latin1");
    for (const parte of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      assert.ok(texto.includes(parte), `falta ${parte}`);
    }
  });

  it("el total del párrafo es el del anexo, no uno tecleado", () => {
    const texto = Buffer.from(docx).toString("utf8");
    assert.ok(texto.includes("9,064.00"));
    assert.ok(texto.includes("11 colaboradores"));
  });

  it("nombra a cada persona con su monto", () => {
    const texto = Buffer.from(docx).toString("utf8");
    assert.ok(texto.includes("Paulo Cesar Salas Abad"));
    assert.ok(texto.includes("73091123"));
    assert.ok(texto.includes("1,232.00"));
  });

  it("dos generaciones con los mismos datos dan el mismo archivo", () => {
    const otra = generarMemo({
      numero: "594-2026", concepto: "Gastos de viáticos",
      area: "Talleres Especializados", empresa: "INDUSTRIAS ROLAND PRINT S.A.C.",
      destino: "Barranca", firmante: "José Haertel",
      cargoFirmante: "Project Manager",
      dirigidoA: "Gerencia de Administración y Finanzas",
      fecha: "08/08/2026", personas: anexo594,
    });
    assert.deepEqual([...otra], [...docx]);
  });

  // «TALLERES EPT I & II» existe de verdad en el catálogo de proyectos.
  it("un ampersand en el nombre no corrompe el documento", () => {
    const con = generarMemo({
      numero: "1-2026", concepto: "TALLERES EPT I & II", area: "PM",
      empresa: "E & R", destino: null, firmante: "A & B",
      cargoFirmante: null, dirigidoA: "GAF", fecha: "01/01/2026",
      personas: [{ nombre: "X & Y", dni: "1", monto: 10, fechaDesde: null, fechaHasta: null }],
    });
    const texto = Buffer.from(con).toString("utf8");
    assert.ok(texto.includes("&amp;"), "el ampersand va escapado");
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(
      texto.slice(texto.indexOf("<w:document"))
    ), "y no queda ninguno suelto");
  });

  it("escapa los cinco caracteres del XML", () => {
    assert.equal(escaparXml(`<a href="x">&'</a>`),
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });

  // Sin CRC correcto, Word abre el archivo y dice que está dañado.
  it("el CRC-32 es el del estándar", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });
});

describe("las fechas van como se leen en el papel", () => {
  it("dd/mm/aaaa, no el ISO de la base", () => {
    assert.equal(aFechaPeruana("2026-08-09"), "09/08/2026");
  });

  it("sin fecha, una raya", () => {
    assert.equal(aFechaPeruana(null), "—");
  });

  it("lo que no reconoce lo deja tal cual, en vez de inventarlo", () => {
    assert.equal(aFechaPeruana("agosto"), "agosto");
  });
});
