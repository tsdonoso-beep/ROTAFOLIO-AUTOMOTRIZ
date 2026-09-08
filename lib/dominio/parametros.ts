import { PARAMETROS_POR_DEFECTO, type Parametros } from "./tipos.ts";

type FilaParametro = { clave: string; valor: unknown };

/**
 * Convierte las filas de la tabla `parametros` al objeto tipado.
 *
 * Una clave ausente o con valor nulo conserva el valor por defecto, que para
 * los topes es `null`: significa "sin definir todavía" (SPEC §15) y hace que
 * la validación correspondiente no se aplique en vez de inventar un número.
 */
export function leerParametros(filas: FilaParametro[] | null): Parametros {
  const mapa = new Map((filas ?? []).map(f => [f.clave, f.valor]));

  const num = (clave: keyof Parametros, porDefecto: number | null): number | null => {
    const v = mapa.get(clave);
    if (v === undefined || v === null) return porDefecto;
    const n = Number(v);
    return Number.isFinite(n) ? n : porDefecto;
  };

  return {
    tope_declaracion_jurada_dia: num("tope_declaracion_jurada_dia", PARAMETROS_POR_DEFECTO.tope_declaracion_jurada_dia),
    tope_movilidad_dia: num("tope_movilidad_dia", PARAMETROS_POR_DEFECTO.tope_movilidad_dia),
    plazo_rendicion_dias: num("plazo_rendicion_dias", PARAMETROS_POR_DEFECTO.plazo_rendicion_dias),
    bloquear_memo_con_pendientes:
      mapa.get("bloquear_memo_con_pendientes") === true ||
      mapa.get("bloquear_memo_con_pendientes") === "true",
    dias_gracia_bloqueo: num("dias_gracia_bloqueo", PARAMETROS_POR_DEFECTO.dias_gracia_bloqueo) ?? 15,
    igv_porcentaje: num("igv_porcentaje", PARAMETROS_POR_DEFECTO.igv_porcentaje) ?? 18,
    umbral_confianza_alerta: num("umbral_confianza_alerta", PARAMETROS_POR_DEFECTO.umbral_confianza_alerta) ?? 0.75,
  };
}
