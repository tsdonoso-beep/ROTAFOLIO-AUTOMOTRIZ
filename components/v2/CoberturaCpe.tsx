"use client";
import { useState, useTransition } from "react";
import { Tarjeta, Aviso } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoTablero, IconoDescargar, IconoEnlace } from "./Iconos";
import { descargarCsv } from "@/lib/export/csv";
import {
  resumenCobertura, hojaDeCobertura, publicarCoberturaEnDrive, publicarResumenCoberturaEnDrive,
} from "@/app/acciones/cobertura-sunat";
import type { FilaResumenCobertura } from "@/lib/export/cobertura-sunat";

/**
 * Cuánto de lo que SUNAT dice que existe (RCE) ya tiene su detalle bajado.
 *
 * Es el checklist del backfill hecho pantalla: por cada mes, cuántas
 * facturas/boletas/notas hay en el registro de compras y cuántas de esas ya
 * tienen su XML importado. Antes de esto había que consultar la base a mano
 * para saberlo.
 */
export default function CoberturaCpe({ resumenInicial }: { resumenInicial: FilaResumenCobertura[] }) {
  const [pendiente, iniciar] = useTransition();
  const [resumen, setResumen] = useState(resumenInicial);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<{ url: string; cuantos: number; cual: string } | null>(null);

  const total = resumen.reduce((a, r) => a + (r.enSire ?? 0), 0);
  const conDetalle = resumen.reduce((a, r) => a + (r.conDetalle ?? 0), 0);
  const pctGeneral = total > 0 ? (conDetalle / total) * 100 : 0;

  const actualizar = () => iniciar(async () => {
    setError(null);
    setResumen(await resumenCobertura());
  });

  const bajarCsv = () => iniciar(async () => {
    setError(null); setHoja(null);
    const h = await hojaDeCobertura();
    if (!h) { setError("No se pudo armar la hoja. ¿Sigue abierta la sesión?"); return; }
    if (h.cuantos === 0) { setError("No hay comprobantes en el registro de compras todavía."); return; }
    descargarCsv(h.nombre, h.filas);
  });

  const publicar = (cual: "detalle" | "resumen") => iniciar(async () => {
    setError(null); setHoja(null);
    const r = cual === "detalle" ? await publicarCoberturaEnDrive() : await publicarResumenCoberturaEnDrive();
    if (!r.ok) { setError(r.motivo); return; }
    setHoja({ url: r.url, cuantos: r.cuantos, cual: cual === "detalle" ? "COBERTURA" : "RESUMEN" });
  });

  return (
    <Tarjeta>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 7 }}>
          <IconoTablero size={17} />
          Cobertura: RCE vs. detalle bajado
        </p>
        <button className="btn-ghost" onClick={actualizar} disabled={pendiente} style={{ fontSize: 11.5 }}>
          Actualizar
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        El registro de compras trae TODO lo declarado a SUNAT; el detalle solo
        existe para lo que ya bajaste con el scraper. Esto dice cuánto falta,
        mes por mes — solo cuenta facturas, boletas y notas (lo demás, como
        recibos por servicios públicos, no tiene XML que bajar).
      </p>

      {resumen.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--text3)" }}>Sin datos todavía.</p>
      ) : (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 14, paddingBottom: 14, borderBottom: "1px solid var(--borde)", marginBottom: 12,
          }}>
            <div>
              <p className="cifra cifra-m" style={{ color: "var(--accent-texto)" }}>{pctGeneral.toFixed(1)}%</p>
              <p className="rotulo" style={{ marginTop: 5 }}>cobertura general</p>
            </div>
            <div>
              <p className="cifra cifra-m">{conDetalle.toLocaleString("es-PE")}</p>
              <p className="rotulo" style={{ marginTop: 5 }}>con detalle</p>
            </div>
            <div>
              <p className="cifra cifra-m">{(total - conDetalle).toLocaleString("es-PE")}</p>
              <p className="rotulo" style={{ marginTop: 5 }}>sin detalle</p>
            </div>
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 14 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text3)", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px 4px 0", fontWeight: 500 }}>Período</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>En el RCE</th>
                  <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Con detalle</th>
                  <th style={{ padding: "4px 0", fontWeight: 500, textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map(r => (
                  <tr key={r.periodo} style={{ borderTop: "1px solid var(--borde)" }}>
                    <td className="mono" style={{ padding: "5px 8px 5px 0" }}>{r.periodo}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.enSire}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.conDetalle}</td>
                    <td style={{
                      padding: "5px 0", textAlign: "right",
                      color: (r.pctCobertura ?? 0) >= 80 ? "var(--success)" : (r.pctCobertura ?? 0) >= 30 ? "var(--warn)" : "var(--danger)",
                    }}>
                      {r.pctCobertura?.toFixed(0) ?? "0"}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="error" icono={<IconoAlerta size={16} />}>{error}</Aviso>
        </div>
      )}

      {hoja && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="ok" icono={<IconoCheck size={16} />}>
            Hoja de {hoja.cual.toLowerCase()} publicada con {hoja.cuantos.toLocaleString("es-PE")} filas.{" "}
            <a href={hoja.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
              Abrirla
            </a>
          </Aviso>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn-ghost" onClick={() => publicar("detalle")} disabled={pendiente} style={{ flex: "1 1 200px", justifyContent: "center" }}>
          <IconoEnlace size={15} />
          Publicar detalle
        </button>
        <button className="btn-ghost" onClick={() => publicar("resumen")} disabled={pendiente} style={{ flex: "1 1 200px", justifyContent: "center" }}>
          <IconoEnlace size={15} />
          Publicar resumen
        </button>
        <button className="btn-ghost" onClick={bajarCsv} disabled={pendiente} style={{ flex: "1 1 200px", justifyContent: "center" }}>
          <IconoDescargar size={15} />
          Bajar CSV del detalle
        </button>
      </div>
    </Tarjeta>
  );
}
