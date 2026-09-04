"use client";
import { useCallback, useRef, useState } from "react";
import { GastoItem } from "@/lib/types";

interface Props { onAdd: (items: GastoItem[]) => void }

/** Lado máximo en píxeles tras comprimir. Suficiente para leer un comprobante. */
const MAX_LADO = 1800;
const CALIDAD_JPEG = 0.82;

function leerComoDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Reduce y recomprime la imagen en el navegador.
 * Una foto de celular pesa 4-6 MB; en base64 crece un 33% más y Gemini
 * la rechaza o tarda muchísimo. Así baja a ~200-500 KB sin perder legibilidad.
 * Los PDFs se dejan intactos.
 */
async function comprimirImagen(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  const original = await leerComoDataURL(file);

  if (!file.type.startsWith("image/")) {
    return { dataUrl: original, mimeType: file.type || "application/pdf" };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("no-decodable"));
      el.src = original;
    });

    const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
    // Ya es pequeña y liviana: no vale la pena recomprimir.
    if (escala === 1 && file.size < 900_000) {
      return { dataUrl: original, mimeType: file.type };
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);

    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl: original, mimeType: file.type };

    // Fondo blanco: los PNG transparentes salen negros al pasar a JPEG.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", CALIDAD_JPEG),
      mimeType: "image/jpeg",
    };
  } catch {
    // Si algo falla al comprimir, se envía la original.
    return { dataUrl: original, mimeType: file.type || "image/jpeg" };
  }
}

async function fileToGasto(file: File): Promise<GastoItem> {
  const { dataUrl, mimeType } = await comprimirImagen(file);
  const base64 = dataUrl.split(",")[1];

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    // Lo asigna la página al agregarlo, según el proyecto activo.
    proyecto_id: "",
    nombre: file.name,
    // Tamaño real que se enviará, no el del archivo original.
    tamanoKB: Math.round((base64.length * 3) / 4 / 1024),
    base64,
    mimeType,
    numero_solicitud: "",
    fecha_solicitud: new Date().toISOString().split("T")[0],
    empresa: "", responsable: "", area_proyecto: "", solicitante: "", motivo: "",
    estado: "PENDIENTE", procesado: false, procesando: false,
  };
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
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
          gap: "14px",
          padding: "40px 24px",
          borderRadius: "10px",
          cursor: "pointer",
          transition: "all 0.2s",
          background: dragging ? "rgba(4,95,108,0.05)" : "var(--surface2)",
          border: `2px dashed ${dragging ? "var(--accent)" : "rgba(0,0,0,0.12)"}`,
        }}
      >
        <div style={{
          width: 48, height: 48,
          background: dragging ? "rgba(4,95,108,0.1)" : "#FFFFFF",
          borderRadius: "12px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "20px",
          transition: "all 0.2s",
          border: "1px solid var(--border2)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          {dragging ? "✨" : "📎"}
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "3px", fontFamily: "var(--font-sora), sans-serif" }}>
            Arrastra tus comprobantes aquí
          </p>
          <p style={{ fontSize: "12px", color: "var(--text2)" }}>
            o <span style={{ color: "var(--accent)", fontWeight: 600 }}>haz clic para seleccionar</span> · Imágenes y PDF
          </p>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {/* Mobile buttons */}
      <div className="flex md:hidden" style={{ gap: "10px" }}>
        <button
          onClick={() => cameraRef.current?.click()}
          style={{
            flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
            padding: "24px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(4,95,108,0.2)",
            background: "rgba(4,95,108,0.05)",
            color: "var(--accent)",
            cursor: "pointer",
            transition: "all 0.15s",
            fontFamily: "var(--font-sora), sans-serif",
          }}
        >
          <span style={{ fontSize: "26px" }}>📷</span>
          <span style={{ fontSize: "13px", fontWeight: 600 }}>Tomar foto</span>
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
            padding: "24px 16px",
            borderRadius: "10px",
            border: "1px solid var(--border2)",
            background: "#FFFFFF",
            color: "var(--text2)",
            cursor: "pointer",
            transition: "all 0.15s",
            fontFamily: "var(--font-sora), sans-serif",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <span style={{ fontSize: "26px" }}>📁</span>
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
