// Encontrar a una persona entre ciento veinticuatro
//
// El desplegable de personas era una lista de 124 nombres sin buscador. La
// primera idea fue filtrar por área, pero los datos dicen que no sirve: el
// 64% de las asignaciones van a gente sin área registrada —los técnicos, que
// son justamente los que viajan—, así que el filtro escondería a la mayoría.
// El proyecto tampoco acota: TALLERES ESP tiene 74 personas distintas. Y no
// hay un núcleo de «los de siempre»: el más asignado tiene 15 memos de 486 y
// el número cuarenta y cinco todavía tiene cuatro.
//
// Lo que sí funciona con una lista plana es escribir. Este módulo es esa
// búsqueda, y se ocupa de las tres cosas que la rompen en castellano.

export interface Persona {
  id: string;
  nombre: string;
  dni: string;
  area?: string | null;
  cargo?: string | null;
}

/**
 * Deja el texto como se teclea de apuro: sin tildes, sin eñes, en minúscula.
 *
 * Nadie escribe «NIÑO HERRERA» con la eñe cuando está buscando rápido, y
 * media plantilla tiene tilde en algún apellido. Sin esto, «nino» no
 * encuentra a Geyler Niño y quien busca concluye que no está registrado.
 */
export function aplanar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca por trozos sueltos, en cualquier orden.
 *
 * «zamora wilmer» tiene que encontrar a «WILMER GERARDO ZAMORA CARRILO»: la
 * gente escribe el apellido primero tan seguido como el nombre, y en el
 * seguimiento los dos órdenes conviven.
 */
export function coincide(p: Persona, consulta: string): boolean {
  const trozos = aplanar(consulta).split(/\s+/).filter(Boolean);
  if (trozos.length === 0) return true;

  const heno = aplanar(`${p.nombre} ${p.dni} ${p.cargo ?? ""} ${p.area ?? ""}`);
  return trozos.every(t => heno.includes(t));
}

export interface Criterios {
  consulta?: string;
  /** Acota, nunca es obligatorio: un paso previo escondería al 64%. */
  area?: string | null;
  cargo?: string | null;
}

export function buscarPersonas(personas: Persona[], c: Criterios): Persona[] {
  return personas.filter(p =>
    (!c.area || p.area === c.area) &&
    (!c.cargo || p.cargo === c.cargo) &&
    coincide(p, c.consulta ?? "")
  );
}

/**
 * Los valores que de verdad sirven para acotar.
 *
 * Sólo se ofrecen los que tienen al menos dos personas: un chip que deja una
 * sola fila no ahorra nada y ensucia la fila de filtros. «Sin área» no se
 * ofrece como opción —no es una categoría, es un dato que falta—.
 */
export function valoresPara(
  personas: Persona[], campo: "area" | "cargo"
): Array<{ valor: string; cuantos: number }> {
  const m = new Map<string, number>();
  for (const p of personas) {
    const v = p[campo];
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m]
    .filter(([, n]) => n >= 2)
    .map(([valor, cuantos]) => ({ valor, cuantos }))
    .sort((a, b) => b.cuantos - a.cuantos || a.valor.localeCompare(b.valor, "es"));
}

// ────────────────────────────────────────────────────────────────
// La cuadrilla anterior
// ────────────────────────────────────────────────────────────────
//
// Un memo de once personas no se arma eligiendo once veces de una lista. Se
// arma diciendo «los mismos del anterior» y quitando a uno o dos. El
// 594-2026 tiene once; el 546-2026, diez.

export interface Cuadrilla {
  memoId: string;
  correlativo: string;
  destino: string | null;
  centroCostoId: string | null;
  fecha: string | null;
  personas: string[];
}

/**
 * Las cuadrillas que vale la pena ofrecer para copiar.
 *
 * Primero las del mismo centro de costo —la obra se repite con la misma
 * gente— y después el resto. Se descartan las de una sola persona: copiar a
 * uno no es copiar, es elegirlo.
 */
export function cuadrillasSugeridas(
  cuadrillas: Cuadrilla[], centroCostoId: string | null, cuantas = 4
): Cuadrilla[] {
  return [...cuadrillas]
    .filter(c => c.personas.length > 1)
    .sort((a, b) => {
      const mismaA = a.centroCostoId === centroCostoId ? 0 : 1;
      const mismaB = b.centroCostoId === centroCostoId ? 0 : 1;
      if (mismaA !== mismaB) return mismaA - mismaB;
      return (b.fecha ?? "").localeCompare(a.fecha ?? "");
    })
    .slice(0, cuantas);
}
