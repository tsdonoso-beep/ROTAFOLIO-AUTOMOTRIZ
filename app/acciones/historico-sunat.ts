"use server";
// El histórico de comprobantes, para sacarlo a una hoja
//
// Se arma en el servidor y viaja ya listo: son miles de filas y el navegador
// no tiene por qué saber de dónde salen ni cruzarlas con nada.
//
// La columna que hace que esta hoja valga más que bajar el archivo del portal
// es «lo rindió»: SUNAT sabe que la factura existe, pero no que Annie la
// fotografió en una obra de Huánuco.

import { solicitanteActual, clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import {
  filasComprobantesSunat, nombreArchivoSunat, mapaPadronPorRuc, TIPOS_SUNAT,
  type ComprobanteHistorico,
} from "@/lib/export/comprobantes-sunat";
import { publicarHoja, darLectura, explicarFallo } from "@/lib/drive/servidor";

export interface HojaHistorico {
  nombre: string;
  filas: string[][];
  /** Cuántos comprobantes trae, sin contar los títulos. */
  cuantos: number;
}

/** Cuántos comprobantes hay guardados y de qué períodos. */
export async function periodosGuardados(): Promise<Array<{ periodo: string; cuantos: number }>> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return [];

  // Por función y no leyendo la tabla: PostgREST corta toda lectura en 1000
  // filas sin avisar, y con 13 000 comprobantes la pantalla mostraba «1000
  // comprobantes, 2 períodos» como si fuera todo lo que hay.
  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("periodos_de_comprobantes_sunat");
  if (error || !Array.isArray(data)) return [];
  return data as Array<{ periodo: string; cuantos: number }>;
}

/**
 * Trae todas las filas de una consulta, no las primeras mil.
 *
 * El límite de PostgREST no da error: devuelve 200 y mil filas. Se pagina
 * hasta que una página llegue incompleta, que es la señal de que se acabó.
 */
async function todasLasFilas<T>(
  hacer: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const TAMANO = 1000;
  const salida: T[] = [];
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await hacer(desde, desde + TAMANO - 1);
    if (error || !data) break;
    salida.push(...data);
    if (data.length < TAMANO) break;
  }
  return salida;
}

/**
 * Arma la hoja de un período, o de todo si no se pide ninguno.
 *
 * Devuelve las filas y no un archivo: el navegador lo descarga con el mismo
 * camino que usan las demás exportaciones de la aplicación, así el separador
 * y el BOM salen iguales en todas.
 */
export async function hojaDelHistorico(periodo?: string): Promise<HojaHistorico | null> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return null;

  const sb = await clienteServidor();

  // Por función: son trece mil filas, y leyendo la tabla llegarían mil. La
  // función también cuenta los cambios de cada comprobante de una vez; pedir
  // ese conteo anidado desde PostgREST expiraba por tiempo.
  const { data, error } = await sb.rpc("historico_comprobantes_sunat", {
    p_periodo: periodo ?? null,
  });
  if (error || !Array.isArray(data)) return null;

  // Quién rindió cada comprobante. Se traen los gastos de una vez y se
  // emparejan en memoria: una consulta por comprobante serían trece mil.
  const gastos = await todasLasFilas<{
    proveedor_ruc: string | null; tipo_comprobante: string | null;
    serie: string | null; numero: string | null;
    usuarios: { nombre?: string } | null;
  }>((desde, hasta) =>
    sb.from("gastos")
      .select("proveedor_ruc, tipo_comprobante, serie, numero, usuarios:usuario_id ( nombre )")
      .eq("clase", "COMPROBANTE")
      .not("numero", "is", null)
      .range(desde, hasta) as never
  );

  const sinCeros = (v: string | null) => (v ?? "").replace(/^0+/, "") || null;
  const llave = (ruc: string | null, tipo: string | null, serie: string | null, numero: string | null) =>
    [ruc ?? "", tipo ?? "", (serie ?? "").toUpperCase(), sinCeros(numero) ?? ""].join("|");

  const quienRindio = new Map<string, string>();
  for (const g of gastos) {
    const u = g.usuarios as unknown as { nombre?: string } | null;
    if (u?.nombre) {
      quienRindio.set(llave(g.proveedor_ruc, g.tipo_comprobante, g.serie, g.numero), u.nombre);
    }
  }

  // Los importes llegan como número desde la base, pero se fuerzan igual:
  // un numeric grande puede viajar como texto y una suma de textos concatena
  // en vez de sumar, en silencio.
  const aNum = (v: unknown) => (v == null || v === "" ? null : Number(v));

  const historico: ComprobanteHistorico[] = (data as ComprobanteHistorico[]).map(c => ({
    ...c,
    total: aNum(c.total),
    base: aNum(c.base),
    igv: aNum(c.igv),
    detraccion: aNum(c.detraccion),
    tipoCambio: aNum(c.tipoCambio),
    rendidoPor: quienRindio.get(
      llave(c.proveedorRuc, c.tipoComprobante, c.serie, c.numero)
    ) ?? null,
  }));

  // La condición del RUC (Buen Contribuyente / Agente de Retención), de la
  // tabla que llena el scraper de Playwright. Es chica —una fila por
  // proveedor, no por comprobante— así que se trae entera de una vez.
  const { data: padronCrudo } = await sb
    .from("padron_ruc")
    .select("ruc, condicion, buen_contribuyente, agente_retencion, agente_percepcion");
  const padron = mapaPadronPorRuc((padronCrudo as Array<Record<string, unknown>>) ?? []);

  return {
    nombre: nombreArchivoSunat(periodo ?? null),
    filas: filasComprobantesSunat(historico, padron),
    cuantos: historico.length,
  };
}

/**
 * Deja el histórico como hoja de Google, para Contabilidad.
 *
 * Se publica siempre con el mismo nombre en la misma carpeta, así el enlace
 * se reparte una vez y sirve para siempre. Se reemplaza solo la pestaña de
 * datos: el tablero de Contabilidad vive en otra pestaña del mismo archivo y
 * la publicación no lo toca.
 */
export async function publicarHistoricoEnDrive(): Promise<
  { ok: true; id: string; url: string; cuantos: number; reemplazada: boolean }
  | { ok: false; motivo: string }
> {
  const hoja = await hojaDelHistorico();
  if (!hoja) return { ok: false, motivo: "No se pudo armar la hoja. ¿Sigue abierta la sesión?" };
  if (hoja.cuantos === 0) {
    return { ok: false, motivo: "No hay comprobantes guardados todavía. Consulta un período primero." };
  }

  try {
    const r = await publicarHoja({
      filas: hoja.filas,
      nombre: "COMPROBANTES SUNAT",
      carpetas: ["SUNAT"],
      tipos: TIPOS_SUNAT,
    });
    return { ok: true, id: r.id, url: r.url, cuantos: hoja.cuantos, reemplazada: r.reemplazada };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}


/**
 * Le da acceso de lectura a la hoja a quien lleva la contabilidad.
 *
 * Va aparte de publicar y no dentro: compartir un archivo es hacia afuera —le
 * aparece a gente de verdad en su Drive— y no debe pasar como efecto
 * secundario de apretar otro botón.
 *
 * Solo lectura, porque la pestaña de datos se reescribe en cada publicación y
 * lo que alguien editara encima se perdería sin aviso.
 */
export async function compartirConContabilidad(): Promise<
  | { ok: true; url: string; dados: string[]; fallaron: Array<{ correo: string; motivo: string }> }
  | { ok: false; motivo: string }
> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "editar_catalogos").ok) {
    return { ok: false, motivo: "Solo Administración del sistema puede compartir la hoja." };
  }

  const sb = await clienteServidor();
  const { data: gente } = await sb
    .from("usuarios")
    .select("email, roles_usuario!inner ( rol )")
    .eq("activo", true)
    .eq("roles_usuario.rol", "CONTABILIDAD");

  const correos = [...new Set((gente ?? []).map(g => g.email).filter(Boolean))];
  if (correos.length === 0) {
    return { ok: false, motivo: "No hay nadie activo con el rol de Contabilidad." };
  }

  // Se publica primero para tener el archivo y su enlace: compartir algo que
  // todavía no existe no tendría sentido.
  const hoja = await publicarHistoricoEnDrive();
  if (!hoja.ok) return hoja;

  const r = await darLectura(hoja.id, correos);
  return { ok: true, url: hoja.url, dados: r.ok, fallaron: r.fallaron };
}
