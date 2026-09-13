"use client";
import { useState, useTransition } from "react";
import { Tarjeta, Aviso, Cifra } from "./Encabezado";
import { IconoAlerta, IconoDescargar } from "./Iconos";
import { descargarCsv } from "@/lib/export/csv";
import { hojaDelHistorico } from "@/app/acciones/historico-sunat";

/**
 * Descarga del histórico de comprobantes.
 *
 * La hoja es la salida, no el almacén: lo que permite notar que un
 * comprobante cambió es tenerlos guardados. Por eso se descarga y no se
 * sincroniza —una hoja que se pisa sola pierde justamente la historia.
 */
export default function HistoricoSunat({ periodos }: {
  periodos: Array<{ periodo: string; cuantos: number }>;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = periodos.reduce((a, p) => a + p.cuantos, 0);

  const bajar = (periodo?: string) => iniciar(async () => {
    setError(null);
    const hoja = await hojaDelHistorico(periodo);
    if (!hoja) { setError("No se pudo armar la hoja. ¿Sigue abierta la sesión?"); return; }
    if (hoja.cuantos === 0) { setError("No hay comprobantes guardados de ese período."); return; }
    descargarCsv(hoja.nombre, hoja.filas);
  });

  if (!periodos.length) {
    return (
      <Tarjeta>
        <p className="rotulo" style={{ marginBottom: 8 }}>Histórico de comprobantes</p>
        <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.55 }}>
          Todavía no hay comprobantes guardados. Cada consulta a SUNAT los va
          archivando acá, y de aquí sale la hoja para Contabilidad.
        </p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta>
      <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        Histórico de comprobantes
      </p>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        Todo lo que SUNAT ha reportado a nombre de la empresa, con quién lo rindió
        y si cambió desde que lo vimos por primera vez.
      </p>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 14, paddingBottom: 16, borderBottom: "1px solid var(--borde)", marginBottom: 14,
      }}>
        <Cifra rotulo="comprobantes guardados" valor={total.toLocaleString("es-PE")} tono="acento" tamano="m" />
        <Cifra rotulo="períodos" valor={String(periodos.length)} tamano="m" />
      </div>

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="error" icono={<IconoAlerta size={16} />}>{error}</Aviso>
        </div>
      )}

      <button className="btn-ghost" onClick={() => bajar()} disabled={pendiente}
        style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}>
        <IconoDescargar size={15} />
        {pendiente ? "Armando la hoja…" : `Bajar todo (${total.toLocaleString("es-PE")} comprobantes)`}
      </button>

      <p className="rotulo" style={{ marginBottom: 7 }}>O un período suelto</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {periodos.map(p => (
          <button key={p.periodo} className="btn-ghost" onClick={() => bajar(p.periodo)}
            disabled={pendiente} style={{ fontSize: 12 }}>
            <span className="mono">{p.periodo}</span>
            <span style={{ color: "var(--text3)", marginLeft: 6 }}>{p.cuantos}</span>
          </button>
        ))}
      </div>

      <p style={{ marginTop: 10, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
        Se abre en Excel con las columnas separadas y las tildes bien. La columna
        «Lo rindió» es la que SUNAT no puede darte: sale de cruzar contra lo que
        capturó tu gente.
      </p>
    </Tarjeta>
  );
}
