import { GastoExtraido } from "./types";
import { PROMPT_EXTRACCION } from "./prompt";

/**
 * Modelos estables en orden de preferencia.
 * Si uno no existe (404) o no está disponible, se prueba el siguiente.
 * NO usar modelos "-preview-<fecha>": Google los retira a los pocos meses.
 */
const MODELOS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Traduce errores de la API a algo entendible. */
function mensajeAmigable(status: number, cuerpo: string): string {
  if (status === 400 && /API key not valid/i.test(cuerpo))
    return "La API Key no es válida. Revísala en el botón 🔑 de arriba.";
  if (status === 400 && /image|inline_data|payload/i.test(cuerpo))
    return "La imagen no se pudo procesar. Prueba con una foto más liviana o en JPG.";
  if (status === 403)
    return "La API Key no tiene permiso para usar Gemini. Genera una nueva en aistudio.google.com.";
  if (status === 429)
    return "Se superó el límite de solicitudes. Espera un minuto y vuelve a intentar.";
  if (status === 404)
    return "El modelo de IA no está disponible.";
  if (status >= 500)
    return "Google tuvo un problema temporal. Intenta de nuevo en unos segundos.";
  return `Error ${status}: ${cuerpo.slice(0, 160)}`;
}

async function llamarModelo(
  modelo: string,
  base64: string,
  mimeType: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ ok: true; texto: string } | { ok: false; status: number; cuerpo: string }> {
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
      // Suficiente margen: 512 se agotaba y devolvía texto vacío.
      maxOutputTokens: 2048,
      // Fuerza JSON limpio, sin ```json ni texto extra.
      responseMimeType: "application/json",
      // Sin "pensamiento" interno: más rápido y no consume el presupuesto de tokens.
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
    return { ok: false, status: res.status, cuerpo: await res.text() };
  }

  const json = await res.json();

  // Si el modelo cortó por filtros de seguridad o límite de tokens
  const finish = json.candidates?.[0]?.finishReason;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
    throw new Error("Gemini bloqueó esta imagen por sus filtros de contenido.");
  }

  const texto: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!texto.trim()) {
    throw new Error(
      finish === "MAX_TOKENS"
        ? "La respuesta se cortó por longitud. Intenta con una imagen más simple."
        : "Gemini devolvió una respuesta vacía. Intenta de nuevo."
    );
  }

  return { ok: true, texto };
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

  let ultimoError = "No se pudo conectar con Gemini.";

  for (const modelo of MODELOS) {
    const r = await llamarModelo(modelo, base64, mimeType, apiKey, signal);

    if (!r.ok) {
      ultimoError = mensajeAmigable(r.status, r.cuerpo);
      // Modelo inexistente o sin acceso → probar el siguiente de la lista.
      if (r.status === 404 || r.status === 403) continue;
      // Cualquier otro error (key inválida, cuota, etc.) no mejora cambiando de modelo.
      throw new Error(ultimoError);
    }

    const raw = r.texto;
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

  throw new Error(ultimoError);
}

export async function testConexion(
  apiKey: string
): Promise<{ ok: boolean; modelo?: string; error?: string }> {
  if (!apiKey?.trim()) return { ok: false, error: "Ingresa una API Key." };

  try {
    const res = await fetch(`${BASE}?key=${apiKey}`);
    if (!res.ok) {
      return { ok: false, error: mensajeAmigable(res.status, await res.text()) };
    }

    const json = await res.json();
    const disponibles: string[] = (json.models ?? [])
      .map((m: { name?: string }) => m.name?.replace("models/", "") ?? "")
      .filter(Boolean);

    // Reporta el primer modelo de nuestra lista que realmente esté disponible.
    const elegido = MODELOS.find((m) => disponibles.includes(m));
    if (!elegido) {
      return {
        ok: false,
        error: "Tu cuenta no tiene acceso a ningún modelo compatible.",
      };
    }

    return { ok: true, modelo: elegido };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
