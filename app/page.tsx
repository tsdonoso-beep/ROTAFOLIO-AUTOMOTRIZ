"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import ApiKeyConfig from "@/components/ApiKeyConfig";
import UploadZone from "@/components/UploadZone";
import GastoCard from "@/components/GastoCard";
import TablaResumen from "@/components/TablaResumen";
import ProyectoModal from "@/components/ProyectoModal";
import LoginGate from "@/components/LoginGate";
import Logo from "@/components/Logo";
import { GastoItem, Proyecto, Usuario } from "@/lib/types";
import { getApiKey } from "@/lib/apikey";
import { extraerComprobante } from "@/lib/gemini";
import { subirADrive } from "@/lib/drive";
import { registrarEnPlanilla } from "@/lib/sheet";
import { deleteProyecto, getProyectos, saveProyecto } from "@/lib/proyectos";
import { getGastos, saveGastos } from "@/lib/gastos";
import { cerrarSesion, getSesion } from "@/lib/usuarios";

export default function Home() {
  const [usuario, setUsuario]     = useState<Usuario | null>(null);
  const [cargando, setCargando]   = useState(true);
  const [apiKey, setApiKey]       = useState("");
  // Todos los gastos de todos los proyectos; en pantalla se filtran.
  const [items, setItems]         = useState<GastoItem[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [proyectoActual, setProyectoActual] = useState<Proyecto | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [tab, setTab]             = useState<"gastos" | "resumen">("gastos");

  useEffect(() => {
    setUsuario(getSesion());
    setApiKey(getApiKey());
    setItems(getGastos());
    const ps = getProyectos();
    setProyectos(ps);
    if (ps.length) setProyectoActual(ps[0]);
    setCargando(false);
  }, []);

  // Persiste en cada cambio para no perder el trabajo al recargar.
  useEffect(() => {
    if (!cargando) saveGastos(items);
  }, [items, cargando]);

  /** Solo los gastos del proyecto activo: así las rendiciones no se mezclan. */
  const visibles = useMemo(
    () => (proyectoActual ? items.filter(i => i.proyecto_id === proyectoActual.id) : []),
    [items, proyectoActual]
  );

  const updateItem = useCallback((id: string, patch: Partial<GastoItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }, []);

  const eliminarItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const agregarItems = useCallback((nuevos: GastoItem[]) => {
    if (!proyectoActual) {
      alert("Primero crea o selecciona un proyecto.");
      return;
    }
    // Cada comprobante queda amarrado al proyecto en el que se subió.
    setItems(prev => [...prev, ...nuevos.map(n => ({ ...n, proyecto_id: proyectoActual.id }))]);
  }, [proyectoActual]);

  const procesarItem = useCallback(async (id: string) => {
    if (!apiKey) {
      alert("Primero configura tu Gemini API Key (botón 🔑 arriba a la derecha).");
      return;
    }
    const item = items.find(i => i.id === id);
    if (!item) return;

    if (!item.base64) {
      updateItem(id, { error: "La imagen ya no está en el navegador (se recargó la página). Vuelve a subir el archivo para procesarlo." });
      return;
    }

    const proyecto = proyectos.find(p => p.id === item.proyecto_id) ?? null;
    updateItem(id, { procesando: true, error: undefined });

    try {
      const { extraido } = await extraerComprobante(item.base64, item.mimeType, apiKey);

      let drive_url: string | undefined;
      let error_drive: string | undefined;
      if (proyecto) {
        try {
          const ext = item.mimeType === "application/pdf" ? "pdf" : "jpg";
          const fecha = extraido.fecha_comprobante || new Date().toISOString().slice(0, 10);
          const fileName = `${fecha}_${extraido.proveedor || item.nombre}_${extraido.numero_comprobante || item.id.slice(-4)}.${ext}`
            .replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_");
          const result = await subirADrive({
            base64: item.base64, mimeType: item.mimeType, fileName,
            centroCostos: proyecto.centro_costos, caja: proyecto.caja,
          });
          drive_url = result.url;
        } catch (e) {
          // Un fallo de Drive no descarta la extracción, pero sí se avisa:
          // sin enlace la fila del registro queda incompleta.
          error_drive = (e as Error).message;
        }
      }

      updateItem(id, {
        procesado: true, procesando: false, extraido, drive_url, error_drive,
        error: undefined,
        empresa: item.empresa || extraido.proveedor,
        motivo:  item.motivo  || extraido.detalle,
      });
    } catch (e) {
      updateItem(id, { procesando: false, error: (e as Error).message });
    }
  }, [apiKey, items, proyectos, updateItem]);

  /** Agrega una fila a la planilla. Es append-only: no se puede deshacer. */
  const registrarItem = useCallback(async (id: string) => {
    const item = items.find(i => i.id === id);
    const proyecto = proyectos.find(p => p.id === item?.proyecto_id);
    if (!item || !proyecto || !usuario) return;

    if (!item.procesado || !item.extraido) {
      updateItem(id, { error_registro: "Primero extrae los datos con IA." });
      return;
    }

    updateItem(id, { registrando: true, error_registro: undefined });
    try {
      const { fecha } = await registrarEnPlanilla(item, proyecto, usuario);
      updateItem(id, {
        registrando: false,
        registrado: { usuario_id: usuario.id, usuario_nombre: usuario.nombre, fecha },
      });
    } catch (e) {
      updateItem(id, { registrando: false, error_registro: (e as Error).message });
    }
  }, [items, proyectos, usuario, updateItem]);

  const procesarTodos = async () => {
    for (const item of visibles.filter(i => !i.procesado && !i.procesando)) {
      await procesarItem(item.id);
    }
  };

  const registrarTodos = async () => {
    const listos = visibles.filter(i => i.procesado && !i.registrado && !i.registrando);
    if (!listos.length) return;
    if (!confirm(`Se agregarán ${listos.length} filas a la planilla a nombre de ${usuario?.nombre}. Esta acción no se puede deshacer. ¿Continuar?`)) return;
    for (const item of listos) await registrarItem(item.id);
  };

  const crearProyecto = (p: Proyecto) => {
    // saveProyecto devuelve el existente si ya había uno con el mismo
    // centro de costos + caja, evitando rendiciones duplicadas.
    const guardado = saveProyecto(p);
    setProyectos(getProyectos());
    setProyectoActual(guardado);
    setShowModal(false);
  };

  const eliminarProyecto = (id: string) => {
    const cuantos = items.filter(i => i.proyecto_id === id).length;
    const aviso = cuantos
      ? `Este proyecto tiene ${cuantos} comprobante(s) cargado(s). Se eliminarán de esta pantalla (lo ya registrado en la planilla y en Drive se conserva). ¿Continuar?`
      : "¿Eliminar este proyecto?";
    if (!confirm(aviso)) return;

    deleteProyecto(id);
    setItems(prev => prev.filter(i => i.proyecto_id !== id));
    const ps = getProyectos();
    setProyectos(ps);
    setProyectoActual(ps[0] ?? null);
  };

  const salir = () => {
    cerrarSesion();
    setUsuario(null);
  };

  const pendientesCount = visibles.filter(i => !i.procesado && !i.procesando).length;
  const procesadosCount = visibles.filter(i => i.procesado).length;
  const registradosCount = visibles.filter(i => i.registrado).length;
  const porRegistrar    = visibles.filter(i => i.procesado && !i.registrado).length;
  const totalSoles      = visibles.filter(i => i.procesado)
    .reduce((s, i) => s + (i.extraido?.monto_total ?? 0), 0);

  if (cargando) return <div style={{ minHeight: "100dvh" }} />;
  if (!usuario) return <LoginGate onEntrar={setUsuario} />;

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
          padding: "14px 20px", gap: 12,
        }}>
          <Logo height={24} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ApiKeyConfig onChange={setApiKey} />
            <button
              onClick={salir}
              title={`${usuario.nombre} — cerrar sesión`}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 10px 5px 5px", borderRadius: "999px",
                border: "1px solid var(--border2)", background: "#FFFFFF",
                cursor: "pointer", transition: "background 0.15s",
              }}
              onMouseOver={e => (e.currentTarget.style.background = "var(--surface2)")}
              onMouseOut={e => (e.currentTarget.style.background = "#FFFFFF")}
            >
              <span style={{
                width: 26, height: 26, borderRadius: "50%",
                background: "var(--accent)", color: "#FFFFFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "10px", fontWeight: 700,
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                {usuario.iniciales}
              </span>
              <span className="hidden sm:inline" style={{
                fontSize: "12px", fontWeight: 600, color: "var(--text2)",
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                Salir
              </span>
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 100px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ═══ STAT CARDS ═══ */}
        {visibles.length > 0 && (
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { label: "Archivos",   value: String(visibles.length), accent: false },
              { label: "Procesados", value: String(procesadosCount), accent: procesadosCount > 0 },
              { label: "Registrados", value: String(registradosCount), accent: registradosCount > 0 },
              { label: "Total S/",   value: totalSoles > 0 ? totalSoles.toFixed(2) : "—", accent: totalSoles > 0 },
            ].map((s) => (
              <div key={s.label} className="animate-fadein" style={{
                background: "#FFFFFF",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "14px 10px",
                textAlign: "center",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}>
                <p className="font-display" style={{
                  fontSize: "20px", fontWeight: 800, letterSpacing: "-0.03em",
                  color: s.accent ? "var(--accent)" : "var(--text)",
                }}>
                  {s.value}
                </p>
                <p style={{ fontSize: "9px", color: "var(--text3)", marginTop: "3px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif" }}>
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
                  style={{ maxWidth: 300, padding: "8px 12px", fontSize: "13px", flex: 1 }}
                  value={proyectoActual?.id ?? ""}
                  onChange={e => setProyectoActual(proyectos.find(p => p.id === e.target.value) ?? null)}
                >
                  {proyectos.map(p => {
                    const n = items.filter(i => i.proyecto_id === p.id).length;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.nombre} — {p.centro_costos} / {p.caja}{n ? ` (${n})` : ""}
                      </option>
                    );
                  })}
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
            <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
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

          {(pendientesCount > 0 || porRegistrar > 0) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {pendientesCount > 0 && (
                <button className="btn-ghost" onClick={procesarTodos}>
                  ✦ Extraer todos ({pendientesCount})
                </button>
              )}
              {porRegistrar > 0 && (
                <button className="btn-primary" onClick={registrarTodos}>
                  📋 Registrar {porRegistrar} en planilla
                </button>
              )}
            </div>
          )}
        </div>

        {/* ═══ TABS + CONTENT ═══ */}
        {visibles.length > 0 && (
          <>
            <div style={{
              display: "flex", gap: 4,
              background: "#FFFFFF",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "4px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>
              {[
                { key: "gastos", label: "Gastos", count: visibles.length },
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
                {visibles.map(item => (
                  <GastoCard key={item.id} item={item}
                    onChange={updateItem} onProcesar={procesarItem}
                    onRegistrar={registrarItem} onEliminar={eliminarItem} />
                ))}
              </div>
            )}

            {tab === "resumen" && <TablaResumen items={visibles} />}
          </>
        )}

        {/* ═══ EMPTY STATE ═══ */}
        {visibles.length === 0 && (
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
              {proyectoActual ? "🧾" : "📁"}
            </div>
            <div>
              <p className="font-display" style={{ fontSize: "17px", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 5 }}>
                {proyectoActual ? "Sin comprobantes en este proyecto" : "Crea tu primer proyecto"}
              </p>
              <p style={{ fontSize: "13px", color: "var(--text2)", lineHeight: 1.65 }}>
                {proyectoActual
                  ? <>Sube imágenes o PDFs de facturas, boletas,<br />recibos o tickets para comenzar.</>
                  : <>Cada proyecto agrupa una rendición por<br />centro de costos y caja.</>}
              </p>
            </div>
          </div>
        )}
      </main>

      {showModal && <ProyectoModal onCrear={crearProyecto} onCerrar={() => setShowModal(false)} />}
    </div>
  );
}
