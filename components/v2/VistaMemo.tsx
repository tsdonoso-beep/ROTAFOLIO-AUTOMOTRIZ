"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Captura from "./Captura";
import GastoFila from "./GastoFila";
import { Aviso, Cifra, EstadoMemo, Medidor, Tarjeta, Vacio, soles } from "./Encabezado";
import {
  IconoAlerta, IconoAtras, IconoComentario, IconoComprobante, IconoCheck,
} from "./Iconos";
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

  const c = useMemo(() => consolidar(Number(memo.monto_autorizado), gastos), [memo, gastos]);
  const editable = MEMO_EDITABLE.includes(memo.estado);
  const impedimentos = useMemo(() => impedimentosParaPresentar(gastos), [gastos]);
  const excedido = c.rendido > c.autorizado;

  const confirmarAlertas = (id: string) => {
    iniciar(async () => {
      await clienteNavegador().from("gastos")
        .update({ alertas_confirmadas: true, estado: "VALIDADO" }).eq("id", id);
      router.refresh();
    });
  };

  const eliminar = (id: string) => {
    iniciar(async () => {
      const { error } = await clienteNavegador().from("gastos").delete().eq("id", id);
      if (error) setAviso({ tipo: "error", texto: error.message });
      router.refresh();
    });
  };

  const presentar = () => {
    if (!confirm(`Se presentarán ${c.cantidad_gastos} comprobantes por ${soles(c.rendido)}. Después no podrás editarlos. ¿Continuar?`)) return;
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
      <Link href="/memos" className="hover-atras" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Mis memos
      </Link>

      {/* ══ Cabecera: las cifras son el contenido ══ */}
      <Tarjeta padding={0} style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "20px 22px 18px" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono" style={{
              fontSize: 12, color: "var(--text2)", background: "var(--surface2)",
              padding: "4px 9px", borderRadius: 7, border: "1px solid var(--border)",
            }}>
              {memo.correlativo}
            </span>
            <EstadoMemo estado={memo.estado} />
          </div>

          <h1 className="font-display" style={{
            fontSize: 22, fontWeight: 800, color: "var(--text)",
            letterSpacing: "-0.03em", marginTop: 11, lineHeight: 1.2,
          }}>
            {memo.destino || memo.centro?.nombre}
          </h1>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
            {memo.centro && (
              <span style={{ fontSize: 12.5, color: "var(--text2)" }}>
                <span className="mono">{memo.centro.codigo}</span> · {memo.centro.nombre}
              </span>
            )}
          </div>
          {memo.fecha_salida && (
            <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 3 }}>
              {memo.fecha_salida} al {memo.fecha_retorno_prev}
            </p>
          )}
        </div>

        {/* Zona hundida para las cifras: se lee como un panel de instrumentos */}
        <div style={{
          background: "var(--surface2)", borderTop: "1px solid var(--border)",
          padding: "18px 22px 20px",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16,
          }}>
            <Cifra rotulo="Autorizado" valor={soles(c.autorizado)} tamano="l" tono="tenue" />
            <Cifra rotulo="Rendido" valor={soles(c.rendido)} tamano="xl"
              tono={excedido ? "peligro" : "neutro"} />
            <Cifra
              rotulo={excedido ? "Excedido" : "Saldo"}
              valor={soles(excedido ? c.reembolso : c.saldo)}
              tamano="l"
              tono={excedido ? "peligro" : "acento"}
            />
          </div>

          <Medidor rendido={c.rendido} autorizado={c.autorizado} />

          {c.cantidad_gastos > 0 && (
            <div style={{
              display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap",
              fontSize: 12, color: "var(--text2)",
            }}>
              <span>{c.cantidad_gastos} comprobante{c.cantidad_gastos === 1 ? "" : "s"}</span>
              {c.con_alertas > 0 && (
                <span style={{ color: "var(--warn)", fontWeight: 600 }}>
                  {c.con_alertas} con alerta
                </span>
              )}
              {c.bloqueantes > 0 && (
                <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                  {c.bloqueantes} bloqueante{c.bloqueantes === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      {/* ══ Observación del revisor ══ */}
      {memo.estado === "OBSERVADA" && memo.observacion_actual && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="error" icono={<IconoComentario size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              Rendición observada.
            </strong>{" "}
            {memo.observacion_actual} Corrige solo los marcados y vuelve a presentar;
            el resto sigue congelado.
          </Aviso>
        </div>
      )}

      {/* ══ Captura ══ */}
      {editable && puedeCapturar && (
        <Tarjeta style={{ marginBottom: 16 }}>
          <p className="rotulo" style={{ marginBottom: 13 }}>Agregar comprobante</p>
          <Captura
            memoId={memo.id}
            parametros={parametros}
            memo={{
              monto_autorizado: Number(memo.monto_autorizado),
              fecha_salida: memo.fecha_salida,
              fecha_retorno_prev: memo.fecha_retorno_prev,
            }}
            rendidoPrevio={c.rendido}
            onListo={() => setAviso({ tipo: "ok", texto: "Comprobante agregado." })}
          />
        </Tarjeta>
      )}

      {aviso && (
        <div style={{ marginBottom: 16 }}>
          <Aviso
            tono={aviso.tipo === "ok" ? "ok" : "error"}
            icono={aviso.tipo === "ok" ? <IconoCheck size={16} /> : <IconoAlerta size={16} />}
          >
            {aviso.texto}
          </Aviso>
        </div>
      )}

      {/* ══ Comprobantes ══ */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 11,
      }}>
        <p className="rotulo">Comprobantes ({gastos.length})</p>
      </div>

      {!gastos.length ? (
        <Vacio
          icono={<IconoComprobante size={26} />}
          titulo="Todavía no hay comprobantes"
          texto={puedeCapturar
            ? "Toma una foto del primer comprobante. La IA lee el proveedor, el número y los montos por ti."
            : "Cuando quien rinde cargue comprobantes, aparecerán aquí."}
        />
      ) : (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

      {/* ══ Presentar ══ */}
      {editable && gastos.length > 0 && (
        <div style={{ marginTop: 20 }}>
          {impedimentos.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
                <strong style={{
                  fontFamily: "var(--font-sora), sans-serif", display: "block", marginBottom: 4,
                }}>
                  Falta resolver antes de presentar
                </strong>
                {impedimentos.map((i, k) => (
                  <span key={k} style={{ display: "block", lineHeight: 1.65 }}>
                    · {i.motivo}{i.cantidad > 0 && ` (${i.cantidad})`}
                  </span>
                ))}
              </Aviso>
            </div>
          )}

          <button
            className="btn-primary" onClick={presentar}
            disabled={pendiente || impedimentos.length > 0}
            style={{ width: "100%", justifyContent: "center", padding: 15, fontSize: 14.5 }}
          >
            {pendiente ? "Presentando…" : (
              <>
                <IconoCheck size={18} />
                Presentar rendición · {soles(c.rendido)}
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}
