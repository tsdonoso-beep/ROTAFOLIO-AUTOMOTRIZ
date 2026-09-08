"use client";
import { useCallback } from "react";
import { completarImportes, importesCuadran, NOMBRE_ORIGEN, type Origen } from "@/lib/ocr/fusion";
import { rucValido } from "@/lib/dominio/validaciones";
import { sinSustentoFormal } from "@/lib/ocr/fusion";
import { soles } from "./Encabezado";
import { IconoAlerta, IconoCheck } from "./Iconos";
import type { Parametros, ResultadoExtraccion } from "@/lib/dominio/tipos";

/**
 * Lo que la caja recibe en la práctica. "Constancia de pago" es el código
 * 00 del catálogo de SUNAT —otros— y cubre el Yape, el Plin y la
 * transferencia: pagos reales que no son comprobantes de pago.
 */
const TIPOS = [
  { codigo: "01", nombre: "Factura" },
  { codigo: "03", nombre: "Boleta" },
  { codigo: "12", nombre: "Ticket" },
  { codigo: "00", nombre: "Constancia de pago" },
  { codigo: "07", nombre: "Nota de crédito" },
  { codigo: "08", nombre: "Nota de débito" },
];

const FORMAS_PAGO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"];

interface Props {
  valores: ResultadoExtraccion;
  origen: Record<string, Origen>;
  onCambio: (valores: ResultadoExtraccion, origen: Record<string, Origen>) => void;
  parametros: Parametros;
}

/**
 * Formulario de un comprobante, común a las tres vías de carga.
 *
 * Cada campo lleva la marca de dónde salió su valor —leído, IA, calculado o
 * tuyo— para que quien confirma sepa qué está revisando y qué está afirmando.
 * En cuanto la persona toca un campo, ese campo pasa a ser suyo.
 */
export default function FormularioGasto({ valores, origen, onCambio, parametros }: Props) {
  const fijar = useCallback((
    cambios: Partial<ResultadoExtraccion>,
    campos: string[],
    comoOrigen: Origen = "manual"
  ) => {
    const nuevos = { ...valores, ...cambios };
    const nuevoOrigen = { ...origen };
    for (const c of campos) nuevoOrigen[c] = comoOrigen;
    onCambio(nuevos, nuevoOrigen);
  }, [valores, origen, onCambio]);

  /**
   * El total es el campo que arrastra a los demás: al cambiarlo se recalcula
   * la base y el IGV, que es lo que permite cargar un gasto tecleando poco.
   */
  const cambiarTotal = (texto: string) => {
    const total = Number(texto) || 0;
    const recalculado = completarImportes(
      { total, subtotal: valores.subtotal, igv: valores.igv },
      { igvPorcentaje: parametros.igv_porcentaje, tipoComprobante: valores.tipo_comprobante }
    );
    const nuevoOrigen: Record<string, Origen> = { ...origen, total: "manual" };
    if (recalculado.subtotal !== valores.subtotal) nuevoOrigen.subtotal = "derivado";
    if (recalculado.igv !== valores.igv) nuevoOrigen.igv = "derivado";
    onCambio({ ...valores, ...recalculado }, nuevoOrigen);
  };

  const cambiarParte = (campo: "subtotal" | "igv", texto: string) => {
    const n = Number(texto) || 0;
    const recalculado = completarImportes(
      { ...{ subtotal: valores.subtotal, igv: valores.igv, total: valores.total }, [campo]: n },
      {
        igvPorcentaje: parametros.igv_porcentaje,
        tipoComprobante: valores.tipo_comprobante,
        editado: campo,
      }
    );
    const otro = campo === "subtotal" ? "igv" : "subtotal";
    onCambio(
      { ...valores, ...recalculado },
      { ...origen, [campo]: "manual", [otro]: "derivado" }
    );
  };

  /** Cambiar el tipo cambia la aritmética: una boleta no discrimina IGV. */
  const cambiarTipo = (codigo: string) => {
    const recalculado = completarImportes(
      { subtotal: valores.subtotal, igv: valores.igv, total: valores.total },
      { igvPorcentaje: parametros.igv_porcentaje, tipoComprobante: codigo }
    );
    onCambio(
      { ...valores, tipo_comprobante: codigo, ...recalculado },
      { ...origen, tipo_comprobante: "manual", subtotal: "derivado", igv: "derivado" }
    );
  };

  const rucEscrito = valores.proveedor_ruc.trim();
  const rucMalo = rucEscrito.length === 11 && !rucValido(rucEscrito);
  const cuadran = importesCuadran({
    subtotal: valores.subtotal, igv: valores.igv, total: valores.total,
  });
  const sinSustento = sinSustentoFormal(valores);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Documento ── */}
      <Grupo titulo="Documento" opcional>
        <Campo etiqueta="Tipo" origen={origen.tipo_comprobante} confianza={valores._confianza.tipo_comprobante}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIPOS.map(t => {
              const activo = valores.tipo_comprobante === t.codigo;
              return (
                <button
                  key={t.codigo} type="button" onClick={() => cambiarTipo(t.codigo)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                    fontSize: 12.5, fontWeight: activo ? 700 : 600,
                    fontFamily: "var(--font-sora), sans-serif",
                    border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                    background: activo ? "var(--accent-suave)" : "var(--surface)",
                    color: activo ? "var(--accent-texto)" : "var(--text2)",
                    transition: "all var(--rapido) var(--curva)",
                  }}
                >
                  {t.nombre}
                </button>
              );
            })}
          </div>
        </Campo>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
          <Campo etiqueta="Serie" origen={origen.serie} confianza={valores._confianza.serie}>
            <input
              className="fg-input mono" value={valores.serie}
              placeholder="F001"
              onChange={e => fijar({ serie: e.target.value.toUpperCase() }, ["serie"])}
            />
          </Campo>
          <Campo etiqueta="Número" origen={origen.numero} confianza={valores._confianza.numero}>
            <input
              className="fg-input mono" value={valores.numero}
              placeholder="00002591" inputMode="numeric"
              onChange={e => fijar({ numero: e.target.value }, ["numero"])}
            />
          </Campo>
        </div>

        <Campo etiqueta="Fecha de emisión" origen={origen.fecha_emision} confianza={valores._confianza.fecha_emision}>
          <input
            className="fg-input" type="date" value={valores.fecha_emision}
            onChange={e => fijar({ fecha_emision: e.target.value }, ["fecha_emision"])}
          />
        </Campo>
      </Grupo>

      {/* ── Proveedor ── */}
      <Grupo titulo="Proveedor" opcional>
        <Campo
          etiqueta="RUC" origen={origen.proveedor_ruc} confianza={valores._confianza.proveedor_ruc}
          error={rucMalo ? "El dígito verificador no cuadra. Revisa el número." : undefined}
        >
          <input
            className="fg-input mono" value={valores.proveedor_ruc}
            placeholder="20100128056" inputMode="numeric" maxLength={11}
            onChange={e => fijar({ proveedor_ruc: e.target.value.replace(/\D/g, "") }, ["proveedor_ruc"])}
            style={rucMalo ? { borderColor: "var(--danger)" } : undefined}
          />
        </Campo>

        <Campo etiqueta="Razón social" origen={origen.proveedor_nombre} confianza={valores._confianza.proveedor_nombre}>
          <input
            className="fg-input" value={valores.proveedor_nombre}
            placeholder="Nombre del proveedor"
            onChange={e => fijar({ proveedor_nombre: e.target.value }, ["proveedor_nombre"])}
          />
        </Campo>

        {/*
          Sin RUC ni numeración el gasto se registra igual —es el caso del
          Yape o la transferencia—, pero deja de dar crédito fiscal. Se dice
          aquí, mientras se puede corregir, y no recién al cerrar el mes.
        */}
        {sinSustento && valores.total > 0 && (
          <div style={{
            padding: "10px 12px", borderRadius: "var(--radio-s)",
            background: "var(--warn-bg)", border: "1px solid rgba(180,83,9,0.2)",
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <span style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }}>
              <IconoAlerta size={15} />
            </span>
            <p style={{ fontSize: 11.5, color: "var(--warn)", lineHeight: 1.5 }}>
              Sin RUC ni numeración este gasto <strong>no otorga crédito
              fiscal</strong>. Igual se archiva: quedará marcado para que
              Contabilidad lo trate aparte.
            </p>
          </div>
        )}
      </Grupo>

      {/* ── Importes ── */}
      <Grupo titulo="Importes">
        <Campo
          etiqueta={`Total (${valores.moneda === "USD" ? "US$" : "S/"})`}
          origen={origen.total} confianza={valores._confianza.total} obligatorio
        >
          <input
            className="fg-input cifra" value={valores.total || ""}
            placeholder="0.00" inputMode="decimal" type="number" step="0.01"
            onChange={e => cambiarTotal(e.target.value)}
            style={{ fontSize: 20, fontWeight: 800, padding: "12px 14px" }}
          />
          <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 5, lineHeight: 1.45 }}>
            Es lo único imprescindible. La base y el IGV se calculan solos.
          </p>
        </Campo>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Campo etiqueta="Base imponible" origen={origen.subtotal} confianza={valores._confianza.subtotal}>
            <input
              className="fg-input cifra" value={valores.subtotal || ""}
              placeholder="0.00" inputMode="decimal" type="number" step="0.01"
              onChange={e => cambiarParte("subtotal", e.target.value)}
            />
          </Campo>
          <Campo etiqueta={`IGV (${parametros.igv_porcentaje}%)`} origen={origen.igv} confianza={valores._confianza.igv}>
            <input
              className="fg-input cifra" value={valores.igv || ""}
              placeholder="0.00" inputMode="decimal" type="number" step="0.01"
              onChange={e => cambiarParte("igv", e.target.value)}
            />
          </Campo>
        </div>

        {valores.total > 0 && (
          <p style={{
            fontSize: 11.5, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 6,
            color: cuadran ? "var(--success)" : "var(--danger)",
          }}>
            {cuadran ? <IconoCheck size={14} /> : <IconoAlerta size={14} />}
            {cuadran
              ? `Cuadra: ${soles(valores.subtotal)} + ${soles(valores.igv)} = ${soles(valores.total)}`
              : `No cuadra: ${soles(valores.subtotal)} + ${soles(valores.igv)} ≠ ${soles(valores.total)}`}
          </p>
        )}

        <Campo etiqueta="Moneda" origen={origen.moneda} confianza={valores._confianza.moneda}>
          <div style={{ display: "flex", gap: 6 }}>
            {(["PEN", "USD"] as const).map(m => (
              <button
                key={m} type="button"
                onClick={() => fijar({ moneda: m }, ["moneda"])}
                style={{
                  padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                  fontSize: 12.5, fontWeight: valores.moneda === m ? 700 : 600,
                  fontFamily: "var(--font-sora), sans-serif",
                  border: `1px solid ${valores.moneda === m ? "var(--accent)" : "var(--border2)"}`,
                  background: valores.moneda === m ? "var(--accent-suave)" : "var(--surface)",
                  color: valores.moneda === m ? "var(--accent-texto)" : "var(--text2)",
                }}
              >
                {m === "PEN" ? "Soles" : "Dólares"}
              </button>
            ))}
          </div>
        </Campo>
      </Grupo>

      {/* ── Complementarios ── */}
      <Grupo titulo="Complementarios" opcional>
        <Campo etiqueta="Forma de pago" origen={origen.forma_pago} confianza={valores._confianza.forma_pago}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FORMAS_PAGO.map(f => {
              const activo = valores.forma_pago === f;
              return (
                <button
                  key={f} type="button"
                  onClick={() => fijar({ forma_pago: activo ? "" : f }, ["forma_pago"])}
                  style={{
                    padding: "7px 11px", borderRadius: 8, cursor: "pointer",
                    fontSize: 11.5, fontWeight: activo ? 700 : 600,
                    fontFamily: "var(--font-sora), sans-serif",
                    border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                    background: activo ? "var(--accent-suave)" : "var(--surface)",
                    color: activo ? "var(--accent-texto)" : "var(--text2)",
                  }}
                >
                  {f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              );
            })}
          </div>
        </Campo>

        <Campo etiqueta="Detalle del consumo" origen={origen.detalle} confianza={valores._confianza.detalle}>
          <input
            className="fg-input" value={valores.detalle}
            placeholder="Qué se compró"
            onChange={e => fijar({ detalle: e.target.value }, ["detalle"])}
          />
        </Campo>
      </Grupo>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════

function Grupo({ titulo, opcional, children }: {
  titulo: string; opcional?: boolean; children: React.ReactNode;
}) {
  return (
    <section>
      <p className="rotulo" style={{ marginBottom: 10 }}>
        {titulo}
        {opcional && (
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, marginLeft: 6 }}>
            · opcional
          </span>
        )}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

/**
 * Un campo con su procedencia a la vista. La marca no es decorativa: es lo
 * que distingue un dato leído de uno que la persona está afirmando, y eso
 * es exactamente lo que se le pide confirmar.
 */
function Campo({ etiqueta, origen, confianza, error, obligatorio, children }: {
  etiqueta: string;
  origen?: Origen;
  confianza?: number;
  error?: string;
  obligatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        marginBottom: 5, flexWrap: "wrap",
      }}>
        <label className="fg-label" style={{ marginBottom: 0 }}>
          {etiqueta}
          {obligatorio && (
            <span style={{ color: "var(--accent-texto)", marginLeft: 3 }} aria-hidden="true">*</span>
          )}
        </label>
        {origen && <MarcaOrigen origen={origen} confianza={confianza} />}
      </div>
      {children}
      {error && (
        <p style={{
          fontSize: 11, color: "var(--danger)", marginTop: 5, lineHeight: 1.45,
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <IconoAlerta size={13} />
          {error}
        </p>
      )}
    </div>
  );
}

function MarcaOrigen({ origen, confianza }: { origen: Origen; confianza?: number }) {
  // Lo leído con poca confianza se señala aparte: es lo que más conviene
  // que la persona mire dos veces antes de confirmar.
  const dudoso = (origen === "ocr" || origen === "ia") && typeof confianza === "number" && confianza < 0.75;

  const paleta: Record<Origen, { fondo: string; texto: string }> = {
    ocr: { fondo: "var(--accent-suave)", texto: "var(--accent-texto)" },
    ia: { fondo: "var(--surface2)", texto: "var(--text2)" },
    derivado: { fondo: "var(--surface2)", texto: "var(--text2)" },
    manual: { fondo: "var(--surface2)", texto: "var(--text2)" },
  };
  const c = dudoso ? { fondo: "var(--warn-bg)", texto: "var(--warn)" } : paleta[origen];

  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 999,
      background: c.fondo, color: c.texto, letterSpacing: "0.05em",
      textTransform: "uppercase", fontFamily: "var(--font-sora), sans-serif",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {dudoso && <IconoAlerta size={11} />}
      {NOMBRE_ORIGEN[origen]}
      {dudoso && " · revisa"}
    </span>
  );
}
