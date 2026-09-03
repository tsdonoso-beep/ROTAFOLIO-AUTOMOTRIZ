"use client";
import { useCallback, useEffect, useState } from "react";
import ApiKeyConfig from "@/components/ApiKeyConfig";
import UploadZone from "@/components/UploadZone";
import GastoCard from "@/components/GastoCard";
import TablaResumen from "@/components/TablaResumen";
import ProyectoModal from "@/components/ProyectoModal";
import Logo from "@/components/Logo";
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
        background: "#FFFFFF",
        borderBottom: "1px solid var(--border)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <div style={{
          maxWidth: 960, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Logo height={24} />
          </div>
          <ApiKeyConfig onChange={setApiKey} />
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 100px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ═══ STAT CARDS ═══ */}
        {items.length > 0 && (
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "Archivos", value: items.length, accent: false },
              { label: "Procesados", value: procesadosCount, accent: procesadosCount > 0 },
              { label: "Total S/", value: totalSoles > 0 ? totalSoles.toFixed(2) : "—", accent: totalSoles > 0 },
            ].map((s) => (
              <div key={s.label} className="animate-fadein" style={{
                background: "#FFFFFF",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}>
                <p className="font-display" style={{
                  fontSize: "22px", fontWeight: 800, letterSpacing: "-0.03em",
                  color: s.accent ? "var(--accent)" : "var(--text)",
                }}>
                  {s.value}
                </p>
                <p style={{ fontSize: "10px", color: "var(--text3)", marginTop: "3px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif" }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ═══ PROYECTO SELECTOR ═══ */}
        <div style={{
          background: "#FFFFFF",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "16px 18px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
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
          background: "#FFFFFF",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "16px 18px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <p className="font-display" style={{ fontSize: "11px", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "14px" }}>
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
              display: "flex", gap: 4,
              background: "#FFFFFF",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "4px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>
              {[
                { key: "gastos", label: "Gastos", count: items.length },
                { key: "resumen", label: "Resumen", count: procesadosCount },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as "gastos" | "resumen")}
                  style={{
                    flex: 1, padding: "8px 16px",
                    borderRadius: "7px",
                    border: tab === t.key ? "1px solid var(--border2)" : "1px solid transparent",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: "var(--font-sora), sans-serif",
                    fontSize: "13px",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    background: tab === t.key ? "#FFFFFF" : "transparent",
                    color: tab === t.key ? "var(--text)" : "var(--text3)",
                    boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.07)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  }}
                >
                  {t.label}
                  <span style={{
                    fontSize: "10px", fontWeight: 700,
                    background: tab === t.key ? "var(--accent)" : "rgba(0,0,0,0.06)",
                    color: tab === t.key ? "#FFFFFF" : "var(--text3)",
                    padding: "1px 7px", borderRadius: "999px",
                    transition: "all 0.15s",
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
            justifyContent: "center", paddingTop: 56, paddingBottom: 56, textAlign: "center", gap: 14,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: "20px",
              background: "#FFFFFF", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "32px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}>
              🧾
            </div>
            <div>
              <p className="font-display" style={{ fontSize: "17px", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 5 }}>
                Sin comprobantes
              </p>
              <p style={{ fontSize: "13px", color: "var(--text2)", lineHeight: 1.65 }}>
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
