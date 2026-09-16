"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta } from "./Encabezado";
import { crearCaja } from "@/app/acciones/cajas";

/** Abre un fondo. Lo que nace y muere después son sus ciclos, no la caja. */
export default function NuevaCaja({ personas, centros }: {
  personas: Array<{ id: string; nombre: string }>;
  centros: Array<{ id: string; codigo: string; nombre: string }>;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [responsable, setResponsable] = useState("");
  const [centro, setCentro] = useState(centros[0]?.id ?? "");

  const enviar = () => {
    setError("");
    iniciar(async () => {
      const r = await crearCaja({
        codigo, nombre, responsableId: responsable, centroCostoId: centro,
      });
      if (!r.ok) { setError(r.error); return; }
      setCodigo(""); setNombre(""); setResponsable("");
      setAbierto(false);
      router.refresh();
    });
  };

  if (!abierto) {
    return (
      <button className="btn-primary" onClick={() => setAbierto(true)}>
        Abrir una caja
      </button>
    );
  }

  return (
    <Tarjeta>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 11 }}>
        <div>
          <label className="fg-label">Código</label>
          <input className="fg-input mono" value={codigo} autoFocus
            onChange={e => setCodigo(e.target.value)} placeholder="CCH-GP" />
        </div>
        <div>
          <label className="fg-label">Nombre</label>
          <input className="fg-input" value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Caja chica — Gestión de Proyectos" />
        </div>
      </div>

      <div style={{ marginTop: 11 }}>
        <label className="fg-label">Responsable</label>
        <select className="fg-input" value={responsable}
          onChange={e => setResponsable(e.target.value)}>
          <option value="">— elige a quién rinde por ella —</option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
        {/* El memo 194-2026 lo dice con todas sus letras en el anexo. */}
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
          Es quien administra el fondo y rinde por él: «Ejecutor y Administrador
          de Caja Chica».
        </p>
      </div>

      <div style={{ marginTop: 11 }}>
        <label className="fg-label">Centro de costos</label>
        <select className="fg-input" value={centro} onChange={e => setCentro(e.target.value)}>
          {centros.map(c => (
            <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ marginTop: 11, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
        <button className="btn-ghost" onClick={() => setAbierto(false)} disabled={pendiente}
          style={{ flex: 1, justifyContent: "center" }}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={enviar}
          disabled={pendiente || !codigo.trim() || !nombre.trim() || !responsable}
          style={{ flex: 2, justifyContent: "center" }}>
          {pendiente ? "Abriendo…" : "Abrir caja"}
        </button>
      </div>
    </Tarjeta>
  );
}
