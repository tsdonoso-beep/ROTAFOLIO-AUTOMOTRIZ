"use server";
import { solicitanteActual } from "@/lib/supabase/servidor";
import { clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { credencialesDe } from "@/lib/sunat/credenciales";
import { obtenerToken, olvidarToken } from "@/lib/sunat/token";

export interface EstadoSunat {
  empresa: string;
  ruc: string;
  /** Nombre de cada variable y si está puesta. Nunca su valor. */
  variables: Array<{ nombre: string; puesta: boolean }>;
  resultado:
    | { tipo: "sin_probar" }
    | { tipo: "faltan"; motivo: string }
    | { tipo: "ok"; segundos: number; usuario: string }
    | { tipo: "error"; motivo: string };
}

const SUFIJOS = ["CLIENT_ID", "CLIENT_SECRET", "USUARIO", "CLAVE"];

function nombresDe(abreviatura: string): string[] {
  const ref = abreviatura.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return SUFIJOS.map(s => `SUNAT_${ref}_${s}`);
}

/** Qué empresas hay y cuáles tienen sus variables puestas. No prueba nada. */
export async function estadoDeCredenciales(): Promise<EstadoSunat[]> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "editar_catalogos").ok) return [];

  const sb = await clienteServidor();
  const { data: empresas } = await sb
    .from("empresas").select("ruc, razon_social, abreviatura").eq("activo", true).order("abreviatura");

  return (empresas ?? []).map(e => ({
    empresa: e.abreviatura,
    ruc: e.ruc,
    variables: nombresDe(e.abreviatura).map(nombre => ({
      nombre, puesta: !!(process.env[nombre] ?? "").trim(),
    })),
    resultado: { tipo: "sin_probar" as const },
  }));
}

/**
 * Pide un token a SUNAT y cuenta cómo fue.
 *
 * Es la única forma de saber si las credenciales sirven: que las cuatro
 * variables estén puestas no dice nada sobre si son correctas. No encola
 * ningún proceso del lado de SUNAT, así que se puede repetir sin costo.
 *
 * Nunca devuelve un secreto, ni siquiera recortado: esta pantalla se mira
 * en reuniones y las capturas viajan.
 */
export async function probarCredenciales(abreviatura: string): Promise<EstadoSunat["resultado"]> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { tipo: "error", motivo: "Sesión no válida." };
  if (!autoriza(solicitante, "editar_catalogos").ok) {
    return { tipo: "error", motivo: "Solo Administración del sistema puede probar esto." };
  }

  const sb = await clienteServidor();
  const { data: empresa } = await sb
    .from("empresas").select("ruc, abreviatura").eq("abreviatura", abreviatura).single();
  if (!empresa) return { tipo: "error", motivo: "Esa empresa no existe." };

  const cred = credencialesDe(empresa.abreviatura, empresa.ruc, process.env);
  if (!cred.ok) return { tipo: "faltan", motivo: cred.motivo };

  try {
    // Se descarta el token guardado para que la prueba sea de verdad y no
    // devuelva el de hace un rato.
    olvidarToken(cred.cred.clientId);
    const t = await obtenerToken(cred.cred);
    return {
      tipo: "ok",
      segundos: Math.round((t.venceEn - Date.now()) / 1000),
      usuario: cred.cred.ruc + cred.cred.usuario.replace(cred.cred.ruc, ""),
    };
  } catch (e) {
    return { tipo: "error", motivo: e instanceof Error ? e.message : String(e) };
  }
}
