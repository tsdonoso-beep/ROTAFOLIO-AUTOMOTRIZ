"use client";
import { useState } from "react";
import { Proyecto } from "@/lib/types";
import { newProyecto } from "@/lib/proyectos";

interface Props {
  onCrear: (p: Proyecto) => void;
  onCerrar: () => void;
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-slate-800">Nuevo Proyecto / Caja</h2>
        <div className="space-y-3">
          <Field label="Nombre del Proyecto" value={nombre} onChange={setNombre} placeholder="Ej: Proyecto Taller Norte" />
          <Field label="Centro de Costos" value={centro} onChange={setCentro} placeholder="Ej: TALLER-01" />
          <Field label="N° Caja / Memo" value={caja} onChange={setCaja} placeholder="Ej: CAJA-2026-03" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCerrar} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={crear} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
            Crear Proyecto
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
