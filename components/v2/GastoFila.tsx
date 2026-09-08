"use client";
import { useState } from "react";
import { ordenarAlertas } from "@/lib/dominio/validaciones";
import { soles } from "./Encabezado";
import type { Alerta, Gasto } from "@/lib/dominio/tipos";

const NOMBRE_COMPROBANTE: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "Nota de crédito",
  "08": "Nota de débito", "12": "Ticket",
};

const COLOR_SEVERIDAD: Record<string, { fondo: string; texto: string; icono: string }> = {
  bloqueante: { fondo: "var(--danger-bg)",  texto: "var(--danger)", icono: "⛔" },
  alta:       { fondo: "var(--warn-bg)",    texto: "var(--warn)",   icono: "⚠️" },
  media:      { fondo: "var(--warn-bg)",    texto: "var(--warn)",   icono: "⚠️" },
  baja:       { fondo: "rgba(0,0,0,0.04)",  texto: "var(--text2)",  icono: "ℹ️" },
};

type G = Pick<Gasto,
  | "id" | "estado" | "clase" | "proveedor_ruc" | "proveedor_nombre"
  | "tipo_comprobante" | "serie" | "numero" | "fecha_emision"
  | "subtotal" | "igv" | "total" | "moneda" | "detalle" | "forma_pago"
  | "alertas" | "alertas_confirmadas" | "confianza_extraccion"
  | "observacion" | "drive_url"
>;

interface Props {
  gasto: G;
  umbralConfianza: number;
  /** Permite confirmar alertas y quitar el gasto. */
  editable?: boolean;
  onConfirmar?: (id: string) => void;
  onEliminar?: (id: string) => void;
  /** Modo revisión: casilla para observar con motivo. */
  revision?: { observado: boolean; motivo: string; onCambio: (obs: boolean, motivo: string) => void };
}

export default function GastoFila({
  gasto: g, umbralConfianza, editable, onConfirmar, onEliminar, revision,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const alertas = ordenarAlertas((g.alertas ?? []) as Alerta[]);
  const bloqueante = alertas.some(a => a.severidad === "bloqueante");
  const sinConfirmar = alertas.length > 0 && !g.alertas_confirmadas && !bloqueante;

  const dudosos = Object.entries(g.confianza_extraccion ?? {})
    .filter(([, v]) => v < umbralConfianza)
    .map(([k]) => k);

  const borde = bloqueante ? "rgba(220,38,38,0.35)"
    : g.estado === "OBSERVADO" ? "rgba(220,38,38,0.35)"
    : sinConfirmar ? "rgba(180,83,9,0.3)"
    : "var(--border)";

  return (
    <div style={{
      background: "#FFFFFF", border: `1px solid ${borde}`, borderRadius: 11,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div
        onClick={() => setAbierto(v => !v)}
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", gap: 11, alignItems: "flex-start" }}
      >
        {revision && (
          <input
            type="checkbox" checked={revision.observado}
            onClick={e => e.stopPropagation()}
            onChange={e => revision.onCambio(e.target.checked, revision.motivo)}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--danger)", flexShrink: 0 }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-sora), sans-serif" }}>
              {g.proveedor_nombre || "Proveedor no leído"}
            </span>
            {bloqueante && <span className="badge badge-error">Duplicado</span>}
            {g.estado === "OBSERVADO" && <span className="badge badge-error">Observado</span>}
            {sinConfirmar && <span className="badge badge-warn">{alertas.length} alerta{alertas.length > 1 ? "s" : ""}</span>}
            {g.alertas_confirmadas && alertas.length > 0 && (
              <span className="badge badge-ok">Confirmado</span>
            )}
          </div>

          <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
            {NOMBRE_COMPROBANTE[g.tipo_comprobante ?? ""] ?? g.tipo_comprobante ?? "—"}
            {g.serie && ` ${g.serie}-${g.numero}`}
            {g.proveedor_ruc && ` · RUC ${g.proveedor_ruc}`}
            {g.fecha_emision && ` · ${g.fecha_emision}`}
          </p>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p className="font-display" style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
            {soles(Number(g.total ?? 0))}
          </p>
          <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 1 }}>
            {abierto ? "▲ menos" : "▼ detalle"}
          </p>
        </div>
      </div>

      {/* Observación del revisor: se muestra siempre, esté abierto o no */}
      {g.observacion && (
        <div style={{
          padding: "10px 14px", background: "var(--danger-bg)",
          borderTop: "1px solid var(--border)", display: "flex", gap: 8,
        }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>💬</span>
          <p style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
            <strong>Observado:</strong> {g.observacion}
          </p>
        </div>
      )}

      {alertas.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {alertas.map((a, i) => {
            const c = COLOR_SEVERIDAD[a.severidad] ?? COLOR_SEVERIDAD.baja;
            return (
              <div key={i} style={{
                padding: "9px 14px", background: c.fondo,
                display: "flex", gap: 8, alignItems: "flex-start",
                borderTop: i > 0 ? "1px solid rgba(0,0,0,0.04)" : "none",
              }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>{c.icono}</span>
                <p style={{ fontSize: 11.5, color: c.texto, lineHeight: 1.5 }}>{a.mensaje}</p>
              </div>
            );
          })}

          {sinConfirmar && editable && onConfirmar && (
            <div style={{ padding: "10px 14px", background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
              <button className="btn-ghost" style={{ fontSize: 12, padding: "7px 13px" }}
                onClick={() => onConfirmar(g.id)}>
                Revisé y confirmo estos datos
              </button>
            </div>
          )}
        </div>
      )}

      {abierto && (
        <div style={{ padding: "13px 14px", borderTop: "1px solid var(--border)", background: "var(--surface2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 11 }}>
            <Dato etiqueta="Subtotal" valor={soles(Number(g.subtotal ?? 0))} dudoso={dudosos.includes("subtotal")} />
            <Dato etiqueta="IGV" valor={soles(Number(g.igv ?? 0))} dudoso={dudosos.includes("igv")} />
            <Dato etiqueta="Total" valor={soles(Number(g.total ?? 0))} dudoso={dudosos.includes("total")} acento />
            <Dato etiqueta="Forma de pago" valor={g.forma_pago || "—"} />
          </div>
          {g.detalle && (
            <div style={{ marginTop: 11 }}>
              <p style={{ fontSize: 9.5, color: "var(--text3)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif" }}>
                Detalle
              </p>
              <p style={{ fontSize: 12.5, color: "var(--text)", marginTop: 3, lineHeight: 1.5 }}>{g.detalle}</p>
            </div>
          )}
          {dudosos.length > 0 && (
            <p style={{ marginTop: 11, fontSize: 11, color: "var(--warn)", lineHeight: 1.5 }}>
              La IA marcó como dudosos: <strong>{dudosos.join(", ")}</strong>. Verifica contra el papel.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
            {g.drive_url && (
              <a href={g.drive_url} target="_blank" rel="noreferrer" className="btn-ghost"
                style={{ fontSize: 12, padding: "7px 12px", textDecoration: "none" }}>
                Ver imagen ↗
              </a>
            )}
            {editable && onEliminar && (
              <button
                onClick={() => { if (confirm("¿Quitar este comprobante de la rendición?")) onEliminar(g.id); }}
                style={{
                  fontSize: 12, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
                  border: "1px solid rgba(220,38,38,0.2)", background: "var(--danger-bg)",
                  color: "var(--danger)", fontFamily: "var(--font-dm), sans-serif",
                }}
              >
                Quitar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Campo de motivo, solo cuando el revisor marca la casilla */}
      {revision?.observado && (
        <div style={{ padding: "11px 14px", borderTop: "1px solid var(--border)", background: "var(--danger-bg)" }}>
          <label className="fg-label" style={{ color: "var(--danger)" }}>Motivo de la observación</label>
          <input
            className="fg-input" value={revision.motivo}
            placeholder="Ej: el monto no coincide con el comprobante físico"
            onChange={e => revision.onCambio(true, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor, dudoso, acento }: {
  etiqueta: string; valor: string; dudoso?: boolean; acento?: boolean;
}) {
  return (
    <div>
      <p style={{
        fontSize: 9.5, color: "var(--text3)", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif",
      }}>
        {etiqueta}{dudoso && <span style={{ color: "var(--warn)" }}> ⚠</span>}
      </p>
      <p style={{
        fontSize: 13, marginTop: 2, fontWeight: acento ? 800 : 600,
        color: dudoso ? "var(--warn)" : acento ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-sora), sans-serif",
      }}>
        {valor}
      </p>
    </div>
  );
}
