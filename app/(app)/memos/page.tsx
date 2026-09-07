import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { Encabezado, EstadoMemo, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { consolidar } from "@/lib/dominio/memo";
import type { EstadoGasto, ClaseGasto, Alerta } from "@/lib/dominio/tipos";

/** Vista inicial del rendidor: sus memos, no un formulario de creación. */
export default async function MisMemos() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  // Solo los memos asignados a esta persona. Las políticas de fila ya lo
  // garantizan; el filtro explícito evita traer de más a quien ve todo.
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
          centros_costo ( codigo, nombre ),
          gastos ( id, estado, clase, total, alertas )
        `)
        .in("id", ids)
        .not("estado", "in", "(BORRADOR,ANULADO)")
        .order("creado_en", { ascending: false })
    : { data: [] };

  // Comprobantes todavía sin memo (§2.3): se capturan y se asignan después.
  const { count: sinAsignar } = await sb
    .from("gastos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", solicitante.usuarioId)
    .is("memo_id", null);

  return (
    <>
      <Encabezado
        titulo="Mis memos"
        bajada="Las rendiciones que te asignaron. Selecciona una para cargar comprobantes."
      />

      {(sinAsignar ?? 0) > 0 && (
        <Link href="/memos/sin-asignar" style={{ textDecoration: "none", display: "block", marginBottom: 12 }}>
          <div style={{
            background: "var(--warn-bg)", border: "1px solid rgba(180,83,9,0.2)",
            borderRadius: 12, padding: "13px 16px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>📥</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--warn)", fontFamily: "var(--font-sora), sans-serif" }}>
                {sinAsignar} comprobante{sinAsignar === 1 ? "" : "s"} sin asignar
              </p>
              <p style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 2 }}>
                Muévelos a un memo para poder presentarlos
              </p>
            </div>
            <span style={{ color: "var(--warn)", fontSize: 15 }}>›</span>
          </div>
        </Link>
      )}

      {!memos?.length ? (
        <Vacio
          icono="📋"
          titulo="Todavía no tienes memos"
          texto="Los memos los abre Control de Gestión y aparecen aquí en cuanto te asignan uno. No necesitas crearlos tú."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {memos.map(m => {
            const gastos = (m.gastos ?? []) as Array<{
              estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[];
            }>;
            const c = consolidar(Number(m.monto_autorizado), gastos);
            const consumo = c.autorizado > 0
              ? Math.min(100, (c.rendido / c.autorizado) * 100)
              : 0;
            const excedido = c.rendido > c.autorizado;
            const cc = m.centros_costo as unknown as { codigo: string; nombre: string } | null;

            const dias = m.fecha_retorno_prev
              ? Math.floor((Date.now() - new Date(m.fecha_retorno_prev).getTime()) / 86_400_000)
              : null;

            return (
              <Link key={m.id} href={`/memos/${m.id}`} style={{ textDecoration: "none" }}>
                <Tarjeta>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 12, fontFamily: "monospace", color: "var(--text2)",
                          background: "var(--surface2)", padding: "2px 7px", borderRadius: 5,
                        }}>
                          {m.correlativo}
                        </span>
                        <EstadoMemo estado={m.estado} />
                        {c.bloqueantes > 0 && (
                          <span className="badge badge-error">{c.bloqueantes} bloqueante{c.bloqueantes > 1 ? "s" : ""}</span>
                        )}
                        {c.con_alertas > 0 && c.bloqueantes === 0 && (
                          <span className="badge badge-warn">{c.con_alertas} con alerta</span>
                        )}
                      </div>

                      <p className="font-display" style={{
                        fontSize: 15, fontWeight: 700, color: "var(--text)",
                        marginTop: 7, letterSpacing: "-0.01em",
                      }}>
                        {m.destino || cc?.nombre || "Sin destino"}
                      </p>
                      <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 2 }}>
                        {cc?.nombre}
                        {m.fecha_salida && ` · ${m.fecha_salida}`}
                        {m.fecha_retorno_prev && ` a ${m.fecha_retorno_prev}`}
                      </p>

                      {dias !== null && dias > 0 && ["ABIERTO", "EN_RENDICION"].includes(m.estado) && (
                        <p style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 5, fontWeight: 600 }}>
                          ⚠ Retorno hace {dias} día{dias === 1 ? "" : "s"} · pendiente de rendir
                        </p>
                      )}
                    </div>

                    <div style={{ minWidth: 170 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                        <span style={{ color: "var(--text3)" }}>Rendido</span>
                        <span style={{
                          fontWeight: 700, fontFamily: "var(--font-sora), sans-serif",
                          color: excedido ? "var(--danger)" : "var(--text)",
                        }}>
                          {soles(c.rendido)}
                        </span>
                      </div>
                      <div style={{
                        height: 6, borderRadius: 999, background: "var(--surface2)",
                        overflow: "hidden", border: "1px solid var(--border)",
                      }}>
                        <div style={{
                          width: `${consumo}%`, height: "100%",
                          background: excedido ? "var(--danger)" : "var(--accent)",
                          transition: "width 0.3s",
                        }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 5 }}>
                        <span style={{ color: "var(--text3)" }}>
                          de {soles(c.autorizado)}
                        </span>
                        <span style={{ color: excedido ? "var(--danger)" : "var(--text2)", fontWeight: 600 }}>
                          {excedido ? `excede ${soles(c.reembolso)}` : `saldo ${soles(c.saldo)}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </Tarjeta>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
