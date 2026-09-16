// La planilla de movilidad: un contenedor con su ley al pie
//
// El formulario preimpreso trae, en letra chica, la base legal completa: el
// inciso a1) del artículo 37° del TUO de la Ley del Impuesto a la Renta y el
// inciso v) del artículo 21° de su Reglamento. Y trae la regla que decide
// cómo se modela:
//
//   «La falta de consignación de la fecha en que se incurrió en el gasto,
//    nombres y apellidos de cada trabajador, número de DNI, motivo y destino
//    del desplazamiento y monto gastado, respecto a cada desplazamiento SÓLO
//    INHABILITA LA PLANILLA PARA LA SUSTENTACIÓN DEL GASTO QUE CORRESPONDE A
//    TAL DESPLAZAMIENTO».
//
// Se cae la fila, no la planilla. Por eso la planilla no tiene un estado
// «válida» o «inválida»: tiene filas, y cada fila sustenta o no sustenta por
// su cuenta. Una planilla con una fila mala y nueve buenas sustenta nueve.
//
// Hoy la rendición registra la planilla como UNA línea con el total —
// «PLANILLA DE MOVILIDAD 010212, S/ 20.90»— y así se pierde justo el detalle
// que la ley exige para aceptarla.

/** Los seis datos que la ley pide por desplazamiento. Dos son de la persona. */
export interface Desplazamiento {
  id: string;
  fecha: string | null;
  motivo: string | null;
  destino: string | null;
  monto: number | null;
}

export interface Trabajador {
  nombre: string | null;
  dni: string | null;
  /** Un DNI provisional es un relleno nuestro, no un documento. */
  dniProvisional?: boolean;
}

export interface FilaRevisada {
  id: string;
  /** Qué le falta, en castellano y en el orden del formulario. */
  faltas: string[];
  /** Vacío de faltas = este desplazamiento sustenta el gasto. */
  sustenta: boolean;
  monto: number;
}

export interface PlanillaRevisada {
  filas: FilaRevisada[];
  /** Todo lo anotado, sustente o no: es plata que salió igual. */
  total: number;
  /** Lo que de verdad se puede deducir. */
  sustentado: number;
  /** Lo que se pierde por filas incompletas. */
  enRiesgo: number;
  sinSustentar: number;
}

const red = (n: number) => Math.round(n * 100) / 100;

/** «a», «a y b», «a, b y c» — sin coma antes de la «y». */
export function listar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Qué le falta a un desplazamiento para sustentar el gasto.
 *
 * El orden es el del texto legal: fecha, nombres, DNI, motivo, destino y
 * monto. Se devuelve la lista para poder decirlo, no un booleano: quien
 * llena la planilla necesita saber qué le falta, no que «hay un error».
 */
export function faltasDelDesplazamiento(
  d: Desplazamiento, t: Trabajador
): string[] {
  return [
    d.fecha ? null : "la fecha en que se incurrió en el gasto",
    t.nombre?.trim() ? null : "los nombres y apellidos del trabajador",
    t.dni?.trim() && !t.dniProvisional ? null : "el número de DNI",
    d.motivo?.trim() ? null : "el motivo del desplazamiento",
    d.destino?.trim() ? null : "el destino del desplazamiento",
    d.monto != null && d.monto > 0 ? null : "el monto gastado",
  ].filter((x): x is string => x !== null);
}

export function revisarPlanilla(
  desplazamientos: Desplazamiento[], t: Trabajador
): PlanillaRevisada {
  const filas = desplazamientos.map(d => {
    const faltas = faltasDelDesplazamiento(d, t);
    return { id: d.id, faltas, sustenta: faltas.length === 0, monto: d.monto ?? 0 };
  });

  const total = red(filas.reduce((s, f) => s + f.monto, 0));
  const sustentado = red(filas.filter(f => f.sustenta).reduce((s, f) => s + f.monto, 0));

  return {
    filas,
    total,
    sustentado,
    enRiesgo: red(total - sustentado),
    sinSustentar: filas.filter(f => !f.sustenta).length,
  };
}

/**
 * Cuánto se gastó cada día, para contrastarlo con el tope diario.
 *
 * El tope es por trabajador y por día —un porcentaje de la RMV fijado en el
 * mismo inciso—, así que no se mide contra la planilla entera: una planilla
 * de un mes puede sumar mucho sin pasarse ni un solo día.
 */
export function porDia(desplazamientos: Desplazamiento[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of desplazamientos) {
    if (!d.fecha) continue;
    m.set(d.fecha, red((m.get(d.fecha) ?? 0) + (d.monto ?? 0)));
  }
  return m;
}

/** Los días que se pasaron del tope. Con el tope sin definir, ninguno. */
export function diasExcedidos(
  desplazamientos: Desplazamiento[], topeDiario: number | null
): Array<{ fecha: string; gastado: number; exceso: number }> {
  if (topeDiario == null || topeDiario <= 0) return [];
  return [...porDia(desplazamientos)]
    .filter(([, gastado]) => gastado > topeDiario)
    .map(([fecha, gastado]) => ({
      fecha, gastado, exceso: red(gastado - topeDiario),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}
