"use client";
import Link from "next/link";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoAtras, IconoCheck, IconoDescargar } from "./Iconos";
import { descargarCsv } from "@/lib/export/csv";
import { filasLiquidacion, nombreArchivoLiquidacion } from "@/lib/export/liquidacion";
import type { Liquidacion, SituacionMemo } from "@/lib/dominio/liquidacion";

const NOMBRE_SITUACION: Record<SituacionMemo, string> = {
  liquidable: "Cerrado",
  en_revision: "En revisión",
  abierta: "Abierto",
};

interface Props {
  persona: { nombre: string; dni: string };
  liquidacion: Liquidacion;
  emitidoPor: string;
}

export default function VistaLiquidacion({ persona, liquidacion: l, emitidoPor }: Props) {
  const debe = l.neto > 0;
  const leDeben = l.neto < 0;

  const exportar = () => {
    const cabecera = {
      nombre: persona.nombre,
      dni: persona.dni,
      emitidoPor,
      emitidoEn: new Date().toISOString().slice(0, 10),
    };
    descargarCsv(nombreArchivoLiquidacion(cabecera), filasLiquidacion(cabecera, l));
  };

  return (
    <>
      <Link href="/liquidaciones" className="hover-atras" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Liquidaciones
      </Link>

      <Tarjeta padding={0} style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "20px 22px 16px" }}>
          <h1 className="font-display" style={{
            fontSize: 21, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em",
          }}>
            {persona.nombre}
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 4 }}>
            <span className="mono">{persona.dni}</span>
            {" · "}{l.lineas.length} memo{l.lineas.length === 1 ? "" : "s"} con movimiento
          </p>
        </div>

        {/* El resultado primero: es la razón por la que se abre esta pantalla. */}
        <div style={{
          background: "var(--surface2)", borderTop: "1px solid var(--border)",
          padding: "18px 22px 20px",
        }}>
          <p className="rotulo" style={{ marginBottom: 6 }}>
            {debe ? "Debe devolver" : leDeben ? "Se le reembolsa" : "Saldo"}
          </p>
          <p className="cifra cifra-xl" style={{
            color: debe ? "var(--accent-texto)" : leDeben ? "var(--danger)" : "var(--text2)",
          }}>
            {l.neto === 0 ? soles(0) : soles(Math.abs(l.neto))}
          </p>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12, marginTop: 16, paddingTop: 15, borderTop: "1px solid var(--border)",
          }}>
            <Dato rotulo="Autorizado" valor={soles(l.autorizado)} />
            <Dato rotulo="Rendido" valor={soles(l.rendido)} />
            <Dato rotulo="A favor de la empresa" valor={soles(l.devuelve)} />
            <Dato rotulo="A favor de la persona" valor={soles(l.reembolsa)} />
          </div>
          <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 11, lineHeight: 1.5 }}>
            Estas cifras corresponden solo a las rendiciones ya revisadas.
          </p>
        </div>
      </Tarjeta>

      {l.sinCerrar > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              Liquidación parcial.
            </strong>{" "}
            Hay {l.sinCerrar} memo{l.sinCerrar === 1 ? "" : "s"} sin cerrar por{" "}
            {soles(l.montoSinCerrar)} que no entra{l.sinCerrar === 1 ? "" : "n"} en el
            neto: mientras la rendición no esté revisada, su monto todavía puede
            cambiar. Pagar contra este número dejaría plata sin justificar.
          </Aviso>
        </div>
      ) : l.lineas.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="ok" icono={<IconoCheck size={17} />}>
            Todas las rendiciones están cerradas: este neto es final y se puede
            pasar a pago.
          </Aviso>
        </div>
      )}

      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 11, gap: 12,
      }}>
        <p className="rotulo">Detalle memo por memo</p>
        <button className="btn-ghost" onClick={exportar} style={{ padding: "8px 14px", fontSize: 12.5 }}>
          <IconoDescargar size={15} />
          Descargar documento
        </button>
      </div>

      <Tarjeta padding={0}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                {["Memo", "Situación", "Autorizado", "Rendido", "Saldo"].map((h, i) => (
                  <th key={h} style={{
                    padding: "10px 15px", textAlign: i <= 1 ? "left" : "right",
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                    textTransform: "uppercase", color: "var(--text3)",
                    fontFamily: "var(--font-sora), sans-serif", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {l.lineas.map((linea, i) => {
                const cerrado = linea.situacion === "liquidable";
                return (
                  <tr key={linea.memoId} style={{
                    borderBottom: i < l.lineas.length - 1 ? "1px solid var(--border)" : "none",
                    // Lo que no cuenta para el neto se atenúa: se ve, pero no
                    // se confunde con lo que sí se está pagando.
                    opacity: cerrado ? 1 : 0.62,
                  }}>
                    <td style={{ padding: "11px 15px" }}>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>
                        {linea.correlativo}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        {linea.fecha ?? "sin fecha"}
                        {linea.destino && ` · ${linea.destino}`}
                      </span>
                    </td>
                    <td style={{ padding: "11px 15px" }}>
                      <span className="badge" style={
                        cerrado
                          ? { background: "var(--success-bg)", color: "var(--success)" }
                          : { background: "var(--warn-bg)", color: "var(--warn)" }
                      }>
                        {NOMBRE_SITUACION[linea.situacion]}
                      </span>
                    </td>
                    <td className="cifra" style={{ padding: "11px 15px", textAlign: "right", fontSize: 13 }}>
                      {soles(linea.autorizado)}
                    </td>
                    <td className="cifra" style={{ padding: "11px 15px", textAlign: "right", fontSize: 13 }}>
                      {soles(linea.rendido)}
                    </td>
                    <td className="cifra" style={{
                      padding: "11px 15px", textAlign: "right", fontSize: 13, fontWeight: 700,
                      color: linea.saldo > 0 ? "var(--accent-texto)"
                        : linea.saldo < 0 ? "var(--danger)" : "var(--text3)",
                    }}>
                      {linea.saldo === 0 ? "—" : soles(linea.saldo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}

function Dato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="rotulo">{rotulo}</p>
      <p className="cifra" style={{ fontSize: 14, marginTop: 3, color: "var(--text)" }}>
        {valor}
      </p>
    </div>
  );
}
