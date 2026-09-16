import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  impedimentosParaPresentar, puedeEditarGasto, transicionGastoValida, transicionMemoValida,
} from "../estados.ts";
import { autoriza, puede, veTodo } from "../permisos.ts";
import { armarCorrelativo, consolidar, correlativoValido, evaluarBloqueoPorPendientes, explicarPendientes, rutaDrive } from "../memo.ts";
import { PARAMETROS_POR_DEFECTO, type Alerta, type EstadoGasto, type Gasto } from "../tipos.ts";

// ════════════════════════════════════════════════════════════════
describe("Transiciones del memo", () => {
  it("ADMIN_MEMOS abre un borrador", () => {
    assert.ok(transicionMemoValida("BORRADOR", "ABIERTO", ["ADMIN_MEMOS"]).ok);
  });

  it("un RENDIDOR no puede abrir un memo", () => {
    assert.ok(!transicionMemoValida("BORRADOR", "ABIERTO", ["RENDIDOR"]).ok);
  });

  it("el rendidor presenta su rendición", () => {
    assert.ok(transicionMemoValida("EN_RENDICION", "PRESENTADA", ["RENDIDOR"]).ok);
  });

  it("el rendidor no puede aprobarse a sí mismo", () => {
    assert.ok(!transicionMemoValida("PRESENTADA", "APROBADA", ["RENDIDOR"]).ok);
  });

  it("REVISOR_COSTOS aprueba, CONTABILIDAD no", () => {
    assert.ok(transicionMemoValida("PRESENTADA", "APROBADA", ["REVISOR_COSTOS"]).ok);
    assert.ok(!transicionMemoValida("PRESENTADA", "APROBADA", ["CONTABILIDAD"]).ok);
  });

  it("CONTABILIDAD marca contabilizado", () => {
    assert.ok(transicionMemoValida("APROBADA", "CONTABILIZADA", ["CONTABILIDAD"]).ok);
  });

  it("rechaza saltos que no existen en la máquina", () => {
    assert.ok(!transicionMemoValida("BORRADOR", "APROBADA", ["ADMIN_SISTEMA"]).ok);
    assert.ok(!transicionMemoValida("CERRADO", "ABIERTO", ["ADMIN_SISTEMA"]).ok);
  });

  it("la entrada en rendición la produce el sistema, no un usuario", () => {
    assert.ok(!transicionMemoValida("ABIERTO", "EN_RENDICION", ["ADMIN_SISTEMA"]).ok);
  });
});

// ════════════════════════════════════════════════════════════════
describe("Corrección parcial tras una observación", () => {
  it("en un memo OBSERVADA solo el gasto observado es editable", () => {
    assert.ok(puedeEditarGasto("OBSERVADO", "OBSERVADA"));
    assert.ok(!puedeEditarGasto("VALIDADO", "OBSERVADA"));
    assert.ok(!puedeEditarGasto("APROBADO", "OBSERVADA"));
  });

  it("presentar congela la rendición para el rendidor", () => {
    assert.ok(!puedeEditarGasto("PRESENTADO", "PRESENTADA"));
    assert.ok(!puedeEditarGasto("VALIDADO", "PRESENTADA"));
  });

  it("mientras el memo está en rendición se edita con normalidad", () => {
    assert.ok(puedeEditarGasto("VALIDADO", "EN_RENDICION"));
    assert.ok(puedeEditarGasto("CON_ALERTA", "EN_RENDICION"));
  });

  it("un gasto sin memo (bandeja sin asignar) es editable", () => {
    assert.ok(puedeEditarGasto("CAPTURADO", null));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Transiciones del gasto", () => {
  it("sigue el camino normal", () => {
    assert.ok(transicionGastoValida("CAPTURADO", "EXTRAIDO"));
    assert.ok(transicionGastoValida("EXTRAIDO", "VALIDADO"));
    assert.ok(transicionGastoValida("VALIDADO", "PRESENTADO"));
    assert.ok(transicionGastoValida("PRESENTADO", "APROBADO"));
  });

  it("permite volver de observado a validado", () => {
    assert.ok(transicionGastoValida("OBSERVADO", "VALIDADO"));
  });

  it("contabilizado es terminal", () => {
    assert.ok(!transicionGastoValida("CONTABILIZADO", "OBSERVADO"));
  });

  it("no se salta la extracción", () => {
    assert.ok(!transicionGastoValida("CAPTURADO", "PRESENTADO"));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Impedimentos para presentar", () => {
  const g = (estado: EstadoGasto, alertas: Alerta[] = [], conf = false) =>
    ({ estado, alertas, alertas_confirmadas: conf });

  const alerta = (severidad: Alerta["severidad"]): Alerta =>
    ({ codigo: "ARITMETICA", mensaje: "", severidad });

  it("una rendición vacía no se puede presentar", () => {
    assert.equal(impedimentosParaPresentar([]).length, 1);
  });

  it("sin problemas, no hay impedimentos", () => {
    assert.equal(impedimentosParaPresentar([g("VALIDADO")]).length, 0);
  });

  it("un gasto sin extraer lo impide", () => {
    const r = impedimentosParaPresentar([g("VALIDADO"), g("CAPTURADO")]);
    assert.ok(r.some(x => /sin extraer/.test(x.motivo)));
  });

  it("una alerta bloqueante lo impide", () => {
    const r = impedimentosParaPresentar([g("VALIDADO", [alerta("bloqueante")])]);
    assert.ok(r.some(x => /bloqueantes/.test(x.motivo)));
  });

  it("una alerta no confirmada lo impide", () => {
    const r = impedimentosParaPresentar([g("VALIDADO", [alerta("alta")], false)]);
    assert.ok(r.some(x => /sin confirmar/.test(x.motivo)));
  });

  it("confirmada, la alerta deja pasar", () => {
    assert.equal(impedimentosParaPresentar([g("VALIDADO", [alerta("alta")], true)]).length, 0);
  });
});

// ════════════════════════════════════════════════════════════════
describe("Permisos", () => {
  it("el rendidor no crea memos", () => {
    assert.ok(!puede(["RENDIDOR"], "crear_memo"));
    assert.ok(puede(["ADMIN_MEMOS"], "crear_memo"));
  });

  it("un rendidor no lee el gasto de otro", () => {
    const yo = { usuarioId: "u1", areaId: "a1", roles: ["RENDIDOR" as const] };
    assert.ok(autoriza(yo, "editar_gasto_no_presentado", { propietarioId: "u1" }).ok);
    assert.ok(!autoriza(yo, "editar_gasto_no_presentado", { propietarioId: "u2" }).ok);
  });

  it("jefatura alcanza solo su área", () => {
    const jefe = { usuarioId: "j1", areaId: "a1", roles: ["JEFATURA" as const] };
    assert.ok(autoriza(jefe, "ver_memos_ajenos", { areaId: "a1" }).ok);
    assert.ok(!autoriza(jefe, "ver_memos_ajenos", { areaId: "a2" }).ok);
  });

  it("con varios roles gana el alcance más amplio", () => {
    const david = { usuarioId: "d", areaId: "a1", roles: ["ADMIN_MEMOS" as const, "REVISOR_COSTOS" as const] };
    assert.ok(autoriza(david, "ver_memos_ajenos", { areaId: "a9" }).ok);
  });

  it("sin dueño declarado se deniega por defecto", () => {
    const yo = { usuarioId: "u1", areaId: null, roles: ["RENDIDOR" as const] };
    assert.ok(!autoriza(yo, "editar_gasto_no_presentado", {}).ok);
  });

  it("veTodo distingue quién ve cualquier memo", () => {
    assert.ok(veTodo(["CONTABILIDAD"]));
    assert.ok(!veTodo(["RENDIDOR"]));
    assert.ok(!veTodo(["JEFATURA"]));   // solo su área, no todo
  });
});

// ════════════════════════════════════════════════════════════════
describe("Correlativo", () => {
  it("arma el formato de §7.1", () => {
    const c = armarCorrelativo({ empresaAbrev: "INROPRIN", anio: 2026, tipo: "VIATICOS", secuencia: 412 });
    assert.equal(c, "INROPRIN-2026-VIA-00412");
    assert.ok(correlativoValido(c));
  });

  it("rellena con ceros a cinco dígitos", () => {
    const c = armarCorrelativo({ empresaAbrev: "INROPRIN", anio: 2026, tipo: "CAJA_CHICA", secuencia: 7 });
    assert.equal(c, "INROPRIN-2026-CCH-00007");
  });

  it("no se corta si la secuencia pasa de 99999", () => {
    const c = armarCorrelativo({ empresaAbrev: "X", anio: 2026, tipo: "OTRO", secuencia: 123456 });
    assert.equal(c, "X-2026-OTR-123456");
    assert.ok(correlativoValido(c));
  });
});

// ════════════════════════════════════════════════════════════════
describe("Consolidado", () => {
  const g = (total: number, clase: Gasto["clase"], estado: EstadoGasto = "VALIDADO") =>
    ({ total, clase, estado, alertas: [] as Alerta[] });

  it("suma las tres clases de gasto", () => {
    const c = consolidar(1000, [
      g(300, "COMPROBANTE"), g(50, "DECLARACION_JURADA"), g(25, "MOVILIDAD"),
    ]);
    assert.equal(c.rendido, 375);
    assert.equal(c.por_clase.COMPROBANTE, 300);
    assert.equal(c.por_clase.DECLARACION_JURADA, 50);
    assert.equal(c.por_clase.MOVILIDAD, 25);
  });

  it("calcula devolución cuando sobra dinero", () => {
    const c = consolidar(1000, [g(400, "COMPROBANTE")]);
    assert.equal(c.saldo, 600);
    assert.equal(c.devolucion, 600);
    assert.equal(c.reembolso, 0);
  });

  it("calcula reembolso cuando se gastó de más", () => {
    const c = consolidar(1000, [g(1200, "COMPROBANTE")]);
    assert.equal(c.saldo, -200);
    assert.equal(c.devolucion, 0);
    assert.equal(c.reembolso, 200);
  });

  it("no cuenta los gastos que aún no se extrajeron", () => {
    const c = consolidar(1000, [g(300, "COMPROBANTE"), g(500, "COMPROBANTE", "CAPTURADO")]);
    assert.equal(c.rendido, 300);
    assert.equal(c.cantidad_gastos, 2);
  });

  it("redondea a céntimos y no arrastra decimales binarios", () => {
    const c = consolidar(100, [g(0.1, "COMPROBANTE"), g(0.2, "COMPROBANTE")]);
    assert.equal(c.rendido, 0.3);
  });

  it("sin adelanto no hay exceso: es el caso de la caja chica", () => {
    // El memo de una caja chica nace después de los gastos y con monto
    // autorizado en cero. La cuenta da igual —saldo negativo, todo
    // reembolso—, pero la pantalla decía "Excedido" y pintaba de rojo algo
    // que es lo normal: nadie se pasó de un monto porque no había monto.
    const c = consolidar(0, [g(45.5, "COMPROBANTE"), g(80.9, "COMPROBANTE")]);
    assert.equal(c.sinAdelanto, true);
    assert.equal(c.rendido, 126.4);
    assert.equal(c.reembolso, 126.4);
    assert.equal(c.devolucion, 0);
  });

  it("un memo con adelanto no se marca como caja chica", () => {
    assert.equal(consolidar(1000, [g(400, "COMPROBANTE")]).sinAdelanto, false);
  });

  it("un memo sin adelanto y sin gastos tampoco es un exceso", () => {
    const c = consolidar(0, []);
    assert.equal(c.sinAdelanto, true);
    assert.equal(c.reembolso, 0);
  });
});

// ════════════════════════════════════════════════════════════════
describe("Bloqueo por memos vencidos", () => {
  const hoy = new Date("2026-09-04T00:00:00Z");
  const memo = (estado: Gasto extends never ? never : "ABIERTO" | "EN_RENDICION" | "CERRADO", retorno: string) =>
    ({ id: "m1", correlativo: "X-2026-VIA-00001", estado, monto_autorizado: 500, fecha_retorno_prev: retorno });

  it("advierte pero no bloquea con el parámetro apagado", () => {
    const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-07-01")], PARAMETROS_POR_DEFECTO, hoy);
    assert.ok(r.advierte);
    assert.ok(!r.bloquea);
    assert.equal(r.monto_total, 500);
  });

  it("bloquea cuando el parámetro está activo", () => {
    const p = { ...PARAMETROS_POR_DEFECTO, bloquear_memo_con_pendientes: true };
    const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-07-01")], p, hoy);
    assert.ok(r.bloquea);
  });

  it("respeta los días de gracia", () => {
    // Retorno hace 10 días, gracia de 15: todavía no cuenta como vencido.
    const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-08-25")], PARAMETROS_POR_DEFECTO, hoy);
    assert.ok(!r.advierte);
  });

  it("ignora los memos ya cerrados", () => {
    const r = evaluarBloqueoPorPendientes([memo("CERRADO", "2026-01-01")], PARAMETROS_POR_DEFECTO, hoy);
    assert.equal(r.vencidos.length, 0);
  });

  it("una rendición presentada ya no es un pendiente", () => {
    // Quien presentó hizo su parte: lo que falta es que la revisen, y eso no
    // es motivo para negarle plata nueva.
    const presentada = { ...memo("ABIERTO", "2026-07-01"), estado: "PRESENTADA" as const };
    const r = evaluarBloqueoPorPendientes(
      [presentada as unknown as Parameters<typeof evaluarBloqueoPorPendientes>[0][number]],
      { ...PARAMETROS_POR_DEFECTO, bloquear_memo_con_pendientes: true },
      hoy
    );
    assert.ok(!r.advierte);
  });

  // ── El anexo del memo (migración 021) ──────────────────────────
  //
  // Un memo cubre a varias personas con montos y tramos distintos. Medir el
  // vencimiento y la deuda contra el memo entero, como se hacía, le atribuye
  // a cada una lo de todas.

  it("el tramo del anexo manda sobre las fechas del memo", () => {
    // El memo llega hasta el 19 de agosto, pero a esta persona le tocaron el
    // 9 y el 10. Contra el memo estaría en plazo; contra su tramo, no.
    const conAnexo = {
      ...memo("ABIERTO", "2026-08-19"),
      fecha_hasta: "2026-08-10",
      monto_asignado: 212,
    };
    const r = evaluarBloqueoPorPendientes([conAnexo], PARAMETROS_POR_DEFECTO, hoy);

    assert.ok(r.advierte, "el 10 de agosto más 15 de gracia ya venció el 4 de setiembre");
    assert.equal(r.vencidos[0].fecha_retorno_prev, "2026-08-10");
    assert.equal(r.vencidos[0].dias_vencido, 25);
  });

  it("sin anexo se sigue midiendo contra la fecha del memo", () => {
    const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-07-01")], PARAMETROS_POR_DEFECTO, hoy);
    assert.equal(r.vencidos[0].fecha_retorno_prev, "2026-07-01");
    assert.equal(r.vencidos[0].monto_asignado, null);
  });

  it("la deuda es la parte de esta persona, no el memo entero", () => {
    // El 594-2026 autorizó S/ 9,064.00 entre once personas. A Wilmer le
    // tocaron S/ 212.00: cobrarle los nueve mil infla la deuda ocho veces.
    const wilmer = {
      id: "m594",
      correlativo: "594-2026",
      estado: "ABIERTO" as const,
      monto_autorizado: 9064,
      fecha_retorno_prev: "2026-08-19",
      fecha_hasta: "2026-08-10",
      monto_asignado: 212,
    };
    const r = evaluarBloqueoPorPendientes([wilmer], PARAMETROS_POR_DEFECTO, hoy);

    assert.equal(r.monto_total, 212);
    assert.equal(r.vencidos[0].monto_autorizado, 9064, "el total del memo se conserva para mostrarlo");
  });

  it("suma las partes de varios memos, cada una la suya", () => {
    const r = evaluarBloqueoPorPendientes([
      { ...memo("ABIERTO", "2026-07-01"), fecha_hasta: "2026-07-01", monto_asignado: 212 },
      { ...memo("ABIERTO", "2026-07-01"), id: "m2", fecha_hasta: "2026-07-01", monto_asignado: 1164 },
    ], PARAMETROS_POR_DEFECTO, hoy);

    assert.equal(r.vencidos.length, 2);
    assert.equal(r.monto_total, 1376);
  });

  it("un tramo sin fecha no inventa un vencimiento", () => {
    const r = evaluarBloqueoPorPendientes(
      [{ ...memo("ABIERTO", "2026-07-01"), fecha_retorno_prev: null, fecha_hasta: null }],
      PARAMETROS_POR_DEFECTO, hoy
    );
    assert.equal(r.vencidos.length, 0);
  });

  describe("explicarPendientes", () => {
    it("el total y la lista hablan del mismo monto", () => {
      const r = evaluarBloqueoPorPendientes([{
        id: "m594", correlativo: "594-2026", estado: "ABIERTO" as const,
        monto_autorizado: 9064, fecha_retorno_prev: "2026-08-19",
        fecha_hasta: "2026-08-10", monto_asignado: 212,
      }], PARAMETROS_POR_DEFECTO, hoy);

      const msg = explicarPendientes("Wilmer Zamora", r);
      assert.ok(msg.includes("212"), msg);
      assert.ok(!msg.includes("9,064"), `no debe atribuirle el memo entero: ${msg}`);
    });

    it("nombra a la persona, el monto y los memos", () => {
      // Quien crea el memo casi nunca es quien arrastra el pendiente: Annie
      // abre memos para todos y no sabe de memoria qué debe cada uno.
      const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-07-01")], PARAMETROS_POR_DEFECTO, hoy);
      const texto = explicarPendientes("Justo Lavilla", r);
      assert.match(texto, /Justo Lavilla/);
      assert.match(texto, /X-2026-VIA-00001/);
      assert.match(texto, /S\/ 500\.00/);
      assert.match(texto, /65 días/);
    });

    it("usa el singular con un solo memo", () => {
      const r = evaluarBloqueoPorPendientes([memo("ABIERTO", "2026-07-01")], PARAMETROS_POR_DEFECTO, hoy);
      assert.match(explicarPendientes("Justo", r), /una rendición vencida/);
    });

    it("sin pendientes no dice nada", () => {
      const r = evaluarBloqueoPorPendientes([], PARAMETROS_POR_DEFECTO, hoy);
      assert.equal(explicarPendientes("Justo", r), "");
    });
  });
});

// ════════════════════════════════════════════════════════════════
describe("Ruta en Drive", () => {
  it("incluye el período, como pidió Contabilidad", () => {
    const r = rutaDrive({
      empresaAbrev: "INROPRIN", fechaSalida: "2026-03-15",
      centroCostoFolder: "1.3 Instalación", correlativo: "INROPRIN-2026-VIA-00412",
    });
    assert.deepEqual(r, ["INROPRIN", "2026-03", "1.3 Instalación", "INROPRIN-2026-VIA-00412"]);
  });
});

// ════════════════════════════════════════════════════════════════
// Lo rendido y lo que da crédito fiscal son dos números distintos
// ════════════════════════════════════════════════════════════════
//
// La rendición de Wilmer Zamora, del memo 594-2026, tal como está en el
// formato: recibió S/ 212.00, rindió S/ 201.80 y devolvió S/ 10.20. De lo
// rendido, solo la factura descuenta IGV.
//
//   facturas             132.90   ← lo único que da crédito fiscal
//   planilla movilidad    20.90
//   declaración jurada    48.00
//                       ───────
//   rendido              201.80

describe("crédito fiscal", () => {
  const g = (
    clase: "COMPROBANTE" | "DECLARACION_JURADA" | "MOVILIDAD",
    total: number,
    tipo_comprobante: string | null = null
  ) => ({ estado: "VALIDADO" as const, clase, total, alertas: [], tipo_comprobante });

  const wilmer = [
    g("COMPROBANTE", 132.90, "01"),
    g("MOVILIDAD", 20.90),
    g("DECLARACION_JURADA", 48.00),
  ];

  it("la rendición de Wilmer calza al céntimo y separa el crédito", () => {
    const c = consolidar(212, wilmer);
    assert.equal(c.rendido, 201.80);
    assert.equal(c.credito_fiscal, 132.90);
    assert.equal(c.devolucion, 10.20);
  });

  it("una boleta es gasto deducible pero no da crédito fiscal", () => {
    const c = consolidar(212, [g("COMPROBANTE", 100, "03")]);
    assert.equal(c.rendido, 100);
    assert.equal(c.credito_fiscal, 0);
  });

  it("la constancia de un Yape tampoco: es un pago real sin sustento formal", () => {
    assert.equal(consolidar(212, [g("COMPROBANTE", 100, "00")]).credito_fiscal, 0);
  });

  it("sin tipo leído todavía no se cuenta: suponerlo factura infla la declaración", () => {
    assert.equal(consolidar(212, [g("COMPROBANTE", 100, null)]).credito_fiscal, 0);
  });
});
