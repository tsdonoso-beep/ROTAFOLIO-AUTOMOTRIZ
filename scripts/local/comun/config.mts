// Configuración de las corridas locales: todo sale del entorno (.env.local + variables en la línea de comando).

import { readFileSync } from "node:fs";

export function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

export function num(nombre: string, porOmision: number): number {
  const bruto = (process.env[nombre] ?? "").trim();
  const v = Number(bruto);
  return bruto !== "" && Number.isFinite(v) ? v : porOmision;
}

export function texto(nombre: string, porOmision: string): string {
  return (process.env[nombre] ?? "").trim() || porOmision;
}

/**
 * La clave de la cuenta de servicio desde un archivo (GOOGLE_SA_KEY_FILE).
 *
 * Un .env no admite el JSON de Google en varias líneas sin comillas. Se acepta
 * el .json tal cual lo entrega Google, envuelto en { "GOOGLE_SA_PRIVATE_KEY": … }
 * (como quedó en secrets/sa.json), o la clave PEM suelta.
 */
export function cargarClaveDeArchivo(): void {
  const archivo = process.env.GOOGLE_SA_KEY_FILE?.trim();
  if (!archivo || process.env.GOOGLE_SA_PRIVATE_KEY?.trim()) return;
  process.env.GOOGLE_SA_PRIVATE_KEY = claveDesdeTexto(readFileSync(archivo, "utf8"));
}

export function claveDesdeTexto(bruto: string): string {
  const t = bruto.replace(/^﻿/, "");
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const valor = j.private_key ? j : j.GOOGLE_SA_PRIVATE_KEY ?? j;
    return typeof valor === "string" ? valor : JSON.stringify(valor);
  } catch {
    return t;
  }
}

cargarClaveDeArchivo();

export const RUC = process.env.SUNAT_RUC?.trim() || "20512201611";

/** Usuario y clave de SOL; el usuario sin el RUC delante. */
export function credencialesSol(): { usuario: string; clave: string } {
  const usuario = pedir("SUNAT_SOL_USUARIO", "SUNAT_INROPRIN_USUARIO");
  return {
    usuario: usuario.startsWith(RUC) ? usuario.slice(RUC.length) : usuario,
    clave: pedir("SUNAT_SOL_CLAVE", "SUNAT_INROPRIN_CLAVE"),
  };
}

export const PERIODOS = texto("PERIODO", "202608,202609").split(",").map(p => p.trim()).filter(p => p && p !== "todos");
export const MAS_RECIENTE_PRIMERO = process.env.ORDEN?.trim() === "reciente";
/** Solo estos proveedores (RUC separados por coma). Vacío = todos. Útil para mandar por pantallas solo a los que la API rechaza. */
export const RUCS = texto("RUCS", "").split(",").map(r => r.trim()).filter(Boolean);
/**
 * Qué series: `noE` (por omisión: las que la consulta por rango nunca trae),
 * `E` (solo E001…, las del portal de SUNAT) o `todas`.
 */
export const SERIES = ((): "noE" | "E" | "todas" => {
  const v = texto("SERIES", "noE").toLowerCase();
  return v === "e" ? "E" : v === "todas" ? "todas" : "noE";
})();
/** Tipos de comprobante a pedir: 01 factura, 07/08 notas, 03 boleta (por la API, a probar). */
export const TIPOS = texto("TIPOS", "01,07,08").split(",").map(t => t.trim()).filter(Boolean);
export const LIMITE = num("LIMITE", 0);
export const HEADLESS = process.env.HEADLESS?.trim() !== "0";
export const CARPETA_DRIVE = texto("SUNAT_DRIVE_FOLDER", "1RnyGimYdnhbQ3nKxGOoBc_iRz38fxCnX");
export const LOGIN_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm";
