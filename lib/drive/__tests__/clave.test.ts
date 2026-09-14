import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizarClavePrivada, correoDeServicio } from "../servidor.ts";

// Una clave de juguete con la misma forma que la de verdad. No abre nada.
const CUERPO = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDeJemplo";
const REAL = `-----BEGIN PRIVATE KEY-----\n${CUERPO}\n-----END PRIVATE KEY-----\n`;
const CON_ESCAPES = REAL.replace(/\n/g, "\\n");

describe("normalizarClavePrivada", () => {
  test("con saltos de verdad la deja igual", () => {
    assert.equal(normalizarClavePrivada(REAL), REAL);
  });

  // Es como vive en un archivo .env.
  test("convierte los \\n escritos literales en saltos de verdad", () => {
    assert.equal(normalizarClavePrivada(CON_ESCAPES), REAL);
  });

  // El caso que rompe sin decir por qué: en un .env las comillas las quita el
  // lector, pero en un secreto de GitHub pasan a ser parte del valor.
  test("quita las comillas dobles que envuelven el valor", () => {
    assert.equal(normalizarClavePrivada(`"${CON_ESCAPES}"`), REAL);
  });

  test("y también las simples", () => {
    assert.equal(normalizarClavePrivada(`'${CON_ESCAPES}'`), REAL);
  });

  test("no toca una comilla que esté solo en un extremo", () => {
    // Si solo hay una, no es un envoltorio: quitarla rompería la clave.
    const rara = `"${CON_ESCAPES}`;
    assert.ok(normalizarClavePrivada(rara)!.startsWith('"'));
  });

  // Hay lectores de PEM que sin el salto final no reconocen la clave.
  test("garantiza el salto de línea del final", () => {
    const sinSalto = REAL.trimEnd();
    assert.ok(normalizarClavePrivada(sinSalto)!.endsWith("-----END PRIVATE KEY-----\n"));
  });

  test("aguanta espacios y saltos sueltos alrededor", () => {
    assert.equal(normalizarClavePrivada(`  \n"${CON_ESCAPES}"  \n `), REAL);
  });

  test("sin clave devuelve sin clave, no una cadena vacía", () => {
    assert.equal(normalizarClavePrivada(undefined), undefined);
  });

  test("la clave normalizada empieza y termina como Google espera", () => {
    const k = normalizarClavePrivada(`"${CON_ESCAPES}"`)!;
    assert.ok(k.startsWith("-----BEGIN PRIVATE KEY-----\n"), k.slice(0, 40));
    assert.ok(k.trimEnd().endsWith("-----END PRIVATE KEY-----"));
  });
});

// Sacar la clave del .json a mano es donde se equivoca todo el mundo: se
// corta de más, se pega con la coma del final, se pierde un trozo. Aceptar el
// archivo entero elimina ese paso.
describe("cuando se pega el archivo .json completo", () => {
  const JSON_DE_GOOGLE = JSON.stringify({
    type: "service_account",
    project_id: "ardent-bulwark-489403-v6",
    private_key_id: "abc123",
    private_key: CON_ESCAPES,
    client_email: "repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com",
    client_id: "123456789",
  }, null, 2);

  test("saca la clave de adentro", () => {
    assert.equal(normalizarClavePrivada(JSON_DE_GOOGLE), REAL);
  });

  test("y también el correo, que viene en el mismo archivo", () => {
    assert.equal(
      correoDeServicio(undefined, JSON_DE_GOOGLE),
      "repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com",
    );
  });

  test("el correo puesto aparte manda sobre el del archivo", () => {
    assert.equal(correoDeServicio("otro@ejemplo.com", JSON_DE_GOOGLE), "otro@ejemplo.com");
  });

  test("un JSON sin clave privada no se toma por una", () => {
    const sinClave = JSON.stringify({ type: "service_account" });
    assert.equal(normalizarClavePrivada(sinClave), sinClave + "\n");
  });

  test("algo que empieza con llave pero no es JSON no revienta", () => {
    assert.ok(normalizarClavePrivada("{esto no es json")!.startsWith("{esto"));
  });

  test("sin archivo ni correo, no hay correo", () => {
    assert.equal(correoDeServicio(undefined, undefined), undefined);
    assert.equal(correoDeServicio("  ", "no es json"), undefined);
  });
});
