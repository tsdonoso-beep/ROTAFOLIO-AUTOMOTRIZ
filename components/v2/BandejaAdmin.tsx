"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Cifra, Medidor, Tarjeta, Vacio, soles } from "./Encabezado";
import { IconoAdministrar, IconoAlerta, IconoCheck, IconoDescargar } from "./Iconos";
import { abrirMemosEnLote } from "@/app/acciones/memos";
import { descargarCsv } from "@/lib/export/csv";
import {
  conteos, FILTROS, filtroInicial, frenoPrincipal, frenos,
  type ClaveFiltro, type MemoDeBandeja,
} from "@/lib/dominio/bandeja";

export interface FilaAdmin extends MemoDeBandeja {
  correlativo: string;
  destino: string | null;
  centro: string | null;
  quien: string;
  rendido: number;
  autorizado: number;
  creditoFiscal: number;
  comprobantes: number;
  conAlertas: number;
  /** El desglose que el panel muestra sin ir a buscarlo. */
  porClase: { COMPROBANTE: number; DECLARACION_JURADA: number; MOVILIDAD: number };
  devuelto: number;
  devolucionesOp: string[];
  bancos: string[];
  pagado: number;
}

const TONO_ESTADO: Record<string, string> = {
  BORRADOR: "badge-neutro", ABIERTO: "badge-acento", EN_RENDICION: "badge-acento",
  PRESENTADA: "badge-warn", OBSERVADA: "badge-error", APROBADA: "badge-ok",
  CONTABILIZADA: "badge-ok", CERRADO: "badge-neutro", ANULADO: "badge-neutro",
};

const legible = (e: string) =>
  e.charAt(0) + e.slice(1).toLowerCase().replace("_", " ");

export default function BandejaAdmin({ memos }: { memos: FilaAdmin[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  const [filtro, setFiltro] = useState<ClaveFiltro>(() => filtroInicial(memos));
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState("");

  // El memo abierto vive en la URL, no sólo en el estado: así se puede pegar
  // el enlace en un WhatsApp, que es como esta gente coordina. Se cambia sin
  // navegar, para no perder la lista ni el scroll.
  const abiertoId = params.get("memo");
  const abierto = memos.find(m => m.id === abiertoId) ?? null;

  const abrirPanel = (id: string) => {
    const p = new URLSearchParams(Array.from(params.entries()));
    if (id === abiertoId) p.delete("memo"); else p.set("memo", id);
    window.history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
    // replaceState no vuelve a renderizar: se fuerza con un refresh suave.
    router.refresh();
  };

  const cuenta = useMemo(() => conteos(memos), [memos]);
  const visibles = useMemo(
    () => memos.filter(FILTROS.find(f => f.clave === filtro)!.pasa),
    [memos, filtro]
  );

  const total = useMemo(() => ({
    frenan: cuenta["me-frena"],
    enRendicion: memos.filter(m => m.estado === "EN_RENDICION" || m.estado === "ABIERTO").length,
    atrasadas: cuenta["atrasadas"],
    sinRendir: memos
      .filter(m => ["ABIERTO", "EN_RENDICION"].includes(m.estado))
      .reduce((s, m) => s + Math.max(0, m.autorizado - m.rendido), 0),
  }), [memos, cuenta]);

  const alternar = (id: string) => setMarcados(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const sumaMarcada = memos
    .filter(m => marcados.has(m.id))
    .reduce((s, m) => s + m.autorizado, 0);

  const abrirEnLote = () => {
    setAviso("");
    iniciar(async () => {
      const r = await abrirMemosEnLote([...marcados]);
      if (r.ok) {
        setMarcados(new Set());
        setAviso(`${r.hechos} memo${r.hechos === 1 ? "" : "s"} abierto${r.hechos === 1 ? "" : "s"}.`);
      } else {
        // Se quedan marcados sólo los que fallaron, para reintentar esos.
        setMarcados(new Set(r.fallos.map(f => f.id)));
        const nombres = r.fallos
          .map(f => `${memos.find(m => m.id === f.id)?.correlativo ?? f.id}: ${f.error}`);
        setAviso(
          `${r.hechos} abierto${r.hechos === 1 ? "" : "s"}. `
          + `No se pudo con ${r.fallos.length}: ${nombres.join("; ")}.`
        );
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 15 }}
      className="bandeja-admin">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

        {/* ── Las cuatro cifras ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9,
        }}>
          <Tarjeta padding={14}>
            <Cifra rotulo="Necesitan tu acción" valor={String(total.frenan)}
              tamano="l" tono={total.frenan > 0 ? "acento" : "neutro"} />
          </Tarjeta>
          <Tarjeta padding={14}>
            <Cifra rotulo="En rendición" valor={String(total.enRendicion)} tamano="l" />
          </Tarjeta>
          <Tarjeta padding={14}>
            <Cifra rotulo="Con atraso" valor={String(total.atrasadas)}
              tamano="l" tono={total.atrasadas > 0 ? "peligro" : "neutro"} />
          </Tarjeta>
          <Tarjeta padding={14}>
            <Cifra rotulo="Sin rendir" valor={soles(total.sinRendir)} tamano="l" tono="tenue" />
          </Tarjeta>
        </div>

        {/* ── Pestañas ── */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {FILTROS.map(f => {
            const n = cuenta[f.clave];
            const on = filtro === f.clave;
            if (n === 0 && !on && f.clave !== "todas") return null;
            return (
              <button key={f.clave} onClick={() => setFiltro(f.clave)} style={{
                padding: "7px 13px", borderRadius: 999, cursor: "pointer",
                fontFamily: "var(--font-sora), sans-serif", fontSize: 12,
                fontWeight: on ? 700 : 600, whiteSpace: "nowrap",
                border: `1px solid ${on ? "var(--accent)" : "var(--border2)"}`,
                background: on ? "var(--accent)" : "#FFFFFF",
                color: on ? "#FFFFFF" : "var(--text2)",
              }}>
                {f.etiqueta} · {n}
              </button>
            );
          })}
          {/* Se exporta lo que está a la vista, no la base entera: si estoy
              mirando lo que me frena, eso es lo que quiero mandar. */}
          <button className="btn-ghost" onClick={() => descargarCsv(
            `memos-${filtro}.csv`,
            [
              ["Correlativo", "Persona", "Estado", "Autorizado", "Rendido",
               "Credito fiscal", "Devuelto", "Dias de atraso", "Me frena"],
              ...visibles.map(m => [
                m.correlativo, m.quien, m.estado,
                m.autorizado.toFixed(2), m.rendido.toFixed(2),
                m.creditoFiscal.toFixed(2), m.devuelto.toFixed(2),
                String(m.diasAtraso > 0 ? m.diasAtraso : 0),
                frenos(m).map(f => f.texto).join("; "),
              ]),
            ]
          )} style={{ marginLeft: "auto", fontSize: 12.5 }}>
            <IconoDescargar size={15} />
            Exportar CSV · {visibles.length}
          </button>
        </div>

        {/* ── Barra de lote ── */}
        {marcados.size > 0 && (
          <div style={{
            background: "var(--accent)", borderRadius: 12, padding: "11px 15px",
            display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", color: "#FFFFFF",
          }}>
            <span className="font-display" style={{ fontSize: 13, fontWeight: 700 }}>
              {marcados.size} memo{marcados.size === 1 ? "" : "s"} · {soles(sumaMarcada)}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={() => setMarcados(new Set())} disabled={pendiente} style={{
                padding: "8px 14px", borderRadius: 9, cursor: "pointer",
                border: "1px solid rgba(255,255,255,.45)", background: "rgba(255,255,255,.14)",
                color: "#FFFFFF", fontFamily: "var(--font-sora), sans-serif",
                fontSize: 12.5, fontWeight: 700,
              }}>
                Quitar selección
              </button>
              <button onClick={abrirEnLote} disabled={pendiente} style={{
                padding: "8px 14px", borderRadius: 9, cursor: "pointer", border: "none",
                background: "#FFFFFF", color: "var(--accent-texto)",
                fontFamily: "var(--font-sora), sans-serif", fontSize: 12.5, fontWeight: 700,
              }}>
                {pendiente ? "Abriendo…" : "Abrir memos"}
              </button>
            </div>
          </div>
        )}

        {aviso && (
          <div style={{
            padding: "11px 14px", borderRadius: 10, background: "var(--surface2)",
            border: "1px solid var(--border2)",
          }}>
            <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5 }}>{aviso}</p>
          </div>
        )}

        {/* ── La lista ── */}
        {visibles.length === 0 ? (
          <Vacio
            icono={<IconoAdministrar size={26} />}
            titulo={filtro === "me-frena" ? "Nada te está frenando" : "Nada en esta pestaña"}
            texto={filtro === "me-frena"
              ? "Ningún memo espera algo de ti ahora mismo. Mira «Todas» para el panorama completo."
              : "Prueba con otra pestaña."}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {visibles.map(m => {
              const freno = frenoPrincipal(m);
              const sel = marcados.has(m.id);
              const activo = m.id === abiertoId;
              return (
                <div key={m.id} className="tarjeta" style={{
                  padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
                  borderColor: activo ? "var(--accent)" : sel ? "var(--accent-borde)" : "var(--border)",
                  background: sel ? "var(--accent-suave)" : "var(--surface)",
                }}>
                  <button onClick={() => alternar(m.id)}
                    aria-label={sel ? "Quitar de la selección" : "Seleccionar"}
                    style={{
                      width: 19, height: 19, borderRadius: 5, flexShrink: 0, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`,
                      background: sel ? "var(--accent)" : "#FFFFFF", color: "#FFFFFF",
                    }}>
                    {sel && <IconoCheck size={12} />}
                  </button>

                  <button onClick={() => abrirPanel(m.id)} style={{
                    flex: 1, minWidth: 0, textAlign: "left", background: "none",
                    border: "none", cursor: "pointer", padding: 0,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span className="font-display" style={{
                        fontSize: 13.5, fontWeight: 700, color: "var(--text)",
                      }}>
                        {m.quien}
                      </span>
                      <span className={`badge ${TONO_ESTADO[m.estado] ?? "badge-neutro"}`}>
                        {legible(m.estado)}
                      </span>
                    </div>
                    {/* El correlativo mide hasta 23 caracteres: se le deja su
                        propia línea en vez de pelear con el nombre. */}
                    <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                      <span className="mono">{m.correlativo}</span>
                      {m.destino && ` · ${m.destino}`}
                    </p>
                    {freno && (
                      <p style={{
                        fontSize: 11.5, marginTop: 5, fontWeight: 600,
                        color: freno.urgencia === "alta" ? "var(--danger)" : "var(--warn)",
                      }}>
                        {freno.texto}
                        {frenos(m).length > 1 && (
                          <span style={{ color: "var(--text3)", fontWeight: 400 }}>
                            {" "}+{frenos(m).length - 1} más
                          </span>
                        )}
                      </p>
                    )}
                  </button>

                  <div style={{ width: 132, flexShrink: 0 }}>
                    {m.autorizado > 0 && <Medidor rendido={m.rendido} autorizado={m.autorizado} />}
                    <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
                      {m.comprobantes} comprobante{m.comprobantes === 1 ? "" : "s"}
                      {m.conAlertas > 0 && ` · ${m.conAlertas} con alerta`}
                    </p>
                  </div>

                  <div style={{ width: 104, flexShrink: 0, textAlign: "right" }}>
                    <p className="cifra cifra-m">{soles(m.rendido)}</p>
                    <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>
                      de {soles(m.autorizado)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── El panel ── */}
      {abierto && <PanelExpediente m={abierto} onCerrar={() => abrirPanel(abierto.id)} />}
    </div>
  );
}

/**
 * El expediente, sin navegar.
 *
 * Trae lo que hace falta para decidir aprobar u observar: lo rendido, cuánto
 * de eso da crédito fiscal, si la persona cobró, y si ya devolvió el saldo.
 */
function PanelExpediente({ m, onCerrar }: { m: FilaAdmin; onCerrar: () => void }) {
  const lista = frenos(m);
  return (
    <aside className="panel-expediente">
      <Tarjeta>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="rotulo">Revisión rápida</p>
            <p className="mono" style={{
              fontSize: 12.5, fontWeight: 600, color: "var(--text)", marginTop: 6,
              wordBreak: "break-all",
            }}>
              {m.correlativo}
            </p>
            <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 4 }}>
              {m.quien}{m.destino && ` · ${m.destino}`}
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar el panel" style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text3)", fontSize: 18, lineHeight: 1, padding: 0,
          }}>
            ×
          </button>
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", gap: 10, marginTop: 15,
          padding: 14, borderRadius: 12, background: "var(--surface2)",
          border: "1px solid var(--border)",
        }}>
          <Cifra rotulo="Rendido" valor={soles(m.rendido)} tamano="l" />
          {/* El número que necesita Contabilidad, y que hasta ahora no se
              mostraba en ninguna parte: sólo las facturas descuentan IGV. */}
          <Cifra rotulo="Da crédito fiscal" valor={soles(m.creditoFiscal)}
            tamano="l" tono="acento" />
        </div>

        {lista.length > 0 && (
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 7 }}>
            {lista.map(f => (
              <div key={f.codigo} style={{
                display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px",
                borderRadius: 10, fontSize: 12, lineHeight: 1.45,
                background: f.urgencia === "alta" ? "var(--danger-bg)" : "var(--warn-bg, rgba(217,119,6,0.08))",
                color: f.urgencia === "alta" ? "var(--danger)" : "var(--warn)",
                border: `1px solid ${f.urgencia === "alta" ? "rgba(220,38,38,.2)" : "rgba(217,119,6,.25)"}`,
              }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><IconoAlerta size={14} /></span>
                <span>{f.texto}</span>
              </div>
            ))}
          </div>
        )}

        {/* La devolución ya no es una promesa: es un hecho con su operación. */}
        {m.devuelto > 0 && (
          <div style={{
            marginTop: 13, display: "flex", gap: 9, alignItems: "flex-start",
            padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.45,
            background: "var(--accent-suave)", color: "var(--accent-texto)",
            border: "1px solid var(--accent-borde)",
          }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><IconoCheck size={14} /></span>
            <span>
              Devolvió <strong>{soles(m.devuelto)}</strong>
              {m.devolucionesOp.length > 0 && (
                <> · op. <span className="mono">{m.devolucionesOp.join(", ")}</span></>
              )}
            </span>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Renglon rotulo="Comprobantes formales" valor={soles(m.porClase.COMPROBANTE)} />
          <Renglon rotulo="Planilla de movilidad" valor={soles(m.porClase.MOVILIDAD)} />
          <Renglon rotulo="Declaración jurada" valor={soles(m.porClase.DECLARACION_JURADA)} />
          <Renglon
            rotulo="Cobró"
            valor={m.bancos.length === 0
              ? "sin constancia"
              : `${soles(m.pagado)} · ${m.bancos.join(" y ")}`}
            tenue={m.bancos.length === 0}
          />
        </div>

        <Link href={`/revisar/${m.id}`} className="btn-primary"
          style={{ marginTop: 16, width: "100%", justifyContent: "center", textDecoration: "none" }}>
          Abrir el expediente completo
        </Link>
        <p style={{
          fontSize: 11, color: "var(--text3)", marginTop: 8,
          textAlign: "center", lineHeight: 1.45,
        }}>
          Aprobar u observar se hace ahí, comprobante por comprobante.
        </p>
      </Tarjeta>
    </aside>
  );
}

function Renglon({ rotulo, valor, tenue }: {
  rotulo: string; valor: string; tenue?: boolean;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
      fontSize: 12.5, color: "var(--text2)", padding: "9px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <span>{rotulo}</span>
      <span className="font-display" style={{
        fontVariantNumeric: "tabular-nums", fontWeight: 700,
        color: tenue ? "var(--text3)" : "var(--text)",
      }}>
        {valor}
      </span>
    </div>
  );
}
