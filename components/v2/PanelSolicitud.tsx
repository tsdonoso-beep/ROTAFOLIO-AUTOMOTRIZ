"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta, soles } from "./Encabezado";
import { anularSolicitud, emitirMemoDeSolicitud, responderSolicitud } from "@/app/acciones/solicitudes";
import { puedeEmitirse, puedeResponder, type EstadoSolicitud } from "@/lib/dominio/solicitud";

interface Solicitud {
  id: string; tipo: string; estado: EstadoSolicitud;
  motivo: string; destino: string | null; monto: number | null;
  desde: string | null; hasta: string | null; respuesta: string | null;
  memoId: string | null;
  solicitanteId: string; solicitanteNombre: string;
  jefeId: string | null; jefeNombre: string | null;
  personas: Array<{ id: string; nombre: string; monto: number | null }>;
}

/**
 * Un pedido, con lo que cada quien puede hacer con él.
 *
 * Quien lo pidió lo retira; su jefatura lo firma; Administración lo emite.
 * La pantalla no decide nada de eso: pregunta a las mismas funciones que usa
 * el servidor, así que no puede ofrecer un botón que la acción vaya a
 * rechazar.
 */
export default function PanelSolicitud({
  solicitud: s, yo, puedeEmitir, tono, etiqueta,
}: {
  solicitud: Solicitud;
  yo: string;
  puedeEmitir: boolean;
  tono: { fondo: string; texto: string };
  etiqueta: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");
  const [respuesta, setRespuesta] = useState("");

  const base = {
    id: s.id, estado: s.estado, solicitanteId: s.solicitanteId,
    jefaturaId: s.jefeId, personas: s.personas.map(p => p.id),
  };

  // Se pregunta con el id de quien mira, no con su rol: la regla es que hay
  // que ser la jefatura a la que se le pidió, y no ser parte del viaje.
  const firmar = puedeResponder(base, {
    usuarioId: yo, esJefatura: s.jefeId === yo, esAdminSistema: false,
  });
  const emitir = puedeEmitirse(base);
  const mio = s.solicitanteId === yo;

  const responder = (aprobar: boolean) => {
    setError("");
    iniciar(async () => {
      const r = await responderSolicitud(s.id, aprobar, respuesta);
      if (!r.ok) { setError(r.error); return; }
      setRespuesta("");
      router.refresh();
    });
  };

  const emitirMemo = () => {
    setError("");
    iniciar(async () => {
      const r = await emitirMemoDeSolicitud(s.id, true);
      if (!r.ok) { setError(r.error); return; }
      router.push(`/memos/${r.id}`);
      router.refresh();
    });
  };

  const retirar = () => {
    setError("");
    iniciar(async () => {
      const r = await anularSolicitud(s.id);
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  };

  return (
    <Tarjeta>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="font-display" style={{
            fontSize: 14.5, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em",
          }}>
            {s.motivo}
          </h3>
          <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3, lineHeight: 1.5 }}>
            {s.tipo.replace("_", " ").toLowerCase()}
            {s.destino && ` · ${s.destino}`}
            {s.desde && ` · del ${s.desde} al ${s.hasta}`}
            {" · "}lo pidió {s.solicitanteNombre}
            {s.jefeNombre && ` · firma ${s.jefeNombre}`}
          </p>
        </div>
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
          background: tono.fondo, color: tono.texto, flexShrink: 0,
        }}>
          {etiqueta}
        </span>
      </div>

      {/* A quién cubre, con lo que le tocaría a cada uno */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
        {s.personas.map(p => (
          <div key={p.id} style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 12.5, color: "var(--text2)",
          }}>
            <span>{p.nombre}</span>
            <span style={{ fontWeight: 600, color: "var(--text)" }}>
              {p.monto == null ? "—" : soles(p.monto)}
            </span>
          </div>
        ))}
        {s.monto != null && s.personas.length > 1 && (
          <div style={{
            display: "flex", justifyContent: "space-between", fontSize: 12.5,
            marginTop: 4, paddingTop: 7, borderTop: "1px solid var(--border2)",
          }}>
            <span style={{ color: "var(--text2)" }}>Total pedido</span>
            <strong style={{ color: "var(--text)" }}>{soles(s.monto)}</strong>
          </div>
        )}
      </div>

      {s.respuesta && (
        <p style={{
          fontSize: 12, color: "var(--text2)", marginTop: 11, paddingTop: 9,
          borderTop: "1px solid var(--border2)", lineHeight: 1.5,
        }}>
          {s.respuesta}
        </p>
      )}

      {/* ── La firma ── */}
      {firmar.puede && (
        <div style={{ marginTop: 13, paddingTop: 13, borderTop: "1px solid var(--border2)" }}>
          <label className="fg-label" style={{ fontSize: 10.5 }}>
            Tu respuesta (obligatoria si lo rechazas)
          </label>
          <input className="fg-input" value={respuesta}
            onChange={e => setRespuesta(e.target.value)}
            placeholder="Ej: que cierre primero la rendición de Piura" />
          <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
            <button className="btn-ghost" onClick={() => responder(false)}
              disabled={pendiente} style={{ flex: 1, justifyContent: "center" }}>
              Rechazar
            </button>
            <button className="btn-primary" onClick={() => responder(true)}
              disabled={pendiente} style={{ flex: 2, justifyContent: "center" }}>
              {pendiente ? "Guardando…" : "Dar el visto bueno"}
            </button>
          </div>
        </div>
      )}

      {/* ── Emitir el memo ── */}
      {puedeEmitir && emitir.puede && (
        <button className="btn-primary" onClick={emitirMemo} disabled={pendiente}
          style={{ marginTop: 13, width: "100%", justifyContent: "center" }}>
          {pendiente ? "Emitiendo…" : "Emitir el memo"}
        </button>
      )}

      {/* Por qué todavía no se puede emitir, dicho donde se busca */}
      {puedeEmitir && !emitir.puede && s.estado === "PENDIENTE" && (
        <p style={{
          fontSize: 11.5, color: "var(--text3)", marginTop: 11, lineHeight: 1.45,
        }}>
          {emitir.motivo}
        </p>
      )}

      {mio && s.estado !== "CONVERTIDA" && (
        <button onClick={retirar} disabled={pendiente} style={{
          background: "none", border: "none", cursor: "pointer", padding: 0,
          marginTop: 11, fontSize: 11.5, color: "var(--text3)",
          fontFamily: "var(--font-sora), sans-serif",
        }}>
          Retirar el pedido
        </button>
      )}

      {error && (
        <p style={{ marginTop: 11, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </Tarjeta>
  );
}
