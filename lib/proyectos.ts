import { Proyecto } from "./types";

const KEY = "rotafolio_proyectos";

/**
 * Un proyecto queda identificado por su combinación centro de costos + caja.
 * Normalizamos para que "TALLER-01 / caja 03" y "taller-01 / CAJA 03"
 * se reconozcan como el mismo y no se dupliquen.
 */
export function claveProyecto(centro: string, caja: string): string {
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(centro)}||${norm(caja)}`;
}

export function getProyectos(): Proyecto[] {
  if (typeof window === "undefined") return [];
  try {
    const lista: Proyecto[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return lista.filter((p) => p && p.id && p.centro_costos && p.caja);
  } catch {
    return [];
  }
}

/** Devuelve el proyecto existente con el mismo centro+caja, si lo hay. */
export function buscarDuplicado(
  centro: string,
  caja: string,
  excluirId?: string
): Proyecto | undefined {
  const clave = claveProyecto(centro, caja);
  return getProyectos().find(
    (p) => p.id !== excluirId && claveProyecto(p.centro_costos, p.caja) === clave
  );
}

/**
 * Guarda el proyecto. Si ya existe otro con el mismo centro+caja, NO crea
 * uno nuevo: devuelve el existente para que las rendiciones se acumulen ahí.
 */
export function saveProyecto(p: Proyecto): Proyecto {
  const existente = buscarDuplicado(p.centro_costos, p.caja, p.id);
  if (existente) return existente;

  const lista = getProyectos().filter((x) => x.id !== p.id);
  lista.unshift(p);
  localStorage.setItem(KEY, JSON.stringify(lista));
  return p;
}

export function deleteProyecto(id: string): void {
  const lista = getProyectos().filter((x) => x.id !== id);
  localStorage.setItem(KEY, JSON.stringify(lista));
}

export function newProyecto(
  nombre: string,
  centro: string,
  caja: string
): Proyecto {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nombre: nombre.trim(),
    centro_costos: centro.trim(),
    caja: caja.trim(),
    creado: new Date().toISOString(),
  };
}
