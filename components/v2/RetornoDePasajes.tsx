"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Tarjeta } from "./Encabezado";
import { fijarFechaRetorno } from "@/app/acciones/memos";
import { puedeFijarRetorno } from "@/lib/dominio/estados";
import type { EstadoMemo } from "@/lib/dominio/tipos";

/**
 * La fecha de vuelta de un memo de pasajes.
 *
 * El memo se emite con la fecha de ida y punto: al abrirlo nadie sabe cuándo
 * termina la obra. La de vuelta se completa después, y es el único dato del
 * sistema que se toca una vez aprobado el memo. Queda en la bitácora
 * precisamente por ser la excepción.
 */
export default function RetornoDePasajes({
  memoId, estado, fechaSalida, fechaRetorno, padre, puedeEditar,
}: {
  memoId: string;
  estado: EstadoMemo;
  fechaSalida: string | null;
  fechaRetorno: string | null;
  padre: { id: string; correlativo: string } | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [fecha, setFecha] = useState(fechaRetorno ?? "");
  const [error, setError] = useState("");

  const permitido = puedeFijarRetorno("PASAJES", estado);

  const guardar = () => {
    setError("");
    iniciar(async () => {
      const r = await fijarFechaRetorno(memoId, fecha);
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <Tarjeta>
        <label className="fg-label">Pasajes</label>

        <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.55 }}>
          {padre ? (
            <>
              Cuelga del viático{" "}
              <Link href={`/memos/${padre.id}`} className="mono"
                style={{ color: "var(--accent)", fontWeight: 600 }}>
                {padre.correlativo}
              </Link>
              .
            </>
          ) : (
            <span style={{ color: "var(--warn)" }}>
              Este memo de pasajes no cuelga de ningún viático, así que no se
              sabe a qué viaje pertenece.
            </span>
          )}
          {" "}
          Ida {fechaSalida ?? "sin fecha"} · vuelta{" "}
          {fechaRetorno
            ? fechaRetorno
            : <strong style={{ color: "var(--warn)" }}>por confirmar</strong>}.
        </p>

        {puedeEditar && permitido.ok && (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-end", marginTop: 13 }}>
            <div style={{ flex: 1 }}>
              <label className="fg-label" style={{ fontSize: 10.5 }}>
                {fechaRetorno ? "Corregir el retorno" : "Confirmar el retorno"}
              </label>
              <input className="fg-input" type="date" value={fecha}
                min={fechaSalida ?? undefined}
                onChange={e => setFecha(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={guardar}
              disabled={pendiente || !fecha || fecha === fechaRetorno}
              style={{ flexShrink: 0 }}>
              {pendiente ? "Guardando…" : "Guardar"}
            </button>
          </div>
        )}

        {puedeEditar && !permitido.ok && (
          <p style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.45, marginTop: 9 }}>
            {permitido.motivo}
          </p>
        )}

        {error && (
          <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>
            {error}
          </p>
        )}
      </Tarjeta>
    </div>
  );
}
