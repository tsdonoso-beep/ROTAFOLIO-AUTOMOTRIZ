import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { Encabezado, EstadoMemo, Medidor, Vacio, soles, Atraso } from "@/components/v2/Encabezado";
import { IconoBandeja, IconoMemos } from "@/components/v2/Iconos";
import { consolidar } from "@/lib/dominio/memo";
import { leerParametros } from "@/lib/dominio/parametros";
import { MEMO_EDITABLE } from "@/lib/dominio/estados";
import CapturaRapida from "@/components/v2/CapturaRapida";
import type { EstadoGasto, ClaseGasto, Alerta, EstadoMemo as TEstadoMemo } from "@/lib/dominio/tipos";

/** Vista inicial del rendidor: sus memos, no un formulario de creación. */
export default async function MisMemos() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  const { data: asignaciones } = await sb
    .from("memo_asignados")
    .select("memo_id")
    .eq("usuario_id", solicitante.usuarioId);

  const ids = (asignaciones ?? []).map(a => a.memo_id);

  const { data: memos } = ids.length
    ? await sb
        .from("memos")
        .select(`
          id, correlativo, tipo, destino, estado, monto_autorizado,
          fecha_salida, fecha_retorno_prev,
          centros_costo ( codigo, nombre, drive_folder ),
          empresas ( ruc ),
          gastos ( id, estado, clase, total, alertas )
        `)
        .in("id", ids)
        .not("estado", "in", "(BORRADOR,ANULADO)")
        .order("creado_en", { ascending: false })
    : { data: [] };

  // Comprobantes todavía sin memo: se capturan y se asignan después.
  const { count: sinAsignar } = await sb
    .from("gastos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", solicitante.usuarioId)
    .is("memo_id", null);

  const { data: filasParam } = await sb.from("parametros").select("clave, valor");

  // Los memos que todavía admiten gastos, en la forma que necesita la
  // captura para validar y para archivar la foto sin volver a consultar.
  const disponibles = (memos ?? [])
    .filter(m => MEMO_EDITABLE.includes(m.estado as TEstadoMemo))
    .map(m => {
      const cc = m.centros_costo as unknown as
        { codigo: string; nombre: string; drive_folder: string | null } | null;
      const emp = m.empresas as unknown as { ruc: string } | null;
      const g = (m.gastos ?? []) as Array<{
        estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[];
      }>;
      return {
        id: m.id,
        correlativo: m.correlativo,
        destino: m.destino,
        estado: m.estado as TEstadoMemo,
        fecha_salida: m.fecha_salida,
        fecha_retorno_prev: m.fecha_retorno_prev,
        monto_autorizado: Number(m.monto_autorizado),
        rendido: consolidar(Number(m.monto_autorizado), g).rendido,
        centroCostoFolder: cc?.drive_folder || cc?.codigo || "SIN-CENTRO",
        empresaRuc: emp?.ruc ?? null,
      };
    });

  return (
    <>
      <Encabezado
        titulo="Mis memos"
        bajada="Las rendiciones que te asignaron. Entra en una para cargar comprobantes."
      />

      <CapturaRapida memos={disponibles} parametros={leerParametros(filasParam)} />

      {(sinAsignar ?? 0) > 0 && (
        <Link href="/memos/sin-asignar" style={{ textDecoration: "none", display: "block", marginBottom: 14 }}>
          <div className="tarjeta tarjeta-int" style={{
            background: "var(--warn-bg)", borderColor: "var(--warn-borde)",
            padding: "14px 17px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ color: "var(--warn)", display: "flex" }}>
              <IconoBandeja size={22} />
            </span>
            <div style={{ flex: 1 }}>
              <p className="font-display" style={{
                fontSize: 13.5, fontWeight: 700, color: "var(--warn)", letterSpacing: "-0.01em",
              }}>
                {sinAsignar} comprobante{sinAsignar === 1 ? "" : "s"} sin asignar
              </p>
              <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                Muévelos a un memo para poder presentarlos
              </p>
            </div>
          </div>
        </Link>
      )}

      {!memos?.length ? (
        <Vacio
          icono={<IconoMemos size={26} />}
          titulo="Todavía no tienes memos"
          texto="Los memos los abre Control de Gestión y aparecen aquí en cuanto te asignan uno. No necesitas crearlos tú."
        />
      ) : (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {memos.map(m => {
            const gastos = (m.gastos ?? []) as Array<{
              estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[];
            }>;
            const c = consolidar(Number(m.monto_autorizado), gastos);
            const excedido = c.rendido > c.autorizado;
            const cc = m.centros_costo as unknown as { codigo: string; nombre: string } | null;

            const dias = m.fecha_retorno_prev && ["ABIERTO", "EN_RENDICION"].includes(m.estado)
              ? Math.floor((Date.now() - new Date(m.fecha_retorno_prev).getTime()) / 86_400_000)
              : 0;

            return (
              <Link key={m.id} href={`/memos/${m.id}`}
                className="animate-fadein" style={{ textDecoration: "none" }}>
                <div className="tarjeta tarjeta-int" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "17px 19px 15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="mono" style={{
                        fontSize: 11.5, color: "var(--text2)", background: "var(--surface2)",
                        padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)",
                      }}>
                        {m.correlativo}
                      </span>
                      <EstadoMemo estado={m.estado} />
                      {c.bloqueantes > 0 && (
                        <span className="badge badge-error">
                          {c.bloqueantes} bloqueante{c.bloqueantes > 1 ? "s" : ""}
                        </span>
                      )}
                      {c.con_alertas > 0 && c.bloqueantes === 0 && (
                        <span className="badge badge-warn">{c.con_alertas} con alerta</span>
                      )}
                      <Atraso dias={dias} />
                    </div>

                    <p className="font-display" style={{
                      fontSize: 16.5, fontWeight: 700, color: "var(--text)",
                      marginTop: 10, letterSpacing: "-0.02em", lineHeight: 1.25,
                    }}>
                      {m.destino || cc?.nombre || "Sin destino"}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>
                      {cc && <span className="mono">{cc.codigo}</span>}
                      {cc && ` · ${cc.nombre}`}
                    </p>
                  </div>

                  <div style={{
                    background: "var(--surface2)", borderTop: "1px solid var(--border)",
                    padding: "14px 19px 16px",
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "baseline", marginBottom: 9, gap: 12,
                    }}>
                      <span>
                        <span className="cifra cifra-l" style={{
                          color: excedido ? "var(--danger)" : "var(--text)",
                        }}>
                          {soles(c.rendido)}
                        </span>
                        <span style={{ fontSize: 12.5, color: "var(--text3)", marginLeft: 6 }}>
                          de {soles(c.autorizado)}
                        </span>
                      </span>
                      <span className="cifra" style={{
                        fontSize: 12.5,
                        color: excedido ? "var(--danger)" : "var(--accent-texto)",
                      }}>
                        {excedido ? `+${soles(c.reembolso)}` : `${soles(c.saldo)} libre`}
                      </span>
                    </div>

                    <Medidor rendido={c.rendido} autorizado={c.autorizado} />

                    <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 9 }}>
                      {c.cantidad_gastos === 0
                        ? "Sin comprobantes todavía"
                        : `${c.cantidad_gastos} comprobante${c.cantidad_gastos === 1 ? "" : "s"}`}
                      {m.fecha_retorno_prev && ` · retorno ${m.fecha_retorno_prev}`}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
