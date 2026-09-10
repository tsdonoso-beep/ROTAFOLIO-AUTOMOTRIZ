"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoBloqueo, IconoCheck } from "./Iconos";
import { responderAutorizacion } from "@/app/acciones/memos";

export interface SolicitudPendiente {
  id: string;
  correlativo: string;
  monto: number;
  destino: string | null;
  motivo: string;
  pedidaPor: string;
  creadoEn: string;
}

/**
 * Lo que el jefe tiene que decidir.
 *
 * Va arriba del tablero y no en una pantalla aparte: es lo único que le
 * frena el trabajo a otra persona, así que no debería haber que ir a
 * buscarlo.
 *
 * Cada solicitud se cuenta sola —correlativo, monto, destino y el motivo
 * congelado al pedirla— porque un memo en borrador no es visible para el
 * jefe, y porque así queda registrado qué fue exactamente lo que autorizó.
 */
export default function PanelAutorizaciones({ solicitudes }: {
  solicitudes: SolicitudPendiente[];
}) {
  if (!solicitudes.length) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
      }}>
        <span style={{ color: "var(--warn)", display: "flex" }}>
          <IconoBloqueo size={16} />
        </span>
        <p className="rotulo" style={{ margin: 0 }}>
          Esperan tu visto bueno ({solicitudes.length})
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {solicitudes.map(s => <Solicitud key={s.id} s={s} />)}
      </div>
    </div>
  );
}

function Solicitud({ s }: { s: SolicitudPendiente }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [rechazando, setRechazando] = useState(false);

  const responder = (conceder: boolean) => {
    setError("");
    iniciar(async () => {
      const r = await responderAutorizacion(s.id, conceder, respuesta);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  };

  return (
    <Tarjeta padding={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 17px 14px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", gap: 12, flexWrap: "wrap",
        }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text2)" }}>
            {s.correlativo}
          </span>
          <span className="cifra" style={{ fontSize: 16, color: "var(--text)" }}>
            {soles(s.monto)}
          </span>
        </div>

        {s.destino && (
          <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", marginTop: 5 }}>
            {s.destino}
          </p>
        )}

        <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 9, lineHeight: 1.55 }}>
          {s.motivo}
        </p>
        <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 7 }}>
          Lo pidió {s.pedidaPor} · {s.creadoEn}
        </p>
      </div>

      <div style={{
        background: "var(--surface2)", borderTop: "1px solid var(--border)",
        padding: "13px 17px 15px",
      }}>
        {rechazando && (
          <div style={{ marginBottom: 11 }}>
            <label className="fg-label">¿Por qué no?</label>
            <input
              className="fg-input" value={respuesta} autoFocus
              onChange={e => setRespuesta(e.target.value)}
              placeholder="Ej: que cierre primero la rendición de Piura"
            />
            <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
              Lo va a leer quien pidió la autorización. Sin esto, solo sabe que
              dijiste que no.
            </p>
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 11 }}>
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <div style={{ display: "flex", gap: 9 }}>
          {rechazando ? (
            <>
              <button className="btn-ghost" disabled={pendiente}
                onClick={() => { setRechazando(false); setRespuesta(""); }}
                style={{ flex: 1, justifyContent: "center" }}>
                Volver
              </button>
              <button className="btn-peligro" disabled={pendiente}
                onClick={() => responder(false)}
                style={{ flex: 1, justifyContent: "center" }}>
                {pendiente ? "Enviando…" : "Confirmar rechazo"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" disabled={pendiente}
                onClick={() => setRechazando(true)}
                style={{ flex: 1, justifyContent: "center" }}>
                No autorizar
              </button>
              <button className="btn-primary" disabled={pendiente}
                onClick={() => responder(true)}
                style={{ flex: 2, justifyContent: "center" }}>
                <IconoCheck size={15} />
                {pendiente ? "Enviando…" : "Dar el visto bueno"}
              </button>
            </>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}
