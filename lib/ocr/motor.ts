// Motor OCR en el navegador (Tesseract.js sobre WebAssembly)
//
// Corre entero en el teléfono: sin clave, sin cuota y sin mandar la imagen
// a ningún servidor. Es la primera pasada de lectura, y la única que sigue
// funcionando cuando la cuota diaria de la IA se agotó.
//
// El worker se carga una sola vez y se reutiliza. Es caro de crear (baja
// unos megas de modelo la primera vez y los deja en caché del navegador),
// así que se levanta perezosamente al primer uso y no antes: quien solo
// entra a mirar sus memos nunca paga ese costo.

import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

/** Idioma del modelo. Los comprobantes peruanos están en español. */
const IDIOMA = "spa";

async function obtenerWorker(
  onProgreso?: (fraccion: number) => void
): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(IDIOMA, 1, {
        logger: m => {
          // La descarga del modelo es lo que demora la primera vez; vale la
          // pena mostrarla para que no parezca que la app se colgó.
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            onProgreso?.(m.progress);
          }
        },
      });
    })().catch(e => {
      // Un fallo al crear el worker no debe dejar la promesa fallida en
      // caché: el siguiente intento merece empezar de cero.
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export interface ResultadoOcr {
  texto: string;
  /** Confianza global que reporta Tesseract, de 0 a 1. */
  confianza: number;
}

/**
 * Lee el texto de una imagen. Devuelve el texto crudo: interpretarlo es
 * trabajo del parser, que sí verifica lo que encuentra.
 */
export async function leerImagen(
  imagen: string,
  onProgreso?: (fraccion: number) => void
): Promise<ResultadoOcr> {
  const worker = await obtenerWorker(onProgreso);
  const { data } = await worker.recognize(imagen);
  return {
    texto: data.text ?? "",
    confianza: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
  };
}

/** Libera el worker. Se llama al salir de la pantalla de captura. */
export async function cerrarMotor(): Promise<void> {
  if (!workerPromise) return;
  const pendiente = workerPromise;
  workerPromise = null;
  try {
    const worker = await pendiente;
    await worker.terminate();
  } catch {
    // Si nunca llegó a levantarse no hay nada que cerrar.
  }
}

/** Tesseract solo lee imágenes: un PDF necesita la IA o carga manual. */
export function esLegiblePorOcr(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
