"use client";
import { useCallback, useRef, useState } from "react";
import { GastoItem } from "@/lib/types";

interface Props {
  onAdd: (items: GastoItem[]) => void;
}

function fileToGasto(file: File): Promise<GastoItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        nombre: file.name,
        tamanoKB: Math.round(file.size / 1024),
        base64,
        mimeType: file.type || "image/jpeg",
        numero_solicitud: "",
        fecha_solicitud: new Date().toISOString().split("T")[0],
        empresa: "",
        responsable: "",
        area_proyecto: "",
        solicitante: "",
        motivo: "",
        estado: "PENDIENTE",
        procesado: false,
        procesando: false,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ACCEPT = "image/*,application/pdf";

export default function UploadZone({ onAdd }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf"
      );
      if (!arr.length) return;
      const gastos = await Promise.all(arr.map(fileToGasto));
      onAdd(gastos);
    },
    [onAdd]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <section className="space-y-3">
      {/* Drop zone — visible en desktop */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`hidden md:flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 transition ${
          dragging
            ? "border-emerald-500 bg-emerald-50"
            : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/50"
        }`}
      >
        <span className="text-4xl">📎</span>
        <p className="text-center text-sm text-slate-500">
          Arrastra imágenes o PDFs aquí<br />
          <span className="text-emerald-600 font-medium">o haz clic para seleccionar</span>
        </p>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {/* Botones móvil — siempre visibles en mobile */}
      <div className="flex gap-3 md:hidden">
        <button
          onClick={() => inputRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-6 text-sm text-slate-600 active:bg-slate-100"
        >
          <span className="text-3xl">📁</span>
          Galería / Archivos
        </button>
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 py-6 text-sm text-emerald-700 active:bg-emerald-100"
        >
          <span className="text-3xl">📷</span>
          Tomar foto
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {/* En desktop también botones compactos bajo el drop */}
      <div className="hidden md:flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          📁 Seleccionar archivos
        </button>
        <button
          onClick={() => cameraRef.current?.click()}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100"
        >
          📷 Cámara
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>
    </section>
  );
}
