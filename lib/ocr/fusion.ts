// Fusión de las tres fuentes de datos de un comprobante
//
// Un gasto puede llenarse desde el OCR local, desde la IA o a mano, y en la
// práctica se llena con una mezcla de las tres. Este módulo decide qué gana
// campo por campo y deja constancia de de dónde salió cada dato, para que
// la pantalla de confirmación pueda mostrarlo y quien revisa después sepa
// qué se leyó y qué se tecleó.
//
// La regla es simple: gana la fuente con más confianza en ese campo, y lo
// manual gana siempre, porque es la persona que tiene el papel en la mano.

import { SIN_CREDITO_FISCAL } from "../dominio/tipos.ts";
import type { ResultadoExtraccion } from "../dominio/tipos.ts";

export type Origen = "ocr" | "ia" | "manual" | "derivado";

export const NOMBRE_ORIGEN: Record<Origen, string> = {
  ocr: "Leído",
  ia: "IA",
  manual: "Tuyo",
  derivado: "Calculado",
};

/**
 * Lo único sin lo cual un gasto no significa nada: cuánto se pagó.
 *
 * Un Yape, un Plin o una transferencia llegan sin RUC, sin serie y sin
 * número —muchas veces son solo una captura de pantalla con un monto— y
 * son plata que salió de la caja igual. Exigirles los datos de una factura
 * dejaría el gasto sin registrar, que es peor que registrarlo incompleto.
 */
export const CAMPOS_OBLIGATORIOS = ["total"] as const;

/**
 * Los datos que dan sustento tributario. No bloquean la carga, pero su
 * ausencia se convierte en una alerta que viaja a quien revisa: sin ellos
 * el gasto no otorga crédito fiscal.
 */
export const CAMPOS_SUSTENTO = [
  "proveedor_ruc",
  "proveedor_nombre",
  "serie",
  "numero",
  "fecha_emision",
] as const;

export interface Fusion {
  valores: ResultadoExtraccion;
  origen: Record<string, Origen>;
}

// ════════════════════════════════════════════════════════════════
//  Fusión OCR + IA
// ════════════════════════════════════════════════════════════════

const CAMPOS_TEXTO = [
  "proveedor_ruc", "proveedor_nombre", "adquiriente_ruc", "tipo_comprobante",
  "serie", "numero", "fecha_emision", "forma_pago", "detalle",
] as const;

const CAMPOS_NUMERO = ["subtotal", "igv", "total"] as const;

/**
 * Combina la lectura del OCR con la de la IA. Cualquiera de las dos puede
 * faltar: sin clave de IA solo llega el OCR, y con un PDF —que Tesseract no
 * lee— solo llega la IA.
 */
export function fusionar(
  ocr: ResultadoExtraccion | null,
  ia: ResultadoExtraccion | null
): Fusion {
  const valores = vacio();
  const origen: Record<string, Origen> = {};

  const elegir = (campo: string): { fuente: ResultadoExtraccion; origen: Origen } | null => {
    const cOcr = ocr?._confianza?.[campo] ?? 0;
    const cIa = ia?._confianza?.[campo] ?? 0;

    if (cOcr === 0 && cIa === 0) return null;
    // Empatados, gana el OCR: sus campos están verificados, no inferidos.
    if (ocr && cOcr >= cIa) return { fuente: ocr, origen: "ocr" };
    if (ia) return { fuente: ia, origen: "ia" };
    return null;
  };

  for (const campo of CAMPOS_TEXTO) {
    const ganador = elegir(campo);
    if (!ganador) continue;
    const v = ganador.fuente[campo];
    if (typeof v === "string" && v.trim()) {
      valores[campo] = v.trim();
      origen[campo] = ganador.origen;
    }
  }

  for (const campo of CAMPOS_NUMERO) {
    const ganador = elegir(campo);
    if (!ganador) continue;
    const v = ganador.fuente[campo];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      valores[campo] = v;
      origen[campo] = ganador.origen;
    }
  }

  const monedaGanadora = elegir("moneda");
  if (monedaGanadora) {
    valores.moneda = monedaGanadora.fuente.moneda;
    origen.moneda = monedaGanadora.origen;
  }

  // La confianza que viaja al gasto es la del campo que efectivamente ganó.
  valores._confianza = {};
  for (const [campo, quien] of Object.entries(origen)) {
    const fuente = quien === "ocr" ? ocr : ia;
    const c = fuente?._confianza?.[campo];
    if (typeof c === "number") valores._confianza[campo] = c;
  }
  valores._no_legibles = camposPendientes(valores);

  return { valores, origen };
}

// ════════════════════════════════════════════════════════════════
//  Aritmética del comprobante
// ════════════════════════════════════════════════════════════════

export interface Importes {
  subtotal: number;
  igv: number;
  total: number;
}

/**
 * Completa los importes que faltan a partir de los que hay.
 *
 * Es lo que permite que en la carga manual la persona teclee solo el total:
 * en una factura el IGV se desagrega con la tasa vigente, y en una boleta,
 * que no da derecho a crédito fiscal, el IGV queda en cero y el subtotal
 * iguala al total.
 *
 * `editado` dice qué campo acaba de tocar la persona, para no sobrescribirlo.
 */
export function completarImportes(
  actual: Importes,
  opciones: { igvPorcentaje: number; tipoComprobante: string; editado?: keyof Importes }
): Importes {
  const { igvPorcentaje, tipoComprobante, editado } = opciones;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Boleta, ticket y constancia de pago no discriminan IGV.
  const sinCreditoFiscal = SIN_CREDITO_FISCAL.includes(tipoComprobante);

  const total = actual.total;
  if (!total || total <= 0) return actual;

  if (sinCreditoFiscal) {
    return { total, subtotal: total, igv: 0 };
  }

  // Si la persona escribió el subtotal, manda el subtotal.
  if (editado === "subtotal" && actual.subtotal > 0) {
    return { total, subtotal: actual.subtotal, igv: r2(total - actual.subtotal) };
  }
  if (editado === "igv" && actual.igv > 0) {
    return { total, subtotal: r2(total - actual.igv), igv: actual.igv };
  }

  // Con el total a secas, se desagrega con la tasa.
  const base = total / (1 + igvPorcentaje / 100);
  return { total, subtotal: r2(base), igv: r2(total - base) };
}

/**
 * Comprueba que los tres importes cierren, con tolerancia de un céntimo.
 *
 * La comparación se hace en céntimos enteros a propósito: en coma flotante
 * 100 + 18 - 118.01 da -0.010000000000005, que excede una tolerancia escrita
 * como 0.01 y haría fallar una suma que en realidad cuadra.
 */
export function importesCuadran(i: Importes): boolean {
  const centimos = Math.round(i.subtotal * 100) + Math.round(i.igv * 100) - Math.round(i.total * 100);
  return Math.abs(centimos) <= 1;
}

// ════════════════════════════════════════════════════════════════
//  Estado de completitud
// ════════════════════════════════════════════════════════════════

/** Campos obligatorios que siguen vacíos. */
export function camposPendientes(r: ResultadoExtraccion): string[] {
  return CAMPOS_OBLIGATORIOS.filter(campo => {
    const v = r[campo];
    if (typeof v === "number") return !(v > 0);
    return !String(v ?? "").trim();
  });
}

export function estaCompleto(r: ResultadoExtraccion): boolean {
  return camposPendientes(r).length === 0;
}

/** Campos de sustento que faltan. No impiden guardar; se advierten. */
export function sustentoFaltante(r: ResultadoExtraccion): string[] {
  return CAMPOS_SUSTENTO.filter(campo => !String(r[campo] ?? "").trim());
}

/**
 * Un gasto sin RUC ni numeración no tiene sustento tributario, por más
 * que tenga monto y fecha. Es el caso del Yape o la transferencia.
 */
export function sinSustentoFormal(r: ResultadoExtraccion): boolean {
  return !r.proveedor_ruc.trim() || !r.serie.trim() || !r.numero.trim();
}

/** Un resultado vacío, punto de partida de la carga manual. */
export function vacio(): ResultadoExtraccion {
  return {
    proveedor_ruc: "",
    proveedor_nombre: "",
    adquiriente_ruc: "",
    tipo_comprobante: "",
    serie: "",
    numero: "",
    fecha_emision: "",
    moneda: "PEN",
    subtotal: 0,
    igv: 0,
    total: 0,
    forma_pago: "",
    detalle: "",
    _confianza: {},
    _no_legibles: [],
  };
}
