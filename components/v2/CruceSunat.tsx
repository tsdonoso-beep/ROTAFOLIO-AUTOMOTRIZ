"use client";
import { useRef, useState } from "react";
import { Aviso, Tarjeta, Cifra, soles } from "./Encabezado";
import { IconoAlerta, IconoDescargar, IconoReloj } from "./Iconos";
import { pedirPropuesta, verTicket, traerYCruzar, type Resultado, type Diagnostico } from "@/app/acciones/cruce-sunat";
import type { Emparejado } from "@/lib/dominio/cruce";
import type { ArchivoDelTicket } from "@/lib/sunat/sire";

type DiagnosticoTipo = Diagnostico;

/** El período anterior al actual, que es el último que ya está cerrado. */
function periodoSugerido(): string {
  const h = new Date();
  const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CADA_MS = 6000;
const LIMITE_MS = 5 * 60 * 1000;

/**
 * Cruce de un período contra el registro de compras de SUNAT.
 *
 * SUNAT encola el pedido y devuelve un ticket, así que esto pregunta cada
 * pocos segundos hasta que el archivo esté. Se muestra en qué va en vez de
 * dejar un botón girando: el proceso tarda minutos y un spinner sin texto
 * no distingue «trabajando» de «colgado».
 */
export default function CruceSunat({ empresa }: { empresa: string }) {
  const [periodo, setPeriodo] = useState(periodoSugerido());
  const [paso, setPaso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const corriendo = useRef(false);

  const trabajando = paso !== null;

  async function correr() {
    if (corriendo.current) return;
    corriendo.current = true;
    setError(null); setDiag(null); setRes(null); setPaso("pidiéndole el período a SUNAT…");

    try {
      const p = await pedirPropuesta(empresa, periodo);
      if (p.tipo === "error") { setError(p.motivo); return; }
      if (p.tipo !== "encolado") { setError("SUNAT respondió algo inesperado."); return; }

      setPaso(`en cola con el ticket ${p.ticket}…`);

      const hasta = Date.now() + LIMITE_MS;
      let archivo: ArchivoDelTicket | null = null;
      let crudo: Record<string, unknown> = {};

      while (Date.now() < hasta) {
        await new Promise(r => setTimeout(r, CADA_MS));
        const t = await verTicket(empresa, p.periodo, p.ticket);
        if (t.tipo === "error") { setError(t.motivo); return; }
        if (t.tipo === "listo") { archivo = t.archivo; crudo = t.ticketCrudo; break; }
        if (t.tipo === "esperando") setPaso(`${t.estado}…`);
      }

      if (!archivo) {
        setError(`El ticket ${p.ticket} no terminó en cinco minutos. Vuelve a intentarlo más tarde.`);
        return;
      }

      setPaso("bajando el archivo y cruzando…");
      const fin = await traerYCruzar(empresa, p.periodo, archivo, crudo);
      if (fin.tipo === "error") {
        setError(fin.motivo);
        setDiag(fin.diagnostico ?? null);
        return;
      }
      setRes(fin.resultado);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaso(null);
      corriendo.current = false;
    }
  }

  return (
    <Tarjeta>
      <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        Cruzar un período contra SUNAT
      </p>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        Trae lo que los proveedores le declararon a SUNAT a nombre de {empresa} y lo
        compara con lo que se rindió. No cambia nada: se mira y se cierra.
      </p>

      <div style={{ display: "flex", gap: 9, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 13 }}>
        <label style={{ flex: "1 1 140px" }}>
          <span className="rotulo" style={{ display: "block", marginBottom: 5 }}>Período</span>
          <input
            className="mono"
            value={periodo}
            onChange={e => setPeriodo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="202608"
            inputMode="numeric"
            disabled={trabajando}
            style={{ width: "100%" }}
          />
        </label>
        <button className="btn-ghost" onClick={correr} disabled={trabajando || periodo.length !== 6}
          style={{ flex: "1 1 180px", justifyContent: "center" }}>
          <IconoDescargar size={15} />
          {trabajando ? "Consultando…" : "Traer y comparar"}
        </button>
      </div>

      {paso && (
        <Aviso tono="info" icono={<IconoReloj size={16} />}>
          {paso}
          <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.85 }}>
            SUNAT procesa el pedido por su cuenta. Suele tardar entre uno y tres minutos.
          </span>
        </Aviso>
      )}

      {error && !paso && (
        <Aviso tono="error" icono={<IconoAlerta size={16} />}>{error}</Aviso>
      )}

      {diag && !paso && <Diagnostico diag={diag} />}

      {res && !paso && <Informe res={res} />}
    </Tarjeta>
  );
}

function Informe({ res }: { res: Resultado }) {
  const r = res.cruce.resumen;
  const sinRendir = res.cruce.soloEnSunat;

  return (
    <div style={{ marginTop: 4 }}>
      {/* Va antes que los números: si aparece, los números no valen. */}
      {res.identidadSospechosa && (
        <div style={{ margin: "14px 0" }}>
          <Aviso tono="error" icono={<IconoAlerta size={16} />}>
            <strong>El cruce está leyendo la columna equivocada.</strong>
            <span style={{ display: "block", marginTop: 4, lineHeight: 1.55 }}>
              {res.identidadSospechosa}
            </span>
          </Aviso>
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: 14, padding: "16px 0", borderTop: "1px solid var(--borde)",
      }}>
        <Cifra rotulo="cuadran con SUNAT" valor={String(r.cuadran)} tono="acento" tamano="m" />
        <Cifra rotulo="con otro importe" valor={String(r.montoDistinto)}
          tono={r.montoDistinto ? "peligro" : "tenue"} tamano="m" />
        <Cifra rotulo="no están en SUNAT" valor={String(r.noEstanEnSunat)}
          tono={r.noEstanEnSunat ? "aviso" : "tenue"} tamano="m" />
        <Cifra rotulo="no comparables" valor={String(r.noComparables)} tono="tenue" tamano="m" />
      </div>

      {sinRendir.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {res.nuestros === 0 ? (
            // Sin nada capturado de ese mes, «sin rendir» es todo el archivo:
            // no es un hallazgo, es la ausencia de datos con qué comparar.
            // Presentarlo como alerta sería un susto falso.
            <Aviso tono="info" icono={<IconoAlerta size={16} />}>
              <strong>Esto todavía no dice nada.</strong>
              <span style={{ display: "block", marginTop: 4, lineHeight: 1.55 }}>
                SUNAT tiene {sinRendir.length} comprobantes de ese período, pero en la
                aplicación no hay ninguno con fecha de ese mes. Sin nada que comparar,
                todo cae del lado «sin rendir»: son las compras normales de la empresa,
                no gastos sin reportar. El cruce recién dirá algo cuando haya
                comprobantes capturados de ese período.
              </span>
            </Aviso>
          ) : (
            <Aviso tono="aviso" icono={<IconoAlerta size={16} />}>
              <strong>{sinRendir.length} comprobantes por {soles(r.montoSoloEnSunat)} que SUNAT
              tiene a nombre de la empresa y nadie rindió.</strong>
              <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.9 }}>
                Puede ser gasto que no se reportó, o crédito fiscal que se está dejando pasar.
              </span>
            </Aviso>
          )}
        </div>
      )}

      {sinRendir.length > 0 && <TablaSunat filas={sinRendir.slice(0, 40)} total={sinRendir.length} />}

      {r.montoDistinto > 0 && (
        <Diferencias
          filas={res.cruce.emparejados.filter(e => e.veredicto === "MONTO_DISTINTO")}
        />
      )}

      {r.noComparables > 0 && (
        <NoComparables
          filas={res.cruce.emparejados.filter(e => e.veredicto === "NO_COMPARABLE")}
        />
      )}

      <Procedencia res={res} />
    </div>
  );
}

function TablaSunat({ filas, total }: {
  filas: Array<{ ruc: string | null; razonSocial: string | null; serie: string | null; numero: string | null; fechaEmision: string | null; total: number | null }>;
  total: number;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p className="rotulo" style={{ marginBottom: 7 }}>En SUNAT y sin rendir</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--borde)" }}>
              {["Proveedor", "Comprobante", "Fecha", "Monto"].map((h, i) => (
                <th key={h} className="rotulo" style={{ textAlign: i === 3 ? "right" : "left", padding: "6px 8px 6px 0", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--borde-suave, var(--borde))" }}>
                <td style={{ padding: "7px 8px 7px 0", color: "var(--text)" }}>
                  {f.razonSocial ?? "—"}
                  <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--text3)" }}>
                    {f.ruc ?? ""}
                  </span>
                </td>
                <td className="mono" style={{ padding: "7px 8px 7px 0", color: "var(--text2)", whiteSpace: "nowrap" }}>
                  {[f.serie, f.numero].filter(Boolean).join("-") || "—"}
                </td>
                <td className="mono" style={{ padding: "7px 8px 7px 0", color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {f.fechaEmision ?? "—"}
                </td>
                <td className="mono" style={{ padding: "7px 0", color: "var(--text)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {f.total == null ? "—" : soles(f.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > filas.length && (
        <p style={{ marginTop: 7, fontSize: 11.5, color: "var(--text3)" }}>
          Se muestran {filas.length} de {total}.
        </p>
      )}
    </div>
  );
}

function Diferencias({ filas }: { filas: Emparejado[] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p className="rotulo" style={{ marginBottom: 7 }}>El monto no coincide con SUNAT</p>
      {filas.map(e => (
        <div key={e.nuestro.id} style={{
          padding: "9px 0", borderBottom: "1px solid var(--borde)", fontSize: 12,
          display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ color: "var(--text)" }}>
            {e.nuestro.proveedorNombre ?? e.nuestro.ruc}
            <span className="mono" style={{ color: "var(--text3)", marginLeft: 7 }}>
              {[e.nuestro.serie, e.nuestro.numero].filter(Boolean).join("-")}
            </span>
          </span>
          <span className="mono" style={{ color: "var(--danger)", whiteSpace: "nowrap" }}>
            rendido {soles(e.nuestro.total ?? 0)} · SUNAT {soles(e.enSunat?.total ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function NoComparables({ filas }: { filas: Emparejado[] }) {
  // Se agrupan por motivo porque la lista larga no aporta: lo que importa es
  // cuántos hay de cada causa, para saber qué arreglar.
  const porMotivo = new Map<string, number>();
  for (const f of filas) {
    const m = f.motivo ?? "sin motivo";
    porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <p className="rotulo" style={{ marginBottom: 7 }}>No se pudieron comparar</p>
      <p style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.5, marginBottom: 8 }}>
        No significa que estén mal. Significa que el registro de compras de SUNAT no
        los trae, o que les falta un dato para poder buscarlos.
      </p>
      {[...porMotivo.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => (
        <div key={motivo} style={{
          display: "flex", gap: 10, padding: "6px 0", fontSize: 12,
          borderBottom: "1px solid var(--borde)",
        }}>
          <span className="mono" style={{ color: "var(--text2)", minWidth: 26 }}>{n}</span>
          <span style={{ color: "var(--text3)" }}>{motivo}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * De dónde salió cada número.
 *
 * Es la primera vez que se lee este archivo de SUNAT en producción. Si una
 * columna no se reconoció, el cruce puede estar comparando contra vacío y
 * dar un resultado tranquilizador que no significa nada. Por eso se muestra
 * qué se entendió, aunque sea información técnica.
 */
function Procedencia({ res }: { res: Resultado }) {
  const { lectura } = res;

  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: 11.5, color: "var(--text3)", cursor: "pointer" }}>
        De dónde salen estos números
      </summary>
      <div style={{ marginTop: 9, fontSize: 11.5, color: "var(--text3)", lineHeight: 1.6 }}>
        <p>
          Período <span className="mono">{res.periodo}</span> · archivo{" "}
          <span className="mono">{res.archivo}</span>
        </p>
        <p>
          SUNAT devolvió {res.cruce.emparejados.length + res.cruce.soloEnSunat.length -
            res.cruce.resumen.noComparables} comprobantes comparables;
          nosotros teníamos {res.nuestros} con fecha de ese mes.
        </p>
        <p style={{ marginTop: 6 }}>
          Columnas reconocidas:{" "}
          <span className="mono">{lectura.mapeo.map(m => m.titulo).join(", ") || "ninguna"}</span>
        </p>
        {lectura.faltantes.length > 0 && (
          <p style={{ color: "var(--warn)", marginTop: 6 }}>
            No se encontró la columna de: {lectura.faltantes.join(", ")}. El cruce de esos
            campos no es confiable.
          </p>
        )}
        {lectura.duplicadas.length > 0 && (
          <p style={{ color: "var(--warn)", marginTop: 6 }}>
            Estas columnas también servían para un campo que ya estaba tomado por otra, así
            que no se usaron:{" "}
            <span className="mono">
              {lectura.duplicadas.map(d => `${d.titulo} → ${d.campo}`).join(", ")}
            </span>
            . Si alguna es la correcta, el cruce está mirando la columna equivocada.
          </p>
        )}
        {lectura.sinMapear.length > 0 && (
          <p style={{ marginTop: 6 }}>
            Columnas que llegaron y no se usaron:{" "}
            <span className="mono">{lectura.sinMapear.join(", ")}</span>
          </p>
        )}
        {lectura.titulos.length > 0 && <PrimeraFila lectura={lectura} />}
        {lectura.descartadas > 0 && (
          <p style={{ marginTop: 6 }}>
            Se descartaron {lectura.descartadas} filas sin RUC ni número (suelen ser totales).
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Qué se le mandó a SUNAT y qué había dicho el ticket.
 *
 * Aparece solo cuando la descarga falla. SUNAT contesta ese fallo con la
 * página de error de su portal, sin nombrar el campo que la rompió, así que
 * sin esto la única salida sería probar combinaciones contra producción.
 */
function Diagnostico({ diag }: { diag: DiagnosticoTipo }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p className="rotulo" style={{ marginBottom: 7 }}>Qué se le mandó a SUNAT</p>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
          <tbody>
            {Object.entries(diag.enviado).map(([k, v]) => (
              <tr key={k} style={{ borderBottom: "1px solid var(--borde)" }}>
                <td className="mono" style={{ padding: "5px 12px 5px 0", color: "var(--text3)", whiteSpace: "nowrap" }}>{k}</td>
                <td className="mono" style={{
                  padding: "5px 0", wordBreak: "break-all",
                  color: v === "(vacío)" ? "var(--warn)" : "var(--text)",
                }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rotulo" style={{ marginBottom: 7 }}>Lo que SUNAT devolvió del ticket</p>
      <pre className="mono" style={{
        fontSize: 10.5, lineHeight: 1.5, color: "var(--text3)", margin: 0,
        padding: 11, borderRadius: "var(--radio-s)", background: "var(--fondo2, var(--borde))",
        overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: 320, overflowY: "auto",
      }}>{JSON.stringify(diag.ticket, null, 2)}</pre>
      <p style={{ marginTop: 7, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
        Copia esto tal cual: con estos dos bloques se ubica el campo en el manual
        del SIRE sin tener que adivinar.
      </p>
    </div>
  );
}

/**
 * La primera fila del archivo, columna por columna y en orden.
 *
 * Es la única forma de saber qué hay realmente en cada columna sin adivinar.
 * El RCE trae dos identidades con títulos parecidos —la de la empresa y la
 * del proveedor— y mirando solo los títulos no se distingue cuál es cuál.
 */
function PrimeraFila({ lectura }: { lectura: Resultado["lectura"] }) {
  const porTitulo = new Map(lectura.mapeo.map(m => [m.titulo, m.campo] as const));
  const duplicada = new Map(lectura.duplicadas.map(d => [d.titulo, d.campo] as const));

  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", color: "var(--text3)" }}>
        Ver la primera fila columna por columna ({lectura.titulos.length} columnas)
      </summary>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
          <tbody>
            {lectura.titulos.map((t, i) => {
              const campo = porTitulo.get(t);
              const dup = duplicada.get(t);
              return (
                <tr key={`${t}-${i}`} style={{ borderBottom: "1px solid var(--borde)" }}>
                  <td className="mono" style={{ padding: "4px 10px 4px 0", color: "var(--text3)", textAlign: "right" }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: "4px 10px 4px 0", color: "var(--text2)", whiteSpace: "nowrap" }}>
                    {t}
                  </td>
                  <td className="mono" style={{ padding: "4px 10px 4px 0", whiteSpace: "nowrap",
                    color: campo ? "var(--accent-texto)" : dup ? "var(--warn)" : "var(--text3)" }}>
                    {campo ? `→ ${campo}` : dup ? `(duplicada de ${dup})` : ""}
                  </td>
                  <td className="mono" style={{ padding: "4px 0", color: "var(--text)", wordBreak: "break-all" }}>
                    {lectura.ejemplo[i] ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
