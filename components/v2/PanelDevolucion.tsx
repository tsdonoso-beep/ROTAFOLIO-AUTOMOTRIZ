"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta, soles } from "./Encabezado";
import { IconoCheck } from "./Iconos";
import { registrarDevolucion } from "@/app/acciones/memos";

/**
 * El saldo que vuelve a la empresa.
 *
 * Wilmer Zamora recibió S/ 212.00, rindió S/ 201.80 y transfirió los
 * S/ 10.20 restantes desde su cuenta de ahorros con la operación 10394730.
 * Hasta ahora eso era una captura de WhatsApp: el memo quedaba con un saldo
 * pendiente que ya estaba pagado, y nadie podía cerrarlo sin preguntar.
 */
export default function PanelDevolucion({
  memoId, usuarioId, porDevolver, devoluciones,
}: {
  memoId: string;
  usuarioId: string;
  porDevolver: number;
  devoluciones: Array<{
    id: string; monto: number; operacion: string | null;
    fecha: string; nota: string | null;
  }>;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  // Se propone el saldo entero porque es lo que pasa casi siempre; se puede
  // corregir, porque a veces se devuelve en dos partes.
  const [monto, setMonto] = useState(porDevolver > 0 ? porDevolver.toFixed(2) : "");
  const [operacion, setOperacion] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState("");

  const enviar = () => {
    setError("");
    iniciar(async () => {
      const r = await registrarDevolucion({
        memoId, usuarioId, monto: Number(monto), operacion, fecha,
        nota: nota || null,
      });
      if (!r.ok) { setError(r.error); return; }
      setAbierto(false);
      setOperacion(""); setNota("");
      router.refresh();
    });
  };

  const nada = devoluciones.length === 0 && porDevolver <= 0;
  if (nada) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Tarjeta>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", marginBottom: devoluciones.length ? 12 : 0,
        }}>
          <div>
            <h2 className="font-display" style={{
              fontSize: 14, fontWeight: 800, color: "var(--text)",
              letterSpacing: "-0.02em",
            }}>
              Devolución del saldo
            </h2>
            <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3, lineHeight: 1.45 }}>
              {porDevolver > 0
                ? `Falta que vuelvan ${soles(porDevolver)} a la empresa.`
                : "Todo el saldo está devuelto."}
            </p>
          </div>
          {porDevolver > 0 && !abierto && (
            <button className="btn-ghost" onClick={() => setAbierto(true)}
              style={{ fontSize: 12.5 }}>
              Registrar
            </button>
          )}
        </div>

        {devoluciones.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {devoluciones.map(d => (
              <div key={d.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 11px", borderRadius: 9,
                background: "var(--ok-bg, rgba(0,162,152,0.05))",
                border: "1px solid var(--border2)",
              }}>
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>
                  <IconoCheck size={15} />
                </span>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--text2)" }}>
                  {d.fecha}
                  {d.operacion && (
                    <> · op. <span className="mono">{d.operacion}</span></>
                  )}
                  {d.nota && ` · ${d.nota}`}
                </span>
                <strong style={{ fontSize: 13, color: "var(--text)" }}>
                  {soles(d.monto)}
                </strong>
              </div>
            ))}
          </div>
        )}

        {abierto && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
              <div>
                <label className="fg-label">Monto devuelto (S/)</label>
                <input className="fg-input" type="number" inputMode="decimal"
                  step="0.01" min="0" value={monto}
                  onChange={e => setMonto(e.target.value)}
                  style={{ fontWeight: 700 }} />
              </div>
              <div>
                <label className="fg-label">Fecha de la operación</label>
                <input className="fg-input" type="date" value={fecha}
                  onChange={e => setFecha(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 11 }}>
              <label className="fg-label">N° de operación</label>
              <input className="fg-input mono" value={operacion}
                onChange={e => setOperacion(e.target.value)} placeholder="10394730" />
              {/* El número es lo que permite cruzar esto contra el extracto
                  del banco. Sin él queda la palabra de alguien. */}
              <p style={{ marginTop: 5, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
                Sale de la constancia de la transferencia. Es lo que permite
                cruzarla después contra el estado de cuenta.
              </p>
            </div>

            <div style={{ marginTop: 11 }}>
              <label className="fg-label">Nota (opcional)</label>
              <input className="fg-input" value={nota}
                onChange={e => setNota(e.target.value)}
                placeholder="Ej: transferido desde cuenta de ahorros" />
            </div>

            {error && (
              <p style={{
                marginTop: 11, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5,
              }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setAbierto(false)}
                disabled={pendiente} style={{ flex: 1, justifyContent: "center" }}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={enviar}
                disabled={pendiente || !(Number(monto) > 0) || !fecha}
                style={{ flex: 2, justifyContent: "center" }}>
                {pendiente ? "Guardando…" : "Registrar devolución"}
              </button>
            </div>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
