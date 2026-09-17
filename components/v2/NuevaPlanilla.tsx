"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta } from "./Encabezado";
import { crearPlanilla } from "@/app/acciones/movilidad";

/** Abre una hoja del talonario. El número es el impreso, no uno nuestro. */
export default function NuevaPlanilla() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const [numero, setNumero] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  const enviar = () => {
    setError("");
    iniciar(async () => {
      const r = await crearPlanilla({ numero, periodo, fechaEmision: fecha });
      if (!r.ok) { setError(r.error); return; }
      setNumero(""); setPeriodo(""); setAbierto(false);
      router.push(`/movilidad/${r.id}`);
      router.refresh();
    });
  };

  if (!abierto) {
    return (
      <button className="btn-primary" onClick={() => setAbierto(true)}>
        Abrir una planilla
      </button>
    );
  }

  return (
    <Tarjeta>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 11 }}>
        <div>
          <label className="fg-label">N° de planilla</label>
          <input className="fg-input mono" value={numero} autoFocus
            onChange={e => setNumero(e.target.value)} placeholder="010212" />
        </div>
        <div>
          <label className="fg-label">Período</label>
          <input className="fg-input" value={periodo}
            onChange={e => setPeriodo(e.target.value)} placeholder="Agosto 2026" />
        </div>
        <div>
          <label className="fg-label">Fecha de emisión</label>
          <input className="fg-input" type="date" value={fecha}
            onChange={e => setFecha(e.target.value)} />
        </div>
      </div>

      {/* Es una serie física, comprada, numerada de fábrica: el número no lo
          genera la aplicación, lo copia del papel que tiene delante. */}
      <p style={{ marginTop: 7, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
        El número es el impreso en el talonario. La 009979 es de Kory Sobrino y
        la 010212 la usó Wilmer Zamora: es la misma serie comprada.
      </p>

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
          disabled={pendiente || !numero.trim()}
          style={{ flex: 2, justifyContent: "center" }}>
          {pendiente ? "Abriendo…" : "Abrir planilla"}
        </button>
      </div>
    </Tarjeta>
  );
}
