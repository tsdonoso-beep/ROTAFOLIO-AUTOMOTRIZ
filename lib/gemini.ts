import { GastoExtraido } from "./types";
import { PROMPT_EXTRACCION } from "./prompt";

const GEMINI_MODEL = "gemini-2.5-flash-lite-preview-06-17";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function extraerComprobante(
  base64: string,
  mimeType: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ extraido: GastoExtraido; raw: string }> {
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT_EXTRACCION },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  const raw: string =
    json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini no devolvió JSON válido");

  const extraido = JSON.parse(match[0]) as GastoExtraido;
  return { extraido, raw };
}

export async function testConexion(
  apiKey: string
): Promise<{ ok: boolean; modelo?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: t.slice(0, 150) };
    }
    return { ok: true, modelo: GEMINI_MODEL };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
