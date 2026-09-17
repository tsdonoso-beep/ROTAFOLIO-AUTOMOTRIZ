// El anexo del memo: quién viaja, cuánto le toca y entre qué fechas
//
// Un memo no le da plata a «un proyecto»: se la da a personas, y a cada una
// una cantidad distinta por un tramo distinto. El 594-2026 lo muestra en una
// sola hoja: once personas, tres tramos, tres montos.
//
//     4 personas   09/08 → 10/08   S/   212.00 c/u
//     6 personas   09/08 → 19/08   S/ 1,164.00 c/u
//     1 persona    10/08 → 19/08   S/ 1,232.00
//                                  ─────────────
//                                  S/ 9,064.00
//
// Ese total no se escribe: se suma. Mientras el monto del memo fuera un
// número aparte, tecleado a mano, podía decir una cosa y el anexo otra —y
// entonces el memo se contradice a sí mismo, que es justo el defecto que
// encontramos en los documentos reales.
//
// Este módulo es la parte que se puede razonar sin base de datos.

export interface FilaDeAnexo {
  usuarioId: string;
  nombre: string;
  monto: number | null;
  fechaDesde: string | null;
  fechaHasta: string | null;
}

export interface AnexoRevisado {
  /** La suma de lo asignado. Es el monto del memo, no un número aparte. */
  total: number;
  /** Qué impide guardar el anexo. Vacío = se puede guardar. */
  reparos: string[];
  /** El tramo que abarca a todos, para la cabecera del memo. */
  desde: string | null;
  hasta: string | null;
}

/** Suma en céntimos y recién entonces divide: 0.1 + 0.2 no es 0.3 en coma flotante. */
export function sumar(montos: Array<number | null>): number {
  const c = montos.reduce<number>((s, m) => s + Math.round((m ?? 0) * 100), 0);
  return c / 100;
}

/** «Ana», «Ana y Beto», «Ana, Beto y Cleo» — sin coma antes de la «y». */
function listar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

export function revisarAnexo(filas: FilaDeAnexo[]): AnexoRevisado {
  const reparos: string[] = [];

  if (filas.length === 0) {
    reparos.push("Asigna al menos una persona al memo.");
  }

  // Una persona dos veces en el mismo memo son dos deudas contra el mismo
  // nombre, y ninguna de las dos se puede cerrar sin saber cuál es cuál.
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const f of filas) {
    if (vistos.has(f.usuarioId)) repetidos.add(f.nombre);
    vistos.add(f.usuarioId);
  }
  if (repetidos.size) {
    reparos.push(`${listar([...repetidos])} está asignada dos veces.`);
  }

  const sinMonto = filas.filter(f => f.monto == null || !(f.monto > 0));
  if (sinMonto.length) {
    reparos.push(
      `Falta el monto de ${listar(sinMonto.map(f => f.nombre))}.`
    );
  }

  // La llegada antes de la salida existe en los datos reales —el memo
  // 546-2026 lo trae en sus diez filas— y es lo que la base rechaza con
  // memo_asignados_tramo_coherente. Se dice acá para no estrellarse contra
  // el CHECK con un mensaje de Postgres.
  const alReves = filas.filter(
    f => f.fechaDesde && f.fechaHasta && f.fechaHasta < f.fechaDesde
  );
  if (alReves.length) {
    reparos.push(
      `${listar(alReves.map(f => f.nombre))} vuelve antes de salir: `
      + "revisa las fechas."
    );
  }

  const desdes = filas.map(f => f.fechaDesde).filter((x): x is string => !!x);
  const hastas = filas.map(f => f.fechaHasta).filter((x): x is string => !!x);

  return {
    total: sumar(filas.map(f => f.monto)),
    reparos,
    // La cabecera abarca a todos: sale el primero y vuelve el último.
    desde: desdes.length ? desdes.reduce((a, b) => (a < b ? a : b)) : null,
    hasta: hastas.length ? hastas.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/**
 * Los tramos distintos que hay en el anexo, como se leen en el memo.
 * El 594-2026 tiene tres; mostrarlos agrupados es como lo lee una persona.
 */
export function tramos(filas: FilaDeAnexo[]): Array<{
  desde: string | null; hasta: string | null; personas: number; montoCadaUno: number | null;
}> {
  const mapa = new Map<string, FilaDeAnexo[]>();
  for (const f of filas) {
    const clave = `${f.fechaDesde ?? ""}|${f.fechaHasta ?? ""}|${f.monto ?? ""}`;
    mapa.set(clave, [...(mapa.get(clave) ?? []), f]);
  }
  return [...mapa.values()].map(g => ({
    desde: g[0].fechaDesde,
    hasta: g[0].fechaHasta,
    personas: g.length,
    montoCadaUno: g[0].monto,
  }));
}
