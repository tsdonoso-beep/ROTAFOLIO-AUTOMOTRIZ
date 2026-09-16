import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  conteos, filtroInicial, frenoPrincipal, frenos, meFrena,
  type MemoDeBandeja,
} from "../bandeja.ts";

const memo = (p: Partial<MemoDeBandeja> = {}): MemoDeBandeja => ({
  id: "m1",
  estado: "EN_RENDICION",
  personas: 1,
  bloqueantes: 0,
  diasAtraso: 0,
  sinCobrar: 0,
  rechazadas: 0,
  ...p,
});

const codigos = (m: MemoDeBandeja) => frenos(m).map(f => f.codigo);

describe("qué me frena", () => {
  it("un memo al día y asignado no frena nada", () => {
    assert.equal(meFrena(memo()), false);
    assert.deepEqual(frenos(memo()), []);
  });

  it("un memo sin nadie asignado es plata que no le llega a nadie", () => {
    assert.deepEqual(codigos(memo({ estado: "BORRADOR", personas: 0 })), ["SIN_ASIGNAR"]);
  });

  it("pero uno anulado o cerrado sin asignar ya no frena", () => {
    for (const estado of ["ANULADO", "CERRADO"]) {
      assert.equal(meFrena(memo({ estado, personas: 0 })), false);
    }
  });

  it("una presentada espera mi revisión", () => {
    assert.deepEqual(codigos(memo({ estado: "PRESENTADA" })), ["ESPERA_REVISION"]);
  });

  it("una observada frena, pero menos: la pelota está del otro lado", () => {
    const f = frenos(memo({ estado: "OBSERVADA" }));
    assert.equal(f[0].codigo, "OBSERVADA");
    assert.equal(f[0].urgencia, "media");
  });
});

// El caso del memo 594-2026: la planilla BCP 1439 pagó a siete de once.
describe("el pago a medias, que antes no aparecía en ninguna bandeja", () => {
  it("cuatro personas sin cobrar frenan, y se dicen por número", () => {
    const f = frenos(memo({ sinCobrar: 4 }));
    assert.equal(f[0].codigo, "PAGO_INCOMPLETO");
    assert.equal(f[0].texto, "4 personas no han cobrado");
  });

  it("una sola persona se dice en singular", () => {
    assert.equal(frenos(memo({ sinCobrar: 1 }))[0].texto, "1 persona no ha cobrado");
  });

  it("un abono rechazado va antes que el pago incompleto: tiene culpable", () => {
    assert.deepEqual(
      codigos(memo({ sinCobrar: 4, rechazadas: 1 })),
      ["PAGO_RECHAZADO", "PAGO_INCOMPLETO"]
    );
  });

  it("sin constancias registradas no se inventa que falta cobrar", () => {
    assert.equal(meFrena(memo({ sinCobrar: null })), false);
  });
});

describe("el atraso sube de tono con los días", () => {
  it("tres días es ámbar", () => {
    assert.equal(frenos(memo({ diasAtraso: 3 }))[0].urgencia, "media");
  });

  it("dieciocho días es rojo", () => {
    assert.equal(frenos(memo({ diasAtraso: 18 }))[0].urgencia, "alta");
  });

  it("al día no frena", () => {
    assert.equal(meFrena(memo({ diasAtraso: 0 })), false);
    assert.equal(meFrena(memo({ diasAtraso: -5 })), false);
  });
});

describe("el freno que se muestra cuando sólo cabe uno", () => {
  it("gana el urgente sobre el informativo", () => {
    const m = memo({ estado: "OBSERVADA", diasAtraso: 2, bloqueantes: 1 });
    assert.equal(frenoPrincipal(m)!.codigo, "BLOQUEANTES");
  });

  it("a igualdad de urgencia, el primero, que es el más accionable", () => {
    const m = memo({ estado: "PRESENTADA", personas: 0 });
    assert.equal(frenoPrincipal(m)!.codigo, "SIN_ASIGNAR");
  });

  it("sin frenos no hay ninguno que mostrar", () => {
    assert.equal(frenoPrincipal(memo()), null);
  });
});

describe("las pestañas", () => {
  const lista = [
    memo({ id: "a", estado: "PRESENTADA" }),
    memo({ id: "b", estado: "BORRADOR", personas: 0 }),
    memo({ id: "c", sinCobrar: 4 }),
    memo({ id: "d", diasAtraso: 18 }),
    memo({ id: "e" }),
  ];

  it("cuenta cada pestaña por su cuenta, y «todas» es todas", () => {
    const c = conteos(lista);
    assert.equal(c["me-frena"], 4);
    assert.equal(c["presentadas"], 1);
    assert.equal(c["pago"], 1);
    assert.equal(c["borradores"], 1);
    assert.equal(c["atrasadas"], 1);
    assert.equal(c["todas"], 5);
  });

  it("abre en «me frena a mí», que es el punto entero del rediseño", () => {
    assert.equal(filtroInicial(lista), "me-frena");
  });

  // Abrir en una lista vacía le diría a alguien que su trabajo no existe.
  it("pero si no frena nada, abre en todas y no en el vacío", () => {
    assert.equal(filtroInicial([memo(), memo()]), "todas");
  });

  it("sin memos tampoco abre en un filtro vacío", () => {
    assert.equal(filtroInicial([]), "todas");
  });
});
