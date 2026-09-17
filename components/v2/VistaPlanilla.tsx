"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Aviso, Cifra, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoAtras, IconoBasura, IconoCheck, IconoMas } from "./Iconos";
import { agregarDesplazamiento, autorizarPlanilla, quitarDesplazamiento } from "@/app/acciones/movilidad";
import { diasExcedidos, listar, revisarPlanilla, type Desplazamiento } from "@/lib/dominio/movilidad";
import type { Parametros } from "@/lib/dominio/tipos";

interface Props {
  planilla: {
    id: string; numero: string; periodo: string | null;
    fechaEmision: string | null; autorizadoEn: string | null;
    autorizadorNombre: string | null;
  };
  trabajador: { nombre: string | null; dni: string | null; dniProvisional: boolean };
  desplazamientos: Desplazamiento[];
  parametros: Parametros;
  puedeEditar: boolean;
  puedeAutorizar: boolean;
}

export default function VistaPlanilla({
  planilla, trabajador, desplazamientos, parametros, puedeEditar, puedeAutorizar,
}: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("");
  const [monto, setMonto] = useState("");

  const r = useMemo(
    () => revisarPlanilla(desplazamientos, trabajador),
    [desplazamientos, trabajador]
  );
  const excedidos = useMemo(
    () => diasExcedidos(desplazamientos, parametros.tope_movilidad_dia ?? null),
    [desplazamientos, parametros]
  );

  const firmada = planilla.autorizadoEn !== null;

  const agregar = () => {
    setError("");
    iniciar(async () => {
      const res = await agregarDesplazamiento({
        planillaId: planilla.id, fecha, motivo, destino, monto: Number(monto),
      });
      if (!res.ok) { setError(res.error); return; }
      setMotivo(""); setDestino(""); setMonto("");
      router.refresh();
    });
  };

  const quitar = (gastoId: string) => {
    setError("");
    iniciar(async () => {
      const res = await quitarDesplazamiento(gastoId, planilla.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  const firmar = () => {
    setError("");
    iniciar(async () => {
      const res = await autorizarPlanilla(planilla.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/movilidad" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Planillas de movilidad
      </Link>

      {/* ══ Cabecera: los datos que van arriba del formulario ══ */}
      <Tarjeta>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h1 className="font-display mono" style={{
              fontSize: 21, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em",
            }}>
              Planilla N° {planilla.numero}
            </h1>
            <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 4 }}>
              {trabajador.nombre ?? "—"}
              {trabajador.dni && <> · DNI <span className="mono">{trabajador.dni}</span></>}
              {planilla.periodo && ` · ${planilla.periodo}`}
            </p>
          </div>
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
            background: firmada ? "rgba(0,162,152,0.10)" : "var(--warn-bg, rgba(217,119,6,0.08))",
            color: firmada ? "var(--accent)" : "var(--warn)",
          }}>
            {firmada ? "AUTORIZADA" : "SIN FIRMAR"}
          </span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 18,
        }}>
          <Cifra rotulo="Total anotado" valor={soles(r.total)} tamano="l" tono="tenue" />
          <Cifra rotulo="Sustenta el gasto" valor={soles(r.sustentado)} tamano="xl" tono="acento" />
          <Cifra
            rotulo="En riesgo"
            valor={soles(r.enRiesgo)}
            tamano="l"
            tono={r.enRiesgo > 0 ? "peligro" : "neutro"}
          />
        </div>
      </Tarjeta>

      {/* ══ La regla que decide todo esto ══ */}
      {r.sinSustentar > 0 && (
        <div style={{ marginTop: 14 }}>
          <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              {r.sinSustentar} de {r.filas.length} desplazamiento
              {r.filas.length === 1 ? "" : "s"} no sustenta
              {r.sinSustentar === 1 ? "" : "n"} el gasto.
            </strong>{" "}
            La ley es clara en que se cae la fila y no la planilla: lo que falte
            «sólo inhabilita la planilla para la sustentación del gasto que
            corresponde a tal desplazamiento». El resto sigue valiendo.
          </Aviso>
        </div>
      )}

      {excedidos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              Tope diario excedido.
            </strong>{" "}
            {excedidos.map(e => `el ${e.fecha} se gastó ${soles(e.gastado)}`).join(", ")}
            {" "}sobre un tope de {soles(parametros.tope_movilidad_dia ?? 0)} por día.
          </Aviso>
        </div>
      )}

      {/* ══ Una fila por desplazamiento ══ */}
      <div style={{ marginTop: 14 }}>
        <Tarjeta>
          <label className="fg-label">Desplazamientos</label>

          {r.filas.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 8 }}>
              Todavía no hay ninguno. Cada viaje va en su propia fila con su
              fecha, su motivo, su destino y su monto: es lo que la ley pide
              para aceptarlo.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {desplazamientos.map(dz => {
                const fila = r.filas.find(f => f.id === dz.id)!;
                return (
                  <div key={dz.id} style={{
                    border: `1px solid ${fila.sustenta ? "var(--border2)" : "rgba(217,119,6,0.35)"}`,
                    borderRadius: 10, padding: "11px 12px",
                    background: fila.sustenta ? "#FFFFFF" : "var(--warn-bg, rgba(217,119,6,0.04))",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                      <span style={{
                        color: fila.sustenta ? "var(--accent)" : "var(--warn)",
                        marginTop: 2, flexShrink: 0,
                      }}>
                        {fila.sustenta ? <IconoCheck size={15} /> : <IconoAlerta size={15} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
                          {dz.motivo || <em style={{ color: "var(--text3)" }}>sin motivo</em>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 2 }}>
                          {dz.fecha ?? "sin fecha"}
                          {" · "}
                          {dz.destino || "sin destino"}
                        </div>
                        {!fila.sustenta && (
                          <p style={{
                            fontSize: 11.5, color: "var(--warn)", marginTop: 6, lineHeight: 1.45,
                          }}>
                            Falta {listar(fila.faltas)}. Este desplazamiento no
                            sustenta el gasto ante SUNAT.
                          </p>
                        )}
                      </div>
                      <strong style={{ fontSize: 13.5, color: "var(--text)", flexShrink: 0 }}>
                        {soles(dz.monto ?? 0)}
                      </strong>
                      {puedeEditar && !firmada && (
                        <button onClick={() => quitar(dz.id)} disabled={pendiente}
                          title="Quitar este desplazamiento"
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "var(--text3)", padding: 0, flexShrink: 0,
                          }}>
                          <IconoBasura size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ Agregar uno ══ */}
          {puedeEditar && !firmada && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border2)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                <div>
                  <label className="fg-label" style={{ fontSize: 10.5 }}>Fecha del gasto</label>
                  <input className="fg-input" type="date" value={fecha}
                    onChange={e => setFecha(e.target.value)} />
                </div>
                <div>
                  <label className="fg-label" style={{ fontSize: 10.5 }}>Monto S/</label>
                  <input className="fg-input" type="number" inputMode="decimal"
                    step="0.01" min="0" value={monto} placeholder="10.50"
                    onChange={e => setMonto(e.target.value)} style={{ fontWeight: 700 }} />
                </div>
              </div>
              <div style={{ marginTop: 9 }}>
                <label className="fg-label" style={{ fontSize: 10.5 }}>Motivo</label>
                <input className="fg-input" value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="MOVILIDAD OFICINA - DOMICILIO (VISITA TÉCNICA)" />
              </div>
              <div style={{ marginTop: 9 }}>
                <label className="fg-label" style={{ fontSize: 10.5 }}>Destino</label>
                <input className="fg-input" value={destino}
                  onChange={e => setDestino(e.target.value)} placeholder="OFICINA - DOMICILIO" />
              </div>
              {/* La ley los nombra por separado, y no son lo mismo: el motivo
                  es el porqué, el destino es el recorrido. */}
              <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
                El motivo es el porqué; el destino, el recorrido. La ley los pide
                por separado.
              </p>

              <button className="btn-primary" onClick={agregar}
                disabled={pendiente || !(Number(monto) > 0)}
                style={{ marginTop: 13, width: "100%", justifyContent: "center" }}>
                <IconoMas size={15} />
                {pendiente ? "Agregando…" : "Agregar desplazamiento"}
              </button>
            </div>
          )}
        </Tarjeta>
      </div>

      {error && (
        <div style={{
          marginTop: 14, padding: "12px 14px", borderRadius: 10,
          background: "var(--danger-bg)", border: "1px solid rgba(220,38,38,0.2)",
        }}>
          <p style={{ fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>{error}</p>
        </div>
      )}

      {/* ══ Las dos firmas del formulario ══ */}
      <div style={{ marginTop: 14 }}>
        <Tarjeta>
          <label className="fg-label">Autorizado</label>
          {firmada ? (
            <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5 }}>
              Firmada por {planilla.autorizadorNombre ?? "la jefatura"} el{" "}
              {planilla.autorizadoEn?.slice(0, 10)}. Una planilla firmada ya no
              admite desplazamientos nuevos: la firma cubre lo que había cuando
              se dio.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5 }}>
                El formulario tiene dos firmas: la del trabajador y la casilla
                AUTORIZADO, que firma la jefatura. Falta esta segunda.
              </p>
              {puedeAutorizar && (
                <button className="btn-primary" onClick={firmar} disabled={pendiente}
                  style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
                  {pendiente ? "Firmando…" : "Autorizar la planilla"}
                </button>
              )}
            </>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
