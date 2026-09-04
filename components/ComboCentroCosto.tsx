"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CENTROS_COSTOS, filtrarCentros, normalizar } from "@/lib/centros-costos";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

/**
 * Buscador desplegable de centros de costos. Filtra el catálogo mientras se
 * escribe, pero admite texto libre para no bloquear un centro que aún no esté
 * en la lista — solo lo advierte.
 */
export default function ComboCentroCosto({ value, onChange, placeholder }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const opciones = useMemo(() => filtrarCentros(value), [value]);
  const enCatalogo = useMemo(
    () => CENTROS_COSTOS.some(c => normalizar(c) === normalizar(value)),
    [value]
  );

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    if (abierto) document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (!abierto && (e.key === "ArrowDown" || e.key === "Enter")) {
      setAbierto(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado(i => Math.min(i + 1, opciones.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && opciones[resaltado]) {
      e.preventDefault();
      elegir(opciones[resaltado]);
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          className="fg-input"
          style={{ paddingRight: 34 }}
          value={value}
          placeholder={placeholder ?? "Busca o escribe el centro de costos"}
          onChange={e => { onChange(e.target.value); setAbierto(true); setResaltado(0); }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclas}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setAbierto(v => !v)}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text3)", fontSize: "11px", padding: 4, lineHeight: 1,
          }}
        >
          {abierto ? "▲" : "▼"}
        </button>
      </div>

      {value.trim() && !enCatalogo && !abierto && (
        <p style={{ marginTop: 6, fontSize: "11px", color: "var(--warn)", lineHeight: 1.45 }}>
          No está en el catálogo. Se creará una carpeta nueva en Drive con este nombre.
        </p>
      )}

      {abierto && (
        <div
          className="animate-fadein"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            zIndex: 60, maxHeight: 210, overflowY: "auto",
            background: "#FFFFFF",
            border: "1px solid var(--border2)",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 4,
          }}
        >
          {opciones.length === 0 ? (
            <p style={{ padding: "10px 12px", fontSize: "12px", color: "var(--text3)", lineHeight: 1.5 }}>
              Sin coincidencias. Puedes escribirlo tal cual y se usará igual.
            </p>
          ) : (
            opciones.map((c, i) => {
              const activo = i === resaltado;
              const elegida = normalizar(c) === normalizar(value);
              return (
                <button
                  key={c}
                  type="button"
                  onMouseEnter={() => setResaltado(i)}
                  onClick={() => elegir(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "9px 11px", textAlign: "left", cursor: "pointer",
                    borderRadius: "7px", border: "none",
                    background: activo ? "var(--surface2)" : "transparent",
                    color: "var(--text)", fontSize: "13px",
                    fontFamily: "var(--font-dm), sans-serif",
                  }}
                >
                  <span style={{ flex: 1 }}>{c}</span>
                  {elegida && <span style={{ color: "var(--accent)", fontSize: "13px" }}>✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
