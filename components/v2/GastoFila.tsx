"use client";
import { useState } from "react";
import { ordenarAlertas } from "@/lib/dominio/validaciones";
import { soles } from "./Encabezado";
import {
  IconoAlerta, IconoBasura, IconoBloqueo, IconoCheck,
  IconoChevron, IconoComentario, IconoEnlace, IconoIA,
} from "./Iconos";
import type { Alerta, Gasto } from "@/lib/dominio/tipos";

const NOMBRE_COMPROBANTE: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "Nota de crédito",
  "08": "Nota de débito", "12": "Ticket",
};

const SEVERIDAD: Record<string, { bg: string; bd: string; fg: string }> = {
  bloqueante: { bg: "var(--danger-bg)", bd: "var(--danger-borde)", fg: "var(--danger)" },
  alta:       { bg: "var(--warn-bg)",   bd: "var(--warn-borde)",   fg: "var(--warn)" },
  media:      { bg: "var(--warn-bg)",   bd: "var(--warn-borde)",   fg: "var(--warn)" },
  baja:       { bg: "var(--surface2)",  bd: "var(--border)",       fg: "var(--text2)" },
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
  editable?: boolean;
  onConfirmar?: (id: string) => void;
  onEliminar?: (id: string) => void;
  revision?: { observado: boolean; motivo: string; onCambio: (obs: boolean, motivo: string) => void };
}

export default function GastoFila({
  gasto: g, umbralConfianza, editable, onConfirmar, onEliminar, revision,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const alertas = ordenarAlertas((g.alertas ?? []) as Alerta[]);
  const bloqueante = alertas.some(a => a.severidad === "bloqueante");
  const sinConfirmar = alertas.length > 0 && !g.alertas_confirmadas && !bloqueante;
  const observado = g.estado === "OBSERVADO";

  const dudosos = Object.entries(g.confianza_extraccion ?? {})
    .filter(([, v]) => v < umbralConfianza)
    .map(([k]) => k);

  /**
   * Una franja de color a la izquierda: el estado del comprobante se
   * percibe recorriendo la lista, sin leer cada tarjeta.
   */
  const franja = bloqueante || observado ? "var(--danger)"
    : sinConfirmar ? "var(--warn)"
    : "transparent";

  return (
    <div className="tarjeta animate-fadein" style={{
      overflow: "hidden", position: "relative",
      borderColor: bloqueante || observado ? "var(--danger-borde)"
        : sinConfirmar ? "var(--warn-borde)" : "var(--border)",
    }}>
      {franja !== "transparent" && (
        <span style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
          background: franja,
        }} />
      )}

      <button
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        style={{
          width: "100%", padding: "14px 16px", cursor: "pointer",
          display: "flex", gap: 12, alignItems: "flex-start",
          background: "transparent", border: "none", textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        {revision && (
          <span
            role="checkbox"
            aria-checked={revision.observado}
            tabIndex={0}
            onClick={e => { e.stopPropagation(); revision.onCambio(!revision.observado, revision.motivo); }}
            onKeyDown={e => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault(); e.stopPropagation();
                revision.onCambio(!revision.observado, revision.motivo);
              }
            }}
            style={{
              width: 19, height: 19, borderRadius: 6, marginTop: 2, flexShrink: 0,
              border: `1.5px solid ${revision.observado ? "var(--danger)" : "var(--border2)"}`,
              background: revision.observado ? "var(--danger)" : "var(--surface)",
              color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all var(--rapido) var(--curva)",
            }}
          >
            {revision.observado && <IconoCheck size={12} />}
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span className="font-display" style={{
              fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.015em",
            }}>
              {g.proveedor_nombre || "Proveedor no leído"}
            </span>
            {bloqueante && (
              <span className="badge badge-error">
                <IconoBloqueo size={11} style={{ marginLeft: -1 }} />Duplicado
              </span>
            )}
            {observado && <span className="badge badge-error">Observado</span>}
            {sinConfirmar && (
              <span className="badge badge-warn">
                {alertas.length} alerta{alertas.length > 1 ? "s" : ""}
              </span>
            )}
            {g.alertas_confirmadas && alertas.length > 0 && !observado && (
              <span className="badge badge-ok">
                <IconoCheck size={11} style={{ marginLeft: -1 }} />Confirmado
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, lineHeight: 1.5 }}>
            {NOMBRE_COMPROBANTE[g.tipo_comprobante ?? ""] ?? g.tipo_comprobante ?? "—"}
            {g.serie && <> <span className="mono">{g.serie}-{g.numero}</span></>}
            {g.proveedor_ruc && <> · RUC <span className="mono">{g.proveedor_ruc}</span></>}
            {g.fecha_emision && ` · ${g.fecha_emision}`}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <p className="cifra cifra-m" style={{ color: "var(--text)" }}>
            {soles(Number(g.total ?? 0))}
          </p>
          <span style={{ color: "var(--text3)", display: "flex" }}>
            <IconoChevron size={17} abierto={abierto} />
          </span>
        </div>
      </button>

      {/* Observación: se ve siempre, esté abierta o no la tarjeta */}
      {g.observacion && (
        <div style={{
          padding: "11px 16px", background: "var(--danger-bg)",
          borderTop: "1px solid var(--danger-borde)", display: "flex", gap: 9,
        }}>
          <span style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }}>
            <IconoComentario size={15} />
          </span>
          <p style={{ fontSize: 12.5, color: "var(--danger)", lineHeight: 1.55 }}>
            <strong>Observado:</strong> {g.observacion}
          </p>
        </div>
      )}

      {alertas.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {alertas.map((a, i) => {
            const s = SEVERIDAD[a.severidad] ?? SEVERIDAD.baja;
            return (
              <div key={i} style={{
                padding: "10px 16px", background: s.bg,
                display: "flex", gap: 9, alignItems: "flex-start",
                borderTop: i > 0 ? `1px solid ${s.bd}` : "none",
              }}>
                <span style={{ color: s.fg, flexShrink: 0, marginTop: 1 }}>
                  {a.severidad === "bloqueante" ? <IconoBloqueo size={14} /> : <IconoAlerta size={14} />}
                </span>
                <p style={{ fontSize: 12.5, color: s.fg, lineHeight: 1.55 }}>{a.mensaje}</p>
              </div>
            );
          })}

          {sinConfirmar && editable && onConfirmar && (
            <div style={{
              padding: "12px 16px", background: "var(--surface2)",
              borderTop: "1px solid var(--border)",
            }}>
              <button className="btn-ghost" style={{ fontSize: 12.5, padding: "8px 14px" }}
                onClick={() => onConfirmar(g.id)}>
                <IconoCheck size={15} />
                Revisé y confirmo estos datos
              </button>
            </div>
          )}
        </div>
      )}

      {abierto && (
        <div style={{
          padding: "15px 16px", borderTop: "1px solid var(--border)",
          background: "var(--surface2)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14,
          }}>
            <Dato rotulo="Subtotal" valor={soles(Number(g.subtotal ?? 0))} dudoso={dudosos.includes("subtotal")} />
            <Dato rotulo="IGV" valor={soles(Number(g.igv ?? 0))} dudoso={dudosos.includes("igv")} />
            <Dato rotulo="Total" valor={soles(Number(g.total ?? 0))} dudoso={dudosos.includes("total")} acento />
            <Dato rotulo="Forma de pago" valor={g.forma_pago || "—"} />
          </div>

          {g.detalle && (
            <div style={{ marginTop: 14 }}>
              <p className="rotulo">Detalle</p>
              <p style={{ fontSize: 13, color: "var(--text)", marginTop: 4, lineHeight: 1.55 }}>
                {g.detalle}
              </p>
            </div>
          )}

          {dudosos.length > 0 && (
            <div style={{
              marginTop: 14, padding: "11px 13px", borderRadius: "var(--radio-s)",
              background: "var(--warn-bg)", border: "1px solid var(--warn-borde)",
              display: "flex", gap: 9, alignItems: "flex-start",
            }}>
              <span style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }}>
                <IconoIA size={15} />
              </span>
              <p style={{ fontSize: 12, color: "var(--warn)", lineHeight: 1.55 }}>
                La IA leyó con poca seguridad: <strong>{dudosos.join(", ")}</strong>.
                Verifica contra el papel antes de presentar.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 9, marginTop: 15, flexWrap: "wrap" }}>
            {g.drive_url && (
              <a href={g.drive_url} target="_blank" rel="noreferrer" className="btn-ghost"
                style={{ fontSize: 12.5, padding: "8px 13px", textDecoration: "none" }}>
                <IconoEnlace size={15} />
                Ver imagen
              </a>
            )}
            {editable && onEliminar && (
              <button
                className="btn-peligro"
                style={{ fontSize: 12.5, padding: "8px 13px" }}
                onClick={() => { if (confirm("¿Quitar este comprobante de la rendición?")) onEliminar(g.id); }}
              >
                <IconoBasura size={15} />
                Quitar
              </button>
            )}
          </div>
        </div>
      )}

      {revision?.observado && (
        <div style={{
          padding: "13px 16px", borderTop: "1px solid var(--danger-borde)",
          background: "var(--danger-bg)",
        }}>
          <label className="fg-label" style={{ color: "var(--danger)" }}>
            Motivo de la observación
          </label>
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

function Dato({ rotulo, valor, dudoso, acento }: {
  rotulo: string; valor: string; dudoso?: boolean; acento?: boolean;
}) {
  return (
    <div>
      <p className="rotulo" style={{ color: dudoso ? "var(--warn)" : "var(--text3)" }}>
        {rotulo}
        {dudoso && <IconoAlerta size={12} style={{ marginLeft: 4, verticalAlign: "-1px" }} />}
      </p>
      <p className="cifra" style={{
        fontSize: 14, marginTop: 3,
        fontWeight: acento ? 800 : 700,
        color: dudoso ? "var(--warn)" : acento ? "var(--accent-texto)" : "var(--text)",
      }}>
        {valor}
      </p>
    </div>
  );
}
