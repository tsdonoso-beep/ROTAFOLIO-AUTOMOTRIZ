"use client";
import { useState } from "react";
import { Usuario } from "@/lib/types";
import { USUARIOS, iniciarSesion, verificarPin } from "@/lib/usuarios";
import Logo from "./Logo";

export default function LoginGate({ onEntrar }: { onEntrar: (u: Usuario) => void }) {
  const [elegido, setElegido] = useState<Usuario | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const entrar = () => {
    if (!elegido) return;
    if (!verificarPin(pin)) {
      setError("Clave incorrecta.");
      setPin("");
      return;
    }
    iniciarSesion(elegido);
    onEntrar(elegido);
  };

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div className="animate-fadein" style={{
        width: "100%", maxWidth: 400,
        background: "#FFFFFF",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        padding: "32px 28px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo height={26} />
        </div>

        <p className="font-display" style={{
          fontSize: "17px", fontWeight: 800, color: "var(--text)",
          letterSpacing: "-0.02em", textAlign: "center", marginBottom: 4,
        }}>
          Rendición de Gastos
        </p>
        <p style={{
          fontSize: "13px", color: "var(--text2)", textAlign: "center",
          marginBottom: 26, lineHeight: 1.5,
        }}>
          Identifícate para que cada comprobante<br />quede registrado a tu nombre.
        </p>

        {/* Selección de usuario */}
        <label className="fg-label">¿Quién registra?</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {USUARIOS.map(u => {
            const activo = elegido?.id === u.id;
            return (
              <button
                key={u.id}
                onClick={() => { setElegido(u); setError(""); }}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                  border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                  background: activo ? "rgba(4,95,108,0.06)" : "#FFFFFF",
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  background: activo ? "var(--accent)" : "var(--surface2)",
                  color: activo ? "#FFFFFF" : "var(--text2)",
                  fontSize: "12px", fontWeight: 700,
                  fontFamily: "var(--font-sora), sans-serif",
                  border: activo ? "none" : "1px solid var(--border2)",
                }}>
                  {u.iniciales}
                </span>
                <span style={{
                  fontSize: "14px", fontWeight: 600,
                  color: activo ? "var(--text)" : "var(--text2)",
                  fontFamily: "var(--font-sora), sans-serif",
                }}>
                  {u.nombre}
                </span>
                {activo && (
                  <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: "15px" }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        {/* PIN */}
        <label className="fg-label">Clave</label>
        <input
          className="fg-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="••••"
          value={pin}
          disabled={!elegido}
          onChange={e => { setPin(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && entrar()}
          style={{
            textAlign: "center", letterSpacing: "0.5em", fontSize: "18px",
            opacity: elegido ? 1 : 0.5,
          }}
        />

        {error && (
          <p style={{ marginTop: 10, fontSize: "12px", color: "var(--danger)", textAlign: "center" }}>
            {error}
          </p>
        )}

        <button
          className="btn-primary"
          onClick={entrar}
          disabled={!elegido || !pin}
          style={{ width: "100%", justifyContent: "center", marginTop: 18, padding: "12px" }}
        >
          Entrar
        </button>
      </div>
    </div>
  );
}
