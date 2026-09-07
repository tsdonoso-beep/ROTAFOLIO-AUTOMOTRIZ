// Validaciones sobre el comprobante — SPEC §7.4
//
// Todas producen alertas, no bloqueos, salvo los dos duplicados. Son funciones
// puras: no tocan red ni base de datos, así se pueden probar y se ejecutan
// igual en el navegador y en el servidor.

import type { Alerta, ClaseGasto, Parametros } from "./tipos.ts";

export interface GastoAValidar {
  clase: ClaseGasto;
  categoria?: string | null;
  proveedor_ruc?: string | null;
  tipo_comprobante?: string | null;
  fecha_emision?: string | null;
  subtotal?: number | null;
  igv?: number | null;
  total?: number | null;
  placa?: string | null;
  confianza_extraccion?: Record<string, number> | null;
}

export interface ContextoValidacion {
  parametros: Parametros;
  memo?: {
    monto_autorizado: number;
    fecha_salida: string | null;
    fecha_retorno_prev: string | null;
    /** Suma de los demás gastos del memo, sin contar el que se valida. */
    rendido_previo: number;
  };
  /** Suma de declaraciones juradas del mismo día, sin contar la actual. */
  dj_del_dia?: number;
  /** Suma de movilidad del mismo día, sin contar la actual. */
  movilidad_del_dia?: number;
  duplicadoComprobante?: boolean;
  duplicadoImagen?: boolean;
}

/** Tolerancia de la comprobación aritmética, en soles. */
const TOLERANCIA_ARITMETICA = 0.05;
/** Días de holgura sobre el rango de fechas del memo. */
const TOLERANCIA_DIAS_FECHA = 2;

// ════════════════════════════════════════════════════════════════
// RUC — módulo 11
// ════════════════════════════════════════════════════════════════

/**
 * Valida un RUC peruano: 11 dígitos y dígito verificador por módulo 11.
 *
 * Los pesos 5,4,3,2,7,6,5,4,3,2 se aplican a los diez primeros dígitos; el
 * verificador es 11 menos el resto de dividir la suma entre 11, tomando los
 * dos últimos dígitos del resultado.
 *
 * Comprobado contra RUCs reales: 20612077224 y 20512201611.
 */
export function rucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + Number(ruc[i]) * peso, 0);
  const verificador = (11 - (suma % 11)) % 10;

  return verificador === Number(ruc[10]);
}

/** Los dos primeros dígitos indican el tipo de contribuyente. */
export function tipoContribuyente(ruc: string): "PERSONA_NATURAL" | "PERSONA_JURIDICA" | "OTRO" {
  if (ruc.startsWith("10")) return "PERSONA_NATURAL";
  if (ruc.startsWith("20")) return "PERSONA_JURIDICA";
  return "OTRO";
}

// ════════════════════════════════════════════════════════════════
// Utilidades de fecha
// ════════════════════════════════════════════════════════════════

function aFecha(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ════════════════════════════════════════════════════════════════
// Validación completa
// ════════════════════════════════════════════════════════════════

export function validarGasto(g: GastoAValidar, ctx: ContextoValidacion): Alerta[] {
  const alertas: Alerta[] = [];
  const p = ctx.parametros;

  // ── Duplicados: los únicos bloqueantes ────────────────────────
  // "la duplicidad es el error más caro porque se detecta meses después"
  if (ctx.duplicadoComprobante) {
    alertas.push({
      codigo: "DUPLICADO_COMPROBANTE",
      severidad: "bloqueante",
      mensaje: "Ya existe un gasto registrado con el mismo RUC, serie y número.",
    });
  }
  if (ctx.duplicadoImagen) {
    alertas.push({
      codigo: "DUPLICADO_IMAGEN",
      severidad: "bloqueante",
      mensaje: "Esta misma imagen ya fue cargada en otro gasto.",
    });
  }

  // ── RUC ───────────────────────────────────────────────────────
  if (g.clase === "COMPROBANTE" && g.proveedor_ruc) {
    if (!rucValido(g.proveedor_ruc)) {
      alertas.push({
        codigo: "RUC_FORMATO",
        severidad: "alta",
        campo: "proveedor_ruc",
        mensaje: /^\d{11}$/.test(g.proveedor_ruc)
          ? "El RUC tiene 11 dígitos pero el dígito verificador no corresponde."
          : "El RUC debe tener exactamente 11 dígitos.",
      });
    }
  }

  // ── Aritmética ────────────────────────────────────────────────
  const { subtotal, igv, total } = g;
  if (subtotal != null && igv != null && total != null) {
    if (Math.abs(subtotal + igv - total) > TOLERANCIA_ARITMETICA) {
      alertas.push({
        codigo: "ARITMETICA",
        severidad: "alta",
        campo: "total",
        mensaje: `Subtotal (${subtotal.toFixed(2)}) más IGV (${igv.toFixed(2)}) da ${(subtotal + igv).toFixed(2)}, pero el total dice ${total.toFixed(2)}.`,
      });
    }

    // El IGV esperado no aplica a operaciones exoneradas ni inafectas, que
    // llegan con IGV en cero. Solo se comprueba cuando hay IGV declarado.
    if (igv > 0 && subtotal > 0) {
      const esperado = subtotal * (p.igv_porcentaje / 100);
      if (Math.abs(igv - esperado) > Math.max(TOLERANCIA_ARITMETICA, esperado * 0.01)) {
        alertas.push({
          codigo: "IGV_PORCENTAJE",
          severidad: "media",
          campo: "igv",
          mensaje: `El IGV esperado al ${p.igv_porcentaje}% sería ${esperado.toFixed(2)}, pero dice ${igv.toFixed(2)}.`,
        });
      }
    }
  }

  // ── Fecha dentro del rango del memo ───────────────────────────
  const emision = aFecha(g.fecha_emision);
  if (emision && ctx.memo) {
    const salida = aFecha(ctx.memo.fecha_salida);
    const retorno = aFecha(ctx.memo.fecha_retorno_prev);

    const antes = salida && diasEntre(emision, salida) > TOLERANCIA_DIAS_FECHA;
    const despues = retorno && diasEntre(retorno, emision) > TOLERANCIA_DIAS_FECHA;

    if (antes || despues) {
      alertas.push({
        codigo: "FECHA_FUERA_RANGO",
        severidad: "media",
        campo: "fecha_emision",
        mensaje: `La fecha del comprobante (${g.fecha_emision}) queda fuera del rango del memo${
          salida && retorno ? ` (${ctx.memo.fecha_salida} a ${ctx.memo.fecha_retorno_prev})` : ""
        }.`,
      });
    }
  }

  // ── Excede el monto autorizado ────────────────────────────────
  if (ctx.memo && total != null) {
    const acumulado = ctx.memo.rendido_previo + total;
    if (acumulado > ctx.memo.monto_autorizado) {
      alertas.push({
        codigo: "EXCEDE_AUTORIZADO",
        severidad: "alta",
        mensaje: `Con este gasto lo rendido llega a ${acumulado.toFixed(2)} y supera el autorizado de ${ctx.memo.monto_autorizado.toFixed(2)}.`,
      });
    }
  }

  // ── Topes de declaración jurada y movilidad ───────────────────
  // Si el parámetro está en null, el tope no está definido todavía (§15):
  // no se inventa un valor, simplemente no se comprueba.
  if (g.clase === "DECLARACION_JURADA" && total != null && p.tope_declaracion_jurada_dia != null) {
    const delDia = (ctx.dj_del_dia ?? 0) + total;
    if (delDia > p.tope_declaracion_jurada_dia) {
      alertas.push({
        codigo: "TOPE_DJ_EXCEDIDO",
        severidad: "alta",
        mensaje: `Las declaraciones juradas del día suman ${delDia.toFixed(2)} y el tope es ${p.tope_declaracion_jurada_dia.toFixed(2)}.`,
      });
    }
  }

  if (g.clase === "MOVILIDAD" && total != null && p.tope_movilidad_dia != null) {
    const delDia = (ctx.movilidad_del_dia ?? 0) + total;
    if (delDia > p.tope_movilidad_dia) {
      alertas.push({
        codigo: "TOPE_MOVILIDAD",
        severidad: "alta",
        mensaje: `La movilidad del día suma ${delDia.toFixed(2)} y el tope es ${p.tope_movilidad_dia.toFixed(2)}.`,
      });
    }
  }

  // ── Placa en gastos vehiculares ───────────────────────────────
  if (esVehicular(g.categoria) && !g.placa) {
    alertas.push({
      codigo: "SIN_PLACA",
      severidad: "media",
      campo: "placa",
      mensaje: "Un gasto vehicular debería llevar la placa del vehículo.",
    });
  }

  // ── Confianza de la extracción ────────────────────────────────
  const bajos = camposBajoUmbral(g.confianza_extraccion, p.umbral_confianza_alerta);
  if (bajos.length) {
    alertas.push({
      codigo: "CONFIANZA_BAJA",
      severidad: "media",
      mensaje: `La IA no leyó con seguridad: ${bajos.join(", ")}. Revisa y confirma.`,
    });
  }

  return alertas;
}

function esVehicular(categoria: string | null | undefined): boolean {
  return categoria === "MOVILIDAD" || categoria === "COMBUSTIBLE" || categoria === "PEAJE";
}

export function camposBajoUmbral(
  confianza: Record<string, number> | null | undefined,
  umbral: number
): string[] {
  if (!confianza) return [];
  return Object.entries(confianza)
    .filter(([, v]) => typeof v === "number" && v < umbral)
    .map(([k]) => k);
}

// ════════════════════════════════════════════════════════════════
// Ayudas para la interfaz
// ════════════════════════════════════════════════════════════════

export function hayBloqueantes(alertas: Alerta[]): boolean {
  return alertas.some(a => a.severidad === "bloqueante");
}

/** Ordena por gravedad para mostrar primero lo que importa. */
export function ordenarAlertas(alertas: Alerta[]): Alerta[] {
  const peso = { bloqueante: 0, alta: 1, media: 2, baja: 3 } as const;
  return [...alertas].sort((a, b) => peso[a.severidad] - peso[b.severidad]);
}

// ════════════════════════════════════════════════════════════════
// Distribución entre proyectos (§7.2)
// ════════════════════════════════════════════════════════════════

export function distribucionValida(
  filas: Array<{ porcentaje: number }>
): { ok: true } | { ok: false; motivo: string } {
  if (filas.length === 0) return { ok: true };

  const suma = filas.reduce((s, f) => s + f.porcentaje, 0);
  if (Math.abs(suma - 100) > 0.01) {
    return { ok: false, motivo: `Los porcentajes suman ${suma.toFixed(2)}% y deben sumar 100%.` };
  }
  if (filas.some(f => f.porcentaje <= 0)) {
    return { ok: false, motivo: "Cada porcentaje debe ser mayor que cero." };
  }
  return { ok: true };
}
