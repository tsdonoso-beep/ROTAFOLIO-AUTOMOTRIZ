"use client";
import { useState, useTransition } from "react";
import { Tarjeta, Aviso, Cifra } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoDescargar, IconoEnlace } from "./Iconos";
import { descargarCsv } from "@/lib/export/csv";
import { hojaDelHistorico, publicarHistoricoEnDrive } from "@/app/acciones/historico-sunat";

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
  const [hoja, setHoja] = useState<{ url: string; cuantos: number } | null>(null);

  const total = periodos.reduce((a, p) => a + p.cuantos, 0);

  const publicar = () => iniciar(async () => {
    setError(null); setHoja(null);
    const r = await publicarHistoricoEnDrive();
    if (!r.ok) { setError(r.motivo); return; }
    setHoja({ url: r.url, cuantos: r.cuantos });
  });

  const bajar = (periodo?: string) => iniciar(async () => {
    setError(null); setHoja(null);
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

      {hoja && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="ok" icono={<IconoCheck size={16} />}>
            Hoja publicada en Drive con {hoja.cuantos.toLocaleString("es-PE")} comprobantes.{" "}
            <a href={hoja.url} target="_blank" rel="noreferrer"
               style={{ color: "inherit", textDecoration: "underline" }}>
              Abrirla
            </a>
            <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.9 }}>
              El enlace no cambia: se reparte una vez y cada publicación actualiza la misma hoja.
            </span>
          </Aviso>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn-ghost" onClick={publicar} disabled={pendiente}
          style={{ flex: "1 1 220px", justifyContent: "center" }}>
          <IconoEnlace size={15} />
          {pendiente ? "Trabajando…" : "Publicar como hoja de Google"}
        </button>
        <button className="btn-ghost" onClick={() => bajar()} disabled={pendiente}
          style={{ flex: "1 1 220px", justifyContent: "center" }}>
          <IconoDescargar size={15} />
          {pendiente ? "Trabajando…" : `Bajar CSV (${total.toLocaleString("es-PE")})`}
        </button>
      </div>

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
