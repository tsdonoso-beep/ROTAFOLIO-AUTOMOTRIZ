import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hayUrgentes, pendientesDe, SIN_PENDIENTES, totalPendiente,
} from "../pendientes.ts";

const con = (p: Partial<typeof SIN_PENDIENTES>) => ({ ...SIN_PENDIENTES, ...p });

describe("pendientesDe", () => {
  test("sin nada esperando no se dice nada", () => {
    assert.deepEqual(pendientesDe(SIN_PENDIENTES), []);
  });

  test("solo aparece lo que tiene cantidad", () => {
    const r = pendientesDe(con({ porRevisar: 2 }));
    assert.equal(r.length, 1);
    assert.equal(r[0].clave, "porRevisar");
  });

  test("lo que frena a otra persona va primero", () => {
    // El criterio de urgencia no es la antigüedad: es si estoy trabando a
    // alguien. Contabilizar puede esperar; un visto bueno tiene a una
    // persona sin su adelanto.
    const r = pendientesDe(con({ porContabilizar: 9, vistoBueno: 1 }));
    assert.equal(r[0].clave, "vistoBueno");
    assert.equal(r[1].clave, "porContabilizar");
  });

  test("el singular y el plural se escriben distinto", () => {
    assert.match(pendientesDe(con({ porRevisar: 1 }))[0].titulo, /1 rendición por revisar/);
    assert.match(pendientesDe(con({ porRevisar: 3 }))[0].titulo, /3 rendiciones por revisar/);
  });

  test("cada pendiente dice a dónde ir", () => {
    for (const p of pendientesDe(con({
      vistoBueno: 1, gastosObservados: 1, rendicionesVencidas: 1, porRevisar: 1,
      porContabilizar: 1, porPagar: 1, borradoresDetenidos: 1, fotosSinArchivar: 1,
    }))) {
      assert.match(p.ruta, /^\//, p.clave);
      assert.ok(p.detalle.length > 0, p.clave);
    }
  });

  test("una liquidación emitida sin pagar es urgente", () => {
    // Es el caso que hizo falta construir todo esto: el documento salió y
    // nadie sabe si la plata se movió.
    assert.equal(pendientesDe(con({ porPagar: 1 }))[0].urgente, true);
  });

  test("una foto que no llegó es urgente: el gasto queda sin respaldo", () => {
    // Se cuenta sobre el error de subida, no sobre la ausencia de foto: un
    // Yape legítimamente no tiene imagen y eso no hay que avisarlo.
    const r = pendientesDe(con({ fotosSinArchivar: 2 }));
    assert.equal(r[0].urgente, true);
    assert.match(r[0].titulo, /2 comprobantes tuyos se quedaron sin foto/);
    assert.match(r[0].detalle, /no tiene respaldo/);
  });

  test("un borrador detenido no es urgente pero se dice igual", () => {
    const r = pendientesDe(con({ borradoresDetenidos: 2 }));
    assert.equal(r[0].urgente, false);
    assert.match(r[0].detalle, /todavía no los ve/);
  });
});

describe("totalPendiente y hayUrgentes", () => {
  test("suma todas las cantidades", () => {
    assert.equal(totalPendiente(con({ porRevisar: 2, porContabilizar: 3 })), 5);
  });

  test("sin nada, cero y sin urgencias", () => {
    assert.equal(totalPendiente(SIN_PENDIENTES), 0);
    assert.equal(hayUrgentes(SIN_PENDIENTES), false);
  });

  test("solo lo no urgente no enciende la alarma", () => {
    assert.equal(hayUrgentes(con({ porContabilizar: 4 })), false);
    assert.equal(hayUrgentes(con({ porContabilizar: 4, porRevisar: 1 })), true);
  });
});
