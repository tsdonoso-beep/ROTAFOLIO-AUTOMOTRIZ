"use client";
import { useState } from "react";
import { Proyecto } from "@/lib/types";
import { newProyecto } from "@/lib/proyectos";

interface Props { onCrear: (p: Proyecto) => void; onCerrar: () => void }

export default function ProyectoModal({ onCrear, onCerrar }: Props) {
  const [nombre, setNombre] = useState("");
  const [centro, setCentro] = useState("");
  const [caja, setCaja] = useState("");

  const crear = () => {
    if (!nombre.trim() || !centro.trim() || !caja.trim()) {
      alert("Completa todos los campos.");
      return;
    }
    onCrear(newProyecto(nombre.trim(), centro.trim(), caja.trim()));
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div
        className="animate-fadein"
        style={{
          width: "100%", maxWidth: "440px",
          background: "var(--surface2)",
          border: "1px solid var(--border2)",
          borderRadius: "24px",
          padding: "28px",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Icon + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "16px",
            background: "var(--accent-dim)",
            border: "1px solid rgba(16,223,160,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "22px",
          }}>
            📁
          </div>
          <div>
            <h2 className="font-display" style={{ fontSize: "18px", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
              Nuevo Proyecto
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text2)", marginTop: "2px" }}>
              Define el centro de costos y caja
            </p>
          </div>
          <button
            onClick={onCerrar}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label className="fg-label">Nombre del Proyecto</label>
            <input className="fg-input" value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Taller Norte — Marzo" autoFocus />
          </div>
          <div>
            <label className="fg-label">Centro de Costos</label>
            <input className="fg-input" value={centro} onChange={e => setCentro(e.target.value)}
              placeholder="Ej: TALLER-01" />
          </div>
          <div>
            <label className="fg-label">N° Caja / Memo</label>
            <input className="fg-input" value={caja} onChange={e => setCaja(e.target.value)}
              placeholder="Ej: CAJA-2026-03"
              onKeyDown={e => e.key === "Enter" && crear()} />
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button className="btn-ghost" onClick={onCerrar} style={{ flex: 1 }}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={crear} style={{ flex: 2 }}>
            Crear Proyecto
          </button>
        </div>
      </div>
    </div>
  );
}
