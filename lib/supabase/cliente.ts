"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Cliente para el navegador. Usa la clave publicable, que es de solo lectura
 * por sí misma: todo el control real lo hacen las políticas de fila de la
 * base según el usuario de la sesión.
 */
export function clienteNavegador() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}
