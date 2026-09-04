import { GastoExtraido } from "./types";
import { PROMPT_EXTRACCION } from "./prompt";

/**
 * Orden de preferencia. No se codifica un modelo fijo: se consulta a la API
 * qué modelos admite realmente esta clave y se elige el mejor disponible.
 * Así la app no se rompe cuando Google retira una versión.
 */
const PREFERENCIA = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-flash-latest",
];

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Modelo ya descubierto para esta clave; evita repetir la consulta. */
let modeloCache: { key: string; modelo: string } | null = null;

function mensajeAmigable(status: number, cuerpo: string): string {
  if (/API_KEY_INVALID|API key not valid/i.test(cuerpo))
    return "La API Key no es válida para Gemini. Debe empezar con «AIza» y obtenerse en aistudio.google.com/apikey";
  if (/SERVICE_DISABLED|has not been used in project/i.test(cuerpo))
    return "La API de Gemini no está habilitada en el proyecto de Google Cloud asociado a esta clave.";
  if (status === 400)
    return `Solicitud rechazada por Google: ${cuerpo.slice(0, 160)}`;
  if (status === 401 || status === 403)
    return "La API Key no tiene permiso para usar Gemini. Genera una en aistudio.google.com/apikey";
  if (status === 429)
    return "Se superó el límite de solicitudes. Espera un minuto y vuelve a intentar.";
  if (status >= 500)
    return "Google tuvo un problema temporal. Intenta de nuevo en unos segundos.";
  return `Error ${status}: ${cuerpo.slice(0, 160)}`;
}

/** Pregunta a Google qué modelos admite esta clave y elige uno con visión. */
async function descubrirModelo(apiKey: string): Promise<string> {
  if (modeloCache?.key === apiKey) return modeloCache.modelo;

  const res = await fetch(`${BASE}?key=${apiKey}`);
  if (!res.ok) throw new Error(mensajeAmigable(res.status, await res.text()));

  const json = await res.json();
  const disponibles: string[] = (json.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent")
    )
    .map((m: { name?: string }) => m.name?.replace("models/", "") ?? "")
    .filter(Boolean);

  if (!disponibles.length) {
    throw new Error(
      "Esta clave no da acceso a ningún modelo de Gemini. Verifica que sea una API Key de aistudio.google.com/apikey (empieza con «AIza»)."
    );
  }

  const elegido =
    PREFERENCIA.find((p) => disponibles.includes(p)) ??
    disponibles.find((n) => /gemini.*flash/i.test(n)) ??
    disponibles.find((n) => /gemini/i.test(n)) ??
    disponibles[0];

  modeloCache = { key: apiKey, modelo: elegido };
  return elegido;
}

export async function extraerComprobante(
  base64: string,
  mimeType: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ extraido: GastoExtraido; raw: string; modelo: string }> {
  if (!apiKey?.trim()) {
    throw new Error("Falta la API Key de Gemini. Configúrala con el botón 🔑.");
  }

  const modelo = await descubrirModelo(apiKey);

  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT_EXTRACCION },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      // Sin razonamiento interno: más rápido y no consume el presupuesto.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await fetch(`${BASE}/${modelo}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const cuerpo = await res.text();
    // El modelo elegido dejó de servir: se descarta el cacheado para que el
    // siguiente intento vuelva a descubrir uno válido.
    if (res.status === 404) modeloCache = null;
    throw new Error(`${mensajeAmigable(res.status, cuerpo)} (modelo: ${modelo})`);
  }

  const json = await res.json();

  const finish = json.candidates?.[0]?.finishReason;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
    throw new Error("Gemini bloqueó esta imagen por sus filtros de contenido.");
  }

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw.trim()) {
    throw new Error(
      finish === "MAX_TOKENS"
        ? "La respuesta se cortó por longitud. Intenta con una imagen más simple."
        : "Gemini devolvió una respuesta vacía. Intenta de nuevo."
    );
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Gemini no devolvió un JSON válido. Respuesta: ${raw.slice(0, 120)}`);
  }

  let extraido: GastoExtraido;
  try {
    extraido = JSON.parse(match[0]) as GastoExtraido;
  } catch {
    throw new Error(`No se pudo leer el JSON de Gemini: ${match[0].slice(0, 120)}`);
  }

  return { extraido, raw, modelo };
}

export async function testConexion(
  apiKey: string
): Promise<{ ok: boolean; modelo?: string; error?: string }> {
  if (!apiKey?.trim()) return { ok: false, error: "Ingresa una API Key." };
  try {
    modeloCache = null; // fuerza un descubrimiento fresco
    return { ok: true, modelo: await descubrirModelo(apiKey) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
