import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  puedeEmitirse, puedeResponder, transicionSolicitudValida,
  type EstadoSolicitud, type Solicitud,
} from "../solicitud.ts";

const pedido = (p: Partial<Solicitud> = {}): Solicitud => ({
  id: "s1",
  estado: "PENDIENTE",
  solicitanteId: "kory",
  jefaturaId: "jose",
  personas: ["wilmer", "johana"],
  ...p,
});

const jefe = (usuarioId: string) => ({
  usuarioId, esJefatura: true, esAdminSistema: false,
});

describe("quién puede firmar un pedido", () => {
  it("la jefatura a la que se le pidió", () => {
    assert.equal(puedeResponder(pedido(), jefe("jose")).puede, true);
  });

  // Mandarle el pedido a cualquiera con el rol sería una firma falsa.
  it("no otra jefatura cualquiera", () => {
    const r = puedeResponder(pedido(), jefe("otra"));
    assert.equal(r.puede, false);
    assert.ok(r.motivo.includes("otra jefatura"));
  });

  it("nadie se autoriza a sí mismo, aunque tenga el rol", () => {
    const r = puedeResponder(pedido({ jefaturaId: "kory" }), jefe("kory"));
    assert.equal(r.puede, false);
    assert.ok(r.motivo.includes("tu propio pedido"));
  });

  it("ni autoriza el viaje del que él mismo es beneficiario", () => {
    const r = puedeResponder(pedido({ jefaturaId: "wilmer" }), jefe("wilmer"));
    assert.equal(r.puede, false);
    assert.ok(r.motivo.includes("te cubre a ti"));
  });

  it("sin jefatura registrada, responde cualquiera que la tenga", () => {
    assert.equal(puedeResponder(pedido({ jefaturaId: null }), jefe("otra")).puede, true);
  });

  it("pero no alguien sin el rol", () => {
    const r = puedeResponder(pedido({ jefaturaId: null }), {
      usuarioId: "x", esJefatura: false, esAdminSistema: false,
    });
    assert.equal(r.puede, false);
  });

  it("el administrador del sistema destraba cuando la jefatura no está", () => {
    assert.equal(puedeResponder(pedido(), {
      usuarioId: "admin", esJefatura: false, esAdminSistema: true,
    }).puede, true);
  });

  it("pero ni siquiera él firma su propio pedido", () => {
    const r = puedeResponder(pedido({ solicitanteId: "admin" }), {
      usuarioId: "admin", esJefatura: false, esAdminSistema: true,
    });
    assert.equal(r.puede, false);
  });

  it("un pedido ya respondido no se responde dos veces", () => {
    assert.equal(puedeResponder(pedido({ estado: "APROBADA" }), jefe("jose")).puede, false);
  });
});

describe("cuándo se puede emitir el memo", () => {
  it("con la firma dada", () => {
    assert.equal(puedeEmitirse(pedido({ estado: "APROBADA" })).puede, true);
  });

  // Es exactamente lo que se quería dejar de hacer.
  it("nunca antes de la firma", () => {
    const r = puedeEmitirse(pedido({ estado: "PENDIENTE" }));
    assert.equal(r.puede, false);
    assert.ok(r.motivo.includes("volver a lo de antes"));
  });

  it("y no dos veces", () => {
    const r = puedeEmitirse(pedido({ estado: "CONVERTIDA" }));
    assert.equal(r.puede, false);
    assert.ok(r.motivo.includes("ya tiene su memo"));
  });

  it("un pedido rechazado o retirado no se emite", () => {
    for (const e of ["RECHAZADA", "ANULADA"] as EstadoSolicitud[]) {
      assert.equal(puedeEmitirse(pedido({ estado: e })).puede, false);
    }
  });
});

describe("las transiciones del pedido", () => {
  it("de pendiente se sale firmando, rechazando o retirándolo", () => {
    assert.ok(transicionSolicitudValida("PENDIENTE", "APROBADA"));
    assert.ok(transicionSolicitudValida("PENDIENTE", "RECHAZADA"));
    assert.ok(transicionSolicitudValida("PENDIENTE", "ANULADA"));
  });

  it("un pedido aprobado todavía se puede retirar: el viaje se cae", () => {
    assert.ok(transicionSolicitudValida("APROBADA", "ANULADA"));
  });

  it("una vez que hay memo, lo que se discute es el memo", () => {
    assert.ok(!transicionSolicitudValida("CONVERTIDA", "ANULADA"));
    assert.ok(!transicionSolicitudValida("CONVERTIDA", "RECHAZADA"));
  });

  it("no se salta la firma para llegar al memo", () => {
    assert.ok(!transicionSolicitudValida("PENDIENTE", "CONVERTIDA"));
  });

  it("lo rechazado no revive: se pide de nuevo", () => {
    assert.ok(!transicionSolicitudValida("RECHAZADA", "APROBADA"));
  });
});
