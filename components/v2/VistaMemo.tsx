"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Captura from "./Captura";
import GastoFila from "./GastoFila";
import { EstadoMemo, Tarjeta, soles } from "./Encabezado";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { consolidar } from "@/lib/dominio/memo";
import { impedimentosParaPresentar, MEMO_EDITABLE } from "@/lib/dominio/estados";
import { presentarRendicion } from "@/app/acciones/memos";
import type { EstadoMemo as TEstadoMemo, Gasto, Parametros } from "@/lib/dominio/tipos";

interface Props {
  memo: {
    id: string; correlativo: string; estado: TEstadoMemo; destino: string | null;
    monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null;
    observacion_actual: string | null;
    centro: { codigo: string; nombre: string } | null;
  };
  gastos: Gasto[];
  parametros: Parametros;
  puedeCapturar: boolean;
}

export default function VistaMemo({ memo, gastos, parametros, puedeCapturar }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ tipo: "error" | "ok"; texto: string } | null>(null);

  const consolidado = useMemo(() => consolidar(Number(memo.monto_autorizado), gastos), [memo, gastos]);
  const editable = MEMO_EDITABLE.includes(memo.estado);
  const impedimentos = useMemo(() => impedimentosParaPresentar(gastos), [gastos]);
  const excedido = consolidado.rendido > consolidado.autorizado;

  const confirmarAlertas = (id: string) => {
    iniciar(async () => {
      const sb = clienteNavegador();
      await sb.from("gastos").update({ alertas_confirmadas: true, estado: "VALIDADO" }).eq("id", id);
      router.refresh();
    });
  };

  const eliminar = (id: string) => {
    iniciar(async () => {
      const sb = clienteNavegador();
      const { error } = await sb.from("gastos").delete().eq("id", id);
      if (error) setAviso({ tipo: "error", texto: error.message });
      router.refresh();
    });
  };

  const presentar = () => {
    if (!confirm(`Se presentarán ${consolidado.cantidad_gastos} comprobantes por ${soles(consolidado.rendido)}. Después no podrás editarlos. ¿Continuar?`)) return;
    iniciar(async () => {
      const r = await presentarRendicion(memo.id);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: "Rendición presentada. Pasó a revisión." });
        router.refresh();
      } else {
        setAviso({ tipo: "error", texto: r.error });
      }
    });
  };

  return (
    <>
      <Link href="/memos" style={{
        fontSize: 12.5, color: "var(--text2)", textDecoration: "none",
        display: "inline-block", marginBottom: 14,
      }}>
        ‹ Mis memos
      </Link>

      {/* ── Cabecera fija con el consolidado ── */}
      <div style={{
        background: "#FFFFFF", border: "1px solid var(--border)", borderRadius: 12,
        padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            fontSize: 12, fontFamily: "monospace", color: "var(--text2)",
            background: "var(--surface2)", padding: "3px 8px", borderRadius: 5,
          }}>
            {memo.correlativo}
          </span>
          <EstadoMemo estado={memo.estado} />
        </div>

        <h1 className="font-display" style={{
          fontSize: 19, fontWeight: 800, color: "var(--text)",
          letterSpacing: "-0.02em", marginTop: 9,
        }}>
          {memo.destino || memo.centro?.nombre}
        </h1>
        <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>
          {memo.centro?.codigo} · {memo.centro?.nombre}
        </p>
        {memo.fecha_salida && (
          <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            {memo.fecha_salida} a {memo.fecha_retorno_prev}
          </p>
        )}

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
          marginTop: 15, paddingTop: 15, borderTop: "1px solid var(--border)",
        }}>
          {[
            { e: "Autorizado", v: soles(consolidado.autorizado), c: "var(--text)" },
            { e: "Rendido", v: soles(consolidado.rendido), c: excedido ? "var(--danger)" : "var(--text)" },
            {
              e: excedido ? "Excede" : "Saldo",
              v: soles(excedido ? consolidado.reembolso : consolidado.saldo),
              c: excedido ? "var(--danger)" : "var(--accent)",
            },
          ].map(k => (
            <div key={k.e} style={{ textAlign: "center" }}>
              <p className="font-display" style={{ fontSize: 16, fontWeight: 800, color: k.c, letterSpacing: "-0.02em" }}>
                {k.v}
              </p>
              <p style={{
                fontSize: 9, color: "var(--text3)", marginTop: 2, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                {k.e}
              </p>
            </div>
          ))}
        </div>

        <div style={{
          height: 6, borderRadius: 999, background: "var(--surface2)", marginTop: 12,
          overflow: "hidden", border: "1px solid var(--border)",
        }}>
          <div style={{
            width: `${consolidado.autorizado > 0 ? Math.min(100, (consolidado.rendido / consolidado.autorizado) * 100) : 0}%`,
            height: "100%", background: excedido ? "var(--danger)" : "var(--accent)",
          }} />
        </div>
      </div>

      {/* ── Observación del revisor ── */}
      {memo.estado === "OBSERVADA" && memo.observacion_actual && (
        <div style={{
          padding: "13px 16px", borderRadius: 11, marginBottom: 14,
          background: "var(--danger-bg)", border: "1px solid rgba(220,38,38,0.25)",
          display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>💬</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", fontFamily: "var(--font-sora), sans-serif" }}>
              Rendición observada
            </p>
            <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 3, lineHeight: 1.5 }}>
              {memo.observacion_actual} Corrige solo los marcados y vuelve a presentar; el resto sigue congelado.
            </p>
          </div>
        </div>
      )}

      {/* ── Captura ── */}
      {editable && puedeCapturar && (
        <Tarjeta>
          <p className="font-display" style={{
            fontSize: 11, fontWeight: 700, color: "var(--text3)",
            textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 12,
          }}>
            Agregar comprobante
          </p>
          <Captura
            memoId={memo.id}
            parametros={parametros}
            memo={{
              monto_autorizado: Number(memo.monto_autorizado),
              fecha_salida: memo.fecha_salida,
              fecha_retorno_prev: memo.fecha_retorno_prev,
            }}
            rendidoPrevio={consolidado.rendido}
            onListo={() => setAviso({ tipo: "ok", texto: "Comprobante agregado." })}
          />
        </Tarjeta>
      )}

      {aviso && (
        <div style={{
          marginTop: 12, padding: "11px 14px", borderRadius: 10,
          background: aviso.tipo === "ok" ? "var(--success-bg)" : "var(--danger-bg)",
          border: `1px solid ${aviso.tipo === "ok" ? "rgba(6,95,70,0.2)" : "rgba(220,38,38,0.2)"}`,
        }}>
          <p style={{
            fontSize: 12.5, lineHeight: 1.5,
            color: aviso.tipo === "ok" ? "var(--success)" : "var(--danger)",
          }}>
            {aviso.texto}
          </p>
        </div>
      )}

      {/* ── Comprobantes ── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p className="font-display" style={{
            fontSize: 11, fontWeight: 700, color: "var(--text3)",
            textTransform: "uppercase", letterSpacing: "0.09em",
          }}>
            Comprobantes ({gastos.length})
          </p>
          {consolidado.con_alertas > 0 && (
            <span className="badge badge-warn">{consolidado.con_alertas} con alerta</span>
          )}
        </div>

        {!gastos.length ? (
          <Tarjeta>
            <p style={{ fontSize: 13, color: "var(--text2)", textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>
              Todavía no hay comprobantes.<br />
              Toma una foto para empezar la rendición.
            </p>
          </Tarjeta>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {gastos.map(g => (
              <GastoFila
                key={g.id} gasto={g}
                umbralConfianza={parametros.umbral_confianza_alerta}
                editable={editable}
                onConfirmar={confirmarAlertas}
                onEliminar={eliminar}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Presentar ── */}
      {editable && gastos.length > 0 && (
        <div style={{ marginTop: 18 }}>
          {impedimentos.length > 0 && (
            <div style={{
              padding: "12px 15px", borderRadius: 10, marginBottom: 11,
              background: "var(--warn-bg)", border: "1px solid rgba(180,83,9,0.2)",
            }}>
              <p style={{
                fontSize: 12, fontWeight: 700, color: "var(--warn)", marginBottom: 5,
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                Falta resolver antes de presentar
              </p>
              {impedimentos.map((i, k) => (
                <p key={k} style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                  · {i.motivo}{i.cantidad > 0 && ` (${i.cantidad})`}
                </p>
              ))}
            </div>
          )}

          <button
            className="btn-primary" onClick={presentar}
            disabled={pendiente || impedimentos.length > 0}
            style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 14 }}
          >
            {pendiente ? "Presentando…" : `Presentar rendición · ${soles(consolidado.rendido)}`}
          </button>
        </div>
      )}
    </>
  );
}
