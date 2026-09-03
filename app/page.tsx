"use client";
import { useCallback, useEffect, useState } from "react";
import ApiKeyConfig from "@/components/ApiKeyConfig";
import UploadZone from "@/components/UploadZone";
import GastoCard from "@/components/GastoCard";
import TablaResumen from "@/components/TablaResumen";
import ProyectoModal from "@/components/ProyectoModal";
import { GastoItem, Proyecto } from "@/lib/types";
import { getApiKey } from "@/lib/apikey";
import { extraerComprobante } from "@/lib/gemini";
import { subirADrive } from "@/lib/drive";
import { deleteProyecto, getProyectos, saveProyecto } from "@/lib/proyectos";

export default function Home() {
  const [apiKey, setApiKey]             = useState("");
  const [items, setItems]               = useState<GastoItem[]>([]);
  const [proyectos, setProyectos]       = useState<Proyecto[]>([]);
  const [proyectoActual, setProyectoActual] = useState<Proyecto | null>(null);
  const [showModal, setShowModal]       = useState(false);
  const [tab, setTab]                   = useState<"gastos" | "resumen">("gastos");

  useEffect(() => {
    setApiKey(getApiKey());
    const ps = getProyectos();
    setProyectos(ps);
    if (ps.length) setProyectoActual(ps[0]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<GastoItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }, []);

  const eliminarItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const agregarItems = useCallback((nuevos: GastoItem[]) => {
    setItems(prev => [...prev, ...nuevos]);
  }, []);

  const procesarItem = useCallback(async (id: string) => {
    if (!apiKey) {
      alert("Primero configura tu Gemini API Key (botón arriba a la derecha).");
      return;
    }
    const item = items.find(i => i.id === id);
    if (!item) return;
    updateItem(id, { procesando: true, error: undefined });
    try {
      const { extraido } = await extraerComprobante(item.base64, item.mimeType, apiKey);
      let drive_url: string | undefined;
      if (proyectoActual) {
        try {
          const ext = item.nombre.split(".").pop() ?? "jpg";
          const fileName = `${extraido.proveedor || item.nombre}_${Date.now()}.${ext}`.replace(/\s+/g, "_");
          const result = await subirADrive({ base64: item.base64, mimeType: item.mimeType, fileName, centroCostos: proyectoActual.centro_costos, caja: proyectoActual.caja });
          drive_url = result.url;
        } catch { /* Drive error no bloquea */ }
      }
      updateItem(id, {
        procesado: true, procesando: false, extraido, drive_url,
        empresa: items.find(i => i.id === id)?.empresa || extraido.proveedor,
        motivo: items.find(i => i.id === id)?.motivo || extraido.detalle,
      });
    } catch (e) {
      updateItem(id, { procesando: false, error: (e as Error).message });
    }
  }, [apiKey, items, proyectoActual, updateItem]);

  const procesarTodos = async () => {
    const pendientes = items.filter(i => !i.procesado && !i.procesando);
    for (const item of pendientes) await procesarItem(item.id);
  };

  const crearProyecto = (p: Proyecto) => {
    saveProyecto(p);
    setProyectos(getProyectos());
    setProyectoActual(p);
    setShowModal(false);
  };

  const eliminarProyecto = (id: string) => {
    if (!confirm("¿Eliminar este proyecto?")) return;
    deleteProyecto(id);
    const ps = getProyectos();
    setProyectos(ps);
    setProyectoActual(ps[0] ?? null);
  };

  const pendientesCount  = items.filter(i => !i.procesado && !i.procesando).length;
  const procesadosCount  = items.filter(i => i.procesado).length;
  const totalSoles       = items.filter(i => i.procesado).reduce((s, i) => s + (i.extraido?.monto_total ?? 0), 0);

  return (
    <div style={{ minHeight: "100dvh" }}>
      {/* ═══ HEADER ═══ */}
      <header style={{
        position: "sticky", top: 0, zIndex: 30,
        background: "rgba(10,11,15,0.85)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{
          maxWidth: 900, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", gap: 16,
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: "12px",
              background: "linear-gradient(135deg, var(--accent) 0%, #0FBFB0 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "18px", flexShrink: 0,
              boxShadow: "0 4px 16px rgba(16,223,160,0.3)",
            }}>
              📸
            </div>
            <div>
              <p className="font-display" style={{ fontSize: "15px", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                FOTO-GRAMA
              </p>
              <p style={{ fontSize: "10px", color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "2px" }}>
                Rendición Automotriz
              </p>
            </div>
          </div>
          <ApiKeyConfig onChange={setApiKey} />
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 100px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ═══ STAT CARDS ═══ */}
        {items.length > 0 && (
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "Archivos", value: items.length, icon: "📁" },
              { label: "Procesados", value: procesadosCount, icon: "✦", accent: true },
              { label: "Total S/", value: totalSoles > 0 ? `${totalSoles.toFixed(2)}` : "—", icon: "💰", accent: totalSoles > 0 },
            ].map((s) => (
              <div key={s.label} className="animate-fadein" style={{
                background: "var(--surface)",
                border: `1px solid ${s.accent ? "rgba(16,223,160,0.2)" : "var(--border)"}`,
                borderRadius: "16px",
                padding: "14px",
                textAlign: "center",
              }}>
                <p style={{ fontSize: "18px", marginBottom: "4px" }}>{s.icon}</p>
                <p className="font-display" style={{ fontSize: "18px", fontWeight: 800, color: s.accent ? "var(--accent)" : "var(--text)", letterSpacing: "-0.02em" }}>
                  {s.value}
                </p>
                <p style={{ fontSize: "10px", color: "var(--text3)", marginTop: "2px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif" }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ═══ PROYECTO SELECTOR ═══ */}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          padding: "16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sora), sans-serif", whiteSpace: "nowrap" }}>
                Proyecto activo
              </p>
              {proyectos.length > 0 ? (
                <select
                  className="fg-input"
                  style={{ maxWidth: 280, padding: "8px 12px", fontSize: "13px", flex: 1 }}
                  value={proyectoActual?.id ?? ""}
                  onChange={e => setProyectoActual(proyectos.find(p => p.id === e.target.value) ?? null)}
                >
                  {proyectos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} — {p.centro_costos} / {p.caja}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: "13px", color: "var(--text3)" }}>Sin proyectos creados</span>
              )}
              {proyectoActual && (
                <button
                  onClick={() => eliminarProyecto(proyectoActual.id)}
                  style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", cursor: "pointer", opacity: 0.6, padding: "4px" }}
                >
                  Eliminar
                </button>
              )}
            </div>
            <button className="btn-primary" onClick={() => setShowModal(true)}
              style={{ whiteSpace: "nowrap", padding: "9px 16px", fontSize: "13px" }}>
              + Nuevo
            </button>
          </div>
          {proyectoActual && (
            <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: "11px", color: "var(--text3)" }}>
                📁 <span style={{ color: "var(--text2)" }}>{proyectoActual.centro_costos}</span>
              </span>
              <span style={{ fontSize: "11px", color: "var(--text3)" }}>
                🗂 <span style={{ color: "var(--text2)" }}>{proyectoActual.caja}</span>
              </span>
            </div>
          )}
        </div>

        {/* ═══ UPLOAD ═══ */}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          padding: "16px",
        }}>
          <p className="font-display" style={{ fontSize: "12px", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>
            Subir Comprobantes
          </p>
          <UploadZone onAdd={agregarItems} />

          {items.length > 0 && pendientesCount > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-primary" onClick={procesarTodos}
                style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "14px" }}>✦</span>
                Extraer todos ({pendientesCount}) con IA
              </button>
            </div>
          )}
        </div>

        {/* ═══ TABS + CONTENT ═══ */}
        {items.length > 0 && (
          <>
            {/* Tab pills */}
            <div style={{
              display: "flex", gap: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "5px",
            }}>
              {[
                { key: "gastos", label: `Gastos`, count: items.length },
                { key: "resumen", label: `Resumen`, count: procesadosCount },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as "gastos" | "resumen")}
                  style={{
                    flex: 1, padding: "9px 16px",
                    borderRadius: "10px",
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    fontFamily: "var(--font-sora), sans-serif",
                    fontSize: "13px",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    background: tab === t.key ? "rgba(255,255,255,0.08)" : "transparent",
                    color: tab === t.key ? "var(--text)" : "var(--text3)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  }}
                >
                  {t.label}
                  <span style={{
                    fontSize: "11px", fontWeight: 700,
                    background: tab === t.key ? "var(--accent)" : "rgba(255,255,255,0.08)",
                    color: tab === t.key ? "#0A0B0F" : "var(--text3)",
                    padding: "1px 7px", borderRadius: "999px",
                    transition: "all 0.2s",
                  }}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {tab === "gastos" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {items.map(item => (
                  <GastoCard key={item.id} item={item}
                    onChange={updateItem} onProcesar={procesarItem} onEliminar={eliminarItem} />
                ))}
              </div>
            )}

            {tab === "resumen" && <TablaResumen items={items} />}
          </>
        )}

        {/* ═══ EMPTY STATE ═══ */}
        {items.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", paddingTop: 64, paddingBottom: 64, textAlign: "center", gap: 16,
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: "24px",
              background: "var(--surface)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "36px",
            }}>
              🧾
            </div>
            <div>
              <p className="font-display" style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 6 }}>
                Sin comprobantes
              </p>
              <p style={{ fontSize: "13px", color: "var(--text2)", lineHeight: 1.6 }}>
                Sube imágenes o PDFs de facturas, boletas,<br />recibos o tickets para comenzar.
              </p>
            </div>
          </div>
        )}
      </main>

      {showModal && <ProyectoModal onCrear={crearProyecto} onCerrar={() => setShowModal(false)} />}
    </div>
  );
}
