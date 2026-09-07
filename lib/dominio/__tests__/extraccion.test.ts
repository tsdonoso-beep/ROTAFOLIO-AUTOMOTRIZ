import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PoolClaves } from "../../extraccion/pool-claves.ts";
import { interpretar } from "../../extraccion/gemini.ts";

const CLAVES = ["AIzaAAAAAAAAAAAA1111", "AIzaBBBBBBBBBBBB2222", "AIzaCCCCCCCCCCCC3333"];

// ════════════════════════════════════════════════════════════════
describe("Pool de claves — reparto", () => {
  it("lee varias claves separadas por coma", () => {
    const p = PoolClaves.desdeEntorno({ GEMINI_API_KEYS: CLAVES.join(",") });
    assert.equal(p.cantidad, 3);
  });

  it("acepta saltos de línea y espacios sobrantes", () => {
    const p = PoolClaves.desdeEntorno({
      GEMINI_API_KEYS: ` ${CLAVES[0]} \n ${CLAVES[1]} `,
    });
    assert.equal(p.cantidad, 2);
  });

  it("descarta claves repetidas", () => {
    const p = PoolClaves.desdeEntorno({
      GEMINI_API_KEYS: `${CLAVES[0]},${CLAVES[0]},${CLAVES[1]}`,
    });
    assert.equal(p.cantidad, 2);
  });

  it("sigue aceptando el nombre en singular del MVP", () => {
    const p = PoolClaves.desdeEntorno({ GEMINI_API_KEY: CLAVES[0] });
    assert.equal(p.cantidad, 1);
  });

  it("sin variable configurada queda vacío", () => {
    assert.ok(PoolClaves.desdeEntorno({}).vacio);
  });

  it("rota el punto de partida en cada petición", () => {
    const p = new PoolClaves(CLAVES);
    const primera = p.ordenDeIntento()[0];
    const segunda = p.ordenDeIntento()[0];
    assert.notEqual(primera, segunda, "dos peticiones seguidas no deben empezar por la misma clave");
  });

  it("siempre ofrece todas las claves como alternativa", () => {
    const p = new PoolClaves(CLAVES);
    assert.equal(p.ordenDeIntento().length, 3);
  });
});

// ════════════════════════════════════════════════════════════════
describe("Pool de claves — enfriamiento", () => {
  it("aparta una hora la clave sin cuota", () => {
    const p = new PoolClaves(CLAVES);
    const ahora = Date.now();
    p.registrarFallo(CLAVES[0], "sin cuota", true, ahora);

    assert.ok(!p.disponibles(ahora).includes(CLAVES[0]));
    assert.ok(p.disponibles(ahora + 61 * 60 * 1000).includes(CLAVES[0]),
      "pasada la hora vuelve a estar disponible");
  });

  it("aparta solo un minuto un fallo pasajero", () => {
    const p = new PoolClaves(CLAVES);
    const ahora = Date.now();
    p.registrarFallo(CLAVES[0], "error 503", false, ahora);

    assert.ok(!p.disponibles(ahora).includes(CLAVES[0]));
    assert.ok(p.disponibles(ahora + 61_000).includes(CLAVES[0]));
  });

  it("deja las claves enfriando al final, no las descarta", () => {
    const p = new PoolClaves(CLAVES);
    const ahora = Date.now();
    p.registrarFallo(CLAVES[0], "sin cuota", true, ahora);
    p.registrarFallo(CLAVES[1], "sin cuota", true, ahora);

    const orden = p.ordenDeIntento(ahora);
    assert.equal(orden.length, 3, "ninguna clave se pierde");
    assert.equal(orden[0], CLAVES[2], "la única sana va primero");
  });

  it("un éxito rehabilita la clave de inmediato", () => {
    const p = new PoolClaves(CLAVES);
    const ahora = Date.now();
    p.registrarFallo(CLAVES[0], "sin cuota", true, ahora);
    p.registrarExito(CLAVES[0]);
    assert.ok(p.disponibles(ahora).includes(CLAVES[0]));
  });

  it("el resumen no expone la clave completa", () => {
    const p = new PoolClaves(CLAVES);
    const r = p.resumen();
    assert.equal(r[0].etiqueta, "AIza…1111");
    assert.ok(!JSON.stringify(r).includes(CLAVES[0]),
      "la clave entera nunca debe aparecer en el diagnóstico");
  });
});

// ════════════════════════════════════════════════════════════════
describe("Interpretación de la respuesta de la IA", () => {
  const completa = JSON.stringify({
    proveedor_ruc: "20612077224",
    proveedor_nombre: "FOR ELECTRIC E.I.R.L.",
    tipo_comprobante: "01",
    serie: "FE01",
    numero: "00002591",
    fecha_emision: "2026-03-23",
    moneda: "PEN",
    subtotal: 63.56,
    igv: 11.44,
    total: 75.0,
    forma_pago: "EFECTIVO",
    detalle: "Cable GPT #16, llave térmica, sacabocado",
    _confianza: { proveedor_ruc: 0.98, total: 0.95 },
    _no_legibles: [],
  });

  it("lee la factura de prueba completa", () => {
    const r = interpretar(completa);
    assert.equal(r.proveedor_ruc, "20612077224");
    assert.equal(r.serie, "FE01");
    assert.equal(r.numero, "00002591");
    assert.equal(r.total, 75);
    assert.equal(r._confianza.proveedor_ruc, 0.98);
  });

  it("extrae el JSON aunque venga envuelto en texto", () => {
    const r = interpretar("Aquí tienes:\n```json\n" + completa + "\n```");
    assert.equal(r.proveedor_ruc, "20612077224");
  });

  it("deja vacío el campo declarado ilegible en vez de aproximarlo", () => {
    const r = interpretar(JSON.stringify({
      proveedor_ruc: "20612077224", total: 75, subtotal: 63.56,
      _no_legibles: ["igv"], _confianza: {},
    }));
    assert.equal(r.igv, 0);
    assert.equal(r._confianza.igv, 0, "un campo ilegible cuenta como confianza cero");
  });

  it("tolera campos ausentes sin romperse", () => {
    const r = interpretar(JSON.stringify({ total: 50 }));
    assert.equal(r.total, 50);
    assert.equal(r.proveedor_ruc, "");
    assert.equal(r.moneda, "PEN");
  });

  it("acota la confianza al rango 0-1", () => {
    const r = interpretar(JSON.stringify({ _confianza: { total: 1.7, igv: -0.3 } }));
    assert.equal(r._confianza.total, 1);
    assert.equal(r._confianza.igv, 0);
  });

  it("convierte a número lo que llegue como texto", () => {
    const r = interpretar(JSON.stringify({ total: "75.00" }));
    assert.equal(r.total, 75);
  });

  it("falla con mensaje claro si no hay JSON", () => {
    assert.throws(() => interpretar("No pude leer la imagen"), /no devolvió JSON/);
  });
});
