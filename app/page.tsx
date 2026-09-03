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
  const [apiKey, setApiKey] = useState("");
  const [items, setItems] = useState<GastoItem[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [proyectoActual, setProyectoActual] = useState<Proyecto | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [tab, setTab] = useState<"gastos" | "resumen">("gastos");

  useEffect(() => {
    setApiKey(getApiKey());
    const ps = getProyectos();
    setProyectos(ps);
    if (ps.length) setProyectoActual(ps[0]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<GastoItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const eliminarItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const agregarItems = useCallback((nuevos: GastoItem[]) => {
    setItems((prev) => [...prev, ...nuevos]);
  }, []);

  const procesarItem = useCallback(
    async (id: string) => {
      if (!apiKey) {
        alert("Primero configura tu Gemini API Key (botón ⚙ API Key arriba).");
        return;
      }
      const item = items.find((i) => i.id === id);
      if (!item) return;

      updateItem(id, { procesando: true, error: undefined });

      try {
        // 1. Extraer con Gemini
        const { extraido } = await extraerComprobante(item.base64, item.mimeType, apiKey);

        // 2. Subir imagen a Drive (si hay proyecto activo)
        let drive_url: string | undefined;
        if (proyectoActual) {
          try {
            const ext = item.nombre.split(".").pop() ?? "jpg";
            const fileName = `${extraido.proveedor || item.nombre}_${Date.now()}.${ext}`.replace(/\s+/g, "_");
            const result = await subirADrive({
              base64: item.base64,
              mimeType: item.mimeType,
              fileName,
              centroCostos: proyectoActual.centro_costos,
              caja: proyectoActual.caja,
            });
            drive_url = result.url;
          } catch (driveErr) {
            console.warn("Drive upload failed:", driveErr);
            // No bloquea el flujo, solo avisa
          }
        }

        updateItem(id, {
          procesado: true,
          procesando: false,
          extraido,
          drive_url,
          // Pre-rellenar campos vacíos con lo extraído
          empresa: items.find((i) => i.id === id)?.empresa || extraido.proveedor,
          motivo: items.find((i) => i.id === id)?.motivo || extraido.detalle,
        });
      } catch (e) {
        updateItem(id, { procesando: false, error: (e as Error).message });
      }
    },
    [apiKey, items, proyectoActual, updateItem]
  );

  const procesarTodos = async () => {
    const pendientes = items.filter((i) => !i.procesado && !i.procesando);
    for (const item of pendientes) {
      await procesarItem(item.id);
    }
  };

  const crearProyecto = (p: Proyecto) => {
    saveProyecto(p);
    setProyectos(getProyectos());
    setProyectoActual(p);
    setShowModal(false);
  };

  const eliminarProyecto = (id: string) => {
    if (!confirm("¿Eliminar este proyecto? Los gastos cargados no se borran.")) return;
    deleteProyecto(id);
    const ps = getProyectos();
    setProyectos(ps);
    setProyectoActual(ps[0] ?? null);
  };

  const pendientesCount = items.filter((i) => !i.procesado && !i.procesando).length;
  const procesadosCount = items.filter((i) => i.procesado).length;
  const totalSoles = items
    .filter((i) => i.procesado)
    .reduce((s, i) => s + (i.extraido?.monto_total ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* HEADER */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-lg font-bold text-white">R</div>
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-tight text-slate-800">FOTO-GRAMA</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Rendición Automotriz</div>
            </div>
          </div>
          <ApiKeyConfig onChange={setApiKey} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {/* SELECTOR DE PROYECTO */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-slate-600">Proyecto activo:</span>
              {proyectos.length > 0 ? (
                <select
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 focus:border-emerald-500 outline-none"
                  value={proyectoActual?.id ?? ""}
                  onChange={(e) => setProyectoActual(proyectos.find((p) => p.id === e.target.value) ?? null)}
                >
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} — {p.centro_costos} / {p.caja}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-slate-400">Sin proyectos creados</span>
              )}
              {proyectoActual && (
                <button onClick={() => eliminarProyecto(proyectoActual.id)} className="text-xs text-red-400 hover:text-red-600">
                  Eliminar
                </button>
              )}
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700"
            >
              + Nuevo Proyecto
            </button>
          </div>
          {proyectoActual && (
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span>📁 Centro: <strong className="text-slate-700">{proyectoActual.centro_costos}</strong></span>
              <span>🗂 Caja: <strong className="text-slate-700">{proyectoActual.caja}</strong></span>
            </div>
          )}
        </section>

        {/* UPLOAD */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Subir Comprobantes</h2>
          <UploadZone onAdd={agregarItems} />
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex gap-4 text-sm text-slate-500">
                <span><strong className="text-slate-800">{items.length}</strong> archivo(s)</span>
                {procesadosCount > 0 && <span className="text-emerald-600"><strong>{procesadosCount}</strong> procesado(s)</span>}
                {totalSoles > 0 && <span className="text-emerald-700 font-semibold">S/ {totalSoles.toFixed(2)}</span>}
              </div>
              {pendientesCount > 0 && (
                <button onClick={procesarTodos} className="ml-auto rounded-lg bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700">
                  Extraer todos ({pendientesCount}) con IA
                </button>
              )}
            </div>
          )}
        </section>

        {/* TABS */}
        {items.length > 0 && (
          <>
            <div className="flex gap-1 rounded-xl bg-slate-200 p-1">
              <TabBtn active={tab === "gastos"} onClick={() => setTab("gastos")}>
                📋 Gastos ({items.length})
              </TabBtn>
              <TabBtn active={tab === "resumen"} onClick={() => setTab("resumen")}>
                📊 Resumen ({procesadosCount})
              </TabBtn>
            </div>

            {tab === "gastos" && (
              <div className="space-y-4">
                {items.map((item) => (
                  <GastoCard
                    key={item.id}
                    item={item}
                    onChange={updateItem}
                    onProcesar={procesarItem}
                    onEliminar={eliminarItem}
                  />
                ))}
              </div>
            )}

            {tab === "resumen" && <TablaResumen items={items} />}
          </>
        )}

        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
            <span className="mb-3 text-5xl">🧾</span>
            <p className="text-sm">Sube imágenes o PDFs de comprobantes para empezar.</p>
            <p className="text-xs mt-1">Soporta: facturas, boletas, recibos, tickets</p>
          </div>
        )}
      </main>

      {showModal && <ProyectoModal onCrear={crearProyecto} onCerrar={() => setShowModal(false)} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${
        active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
