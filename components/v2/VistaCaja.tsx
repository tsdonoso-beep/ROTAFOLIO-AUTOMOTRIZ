"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Aviso, Cifra, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoAtras } from "./Iconos";
import { reponerCaja } from "@/app/acciones/cajas";
import type { CicloDeCaja, EstadoDeLaCaja } from "@/lib/dominio/cajachica";

interface Props {
  caja: {
    id: string; codigo: string; nombre: string;
    activa: boolean; responsable: string;
  };
  estado: EstadoDeLaCaja;
  ciclos: CicloDeCaja[];
  centros: Array<{ id: string; codigo: string; nombre: string }>;
  centroSugerido: string | null;
  puedeReponer: boolean;
}

const VIVO = ["ABIERTO", "EN_RENDICION", "PRESENTADA", "OBSERVADA"];

export default function VistaCaja({
  caja, estado, ciclos, centros, centroSugerido, puedeReponer,
}: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  // Se propone reponer lo mismo del ciclo anterior: el fondo es el fondo, y
  // cambiarlo es la excepción, no la regla.
  const [monto, setMonto] = useState(
    ciclos[0] ? String(ciclos[0].monto) : ""
  );
  const [centro, setCentro] = useState(centroSugerido ?? centros[0]?.id ?? "");

  const reponer = () => {
    setError("");
    iniciar(async () => {
      const r = await reponerCaja({
        cajaId: caja.id, monto: Number(monto), centroCostoId: centro,
      });
      if (!r.ok) { setError(r.error); return; }
      router.push(`/memos/${r.id}`);
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/caja" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Caja chica
      </Link>

      <Tarjeta>
        <h1 className="font-display" style={{
          fontSize: 21, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em",
        }}>
          {caja.nombre}
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 4 }}>
          <span className="mono">{caja.codigo}</span> · {caja.responsable}
          {estado.cadenciaDias != null && ` · se repone cada ${estado.cadenciaDias} días`}
        </p>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 18,
        }}>
          <Cifra
            rotulo={estado.abierto ? `Ciclo ${estado.abierto.ciclo ?? "—"}` : "Sin ciclo"}
            valor={estado.abierto ? soles(estado.abierto.monto) : "—"}
            tamano="l" tono="tenue"
          />
          <Cifra
            rotulo="Queda del fondo"
            valor={estado.abierto ? soles(estado.saldo) : "—"}
            tamano="xl"
            tono={estado.abierto && estado.saldo <= 0 ? "peligro" : "acento"}
          />
          <Cifra rotulo="Repuesto en total" valor={soles(estado.repuestoTotal)}
            tamano="l" tono="tenue" />
        </div>
      </Tarjeta>

      {/* ══ Reponer: abrir el ciclo siguiente ══ */}
      {puedeReponer && caja.activa && (
        <div style={{ marginTop: 14 }}>
          <Tarjeta>
            <label className="fg-label">Reposición</label>
            {estado.abierto ? (
              <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.55 }}>
                El ciclo {estado.abierto.ciclo ?? estado.abierto.correlativo} sigue
                abierto. Hay que rendirlo antes de reponer: dos ciclos a la vez son
                dos fondos, y el saldo deja de significar nada.{" "}
                <Link href={`/memos/${estado.abierto.id}`}
                  style={{ color: "var(--accent)", fontWeight: 600 }}>
                  Ir al ciclo abierto
                </Link>
              </p>
            ) : (
              <>
                <p style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.45 }}>
                  Abre el ciclo siguiente apuntando al anterior. El que se cerró
                  queda cerrado con lo que se gastó: no se reabre.
                </p>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 2fr", gap: 11, marginTop: 12,
                }}>
                  <div>
                    <label className="fg-label" style={{ fontSize: 10.5 }}>Monto S/</label>
                    <input className="fg-input" type="number" inputMode="decimal"
                      step="0.01" min="0" value={monto}
                      onChange={e => setMonto(e.target.value)}
                      style={{ fontWeight: 700 }} />
                  </div>
                  <div>
                    <label className="fg-label" style={{ fontSize: 10.5 }}>Centro de costos</label>
                    <select className="fg-input" value={centro}
                      onChange={e => setCentro(e.target.value)}>
                      {centros.map(c => (
                        <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button className="btn-primary" onClick={reponer}
                  disabled={pendiente || !(Number(monto) > 0) || !centro}
                  style={{ marginTop: 13, width: "100%", justifyContent: "center" }}>
                  {pendiente ? "Reponiendo…" : "Reponer el fondo"}
                </button>
              </>
            )}

            {error && (
              <div style={{ marginTop: 12 }}>
                <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
              </div>
            )}
          </Tarjeta>
        </div>
      )}

      {/* ══ La historia del fondo ══ */}
      <div style={{ marginTop: 14 }}>
        <Tarjeta>
          <label className="fg-label">Ciclos</label>
          {ciclos.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5 }}>
              Esta caja todavía no tiene ningún ciclo. El primero se abre
              reponiendo el fondo.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
              {ciclos.map(c => (
                <Link key={c.id} href={`/memos/${c.id}`} style={{ textDecoration: "none" }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 11,
                    padding: "10px 12px", borderRadius: 9,
                    border: `1px solid ${VIVO.includes(c.estado) ? "var(--accent)" : "var(--border2)"}`,
                    background: VIVO.includes(c.estado) ? "rgba(0,162,152,0.04)" : "#FFFFFF",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        Ciclo {c.ciclo ?? "—"}
                      </span>
                      <p className="mono" style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>
                        {c.correlativo}{c.fecha && ` · ${c.fecha}`}
                      </p>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        {soles(c.monto)}
                      </div>
                      <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>
                        rindió {soles(c.rendido)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
