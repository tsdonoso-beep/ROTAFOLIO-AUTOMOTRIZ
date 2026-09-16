"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoBasura, IconoCheck } from "./Iconos";
import { borrarConstancia, registrarConstancia } from "@/app/acciones/pagos";
import {
  cobertura, ETIQUETA_PAGO, type Beneficiario, type Constancia,
} from "@/lib/dominio/pago";

const TONO: Record<string, string> = {
  PAGADO: "var(--accent)",
  PARCIAL: "var(--warn)",
  RECHAZADO: "var(--danger)",
  SIN_PAGAR: "var(--text3)",
};

/**
 * Lo que de verdad cobró cada quien.
 *
 * Un memo se paga en más de una planilla: una por banco. Hasta que todas
 * estén registradas, el memo no está pagado — y quienes faltan tienen
 * nombre.
 */
export default function PanelConstancias({
  memoId, autorizado, beneficiarios, constancias, puedeRegistrar,
}: {
  memoId: string;
  autorizado: number;
  beneficiarios: Beneficiario[];
  constancias: Constancia[];
  puedeRegistrar: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const [banco, setBanco] = useState("");
  const [planilla, setPlanilla] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [lineas, setLineas] = useState<Record<string, { monto: string; procesada: boolean }>>({});

  const c = useMemo(
    () => cobertura(beneficiarios, constancias, autorizado),
    [beneficiarios, constancias, autorizado]
  );

  const guardar = () => {
    setError("");
    iniciar(async () => {
      const r = await registrarConstancia({
        memoId, banco, planilla, fecha,
        lineas: beneficiarios.map(b => ({
          usuarioId: b.usuarioId,
          monto: Number(lineas[b.usuarioId]?.monto ?? 0),
          procesada: lineas[b.usuarioId]?.procesada ?? true,
        })),
      });
      if (!r.ok) { setError(r.error); return; }
      setBanco(""); setPlanilla(""); setLineas({}); setAbierto(false);
      router.refresh();
    });
  };

  const borrar = (pagoId: string) => {
    setError("");
    iniciar(async () => {
      const r = await borrarConstancia(pagoId, memoId);
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  };

  // Quien todavía no cobró es a quien hay que pagarle: se propone su saldo.
  const proponerFaltantes = () => {
    const n: Record<string, { monto: string; procesada: boolean }> = {};
    for (const p of c.porPersona) {
      if (p.situacion === "PAGADO") continue;
      const falta = (p.asignado ?? 0) - p.cobrado;
      n[p.usuarioId] = { monto: falta > 0 ? falta.toFixed(2) : "", procesada: true };
    }
    setLineas(n);
  };

  if (!puedeRegistrar && constancias.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Tarjeta>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <div>
            <h2 className="font-display" style={{
              fontSize: 14, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em",
            }}>
              Pago
            </h2>
            <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3, lineHeight: 1.45 }}>
              {c.cubierto
                ? `Cobrado por completo${c.bancos.length ? ` · ${c.bancos.join(" y ")}` : ""}`
                : `${soles(c.pagado)} de ${soles(c.autorizado)} · faltan ${soles(c.falta)}`}
            </p>
          </div>
          {puedeRegistrar && !abierto && (
            <button className="btn-ghost" style={{ fontSize: 12.5 }}
              onClick={() => { proponerFaltantes(); setAbierto(true); }}>
              Registrar constancia
            </button>
          )}
        </div>

        {/* Quiénes siguen esperando. Es el punto entero de esto. */}
        {!c.cubierto && c.sinCobrar.length > 0 && constancias.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
              <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                Pagado en parte.
              </strong>{" "}
              Un memo se paga en una planilla por banco. Todavía no cobran{" "}
              {c.sinCobrar.join(", ")}.
            </Aviso>
          </div>
        )}

        {/* Qué cobró cada quien */}
        {constancias.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            {c.porPersona.map(p => (
              <div key={p.usuarioId} style={{
                display: "flex", alignItems: "center", gap: 9, fontSize: 12.5,
              }}>
                <span style={{ flex: 1, color: "var(--text2)" }}>{p.nombre}</span>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: TONO[p.situacion],
                }}>
                  {ETIQUETA_PAGO[p.situacion]}
                </span>
                <strong style={{ color: "var(--text)", minWidth: 78, textAlign: "right" }}>
                  {soles(p.cobrado)}
                </strong>
              </div>
            ))}
          </div>
        )}

        {/* Las constancias registradas */}
        {constancias.length > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border2)",
            display: "flex", flexDirection: "column", gap: 5,
          }}>
            {constancias.map(k => (
              <div key={k.id} style={{
                display: "flex", alignItems: "center", gap: 9,
                fontSize: 11.5, color: "var(--text3)",
              }}>
                <IconoCheck size={13} />
                <span style={{ flex: 1 }}>
                  {k.banco}
                  {k.planilla && <> · planilla <span className="mono">{k.planilla}</span></>}
                  {k.fecha && ` · ${k.fecha}`}
                  {" · "}{k.lineas.length} persona{k.lineas.length === 1 ? "" : "s"}
                </span>
                {puedeRegistrar && (
                  <button onClick={() => borrar(k.id)} disabled={pendiente}
                    title="Quitar esta constancia"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--text3)", padding: 0,
                    }}>
                    <IconoBasura size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cargar una */}
        {abierto && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
              <div>
                <label className="fg-label" style={{ fontSize: 10.5 }}>Banco</label>
                <input className="fg-input" value={banco} autoFocus
                  onChange={e => setBanco(e.target.value)} placeholder="BCP" />
              </div>
              <div>
                <label className="fg-label" style={{ fontSize: 10.5 }}>N° de planilla</label>
                <input className="fg-input mono" value={planilla}
                  onChange={e => setPlanilla(e.target.value)} placeholder="1439" />
              </div>
              <div>
                <label className="fg-label" style={{ fontSize: 10.5 }}>Fecha</label>
                <input className="fg-input" type="date" value={fecha}
                  onChange={e => setFecha(e.target.value)} />
              </div>
            </div>

            <p style={{ marginTop: 9, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
              Deja en cero a quien no aparezca en esta constancia. Si el banco
              rechazó una fila, desmárcala: esa persona no cobró y no tiene nada
              que rendir.
            </p>

            <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 7 }}>
              {beneficiarios.map(b => {
                const l = lineas[b.usuarioId] ?? { monto: "", procesada: true };
                return (
                  <div key={b.usuarioId} style={{
                    display: "flex", alignItems: "center", gap: 9,
                  }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: "var(--text2)" }}>
                      {b.nombre}
                    </span>
                    <label style={{
                      display: "flex", alignItems: "center", gap: 5,
                      fontSize: 11, color: "var(--text3)", cursor: "pointer",
                    }}>
                      <input type="checkbox" checked={l.procesada}
                        onChange={e => setLineas(x => ({
                          ...x,
                          [b.usuarioId]: { ...l, procesada: e.target.checked },
                        }))} />
                      procesada
                    </label>
                    <input className="fg-input" type="number" inputMode="decimal"
                      step="0.01" min="0" value={l.monto} placeholder="0.00"
                      onChange={e => setLineas(x => ({
                        ...x,
                        [b.usuarioId]: { ...l, monto: e.target.value },
                      }))}
                      style={{ width: 104, fontWeight: 600 }} />
                  </div>
                );
              })}
            </div>

            {error && (
              <p style={{ marginTop: 11, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setAbierto(false)}
                disabled={pendiente} style={{ flex: 1, justifyContent: "center" }}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={guardar}
                disabled={pendiente || !banco.trim()}
                style={{ flex: 2, justifyContent: "center" }}>
                {pendiente ? "Guardando…" : "Registrar constancia"}
              </button>
            </div>
          </div>
        )}

        {error && !abierto && (
          <p style={{ marginTop: 11, fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>
            {error}
          </p>
        )}
      </Tarjeta>
    </div>
  );
}
