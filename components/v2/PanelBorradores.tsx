"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoBloqueo, IconoCheck, IconoReloj } from "./Iconos";
import { abrirMemo } from "@/app/acciones/memos";
import { situacionDeApertura, type Autorizacion } from "@/lib/dominio/autorizacion";

export interface Borrador {
  id: string;
  correlativo: string;
  destino: string | null;
  monto: number;
  personas: string;
  autorizaciones: Autorizacion[];
}

/**
 * Los memos que se crearon pero todavía no están abiertos.
 *
 * Existe porque un borrador es invisible para el rendidor: si nadie lo
 * mira, se queda ahí y la persona espera una plata que nunca le llegó a
 * aparecer. Los que esperan una firma van arriba.
 */
export default function PanelBorradores({ borradores }: { borradores: Borrador[] }) {
  if (!borradores.length) return null;

  const orden = [...borradores].sort((a, b) => {
    const pa = a.autorizaciones.some(x => x.estado === "PENDIENTE") ? 0 : 1;
    const pb = b.autorizaciones.some(x => x.estado === "PENDIENTE") ? 0 : 1;
    return pa - pb;
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <p className="rotulo" style={{ marginBottom: 10 }}>
        Sin abrir ({borradores.length}) · el rendidor todavía no los ve
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orden.map(b => <Fila key={b.id} b={b} />)}
      </div>
    </div>
  );
}

function Fila({ b }: { b: Borrador }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const s = situacionDeApertura(b.autorizaciones, b.monto);
  const esperando = b.autorizaciones.some(a => a.estado === "PENDIENTE");
  const rechazado = b.autorizaciones.some(a => a.estado === "RECHAZADA");

  const abrir = () => {
    setError("");
    iniciar(async () => {
      const r = await abrirMemo(b.id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  };

  return (
    <Tarjeta padding={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 17px 14px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6,
        }}>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text2)" }}>
            {b.correlativo}
          </span>
          <span className="cifra" style={{ fontSize: 15, color: "var(--text)" }}>
            {soles(b.monto)}
          </span>
        </div>

        <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
          {b.destino || "Sin destino"}
        </p>
        <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
          {b.personas}
        </p>

        {s.motivo && (
          <div style={{
            display: "flex", gap: 7, alignItems: "flex-start", marginTop: 11,
            fontSize: 12.5, lineHeight: 1.5,
            color: rechazado ? "var(--danger)" : "var(--warn)",
          }}>
            <span style={{ marginTop: 1, flexShrink: 0, display: "flex" }}>
              {rechazado ? <IconoBloqueo size={14} /> : <IconoReloj size={14} />}
            </span>
            <span>{s.motivo}</span>
          </div>
        )}
      </div>

      <div style={{
        background: "var(--surface2)", borderTop: "1px solid var(--border)",
        padding: "12px 17px 14px",
      }}>
        {error && <div style={{ marginBottom: 10 }}><Aviso tono="error">{error}</Aviso></div>}

        {rechazado || (!s.puedeAbrir && !esperando) ? (
          <p style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.5 }}>
            {rechazado
              ? "Este memo no se puede abrir. Anúlalo, o crea uno nuevo cuando la persona cierre lo que debe."
              : "Devuelve el monto al que se autorizó, o pide el visto bueno otra vez."}
          </p>
        ) : (
          <button className="btn-primary" onClick={abrir}
            disabled={pendiente || esperando}
            style={{ width: "100%", justifyContent: "center" }}>
            <IconoCheck size={15} />
            {pendiente ? "Abriendo…" : esperando ? "Esperando a Jefatura" : "Abrir memo"}
          </button>
        )}
      </div>
    </Tarjeta>
  );
}
