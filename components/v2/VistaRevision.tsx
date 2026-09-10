"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import GastoFila from "./GastoFila";
import { Aviso, Cifra, EstadoMemo, Medidor, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoAtras, IconoBloqueo, IconoCheck, IconoDescargar } from "./Iconos";
import { consolidar } from "@/lib/dominio/memo";
import { aprobarRendicion, marcarContabilizado, observarGastos } from "@/app/acciones/memos";
import { descargarCsv, filasCsv } from "@/lib/export/csv";
import type { EstadoMemo as TEstadoMemo, Gasto, Parametros } from "@/lib/dominio/tipos";

interface Props {
  memo: {
    id: string; correlativo: string; estado: TEstadoMemo; destino: string | null;
    monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null;
    centro: { codigo: string; nombre: string } | null;
    empresa: string;
    asignados: string[];
    aprobadoPor: string | null;
  };
  gastos: Gasto[];
  parametros: Parametros;
  /** "revisar" habilita aprobar/observar; "contabilidad" habilita exportar. */
  modo: "revisar" | "contabilidad";
}

export default function VistaRevision({ memo, gastos, parametros, modo }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [obs, setObs] = useState<Record<string, string>>({});
  const [asiento, setAsiento] = useState("");

  const consolidado = useMemo(() => consolidar(Number(memo.monto_autorizado), gastos), [memo, gastos]);
  const excedido = consolidado.rendido > consolidado.autorizado;

  const visibles = useMemo(
    () => soloAlertas ? gastos.filter(g => (g.alertas ?? []).length > 0) : gastos,
    [gastos, soloAlertas]
  );

  const marcados = Object.entries(obs).filter(([, m]) => m !== undefined);
  const conMotivo = marcados.filter(([, m]) => m.trim());

  const aprobar = () => {
    if (!confirm(`Se aprobará la rendición ${memo.correlativo} por ${soles(consolidado.rendido)}. ¿Continuar?`)) return;
    iniciar(async () => {
      const r = await aprobarRendicion(memo.id);
      if (r.ok) { router.push("/revisar"); router.refresh(); }
      else setError(r.error);
    });
  };

  const observar = () => {
    if (!conMotivo.length) {
      setError("Marca al menos un gasto y escribe el motivo de la observación.");
      return;
    }
    iniciar(async () => {
      const r = await observarGastos(memo.id, conMotivo.map(([gastoId, motivo]) => ({ gastoId, motivo })));
      if (r.ok) { router.push("/revisar"); router.refresh(); }
      else setError(r.error);
    });
  };

  const contabilizar = () => {
    iniciar(async () => {
      const r = await marcarContabilizado(memo.id, asiento);
      if (r.ok) { router.refresh(); }
      else setError(r.error);
    });
  };

  const exportar = () => {
    descargarCsv(
      `${memo.correlativo}.csv`,
      filasCsv({
        correlativo: memo.correlativo,
        empresa: memo.empresa,
        centroCodigo: memo.centro?.codigo ?? "",
        centroNombre: memo.centro?.nombre ?? "",
        destino: memo.destino ?? "",
        rendidor: memo.asignados.join(", "),
        aprobadoPor: memo.aprobadoPor ?? "",
      }, gastos)
    );
  };

  const base = modo === "revisar" ? "/revisar" : "/contabilidad";

  return (
    <>
      <Link href={base} style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        {modo === "revisar" ? "Rendiciones por revisar" : "Contabilidad"}
      </Link>

      {/* ── Panel superior ── */}
      <Tarjeta>
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
        <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
          Rinde: {memo.asignados.join(", ") || "—"}
          {memo.aprobadoPor && ` · Aprobó: ${memo.aprobadoPor}`}
        </p>

        {/*
          El mismo panel hundido que ve el rendidor: quien revisa y quien
          rindió leen la misma instrumentación, así no discuten cifras
          presentadas de dos maneras distintas.
        */}
        <div style={{
          marginTop: 16, padding: "15px 16px 16px", borderRadius: "var(--radio-s)",
          background: "var(--surface2)", border: "1px solid var(--border)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 12,
          }}>
            <Cifra
              rotulo="Autorizado"
              valor={consolidado.sinAdelanto ? "sin adelanto" : soles(consolidado.autorizado)}
              tamano="m"
            />
            <Cifra
              rotulo="Rendido"
              valor={soles(consolidado.rendido)}
              tono={excedido && !consolidado.sinAdelanto ? "peligro" : "neutro"}
              tamano="m"
            />
            <Cifra
              rotulo={excedido || consolidado.sinAdelanto ? "A reembolsar" : "A devolver"}
              valor={soles(excedido || consolidado.sinAdelanto ? consolidado.reembolso : consolidado.devolucion)}
              // Un reembolso de caja chica es lo normal, no una alarma:
              // nadie se pasó de un monto porque no había monto.
              tono={excedido && !consolidado.sinAdelanto ? "peligro" : "acento"}
              tamano="m"
            />
            <Cifra
              rotulo="Con alertas"
              valor={String(consolidado.con_alertas)}
              tono={consolidado.con_alertas ? "aviso" : "tenue"}
              tamano="m"
            />
          </div>
          <div style={{ marginTop: 13 }}>
            <Medidor rendido={consolidado.rendido} autorizado={consolidado.autorizado} />
          </div>
        </div>
      </Tarjeta>

      {/* ── Filtro ── */}
      {consolidado.con_alertas > 0 && (
        <label style={{
          display: "flex", alignItems: "center", gap: 9, marginTop: 14,
          padding: "11px 14px", borderRadius: 10, cursor: "pointer",
          background: soloAlertas ? "var(--warn-bg)" : "#FFFFFF",
          border: `1px solid ${soloAlertas ? "rgba(180,83,9,0.25)" : "var(--border)"}`,
        }}>
          <input type="checkbox" checked={soloAlertas} onChange={e => setSoloAlertas(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--warn)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: soloAlertas ? "var(--warn)" : "var(--text2)" }}>
            Ver solo los {consolidado.con_alertas} con alerta
          </span>
        </label>
      )}

      {/* ── Gastos ── */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
        {visibles.map(g => (
          <GastoFila
            key={g.id} gasto={g}
            umbralConfianza={parametros.umbral_confianza_alerta}
            revision={modo === "revisar" && memo.estado === "PRESENTADA" ? {
              observado: obs[g.id] !== undefined,
              motivo: obs[g.id] ?? "",
              onCambio: (marcado, motivo) => setObs(prev => {
                const n = { ...prev };
                if (marcado) n[g.id] = motivo; else delete n[g.id];
                return n;
              }),
            } : undefined}
          />
        ))}
      </div>

      {error && (
        <div className="animate-fadein" style={{ marginTop: 13 }}>
          <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
        </div>
      )}

      {/* ── Acciones ── */}
      {modo === "revisar" && memo.estado === "PRESENTADA" && (
        <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={observar} disabled={pendiente || !conMotivo.length}
            className="btn-peligro"
            style={{
              flex: 1, minWidth: 180, justifyContent: "center", padding: 12, fontSize: 13.5,
              opacity: conMotivo.length ? 1 : 0.5,
              cursor: conMotivo.length ? "pointer" : "not-allowed",
            }}
          >
            Observar {conMotivo.length > 0 && `(${conMotivo.length})`}
          </button>
          <button className="btn-primary" onClick={aprobar} disabled={pendiente || marcados.length > 0}
            style={{ flex: 2, minWidth: 180, justifyContent: "center", padding: 12, fontSize: 13.5 }}>
            {pendiente ? "Procesando…" : <><IconoCheck size={17} />Aprobar rendición</>}
          </button>
        </div>
      )}

      {modo === "revisar" && marcados.length > 0 && (
        <p style={{ marginTop: 9, fontSize: 11.5, color: "var(--text3)", lineHeight: 1.5 }}>
          Solo los gastos marcados vuelven al rendidor. El resto queda congelado, así
          no tiene que rehacer toda la rendición.
        </p>
      )}

      {modo === "contabilidad" && (
        <div style={{ marginTop: 18 }}>
          <Tarjeta>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <button className="btn-ghost" onClick={exportar} style={{ padding: "11px 18px" }}>
                <IconoDescargar size={16} />
                Exportar CSV
              </button>
              {memo.estado === "APROBADA" && (
                <>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label className="fg-label">N° de asiento (opcional)</label>
                    <input className="fg-input" value={asiento} onChange={e => setAsiento(e.target.value)}
                      placeholder="Ej: 06-2026-0142" />
                  </div>
                  <button className="btn-primary" onClick={contabilizar} disabled={pendiente}
                    style={{ padding: "11px 18px" }}>
                    {pendiente ? "Guardando…" : "Marcar contabilizado"}
                  </button>
                </>
              )}
            </div>
            {memo.estado === "CONTABILIZADA" && (
              <div style={{ marginTop: 12 }}>
                <Aviso tono="ok" icono={<IconoBloqueo size={17} />}>
                  Ya contabilizada. El expediente queda cerrado y no admite cambios.
                </Aviso>
              </div>
            )}
          </Tarjeta>
        </div>
      )}
    </>
  );
}
