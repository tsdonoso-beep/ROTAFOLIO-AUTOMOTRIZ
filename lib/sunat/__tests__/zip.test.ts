import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leerZip } from "../zip.ts";
import { DEFLATE, SIN_COMPRIMIR, CON_DESCRIPTOR } from "./zip.fixtures.ts";

const bytes = (b64: string) => Buffer.from(b64, "base64");

describe("leerZip", () => {
  test("saca los archivos de un zip normal", () => {
    const a = leerZip(bytes(DEFLATE));
    const nombres = a.map(x => x.nombre).sort();
    assert.deepEqual(nombres, ["reporte.csv", "sub/nota.txt"]);
  });

  test("el contenido sale intacto, con acentos incluidos", () => {
    const csv = leerZip(bytes(DEFLATE)).find(a => a.nombre === "reporte.csv")!;
    const texto = csv.contenido.toString("utf8");
    const lineas = texto.trimEnd().split("\n");

    assert.equal(lineas[0], "periodo;ruc;razón social;monto");
    assert.equal(lineas.length, 501);
    assert.equal(lineas[1], "202608;20512201611;PROVEEDOR DE PRUEBA Ñ 0;0.50");
    assert.equal(lineas[500], "202608;20512201611;PROVEEDOR DE PRUEBA Ñ 499;499.50");
  });

  test("también abre lo que viene sin comprimir", () => {
    const a = leerZip(bytes(SIN_COMPRIMIR));
    assert.equal(a.length, 1);
    assert.equal(a[0].nombre, "sub/nota.txt");
    assert.equal(a[0].contenido.toString("utf8"), "hola");
  });

  // Este es el motivo de leer el índice en vez de recorrer el archivo: aquí
  // la cabecera local miente y dice que el contenido mide cero.
  test("abre un zip cuyos tamaños van detrás del contenido", () => {
    const a = leerZip(bytes(CON_DESCRIPTOR));
    assert.equal(a.length, 1);
    const lineas = a[0].contenido.toString("utf8").trimEnd().split("\n");
    assert.equal(lineas.length, 501);
    assert.equal(lineas[0], "periodo;ruc;razón social;monto");
  });

  test("acepta un ArrayBuffer, que es lo que devuelve fetch", () => {
    const b = bytes(SIN_COMPRIMIR);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    assert.equal(leerZip(ab)[0].contenido.toString("utf8"), "hola");
  });

  test("las carpetas no cuentan como archivos", () => {
    // `zip -r` guarda la entrada de la carpeta; no debe aparecer vacía.
    assert.ok(leerZip(bytes(DEFLATE)).every(a => !a.nombre.endsWith("/")));
  });

  describe("cuando lo que llega no es un zip", () => {
    test("lo dice, en vez de devolver basura", () => {
      const error = Buffer.from('{"cod":"1033","msg":"Sin datos"}', "utf8");
      assert.throws(() => leerZip(error), /no es un zip/i);
    });

    test("un archivo vacío tampoco pasa", () => {
      assert.throws(() => leerZip(Buffer.alloc(0)), /no es un zip/i);
    });
  });

  test("no expande más de lo que se le permite", () => {
    assert.throws(() => leerZip(bytes(DEFLATE), 1024), /No se abre/);
  });
});
