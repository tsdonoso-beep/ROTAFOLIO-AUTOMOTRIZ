// El período tributario del SIRE
//
// SUNAT lo pide como "yyyymm" y rechaza cualquier otra cosa con un 422 y el
// código 1006. También rechaza un período futuro (1007). Vale la pena
// resolverlo antes de gastar una llamada: un token tiene vida corta y cada
// pedido de exportación encola un proceso del lado de SUNAT.

export interface PeriodoInvalido {
  ok: false;
  motivo: string;
}
export interface PeriodoValido {
  ok: true;
  periodo: string;
  anio: number;
  mes: number;
}

const RE = /^(\d{4})(0[1-9]|1[0-2])$/;

/**
 * Comprueba un período antes de mandarlo.
 *
 * `hoy` entra como parámetro para que esto sea puro: si leyera el reloj por
 * su cuenta, la prueba del período futuro dependería del día en que se
 * corra.
 */
export function validarPeriodo(valor: string, hoy: Date): PeriodoValido | PeriodoInvalido {
  const limpio = (valor ?? "").trim();
  const m = RE.exec(limpio);

  if (!m) {
    return {
      ok: false,
      motivo: `«${limpio}» no tiene el formato yyyymm que pide SUNAT (por ejemplo 202607).`,
    };
  }

  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const actual = periodoDe(hoy);

  if (limpio > actual) {
    return { ok: false, motivo: `El período ${limpio} todavía no existe: el actual es ${actual}.` };
  }
  if (anio < 2022) {
    // El SIRE arrancó en 2022; pedir antes devuelve vacío sin decir por qué.
    return { ok: false, motivo: `El SIRE no tiene datos anteriores a 2022 y pediste ${limpio}.` };
  }

  return { ok: true, periodo: limpio, anio, mes };
}

/** El período tributario de una fecha. */
export function periodoDe(fecha: Date): string {
  const a = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `${a}${m}`;
}

/**
 * El último período que conviene pedir.
 *
 * El del mes en curso todavía se está formando —los proveedores siguen
 * declarando— así que para una prueba se usa el anterior, que ya está
 * cerrado.
 */
export function periodoCerradoAnterior(hoy: Date): string {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  return periodoDe(d);
}
