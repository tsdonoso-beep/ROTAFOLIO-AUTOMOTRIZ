// Extractor de comprobantes con Gemini — solo servidor
//
// Implementa `ExtractorComprobantes` (§8.5) para que se pueda cambiar de
// proveedor sin tocar el resto: la decisión de qué modelo puede procesar
// documentos de la empresa sigue abierta en §15 pregunta 7.
//
// Conserva del MVP lo que la spec §1.1 pidió conservar: descubrimiento
// dinámico del modelo, thinkingBudget 0 y responseMimeType JSON.

import type { ExtractorComprobantes, ResultadoExtraccion } from "../dominio/tipos.ts";
import { PROMPT_EXTRACCION } from "./prompt.ts";
import { PoolClaves, poolCompartido } from "./pool-claves.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const PREFERENCIA = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-flash-latest",
];

/** Modelo descubierto por clave; evita repetir la consulta en cada extracción. */
const modeloPorClave = new Map<string, string>();

export class ExtractorGemini implements ExtractorComprobantes {
  readonly nombre = "gemini";
  private pool: PoolClaves;

  constructor(pool: PoolClaves = poolCompartido()) {
    this.pool = pool;
  }

  async extraer(params: { base64: string; mimeType: string; signal?: AbortSignal }) {
    if (this.pool.vacio) {
      throw new ErrorExtraccion(
        "No hay ninguna clave de IA configurada en el servidor.",
        "SIN_CLAVES"
      );
    }

    const intentos = this.pool.ordenDeIntento();
    let ultimo: ErrorExtraccion | null = null;

    for (const clave of intentos) {
      try {
        const modelo = await this.descubrirModelo(clave);
        const crudo = await this.generar(clave, modelo, params);
        const resultado = interpretar(crudo);
        this.pool.registrarExito(clave);
        return { resultado, modelo, crudo };
      } catch (e) {
        const err = e instanceof ErrorExtraccion
          ? e
          : new ErrorExtraccion((e as Error).message, "DESCONOCIDO");

        // Un fallo del contenido (imagen ilegible, JSON inválido) no mejora
        // cambiando de clave: se propaga sin gastar el resto del pool.
        if (!err.reintentableConOtraClave) throw err;

        this.pool.registrarFallo(clave, err.message, err.codigo === "CUOTA");
        modeloPorClave.delete(clave);
        ultimo = err;
      }
    }

    throw ultimo ?? new ErrorExtraccion("Ninguna clave de IA pudo procesar la imagen.", "SIN_CLAVES");
  }

  private async descubrirModelo(clave: string): Promise<string> {
    const cacheado = modeloPorClave.get(clave);
    if (cacheado) return cacheado;

    const res = await fetch(`${BASE}?key=${clave}`);
    if (!res.ok) throw traducir(res.status, await res.text());

    const json = await res.json();
    const disponibles: string[] = (json.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name?: string }) => m.name?.replace("models/", "") ?? "")
      .filter(Boolean);

    const elegido =
      PREFERENCIA.find(p => disponibles.includes(p)) ??
      disponibles.find(n => /gemini.*flash/i.test(n)) ??
      disponibles.find(n => /gemini/i.test(n));

    if (!elegido) {
      throw new ErrorExtraccion(
        "La clave no da acceso a ningún modelo con visión.",
        "CLAVE_INVALIDA"
      );
    }

    modeloPorClave.set(clave, elegido);
    return elegido;
  }

  private async generar(
    clave: string,
    modelo: string,
    params: { base64: string; mimeType: string; signal?: AbortSignal }
  ): Promise<string> {
    const res = await fetch(`${BASE}/${modelo}:generateContent?key=${clave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: params.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT_EXTRACCION },
            { inline_data: { mime_type: params.mimeType, data: params.base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) throw traducir(res.status, await res.text());

    const json = await res.json();
    const fin = json.candidates?.[0]?.finishReason;

    if (fin === "SAFETY" || fin === "PROHIBITED_CONTENT") {
      throw new ErrorExtraccion("La IA bloqueó esta imagen por sus filtros de contenido.", "CONTENIDO");
    }

    const texto: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!texto.trim()) {
      throw new ErrorExtraccion(
        fin === "MAX_TOKENS"
          ? "La respuesta se cortó por longitud. Prueba con una imagen más simple."
          : "La IA devolvió una respuesta vacía.",
        "CONTENIDO"
      );
    }
    return texto;
  }
}

// ════════════════════════════════════════════════════════════════
// Errores
// ════════════════════════════════════════════════════════════════

export type CodigoError =
  | "SIN_CLAVES" | "CLAVE_INVALIDA" | "CUOTA" | "SERVIDOR"
  | "CONTENIDO" | "DESCONOCIDO";

export class ErrorExtraccion extends Error {
  readonly codigo: CodigoError;

  constructor(mensaje: string, codigo: CodigoError) {
    super(mensaje);
    this.name = "ErrorExtraccion";
    this.codigo = codigo;
  }

  /** Si probar con otra clave del pool puede resolverlo. */
  get reintentableConOtraClave(): boolean {
    return this.codigo === "CLAVE_INVALIDA"
        || this.codigo === "CUOTA"
        || this.codigo === "SERVIDOR";
  }
}

function traducir(status: number, cuerpo: string): ErrorExtraccion {
  if (/API_KEY_INVALID|API key not valid/i.test(cuerpo))
    return new ErrorExtraccion("Clave de IA inválida.", "CLAVE_INVALIDA");
  if (/SERVICE_DISABLED|has not been used in project/i.test(cuerpo))
    return new ErrorExtraccion("La API de Gemini no está habilitada para esta clave.", "CLAVE_INVALIDA");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(cuerpo))
    return new ErrorExtraccion("Clave sin cuota disponible.", "CUOTA");
  if (status === 401 || status === 403)
    return new ErrorExtraccion("La clave no tiene permiso para usar Gemini.", "CLAVE_INVALIDA");
  if (status >= 500)
    return new ErrorExtraccion("Google tuvo un problema temporal.", "SERVIDOR");
  return new ErrorExtraccion(`Error ${status}: ${cuerpo.slice(0, 160)}`, "DESCONOCIDO");
}

// ════════════════════════════════════════════════════════════════
// Interpretación de la respuesta
// ════════════════════════════════════════════════════════════════

const CAMPOS_TEXTO = [
  "proveedor_ruc", "proveedor_nombre", "adquiriente_ruc", "tipo_comprobante",
  "serie", "numero", "fecha_emision", "forma_pago", "detalle",
] as const;

/**
 * Convierte la respuesta cruda al tipo del dominio, tolerando que el modelo
 * omita campos o los devuelva como texto. Un campo declarado no legible se
 * deja vacío a propósito: la interfaz lo marcará como obligatorio (§7.5).
 */
export function interpretar(crudo: string): ResultadoExtraccion {
  const match = crudo.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new ErrorExtraccion(`La IA no devolvió JSON. Respuesta: ${crudo.slice(0, 120)}`, "CONTENIDO");
  }

  let j: Record<string, unknown>;
  try {
    j = JSON.parse(match[0]);
  } catch {
    throw new ErrorExtraccion(`El JSON de la IA no se pudo leer: ${match[0].slice(0, 120)}`, "CONTENIDO");
  }

  const noLegibles = Array.isArray(j._no_legibles) ? j._no_legibles.map(String) : [];
  const confianza: Record<string, number> = {};
  if (j._confianza && typeof j._confianza === "object") {
    for (const [k, v] of Object.entries(j._confianza as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) confianza[k] = Math.min(1, Math.max(0, n));
    }
  }
  // Un campo que el modelo declaró ilegible cuenta como confianza cero,
  // aunque no lo haya incluido en _confianza.
  for (const campo of noLegibles) confianza[campo] = 0;

  const texto = (k: string): string => {
    if (noLegibles.includes(k)) return "";
    const v = j[k];
    return v == null ? "" : String(v).trim();
  };

  const numero = (k: string): number => {
    if (noLegibles.includes(k)) return 0;
    const n = Number(j[k]);
    return Number.isFinite(n) ? n : 0;
  };

  const salida = {
    moneda: j.moneda === "USD" ? "USD" : "PEN",
    subtotal: numero("subtotal"),
    igv: numero("igv"),
    total: numero("total"),
    _confianza: confianza,
    _no_legibles: noLegibles,
  } as ResultadoExtraccion;

  for (const campo of CAMPOS_TEXTO) {
    (salida as unknown as Record<string, string>)[campo] = texto(campo);
  }
  return salida;
}
