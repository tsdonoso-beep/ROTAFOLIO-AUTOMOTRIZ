import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado } from "@/components/v2/Encabezado";
import { IconoAdministrar, IconoMas } from "@/components/v2/Iconos";
import BandejaAdmin, { type FilaAdmin } from "@/components/v2/BandejaAdmin";
import { consolidar } from "@/lib/dominio/memo";
import { cobertura } from "@/lib/dominio/pago";
import PanelBorradores, { type Borrador } from "@/components/v2/PanelBorradores";
import type { Autorizacion } from "@/lib/dominio/autorizacion";
import type { Alerta, ClaseGasto, EstadoGasto } from "@/lib/dominio/tipos";

export default async function Administrar() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "crear_memo").ok) redirect("/");

  const sb = await clienteServidor();

  // Todo lo que la bandeja necesita para decidir qué frena, en una consulta:
  // preguntarlo fila por fila desde el panel haría 60 idas a la base.
  const { data } = await sb
    .from("memos")
    .select(`
      id, correlativo, destino, estado, monto_autorizado,
      fecha_salida, fecha_retorno_prev,
      centros_costo ( codigo, nombre, abreviatura ),
      memo_asignados ( monto, usuarios ( nombre ) ),
      gastos ( estado, clase, total, alertas, alertas_confirmadas, tipo_comprobante ),
      devoluciones ( monto, operacion ),
      pagos ( banco, pago_lineas ( usuario_id, monto, procesada ) )
    `)
    .order("creado_en", { ascending: false })
    .limit(60);

  const hoy = new Date();

  const filas: FilaAdmin[] = ((data ?? []) as unknown as CrudoMemo[]).map(m => {
    const asignados = m.memo_asignados ?? [];
    const gastos = m.gastos ?? [];
    const c = consolidar(Number(m.monto_autorizado), gastos);

    // Una alerta bloqueante ya confirmada no bloquea: el rendidor la revisó.
    const bloqueantes = gastos.filter(g =>
      !g.alertas_confirmadas &&
      (g.alertas ?? []).some(a => a.severidad === "bloqueante")
    ).length;

    const constancias = (m.pagos ?? []).map(p => ({
      id: p.banco, banco: p.banco, planilla: null, fecha: null,
      lineas: (p.pago_lineas ?? []).map(l => ({
        usuarioId: l.usuario_id, monto: Number(l.monto), procesada: l.procesada,
      })),
    }));

    // Sin ninguna constancia registrada no se sabe si cobraron: null, no cero.
    const pago = constancias.length === 0 ? null : cobertura(
      asignados.map((a, i) => ({
        usuarioId: String(i), nombre: a.usuarios?.nombre ?? "—",
        asignado: a.monto == null ? null : Number(a.monto),
      })),
      constancias,
      Number(m.monto_autorizado)
    );

    const limite = m.fecha_retorno_prev;
    const diasAtraso = limite && ["ABIERTO", "EN_RENDICION"].includes(m.estado)
      ? Math.floor((hoy.getTime() - Date.parse(limite)) / 86_400_000)
      : 0;

    const devoluciones = m.devoluciones ?? [];

    return {
      id: m.id,
      estado: m.estado,
      personas: asignados.length,
      bloqueantes,
      diasAtraso,
      // cobertura() cuenta por índice, así que se usa el conteo de filas sin
      // cobrar; sin constancias, null.
      sinCobrar: pago === null ? null : pago.sinCobrar.length,
      rechazadas: constancias.reduce(
        (s, k) => s + k.lineas.filter(l => !l.procesada).length, 0),
      correlativo: m.correlativo,
      destino: m.destino,
      centro: m.centros_costo?.abreviatura ?? m.centros_costo?.nombre ?? null,
      quien: asignados.length === 0
        ? "Nadie asignado"
        : asignados.length === 1
          ? (asignados[0].usuarios?.nombre ?? "—")
          : `Cuadrilla · ${asignados.length} personas`,
      rendido: c.rendido,
      autorizado: c.autorizado,
      creditoFiscal: c.credito_fiscal,
      comprobantes: c.cantidad_gastos,
      conAlertas: c.con_alertas,
      porClase: c.por_clase,
      devuelto: Math.round(devoluciones.reduce((s, d) => s + Number(d.monto), 0) * 100) / 100,
      devolucionesOp: devoluciones.map(d => d.operacion).filter((x): x is string => !!x),
      bancos: [...new Set(constancias.map(k => k.banco))],
      pagado: pago?.pagado ?? 0,
    };
  });

  // Los borradores se sacan aparte: un memo sin abrir es invisible para el
  // rendidor, así que si nadie lo mira acá se queda ahí y la persona espera
  // una plata que nunca le llegó a aparecer.
  const { data: crudos } = await sb
    .from("memos")
    .select(`
      id, correlativo, destino, monto_autorizado,
      memo_asignados ( usuarios ( nombre ) ),
      autorizaciones_memo ( id, jefe_id, estado, respuesta, monto, usuarios!autorizaciones_memo_jefe_id_fkey ( nombre ) )
    `)
    .eq("estado", "BORRADOR")
    .order("creado_en", { ascending: false });

  type BorradorCrudo = {
    id: string; correlativo: string; destino: string | null; monto_autorizado: number;
    memo_asignados: Array<{ usuarios: { nombre: string } | null }>;
    autorizaciones_memo: Array<{
      id: string; jefe_id: string; estado: string; respuesta: string | null;
      monto: number; usuarios: { nombre: string } | null;
    }>;
  };

  const borradores: Borrador[] = ((crudos ?? []) as unknown as BorradorCrudo[]).map(m => ({
    id: m.id,
    correlativo: m.correlativo,
    destino: m.destino,
    monto: Number(m.monto_autorizado),
    personas: (m.memo_asignados ?? [])
      .map(a => a.usuarios?.nombre).filter(Boolean).join(", ") || "Sin asignar",
    autorizaciones: (m.autorizaciones_memo ?? []).map((a): Autorizacion => ({
      id: a.id,
      jefeId: a.jefe_id,
      jefeNombre: a.usuarios?.nombre ?? "Jefatura",
      estado: a.estado as Autorizacion["estado"],
      respuesta: a.respuesta,
      monto: Number(a.monto),
    })),
  }));

  return (
    <>
      <Encabezado
        titulo="Administrar memos"
        bajada="Empieza por lo que te frena. El resto está a una pestaña de distancia."
        accion={
          <Link href="/administrar/nuevo" className="btn-primary" style={{ textDecoration: "none" }}>
            <IconoMas size={17} />
            Nuevo memo
          </Link>
        }
      />
      <PanelBorradores borradores={borradores} />

      <BandejaAdmin memos={filas} />
    </>
  );
}

/** Lo que devuelve la consulta de arriba, antes de resumirse en filas. */
type CrudoMemo = {
  id: string; correlativo: string; destino: string | null; estado: string;
  monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null;
  centros_costo: { codigo: string; nombre: string; abreviatura: string | null } | null;
  memo_asignados: Array<{ monto: number | null; usuarios: { nombre: string } | null }>;
  gastos: Array<{
    estado: EstadoGasto; clase: ClaseGasto; total: number | null;
    alertas: Alerta[]; alertas_confirmadas: boolean; tipo_comprobante: string | null;
  }>;
  devoluciones: Array<{ monto: number; operacion: string | null }>;
  pagos: Array<{
    banco: string;
    pago_lineas: Array<{ usuario_id: string; monto: number; procesada: boolean }>;
  }>;
};
