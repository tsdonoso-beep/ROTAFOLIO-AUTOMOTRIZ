"use client";
import { useMemo, useState } from "react";
import { Proyecto } from "@/lib/types";
import { buscarDuplicado, newProyecto } from "@/lib/proyectos";
import { nombreSugerido } from "@/lib/centros-costos";
import ComboCentroCosto from "./ComboCentroCosto";

interface Props { onCrear: (p: Proyecto) => void; onCerrar: () => void }

export default function ProyectoModal({ onCrear, onCerrar }: Props) {
  const [centro, setCentro] = useState("");
  const [caja, setCaja] = useState("");
  // Vacío = usar el nombre sugerido. Solo se llena si el usuario lo edita.
  const [nombreManual, setNombreManual] = useState("");

  const sugerido = useMemo(() => nombreSugerido(centro, caja), [centro, caja]);
  const nombreFinal = nombreManual.trim() || sugerido;

  const duplicado = useMemo(
    () => (centro.trim() && caja.trim() ? buscarDuplicado(centro, caja) : undefined),
    [centro, caja]
  );

  const listo = centro.trim() && caja.trim();

  const crear = () => {
    if (!listo) return;
    onCrear(newProyecto(nombreFinal, centro, caja));
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        background: "rgba(15,25,35,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div
        className="animate-fadein"
        style={{
          width: "100%", maxWidth: "460px",
          background: "#FFFFFF",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "28px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "12px",
            background: "rgba(4,95,108,0.08)",
            border: "1px solid rgba(4,95,108,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px",
          }}>
            📁
          </div>
          <div>
            <h2 className="font-display" style={{ fontSize: "17px", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
              Nuevo Proyecto
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text2)", marginTop: "2px" }}>
              El centro de costos y la caja lo identifican
            </p>
          </div>
          <button
            onClick={onCerrar}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label className="fg-label">Centro de Costos</label>
            <ComboCentroCosto value={centro} onChange={setCentro} />
          </div>

          <div>
            <label className="fg-label">N° Caja / Memo</label>
            <input className="fg-input" value={caja} onChange={e => setCaja(e.target.value)}
              placeholder="Ej: CAJA-2026-03"
              onKeyDown={e => e.key === "Enter" && crear()} />
          </div>

          {/* El nombre se arma solo; queda editable por si se quiere otro. */}
          <div>
            <label className="fg-label">Nombre del Proyecto (opcional)</label>
            <input
              className="fg-input"
              value={nombreManual}
              onChange={e => setNombreManual(e.target.value)}
              placeholder={sugerido || "Se completa con el centro de costos y la caja"}
              onKeyDown={e => e.key === "Enter" && crear()}
            />
            {!nombreManual.trim() && sugerido && (
              <p style={{ marginTop: 6, fontSize: "11px", color: "var(--text3)", lineHeight: 1.45 }}>
                Se guardará como <strong style={{ color: "var(--text2)" }}>{sugerido}</strong>
              </p>
            )}
          </div>
        </div>

        {duplicado && (
          <div style={{
            marginTop: 16, padding: "12px 14px",
            background: "var(--warn-bg)",
            border: "1px solid rgba(180,83,9,0.2)",
            borderRadius: "9px",
            display: "flex", gap: 9, alignItems: "flex-start",
          }}>
            <span style={{ fontSize: "14px", flexShrink: 0 }}>ℹ️</span>
            <p style={{ fontSize: "12px", color: "var(--warn)", lineHeight: 1.55 }}>
              Ya existe <strong>{duplicado.nombre}</strong> con este centro de costos
              y caja. Al continuar se usará ese proyecto y los comprobantes se
              acumularán ahí, en vez de crear uno duplicado.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button className="btn-ghost" onClick={onCerrar} style={{ flex: 1 }}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={crear} disabled={!listo}
            style={{ flex: 2, justifyContent: "center" }}>
            {duplicado ? "Usar proyecto existente" : "Crear Proyecto"}
          </button>
        </div>
      </div>
    </div>
  );
}
