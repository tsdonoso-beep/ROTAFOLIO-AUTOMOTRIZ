"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buscar, type Resultado, type TipoResultado } from "@/app/acciones/buscar";

const ETIQUETA: Record<TipoResultado, string> = {
  memo: "Memo", persona: "Persona", gasto: "Comprobante", pedido: "Pedido",
};

/**
 * El buscador global.
 *
 * Era el pedido más repetido y no existía ninguno: para encontrar un memo
 * había que recorrer la lista. Busca por lo que la gente recuerda de memoria
 * —un nombre, el número del memo, el RUC del proveedor, la serie de un
 * comprobante— y no por cómo está organizada la base.
 */
export default function Buscador() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [respuesta, setFilas] = useState<{ q: string; r: Resultado[] }>({ q: "", r: [] });
  const [cursor, setCursor] = useState(0);
  // Sólo valen las filas de la consulta que se está escribiendo.
  const filas = respuesta.q === q ? respuesta.r : [];
  const caja = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K desde cualquier parte: quien busca mucho no quiere apuntar
  // con el ratón cada vez.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        campo.current?.focus();
        setAbierto(true);
      }
      if (e.key === "Escape") { setAbierto(false); campo.current?.blur(); }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  // Se espera a que deje de teclear: una consulta por pulsación sería una
  // consulta a la base por letra. El resultado se guarda junto a la consulta
  // que lo produjo, para que nunca se muestren las filas de una búsqueda
  // anterior mientras la nueva viaja.
  useEffect(() => {
    const t = setTimeout(() => {
      iniciar(async () => {
        const r = q.trim().length < 3 ? [] : await buscar(q);
        setFilas({ q, r });
        setCursor(0);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const ir = (r: Resultado) => {
    setAbierto(false);
    setQ("");
    router.push(r.ruta);
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (!filas.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => (c + 1) % filas.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => (c - 1 + filas.length) % filas.length); }
    if (e.key === "Enter") { e.preventDefault(); ir(filas[cursor]); }
  };

  return (
    <div ref={caja} style={{ position: "relative", flex: 1, maxWidth: 420, minWidth: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "8px 13px",
        borderRadius: 999, background: "var(--surface2)",
        border: `1px solid ${abierto ? "var(--accent-borde)" : "var(--border)"}`,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)"
          strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
        </svg>
        <input
          id="buscador-global"
          ref={campo}
          value={q}
          onChange={e => { setQ(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclas}
          placeholder="Buscar persona, memo, RUC, serie…"
          aria-label="Buscar en toda la aplicación"
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent",
            outline: "none", fontSize: 13, color: "var(--text)",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        />
        <span className="mono hidden sm:inline" style={{
          fontSize: 10.5, color: "var(--text3)", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px",
        }}>
          ⌘K
        </span>
      </div>

      {abierto && q.trim().length >= 3 && (
        <div style={{
          position: "absolute", top: "calc(100% + 7px)", left: 0, right: 0, zIndex: 60,
          background: "var(--surface)", border: "1px solid var(--border2)",
          borderRadius: "var(--radio)", boxShadow: "var(--sombra3)",
          overflow: "hidden", maxHeight: 400, overflowY: "auto",
        }}>
          {pendiente && filas.length === 0 ? (
            <p style={{ padding: "14px 15px", fontSize: 12.5, color: "var(--text3)" }}>
              Buscando…
            </p>
          ) : filas.length === 0 ? (
            <p style={{ padding: "14px 15px", fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5 }}>
              Nada con «{q}». Prueba con el número del memo, un RUC o la serie
              del comprobante.
            </p>
          ) : (
            filas.map((r, i) => (
              <button key={`${r.tipo}-${r.id}`} onClick={() => ir(r)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 11, width: "100%",
                  padding: "10px 14px", border: "none", cursor: "pointer",
                  textAlign: "left", borderBottom: "1px solid var(--border)",
                  background: i === cursor ? "var(--accent-suave)" : "transparent",
                }}>
                <span className="badge badge-neutro" style={{ flexShrink: 0 }}>
                  {ETIQUETA[r.tipo]}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={r.tipo === "memo" ? "mono" : "font-display"} style={{
                    display: "block", fontSize: r.tipo === "memo" ? 12 : 13,
                    fontWeight: 600, color: "var(--text)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.titulo}
                  </span>
                  {r.detalle && (
                    <span style={{
                      display: "block", fontSize: 11.5, color: "var(--text3)", marginTop: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.detalle}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
