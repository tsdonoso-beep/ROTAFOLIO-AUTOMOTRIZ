// El token del api-seguridad de SUNAT
//
// No es el client_credentials habitual: SUNAT usa grant_type=password y pide
// además el usuario secundario de Clave SOL y su contraseña. Con las cuatro
// cosas, no con dos.
//
// Y el `scope` tiene que coincidir con el host que se va a consumir: un
// token sacado para SIRE no sirve para consultar comprobantes, y al revés
// tampoco. Fallan con un 401 que no explica el motivo.

import { usuarioSol, type CredencialesSunat } from "./credenciales.ts";

export const AUTORIDAD = "https://api-seguridad.sunat.gob.pe";
export const SIRE = "https://api-sire.sunat.gob.pe";

export interface Token {
  valor: string;
  /** Momento a partir del cual conviene pedir otro. */
  venceEn: number;
}

/**
 * El cuerpo del pedido de token, tal como lo espera SUNAT.
 *
 * Va aparte para poder probarlo sin red: el formato del `username` —RUC y
 * usuario pegados— es el error más común y se manifiesta como credenciales
 * inválidas, no como un problema de formato.
 */
export function cuerpoDeToken(c: CredencialesSunat): URLSearchParams {
  return new URLSearchParams({
    grant_type: "password",
    scope: SIRE,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    username: usuarioSol(c.ruc, c.usuario),
    password: c.clave,
  });
}

export function urlDeToken(clientId: string): string {
  return `${AUTORIDAD}/v1/clientessol/${encodeURIComponent(clientId)}/oauth2/token/`;
}

/**
 * Cuándo se considera vencido.
 *
 * Se le resta un margen al `expires_in` de SUNAT: si se apura hasta el
 * último segundo, una petición que sale justo en el borde llega con el
 * token ya muerto y falla con un 401 que parece un problema de credenciales.
 */
export function vigencia(expiresIn: number, ahora: number, margenSeg = 60): number {
  const vida = Math.max(0, Number(expiresIn) || 0);
  return ahora + Math.max(0, vida - margenSeg) * 1000;
}

export function vigente(t: Token | null, ahora: number): t is Token {
  return !!t && t.venceEn > ahora;
}

// ════════════════════════════════════════════════════════════════

/**
 * Pide un token. Reutiliza el anterior mientras siga vigente.
 *
 * La caché es por proceso y por cliente: en el servidor eso alcanza, y
 * evita pedir un token nuevo en cada comprobante que se quiera cruzar.
 */
const cache = new Map<string, Token>();

export async function obtenerToken(
  c: CredencialesSunat,
  opciones: { ahora?: number; fetch?: typeof globalThis.fetch } = {}
): Promise<Token> {
  const ahora = opciones.ahora ?? Date.now();
  const traer = opciones.fetch ?? globalThis.fetch;

  const guardado = cache.get(c.clientId);
  if (vigente(guardado ?? null, ahora)) return guardado!;

  const res = await traer(urlDeToken(c.clientId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: cuerpoDeToken(c).toString(),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `SUNAT no dio token (HTTP ${res.status}). ` +
      `Revisa que el usuario sea ${usuarioSol(c.ruc, c.usuario)} y que la clave sea la ` +
      `del usuario secundario, no la del RUC. ${detalle.slice(0, 300)}`
    );
  }

  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("SUNAT respondió sin access_token.");

  const token: Token = { valor: j.access_token, venceEn: vigencia(j.expires_in ?? 3600, ahora) };
  cache.set(c.clientId, token);
  return token;
}

/** Para las pruebas y para forzar una renovación. */
export function olvidarToken(clientId?: string): void {
  if (clientId) cache.delete(clientId);
  else cache.clear();
}
