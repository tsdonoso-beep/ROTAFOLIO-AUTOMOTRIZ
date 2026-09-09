"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Captura, { type MemoDisponible } from "./Captura";
import { Aviso, Tarjeta } from "./Encabezado";
import { IconoCamara, IconoCheck } from "./Iconos";
import type { Parametros } from "@/lib/dominio/tipos";

interface Props {
  memos: MemoDisponible[];
  parametros: Parametros;
}

/**
 * Capturar sin elegir memo primero.
 *
 * Es la vuelta al proceso actual: hoy la persona junta todo en un sobre y
 * al volver alguien lo ordena comprobante por comprobante contra los tres
 * o cuatro memos que el viaje generó. Aquí se fotografía en el momento y
 * la fecha del comprobante decide a cuál pertenece.
 */
export default function CapturaRapida({ memos, parametros }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [listo, setListo] = useState(false);

  if (!memos.length) return null;

  if (!abierto) {
    return (
      <div style={{ marginBottom: 14 }}>
        {listo && (
          <div style={{ marginBottom: 10 }}>
            <Aviso tono="ok" icono={<IconoCheck size={16} />}>
              Comprobante guardado.
            </Aviso>
          </div>
        )}
        <button
          onClick={() => { setAbierto(true); setListo(false); }}
          className="tarjeta tarjeta-int"
          style={{
            width: "100%", padding: "16px 18px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 13, textAlign: "left",
            background: "var(--accent-suave)", borderColor: "var(--accent-borde)",
            fontFamily: "inherit",
          }}
        >
          <span style={{ color: "var(--accent-texto)", display: "flex" }}>
            <IconoCamara size={24} />
          </span>
          <span style={{ flex: 1 }}>
            <span className="font-display" style={{
              fontSize: 14, fontWeight: 700, color: "var(--accent-texto)",
              letterSpacing: "-0.01em", display: "block",
            }}>
              Capturar comprobante
            </span>
            <span style={{ fontSize: 12, color: "var(--text2)", marginTop: 2, display: "block" }}>
              No hace falta que elijas el memo: la fecha lo decide
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <Tarjeta style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 13,
      }}>
        <p className="rotulo">Capturar comprobante</p>
        <button
          onClick={() => setAbierto(false)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12.5, color: "var(--text2)", padding: 0,
            fontFamily: "var(--font-dm), sans-serif",
          }}
        >
          Cerrar
        </button>
      </div>

      <Captura
        memos={memos}
        parametros={parametros}
        onListo={() => {
          setListo(true);
          setAbierto(false);
          router.refresh();
        }}
      />
    </Tarjeta>
  );
}
