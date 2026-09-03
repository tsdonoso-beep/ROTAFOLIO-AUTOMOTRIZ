"use client";
import { useEffect, useRef, useState } from "react";
import { clearApiKey, getApiKey, maskApiKey, pareceKeyValida, setApiKey } from "@/lib/apikey";
import { testConexion } from "@/lib/gemini";

export default function ApiKeyConfig({ onChange }: { onChange?: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = getApiKey();
    setSaved(k);
    setInput(k);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const guardar = () => {
    const val = input.trim();
    if (!val) return;
    if (!pareceKeyValida(val) && !confirm("La key no empieza con 'AIza'. ¿Guardar igual?")) return;
    setApiKey(val);
    setSaved(val);
    setMsg(null);
    onChange?.(val);
    setOpen(false);
  };

  const borrar = () => {
    clearApiKey();
    setSaved("");
    setInput("");
    setMsg(null);
    onChange?.("");
  };

  const probar = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await testConexion(input.trim());
      setMsg(r.ok ? { ok: true, texto: `Conexión OK — ${r.modelo}` } : { ok: false, texto: r.error ?? "Error" });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "7px",
          padding: "7px 13px",
          borderRadius: "8px",
          border: `1px solid ${saved ? "rgba(4,95,108,0.25)" : "rgba(180,83,9,0.25)"}`,
          background: saved ? "rgba(4,95,108,0.06)" : "rgba(180,83,9,0.06)",
          color: saved ? "var(--accent)" : "var(--warn)",
          fontSize: "12px",
          fontWeight: 600,
          fontFamily: "var(--font-sora), sans-serif",
          cursor: "pointer",
          transition: "all 0.2s",
          letterSpacing: "-0.01em",
        }}
      >
        <span style={{ fontSize: "14px" }}>{saved ? "🔑" : "⚠"}</span>
        <span className="hidden sm:inline">{saved ? maskApiKey(saved) : "API Key"}</span>
      </button>

      {open && (
        <div
          className="animate-fadein"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            zIndex: 50,
            width: "320px",
            background: "#FFFFFF",
            border: "1px solid var(--border2)",
            borderRadius: "14px",
            padding: "20px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          <p className="font-display" style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px", color: "var(--text)" }}>
            Gemini API Key
          </p>
          <p style={{ fontSize: "12px", color: "var(--text2)", marginBottom: "16px", lineHeight: 1.5 }}>
            Tu clave personal de <strong style={{ color: "var(--text)" }}>aistudio.google.com</strong>. Solo se guarda en este navegador.
          </p>
          <input
            type="password"
            className="fg-input"
            placeholder="AIza..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardar()}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={guardar} style={{ flex: 1 }}>
              Guardar
            </button>
            <button className="btn-ghost" onClick={probar} disabled={testing || !input.trim()}>
              {testing ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="animate-spin" style={{ display: "inline-block", width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} />
                  Probando
                </span>
              ) : "Probar"}
            </button>
            {saved && (
              <button
                onClick={borrar}
                style={{ background: "transparent", border: "none", color: "var(--danger)", fontSize: "13px", cursor: "pointer", padding: "10px 8px" }}
              >
                Borrar
              </button>
            )}
          </div>
          {msg && (
            <p style={{ marginTop: "10px", fontSize: "12px", color: msg.ok ? "var(--accent)" : "var(--danger)", display: "flex", alignItems: "center", gap: "5px" }}>
              {msg.ok ? "✓" : "✕"} {msg.texto}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
