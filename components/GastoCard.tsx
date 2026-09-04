"use client";
import { useState } from "react";
import { GastoItem } from "@/lib/types";

interface Props {
  item: GastoItem;
  onChange: (id: string, patch: Partial<GastoItem>) => void;
  onProcesar: (id: string) => void;
  onRegistrar: (id: string) => void;
  onEliminar: (id: string) => void;
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

export default function GastoCard({ item, onChange, onProcesar, onRegistrar, onEliminar }: Props) {
  const [expanded, setExpanded] = useState(true);
  const e = item.extraido;
  const isImg = item.mimeType.startsWith("image/");
  // Una vez en la planilla el gasto queda cerrado: no se edita más.
  const cerrado = !!item.registrado;

  return (
    <div
      className="animate-fadein"
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        transition: "box-shadow 0.2s",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "12px 14px",
        borderBottom: expanded || item.error ? "1px solid var(--border)" : "none",
        background: "var(--surface2)",
      }}>
        {/* File icon */}
        <div style={{
          width: 36, height: 36, borderRadius: "9px",
          background: isImg ? "rgba(4,95,108,0.08)" : "rgba(99,102,241,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "16px", flexShrink: 0,
          border: `1px solid ${isImg ? "rgba(4,95,108,0.15)" : "rgba(99,102,241,0.15)"}`,
        }}>
          {isImg ? "🖼" : "📄"}
        </div>

        {/* Name + size */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sora), sans-serif" }}>
            {item.nombre}
          </p>
          <p style={{ fontSize: "11px", color: "var(--text3)", marginTop: "1px" }}>{item.tamanoKB} KB</p>
        </div>

        {/* Status + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", flexShrink: 0 }}>
          {item.procesando && (
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--accent)" }}>
              <span className="animate-spin" style={{ display: "inline-block", width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} />
              <span className="hidden sm:inline">Procesando</span>
            </span>
          )}
          {item.registrando && (
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--accent)" }}>
              <span className="animate-spin" style={{ display: "inline-block", width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} />
              <span className="hidden sm:inline">Registrando</span>
            </span>
          )}
          {cerrado && <span className="badge badge-ok">🔒 Registrado</span>}
          {item.error && <span className="badge badge-error">Error</span>}
          {item.procesado && !item.error && !cerrado && <span className="badge badge-ok">✓ Extraído</span>}
          {item.error && !item.procesando && (
            <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => onProcesar(item.id)}>
              Reintentar
            </button>
          )}
          {item.drive_url && (
            <a href={item.drive_url} target="_blank" rel="noreferrer"
              style={{
                fontSize: "12px", color: "var(--accent)", padding: "4px 9px",
                borderRadius: "7px", border: "1px solid rgba(4,95,108,0.2)",
                background: "rgba(4,95,108,0.06)", textDecoration: "none", fontWeight: 600,
              }}>
              Drive ↗
            </a>
          )}
          {!item.procesado && !item.procesando && !item.error && (
            <button className="btn-primary" style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => onProcesar(item.id)}>
              IA ✦
            </button>
          )}
          {item.procesado && !cerrado && !item.registrando && (
            <button className="btn-primary" style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => onRegistrar(item.id)}>
              Registrar
            </button>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: "none", border: "none", color: "var(--text3)", fontSize: "16px", cursor: "pointer", lineHeight: 1, padding: "4px" }}
          >
            {expanded ? "⌃" : "⌄"}
          </button>
          <button
            onClick={() => {
              if (cerrado && !confirm("Este gasto ya está en la planilla. Quitarlo de la pantalla no borra esa fila. ¿Continuar?")) return;
              onEliminar(item.id);
            }}
            style={{ background: "none", border: "none", color: "var(--text3)", fontSize: "18px", cursor: "pointer", lineHeight: 1, padding: "4px", transition: "color 0.2s" }}
            onMouseOver={e2 => (e2.currentTarget.style.color = "var(--danger)")}
            onMouseOut={e2 => (e2.currentTarget.style.color = "var(--text3)")}
          >×</button>
        </div>
      </div>

      {/* Sello de registro */}
      {item.registrado && (
        <div style={{
          padding: "9px 14px",
          background: "var(--success-bg)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "12px" }}>🔒</span>
          <p style={{ fontSize: "11.5px", color: "var(--success)", fontWeight: 600 }}>
            Registrado por {item.registrado.usuario_nombre}
          </p>
          <span style={{ fontSize: "11px", color: "var(--text3)" }}>
            · {fechaCorta(item.registrado.fecha)}
          </span>
        </div>
      )}

      {/* Fallo al subir la imagen a Drive */}
      {item.error_drive && !item.drive_url && (
        <div style={{
          padding: "11px 14px",
          background: "var(--warn-bg)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", gap: "8px",
        }}>
          <span style={{ fontSize: "13px", lineHeight: 1.4, flexShrink: 0 }}>📎</span>
          <p style={{ fontSize: "12px", color: "var(--warn)", lineHeight: 1.5, fontWeight: 500 }}>
            La imagen no se subió a Drive: {item.error_drive} — la fila del
            registro quedará sin enlace. Usa «Reintentar» para volver a subirla.
          </p>
        </div>
      )}

      {/* Error de registro */}
      {item.error_registro && (
        <div style={{
          padding: "11px 14px",
          background: "var(--danger-bg)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", gap: "8px",
        }}>
          <span style={{ fontSize: "13px", lineHeight: 1.4, flexShrink: 0 }}>📋</span>
          <p style={{ fontSize: "12px", color: "var(--danger)", lineHeight: 1.5, fontWeight: 500 }}>
            No se pudo registrar: {item.error_registro}
          </p>
        </div>
      )}

      {/* Error message — siempre visible, aunque la tarjeta esté colapsada */}
      {item.error && (
        <div style={{
          padding: "11px 14px",
          background: "var(--danger-bg)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", gap: "8px",
        }}>
          <span style={{ fontSize: "13px", lineHeight: 1.4, flexShrink: 0 }}>⚠️</span>
          <p style={{ fontSize: "12px", color: "var(--danger)", lineHeight: 1.5, fontWeight: 500 }}>
            {item.error}
          </p>
        </div>
      )}

      {expanded && (
        <>
          {/* AI extracted data */}
          {e && (
            <div style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
              background: "rgba(4,95,108,0.03)",
            }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.09em", color: "var(--accent)", textTransform: "uppercase", marginBottom: "12px", fontFamily: "var(--font-sora), sans-serif" }}>
                ✦ Datos extraídos por IA
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <AIRow label="Proveedor" value={e.proveedor} />
                <AIRow label="Tipo" value={e.tipo_comprobante} />
                <AIRow label="N° Comprobante" value={e.numero_comprobante} />
                <AIRow label="Fecha" value={e.fecha_comprobante} />
                <AIRow label="Forma de pago" value={e.forma_pago} />
                <AIRow label="Total" value={`${e.moneda === "USD" ? "$" : "S/"} ${e.monto_total?.toFixed(2)}`} accent />
                <div style={{ gridColumn: "1 / -1" }}>
                  <AIRow label="Detalle" value={e.detalle} />
                </div>
              </div>
            </div>
          )}

          {/* Manual fields */}
          <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="N° Solicitud" value={item.numero_solicitud} readOnly={cerrado}
              onChange={v => onChange(item.id, { numero_solicitud: v })} />
            <Field label="Fecha Solicitud" value={item.fecha_solicitud} type="date" readOnly={cerrado}
              onChange={v => onChange(item.id, { fecha_solicitud: v })} />
            <Field label="Empresa" value={item.empresa} readOnly={cerrado}
              onChange={v => onChange(item.id, { empresa: v })} />
            <Field label="Responsable" value={item.responsable} readOnly={cerrado}
              onChange={v => onChange(item.id, { responsable: v })} />
            <Field label="Área / Proyecto" value={item.area_proyecto} readOnly={cerrado}
              onChange={v => onChange(item.id, { area_proyecto: v })} />
            <Field label="Solicitante" value={item.solicitante} readOnly={cerrado}
              onChange={v => onChange(item.id, { solicitante: v })} />
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="fg-label">Descripción / Motivo del Gasto</label>
              <textarea
                className="fg-input"
                style={{ resize: "none", minHeight: "72px", opacity: cerrado ? 0.65 : 1 }}
                rows={2}
                readOnly={cerrado}
                value={item.motivo}
                onChange={(ev) => onChange(item.id, { motivo: ev.target.value })}
              />
            </div>
            <div>
              <label className="fg-label">Estado</label>
              <select className="fg-input" value={item.estado} disabled={cerrado}
                style={{ opacity: cerrado ? 0.65 : 1 }}
                onChange={(ev) => onChange(item.id, { estado: ev.target.value as GastoItem["estado"] })}>
                <option value="PENDIENTE">Pendiente</option>
                <option value="PAGADO">Pagado</option>
                <option value="ANULADO">Anulado</option>
              </select>
            </div>
            {cerrado && (
              <p style={{ gridColumn: "1 / -1", fontSize: "11px", color: "var(--text3)", lineHeight: 1.5 }}>
                Los campos quedaron bloqueados al registrarse en la planilla. Para
                corregir algo, edítalo directamente en la hoja de cálculo.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AIRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: "10px", color: "var(--text3)", marginBottom: "2px", fontFamily: "var(--font-sora), sans-serif", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ fontSize: "13px", fontWeight: accent ? 700 : 500, color: accent ? "var(--accent)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value || "—"}
      </p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", readOnly }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; readOnly?: boolean;
}) {
  return (
    <div>
      <label className="fg-label">{label}</label>
      <input type={type} className="fg-input" value={value} readOnly={readOnly}
        style={{ opacity: readOnly ? 0.65 : 1 }}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
