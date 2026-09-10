"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoCheck, IconoLiquidacion } from "./Iconos";
import { emitirLiquidacion, registrarPago } from "@/app/acciones/liquidaciones";
import {
  netoSinPagar, NOMBRE_ESTADO_LIQUIDACION, type LiquidacionEmitida,
} from "@/lib/dominio/liquidacion";

interface Props {
  usuarioId: string;
  emitidas: LiquidacionEmitida[];
  disponibles: string[];
  puedeRegistrarPago: boolean;
}

/**
 * El documento de pago y su desenlace.
 *
 * Antes esta pantalla calculaba el neto y ofrecía descargarlo, y nada más:
 * al día siguiente mostraba el mismo número, idéntico, sin que nada dijera
 * si ya se había pagado. En un documento que va a pago, eso es pagar dos
 * veces.
 */
export default function PanelPago({
  usuarioId, emitidas, disponibles, puedeRegistrarPago,
}: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const porPagar = netoSinPagar(emitidas);
  const vigentes = emitidas.filter(l => l.estado !== "ANULADA");

  const emitir = () => {
    setError("");
    iniciar(async () => {
      const r = await emitirLiquidacion(usuarioId, disponibles);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <p className="rotulo" style={{ marginBottom: 10 }}>Pago</p>

      {error && <div style={{ marginBottom: 11 }}><Aviso tono="error">{error}</Aviso></div>}

      {porPagar !== 0 && (
        <div style={{ marginBottom: 11 }}>
          <Aviso tono="aviso" icono={<IconoLiquidacion size={17} />}>
            Hay {soles(Math.abs(porPagar))} emitidos y todavía sin mover.
          </Aviso>
        </div>
      )}

      <Tarjeta>
        {vigentes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 15 }}>
            {vigentes.map(l => (
              <Emitida key={l.id} l={l} puedeRegistrarPago={puedeRegistrarPago} />
            ))}
          </div>
        )}

        {disponibles.length > 0 ? (
          <>
            <button className="btn-primary" onClick={emitir} disabled={pendiente}
              style={{ width: "100%", justifyContent: "center" }}>
              <IconoLiquidacion size={16} />
              {pendiente
                ? "Emitiendo…"
                : `Emitir liquidación de ${disponibles.length} rendición${disponibles.length === 1 ? "" : "es"}`}
            </button>
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              Los montos quedan congelados: que después se apruebe otro gasto no
              cambia lo que se mandó a pagar.
            </p>
          </>
        ) : (
          <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
            {vigentes.length
              ? "Todas las rendiciones cerradas de esta persona ya están en una liquidación."
              : "Todavía no hay rendiciones cerradas que liquidar. Una rendición entra acá recién cuando la aprueban."}
          </p>
        )}
      </Tarjeta>
    </div>
  );
}

function Emitida({ l, puedeRegistrarPago }: {
  l: LiquidacionEmitida; puedeRegistrarPago: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [referencia, setReferencia] = useState("");
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");

  const pagada = l.estado === "PAGADA";

  const pagar = () => {
    setError("");
    iniciar(async () => {
      const r = await registrarPago(l.id, referencia, observacion);
      if (r.ok) { setAbierto(false); router.refresh(); }
      else setError(r.error);
    });
  };

  return (
    <div style={{
      padding: "12px 14px", borderRadius: "var(--radio-s)",
      background: "var(--surface2)", border: "1px solid var(--border)",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: 10, flexWrap: "wrap",
      }}>
        <div>
          <span className="badge" style={
            pagada
              ? { background: "var(--success-bg)", color: "var(--success)" }
              : { background: "var(--warn-bg)", color: "var(--warn)" }
          }>
            {NOMBRE_ESTADO_LIQUIDACION[l.estado]}
          </span>
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>
            {l.memoIds.length} memo{l.memoIds.length === 1 ? "" : "s"} · emitida {l.emitidaEn}
          </span>
        </div>
        <span className="cifra" style={{ fontSize: 14, color: "var(--text)" }}>
          {soles(Math.abs(l.neto))}
          <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 400, marginLeft: 5 }}>
            {l.neto > 0 ? "devuelve" : l.neto < 0 ? "se le paga" : ""}
          </span>
        </span>
      </div>

      {pagada && l.referencia && (
        <p style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 7 }}>
          <span className="mono">{l.referencia}</span>
          {l.pagadaEn && <span style={{ color: "var(--text3)" }}> · {l.pagadaEn}</span>}
        </p>
      )}

      {!pagada && puedeRegistrarPago && (
        abierto ? (
          <div style={{ marginTop: 11 }}>
            <label className="fg-label">Referencia del movimiento</label>
            <input className="fg-input" value={referencia} autoFocus
              onChange={e => setReferencia(e.target.value)}
              placeholder="N.º de operación, voucher, transferencia…" />

            <div style={{ marginTop: 10 }}>
              <label className="fg-label">Observación (opcional)</label>
              <input className="fg-input" value={observacion}
                onChange={e => setObservacion(e.target.value)}
                placeholder="Ej: depósito BCP cuenta corriente" />
            </div>

            {error && <div style={{ marginTop: 10 }}><Aviso tono="error">{error}</Aviso></div>}

            <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
              <button className="btn-ghost" disabled={pendiente}
                onClick={() => setAbierto(false)}
                style={{ flex: 1, justifyContent: "center" }}>
                Volver
              </button>
              <button className="btn-primary" disabled={pendiente || !referencia.trim()}
                onClick={pagar} style={{ flex: 2, justifyContent: "center" }}>
                <IconoCheck size={15} />
                {pendiente ? "Registrando…" : "Confirmar el movimiento"}
              </button>
            </div>
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              Esto cierra las rendiciones que ya estén contabilizadas. No se
              puede deshacer desde acá.
            </p>
          </div>
        ) : (
          <button className="btn-ghost" onClick={() => setAbierto(true)}
            style={{ width: "100%", justifyContent: "center", marginTop: 11 }}>
            Registrar el pago
          </button>
        )
      )}
    </div>
  );
}
