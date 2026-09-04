/**
 * Centros de costos disponibles en el desplegable.
 *
 * Los nombres deben coincidir EXACTAMENTE con las carpetas de Drive: la app
 * crea la ruta «FOTO-GRAMA / <centro de costos> / <caja>», así que un nombre
 * distinto genera una carpeta nueva en vez de usar la existente.
 *
 * PROVISIONAL: esta lista se tomó de las carpetas encontradas en la unidad
 * compartida. Reemplázala por el catálogo oficial cuando esté disponible.
 * El campo admite texto libre, así que un centro que no esté aquí se puede
 * escribir a mano sin bloquear el registro.
 */
export const CENTROS_COSTOS: string[] = [
  "1.1 Transporte y entrega de bienes",
  "1.2 Adecuación",
  "1.3 Instalación",
  "1.4 Capacitación",
];

/** Búsqueda tolerante: ignora mayúsculas, tildes y espacios de más. */
export function filtrarCentros(consulta: string): string[] {
  const q = normalizar(consulta);
  if (!q) return CENTROS_COSTOS;
  return CENTROS_COSTOS.filter((c) => normalizar(c).includes(q));
}

export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Nombre por defecto del proyecto. Centro de costos y caja ya lo identifican,
 * así que no hace falta escribirlo aparte.
 */
export function nombreSugerido(centro: string, caja: string): string {
  const c = centro.trim();
  const k = caja.trim();
  if (!c) return "";
  return k ? `${c} — ${k}` : c;
}
