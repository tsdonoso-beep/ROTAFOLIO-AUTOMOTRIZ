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

  describe("explicarPendientes", () => {
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
