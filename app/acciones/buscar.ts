"use server";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

/**
 * El buscador global.
 *
 * Es el pedido más repetido y no existía ninguno: para encontrar un memo
 * había que recorrer la lista. Busca por lo que la gente recuerda de
 * memoria —el nombre de alguien, el número del memo, el RUC del proveedor,
 * la serie del comprobante— y no por lo que la base tiene bien indexado.
 *
 * No tiene alcance propio: se apoya en las políticas de fila. Un rendidor
 * que busca «Rosa» no encuentra los memos de Rosa, porque la consulta sale
 * con su sesión y RLS no se los devuelve. Eso es a propósito — un buscador
 * con permisos propios sería una segunda puerta que se olvida de cerrar.
 */

export type TipoResultado = "memo" | "persona" | "gasto" | "pedido";

export interface Resultado {
  tipo: TipoResultado;
  id: string;
  /** Lo que se lee grande. */
  titulo: string;
  /** La línea de abajo, con lo que lo distingue de otro parecido. */
  detalle: string;
  ruta: string;
}

const LIMITE_POR_TIPO = 5;

/** Escapa lo que en un patrón `ilike` significaría otra cosa. */
function patron(q: string): string {
  return `%${q.replace(/[\\%_]/g, c => "\\" + c)}%`;
}

export async function buscar(consulta: string): Promise<Resultado[]> {
  const q = consulta.trim();
  // Con una o dos letras, todo coincide con todo: el resultado no ayuda y la
  // consulta recorre la tabla entera.
  if (q.length < 3) return [];

  const solicitante = await solicitanteActual();
  if (!solicitante) return [];

  const sb = await clienteServidor();
  const p = patron(q);

  const veAjenos = autoriza(solicitante, "ver_memos_ajenos").ok;

  const [memos, personas, gastos, pedidos] = await Promise.all([
    sb.from("memos")
      .select("id, correlativo, destino, estado, tipo")
      .or(`correlativo.ilike.${p},destino.ilike.${p}`)
      .limit(LIMITE_POR_TIPO),

    // Buscar personas sólo tiene sentido si se pueden ver sus memos.
    veAjenos
      ? sb.from("usuarios")
          .select("id, nombre, dni, cargo")
          .or(`nombre.ilike.${p},dni.ilike.${p}`)
          .eq("activo", true)
          .limit(LIMITE_POR_TIPO)
      : Promise.resolve({ data: [] }),

    sb.from("gastos")
      .select("id, memo_id, proveedor_nombre, proveedor_ruc, serie, numero, total")
      .or(`proveedor_ruc.ilike.${p},proveedor_nombre.ilike.${p},serie.ilike.${p},numero.ilike.${p}`)
      .limit(LIMITE_POR_TIPO),

    sb.from("solicitudes_memo")
      .select("id, motivo, destino, estado")
      .or(`motivo.ilike.${p},destino.ilike.${p}`)
      .limit(LIMITE_POR_TIPO),
  ]);

  const r: Resultado[] = [];

  for (const m of memos.data ?? []) {
    r.push({
      tipo: "memo",
      id: m.id,
      titulo: m.correlativo,
      detalle: [m.destino, m.tipo?.toLowerCase().replace("_", " ")]
        .filter(Boolean).join(" · "),
      ruta: `/memos/${m.id}`,
    });
  }

  for (const u of (personas.data ?? []) as Array<{
    id: string; nombre: string; dni: string; cargo: string | null;
  }>) {
    r.push({
      tipo: "persona",
      id: u.id,
      titulo: u.nombre,
      detalle: [u.dni, u.cargo].filter(Boolean).join(" · "),
      ruta: `/liquidaciones/${u.id}`,
    });
  }

  for (const g of (gastos.data ?? []) as Array<{
    id: string; memo_id: string | null; proveedor_nombre: string | null;
    proveedor_ruc: string | null; serie: string | null; numero: string | null;
    total: number | null;
  }>) {
    r.push({
      tipo: "gasto",
      id: g.id,
      titulo: g.proveedor_nombre || g.proveedor_ruc || "Comprobante",
      detalle: [
        [g.serie, g.numero].filter(Boolean).join("-"),
        g.proveedor_ruc,
        g.total == null ? null : `S/ ${Number(g.total).toFixed(2)}`,
      ].filter(Boolean).join(" · "),
      // Un comprobante no tiene pantalla propia: se va a su memo.
      ruta: g.memo_id ? `/memos/${g.memo_id}` : "/memos/sin-asignar",
    });
  }

  for (const s of (pedidos.data ?? []) as Array<{
    id: string; motivo: string; destino: string | null; estado: string;
  }>) {
    r.push({
      tipo: "pedido",
      id: s.id,
      titulo: s.motivo,
      detalle: [s.destino, s.estado.toLowerCase()].filter(Boolean).join(" · "),
      ruta: "/solicitudes",
    });
  }

  return r;
}
