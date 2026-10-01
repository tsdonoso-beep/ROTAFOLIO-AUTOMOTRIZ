import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CacheCarpetas } from "../comun/cache-drive.mts";

function falso(inicial: Record<string, string[]> = {}, fallarCrear = new Set<string>()) {
  const creados: string[] = [];
  let listados = 0;
  const cache = new CacheCarpetas(
    async id => {
      listados++;
      return new Map((inicial[id] ?? []).map(n => [n, `url:${id}/${n}`]));
    },
    async (id, nombre) => {
      await new Promise(r => setTimeout(r, 5));
      if (fallarCrear.has(nombre)) throw new Error("cupo de Drive");
      creados.push(`${id}/${nombre}`);
      return `nuevo:${id}/${nombre}`;
    },
  );
  return { cache, creados, listados: () => listados };
}

describe("CacheCarpetas", () => {
  test("lista cada carpeta una sola vez, aunque se suban muchos archivos", async () => {
    const f = falso({ A: ["ya.xml"] });
    await Promise.all(["1.xml", "2.xml", "3.xml", "ya.xml"].map(n => f.cache.subir("A", n)));
    await f.cache.subir("B", "x.xml");
    assert.equal(f.listados(), 2);
    assert.deepEqual(f.creados.sort(), ["A/1.xml", "A/2.xml", "A/3.xml", "B/x.xml"]);
  });

  test("lo que ya estaba no se sube y devuelve su enlace", async () => {
    const f = falso({ A: ["ya.xml"] });
    assert.deepEqual(await f.cache.subir("A", "ya.xml"), { estado: "existe", url: "url:A/ya.xml" });
    assert.equal(f.creados.length, 0);
  });

  test("dos pedidos simultáneos del mismo nombre suben una sola vez", async () => {
    const f = falso();
    const [r1, r2] = await Promise.all([f.cache.subir("A", "d.xml"), f.cache.subir("A", "d.xml")]);
    assert.equal(f.creados.length, 1);
    assert.deepEqual([r1.estado, r2.estado].sort(), ["existe", "nuevo"]);
    assert.equal(r1.url, r2.url);
  });

  test("después de subir, el mismo nombre ya cuenta como existente", async () => {
    const f = falso();
    await f.cache.subir("A", "n.xml");
    assert.equal((await f.cache.subir("A", "n.xml")).estado, "existe");
    assert.equal(f.creados.length, 1);
  });

  test("si la subida falla, el nombre queda libre para reintentar", async () => {
    const fallar = new Set(["f.xml"]);
    const f = falso({}, fallar);
    await assert.rejects(f.cache.subir("A", "f.xml"), /cupo/);
    fallar.delete("f.xml");
    assert.equal((await f.cache.subir("A", "f.xml")).estado, "nuevo");
  });
});
