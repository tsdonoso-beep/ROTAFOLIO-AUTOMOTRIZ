import { Proyecto } from "./types";

const KEY = "rotafolio_proyectos";

export function getProyectos(): Proyecto[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveProyecto(p: Proyecto): void {
  const lista = getProyectos().filter((x) => x.id !== p.id);
  lista.unshift(p);
  localStorage.setItem(KEY, JSON.stringify(lista));
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
    nombre,
    centro_costos: centro,
    caja,
    creado: new Date().toISOString(),
  };
}
