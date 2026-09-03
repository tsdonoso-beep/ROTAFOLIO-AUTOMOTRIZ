"use client";
import { useCallback, useRef, useState } from "react";
import { GastoItem } from "@/lib/types";

interface Props { onAdd: (items: GastoItem[]) => void }

function fileToGasto(file: File): Promise<GastoItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        nombre: file.name,
        tamanoKB: Math.round(file.size / 1024),
        base64: result.split(",")[1],
        mimeType: file.type || "image/jpeg",
        numero_solicitud: "",
        fecha_solicitud: new Date().toISOString().split("T")[0],
        empresa: "", responsable: "", area_proyecto: "", solicitante: "", motivo: "",
        estado: "PENDIENTE", procesado: false, procesando: false,
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

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!arr.length) return;
    const gastos = await Promise.all(arr.map(fileToGasto));
    onAdd(gastos);
  }, [onAdd]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Drop zone — desktop */}
      <div
        className="hidden md:flex"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "48px 24px",
          borderRadius: "20px",
          cursor: "pointer",
          transition: "all 0.2s",
          background: dragging
            ? "rgba(16,223,160,0.08)"
            : "rgba(255,255,255,0.02)",
          border: `2px dashed ${dragging ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
          boxShadow: dragging ? "inset 0 0 40px rgba(16,223,160,0.05)" : "none",
        }}
      >
        <div style={{
          width: 56, height: 56,
          background: dragging ? "var(--accent-dim)" : "rgba(255,255,255,0.04)",
          borderRadius: "16px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "24px",
          transition: "all 0.2s",
          border: "1px solid var(--border2)",
        }}>
          {dragging ? "✨" : "📎"}
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "4px", fontFamily: "var(--font-sora), sans-serif" }}>
            Arrastra tus comprobantes aquí
          </p>
          <p style={{ fontSize: "12px", color: "var(--text2)" }}>
            o <span style={{ color: "var(--accent)" }}>haz clic para seleccionar</span> · Imágenes y PDF
          </p>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {/* Mobile buttons */}
      <div className="flex md:hidden" style={{ gap: "12px" }}>
        <button
          onClick={() => cameraRef.current?.click()}
          style={{
            flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
            padding: "28px 16px",
            borderRadius: "20px",
            border: "1px solid var(--accent-dim)",
            background: "rgba(16,223,160,0.06)",
            color: "var(--accent)",
            cursor: "pointer",
            transition: "all 0.15s",
            fontFamily: "var(--font-sora), sans-serif",
          }}
        >
          <span style={{ fontSize: "28px" }}>📷</span>
          <span style={{ fontSize: "13px", fontWeight: 600 }}>Tomar foto</span>
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
            padding: "28px 16px",
            borderRadius: "20px",
            border: "1px solid var(--border2)",
            background: "rgba(255,255,255,0.03)",
            color: "var(--text2)",
            cursor: "pointer",
            transition: "all 0.15s",
            fontFamily: "var(--font-sora), sans-serif",
          }}
        >
          <span style={{ fontSize: "28px" }}>📁</span>
          <span style={{ fontSize: "13px", fontWeight: 600 }}>Galería</span>
        </button>
      </div>

      {/* Desktop extra buttons */}
      <div className="hidden md:flex" style={{ gap: "8px" }}>
        <button className="btn-ghost" onClick={() => inputRef.current?.click()}>
          📁 Seleccionar archivos
        </button>
        <button className="btn-ghost" onClick={() => cameraRef.current?.click()}>
          📷 Cámara
        </button>
      </div>

      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)} />
    </div>
  );
}
