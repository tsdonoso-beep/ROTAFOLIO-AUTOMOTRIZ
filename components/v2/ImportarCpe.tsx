"use client";
import { useRef, useState, useTransition } from "react";
import { Tarjeta, Aviso, Cifra } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoComprobante, IconoDescargar, IconoEnlace, IconoGaleria } from "./Iconos";
import { descargarCsv } from "@/lib/export/csv";
import {
  importarComprobantesZip, publicarItemsEnDrive, hojaDeItems,
  type ResultadoImportacion,
} from "@/app/acciones/items-sunat";

/**
 * Importa el detalle de comprobantes desde el ZIP de la descarga masiva.
 *
 * El detalle de ítems —qué se compró, cuánto y a qué precio— no se baja por
 * API: sale del XML de cada comprobante. Una persona los baja de SUNAT y sube
 * el ZIP acá; de aquí sale la hoja para Contabilidad, una fila por ítem.
 */
export default function ImportarCpe({ empresas, periodos }: {
  empresas: string[];
  periodos: Array<{ periodo: string; cuantos: number }>;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [hoja, setHoja] = useState<{ url: string; cuantos: number } | null>(null);
  const [empresa, setEmpresa] = useState(empresas[0] ?? "");
  const archivoRef = useRef<HTMLInputElement>(null);

  const total = periodos.reduce((a, p) => a + p.cuantos, 0);

  const leerBase64 = (f: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("No se pudo leer el archivo."));
    r.readAsDataURL(f);
  });

  const subir = (f: File) => iniciar(async () => {
    setError(null); setResultado(null); setHoja(null);
    try {
      const base64 = await leerBase64(f);
      const r = await importarComprobantesZip(empresa, base64);
      if (!r.ok) { setError(r.motivo ?? "No se pudo importar."); return; }
      setResultado(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (archivoRef.current) archivoRef.current.value = "";
    }
  });

  const publicar = () => iniciar(async () => {
    setError(null); setHoja(null);
    const r = await publicarItemsEnDrive();
    if (!r.ok) { setError(r.motivo); return; }
    setHoja({ url: r.url, cuantos: r.cuantos });
  });

  const bajar = (periodo?: string) => iniciar(async () => {
    setError(null); setHoja(null);
    const h = await hojaDeItems(periodo);
    if (!h) { setError("No se pudo armar la hoja. ¿Sigue abierta la sesión?"); return; }
    if (h.cuantos === 0) { setError("No hay ítems de ese período."); return; }
    descargarCsv(h.nombre, h.filas);
  });

  return (
    <Tarjeta>
      <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 7 }}>
        <IconoComprobante size={17} />
        Detalle de comprobantes
      </p>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        El registro de compras trae la cabecera; el detalle de ítems sale del XML.
        Bájalo en SUNAT — <span className="mono" style={{ fontSize: 11 }}>Comprobantes de pago → SEE-SOL → Consultar Factura y Nota → Descarga masiva</span> — y sube el ZIP acá.
      </p>

      {periodos.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 14, paddingBottom: 16, borderBottom: "1px solid var(--borde)", marginBottom: 14,
        }}>
          <Cifra rotulo="comprobantes con detalle" valor={total.toLocaleString("es-PE")} tono="acento" tamano="m" />
          <Cifra rotulo="períodos" valor={String(periodos.length)} tamano="m" />
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="error" icono={<IconoAlerta size={16} />}>{error}</Aviso>
        </div>
      )}

      {resultado?.ok && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="ok" icono={<IconoCheck size={16} />}>
            Importados <strong>{resultado.items?.toLocaleString("es-PE")}</strong> ítems
            de {((resultado.nuevos ?? 0) + (resultado.actualizados ?? 0)).toLocaleString("es-PE")} comprobantes
            {" "}({resultado.nuevos} nuevos, {resultado.actualizados} actualizados) de {resultado.archivos} XML.
            {resultado.ajenos ? (
              <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.9 }}>
                {resultado.ajenos} no eran ni de compra ni de venta de esta empresa; se guardaron como «otro».
              </span>
            ) : null}
          </Aviso>
        </div>
      )}

      {hoja && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="ok" icono={<IconoCheck size={16} />}>
            Hoja publicada con {hoja.cuantos.toLocaleString("es-PE")} ítems.{" "}
            <a href={hoja.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
              Abrirla
            </a>
            <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.9 }}>
              El enlace no cambia: cada publicación actualiza la misma hoja.
            </span>
          </Aviso>
        </div>
      )}

      {empresas.length > 1 && (
        <label style={{ display: "block", marginBottom: 10 }}>
          <span className="rotulo" style={{ display: "block", marginBottom: 5 }}>Empresa del ZIP</span>
          <select value={empresa} onChange={e => setEmpresa(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, borderRadius: 8, border: "1px solid var(--borde)", background: "var(--fondo)", color: "var(--text)" }}>
            {empresas.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
      )}

      <input ref={archivoRef} type="file" accept=".zip,application/zip"
        onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }}
        disabled={pendiente} style={{ display: "none" }} />

      <button className="btn-primary" onClick={() => archivoRef.current?.click()} disabled={pendiente || !empresa}
        style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}>
        <IconoGaleria size={15} />
        {pendiente ? "Trabajando…" : "Subir ZIP de la descarga masiva"}
      </button>

      {periodos.length > 0 && (
        <>
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
        </>
      )}

      <p style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
        Una fila por ítem, con la cabecera del comprobante repetida. Reimportar el
        mismo ZIP no duplica: un comprobante ya visto se actualiza.
      </p>
    </Tarjeta>
  );
}
