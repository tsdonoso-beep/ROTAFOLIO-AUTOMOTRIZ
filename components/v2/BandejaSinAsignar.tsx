"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { rutaDrive } from "@/lib/dominio/memo";
import { actualizarLegajo } from "@/app/acciones/legajo";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoEnlace } from "./Iconos";
import { asignarPorFecha, explicar, memoDe } from "@/lib/dominio/asignacion";
import { impedimentosParaRendirCaja, periodoDeCaja, resumirCaja } from "@/lib/dominio/cajachica";
import { validarGasto } from "@/lib/dominio/validaciones";
import { rendirCajaChica } from "@/app/acciones/memos";
import type { Alerta, EstadoMemo, Gasto, Parametros } from "@/lib/dominio/tipos";

interface MemoDestino {
  id: string;
  correlativo: string;
  destino: string | null;
  estado: EstadoMemo;
  fecha_salida: string | null;
  fecha_retorno_prev: string | null;
  monto_autorizado: number;
  rendido: number;
  centroCostoFolder: string;
  empresaRuc: string | null;
  empresaAbrev: string;
}

interface Props {
  gastos: Gasto[];
  memos: MemoDestino[];
  parametros: Parametros;
  centros: Array<{ id: string; codigo: string; nombre: string }>;
}

const NOMBRE_COMPROBANTE: Record<string, string> = {
  "00": "Constancia", "01": "Factura", "03": "Boleta",
  "07": "Nota de crédito", "08": "Nota de débito", "12": "Ticket",
};

export default function BandejaSinAsignar({ gastos, memos, parametros, centros }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  // Selección para rendir como caja chica: el otro destino posible de un
  // comprobante suelto, además de mudarlo a un memo de viáticos.
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const seleccionados = useMemo(
    () => gastos.filter(g => elegidos.has(g.id)),
    [gastos, elegidos]
  );

  const alternar = (id: string) => {
    setElegidos(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <>
      {aviso && (
        <div style={{ marginBottom: 14 }}>
          <Aviso
            tono={aviso.tono}
            icono={aviso.tono === "ok" ? <IconoCheck size={16} /> : <IconoAlerta size={16} />}
          >
            {aviso.texto}
          </Aviso>
        </div>
      )}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {gastos.map(g => (
          <Fila
            key={g.id} gasto={g} memos={memos} parametros={parametros}
            enCaja={elegidos.has(g.id)} onAlternarCaja={() => alternar(g.id)}
            onResultado={(tono, texto) => {
              setAviso({ tono, texto });
              setElegidos(prev => { const n = new Set(prev); n.delete(g.id); return n; });
              router.refresh();
            }}
          />
        ))}
      </div>

      <PanelCajaChica
        gastos={seleccionados} centros={centros}
        onResultado={(tono, texto) => {
          setAviso({ tono, texto });
          if (tono === "ok") setElegidos(new Set());
          router.refresh();
        }}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════

/**
 * Rendir varios sueltos de una vez, como caja chica.
 *
 * Es el proceso invertido que describió Finanzas: acá no hubo memo previo
 * ni monto autorizado, así que todo lo que se junta es un reembolso. El
 * memo se crea recién al presentar.
 */
function PanelCajaChica({ gastos, centros, onResultado }: {
  gastos: Gasto[];
  centros: Array<{ id: string; codigo: string; nombre: string }>;
  onResultado: (tono: "ok" | "error", texto: string) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const [centro, setCentro] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const resumen = resumirCaja(gastos as never);
  const impedimentos = impedimentosParaRendirCaja(gastos as never);

  if (!gastos.length) return null;

  const rendir = () => {
    iniciar(async () => {
      const r = await rendirCajaChica({
        centroCostoId: centro,
        gastoIds: gastos.map(g => g.id),
        descripcion,
      });
      onResultado(r.ok ? "ok" : "error",
        r.ok ? `Caja chica presentada por ${soles(resumen.aReembolsar)}. Pasó a revisión.` : r.error);
    });
  };

  return (
    <div style={{
      position: "sticky", bottom: 12, marginTop: 16, zIndex: 20,
    }}>
      <Tarjeta style={{ borderColor: "var(--accent-borde)", boxShadow: "var(--sombra3)" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 13,
        }}>
          <p className="rotulo" style={{ marginBottom: 0 }}>Rendir como caja chica</p>
          <p>
            <span className="cifra cifra-m" style={{ color: "var(--accent-texto)" }}>
              {soles(resumen.aReembolsar)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--text3)", marginLeft: 6 }}>
              a reembolsarte
            </span>
          </p>
        </div>

        <p style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.5, marginBottom: 13 }}>
          {resumen.cantidad} comprobante{resumen.cantidad === 1 ? "" : "s"}
          {resumen.desde && ` · ${periodoDeCaja(resumen).replace("Caja chica ", "")}`}
          . Acá no hubo adelanto, así que el total se te reembolsa.
        </p>

        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="fg-label" htmlFor="cc-caja">Centro de costo</label>
            <select
              id="cc-caja" className="fg-input" value={centro}
              onChange={e => setCentro(e.target.value)}
              style={{ fontFamily: "var(--font-dm), sans-serif" }}
            >
              <option value="">Elige…</option>
              {centros.map(c => (
                <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fg-label" htmlFor="desc-caja">Concepto (opcional)</label>
            <input
              id="desc-caja" className="fg-input" value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder={periodoDeCaja(resumen)}
            />
          </div>
        </div>

        {impedimentos.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Aviso tono="aviso" icono={<IconoAlerta size={16} />}>
              {impedimentos.map((i, k) => (
                <span key={k} style={{ display: "block", lineHeight: 1.6 }}>
                  · {i.motivo}{i.cantidad > 0 && ` (${i.cantidad})`}
                </span>
              ))}
            </Aviso>
          </div>
        )}

        <button
          className="btn-primary" onClick={rendir}
          disabled={pendiente || !centro || impedimentos.length > 0}
          style={{
            width: "100%", justifyContent: "center", marginTop: 13, padding: 12,
            opacity: !centro || impedimentos.length ? 0.5 : 1,
          }}
        >
          {pendiente ? "Presentando…" : (
            <><IconoCheck size={17} />Presentar caja chica · {soles(resumen.aReembolsar)}</>
          )}
        </button>

        {!centro && (
          <p style={{
            fontSize: 11.5, color: "var(--text3)", marginTop: 8,
            textAlign: "center", lineHeight: 1.45,
          }}>
            Elige el centro de costo al que corresponde el gasto.
          </p>
        )}
      </Tarjeta>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════

function Fila({ gasto: g, memos, parametros, enCaja, onAlternarCaja, onResultado }: {
  gasto: Gasto;
  memos: MemoDestino[];
  parametros: Parametros;
  /** Marcado para entrar en una rendición de caja chica. */
  enCaja: boolean;
  onAlternarCaja: () => void;
  onResultado: (tono: "ok" | "error", texto: string) => void;
}) {
  // Se recalcula al abrir la bandeja, no se guarda: entre la captura y este
  // momento pueden haberse abierto memos nuevos que ahora sí lo cubren.
  const sugerencia = asignarPorFecha(g.fecha_emision ?? "", memos);
  const [elegido, setElegido] = useState<string>(memoDe(sugerencia)?.id ?? "");
  const [guardando, setGuardando] = useState(false);

  const asignar = async () => {
    const destino = memos.find(m => m.id === elegido);
    if (!destino) return;

    setGuardando(true);
    const sb = clienteNavegador();

    // Las alertas se recalculan contra el memo elegido: el exceso sobre lo
    // autorizado y el rango de fechas dependen de a cuál pertenece, así que
    // las de la captura ya no valen.
    const alertas: Alerta[] = validarGasto(
      {
        clase: g.clase,
        proveedor_ruc: g.proveedor_ruc,
        adquiriente_ruc: g.adquiriente_ruc,
        tipo_comprobante: g.tipo_comprobante,
        fecha_emision: g.fecha_emision,
        subtotal: g.subtotal, igv: g.igv, total: g.total,
        confianza_extraccion: g.confianza_extraccion as Record<string, number> | null,
      },
      {
        parametros,
        rucEmpresa: destino.empresaRuc,
        memo: {
          monto_autorizado: destino.monto_autorizado,
          fecha_salida: destino.fecha_salida,
          fecha_retorno_prev: destino.fecha_retorno_prev,
          rendido_previo: destino.rendido,
        },
      }
    );

    const { error } = await sb.from("gastos").update({
      memo_id: destino.id,
      alertas,
      alertas_confirmadas: false,
      estado: alertas.length ? "CON_ALERTA" : "VALIDADO",
    }).eq("id", g.id);

    if (error) {
      setGuardando(false);
      onResultado("error", error.message);
      return;
    }

    // La foto estaba archivada en la carpeta de pendientes; ahora que se
    // sabe el memo, viaja a la carpeta que le corresponde. Si falla, el
    // gasto ya quedó asignado: solo el archivo queda donde estaba.
    if (g.storage_key) {
      try {
        const res = await fetch("/api/drive-upload", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: g.storage_key,
            carpetas: rutaDrive({
              empresaAbrev: destino.empresaAbrev,
              fechaSalida: destino.fecha_salida,
              centroCostoFolder: destino.centroCostoFolder,
              correlativo: destino.correlativo,
            }),
          }),
        });
        const json = await res.json();
        if (res.ok && json.url) {
          await sb.from("gastos").update({ drive_url: json.url }).eq("id", g.id);
        }
      } catch {
        // No se interrumpe: el comprobante ya está donde tiene que estar.
      }
    }

    // El expediente cambió: su carátula se rehace con el comprobante dentro.
    await actualizarLegajo(destino.id);

    onResultado("ok", `Comprobante movido a ${destino.correlativo}.`);
  };

  const dudoso = sugerencia.tipo !== "exacta";

  return (
    <Tarjeta padding={0} className="animate-fadein" style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 17px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <span
            role="checkbox" aria-checked={enCaja} tabIndex={0}
            aria-label="Incluir en la caja chica"
            onClick={onAlternarCaja}
            onKeyDown={e => {
              if (e.key === " " || e.key === "Enter") { e.preventDefault(); onAlternarCaja(); }
            }}
            style={{
              width: 19, height: 19, borderRadius: 6, marginTop: 2, flexShrink: 0,
              cursor: "pointer",
              border: `1.5px solid ${enCaja ? "var(--accent)" : "var(--border2)"}`,
              background: enCaja ? "var(--accent)" : "var(--surface)",
              color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all var(--rapido) var(--curva)",
            }}
          >
            {enCaja && <IconoCheck size={12} />}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="font-display" style={{
              fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.015em",
            }}>
              {g.proveedor_nombre || "Proveedor no leído"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, lineHeight: 1.5 }}>
              {NOMBRE_COMPROBANTE[g.tipo_comprobante ?? ""] ?? "—"}
              {g.serie && <> <span className="mono">{g.serie}-{g.numero}</span></>}
              {g.fecha_emision && ` · ${g.fecha_emision}`}
            </p>
          </div>
          <p className="cifra cifra-m" style={{ color: "var(--text)", flexShrink: 0 }}>
            {soles(Number(g.total ?? 0))}
          </p>
        </div>
      </div>

      <div style={{
        padding: "14px 17px 16px", background: "var(--surface2)",
        borderTop: "1px solid var(--border)",
      }}>
        <p style={{
          fontSize: 11.5, lineHeight: 1.5, marginBottom: 9,
          display: "flex", gap: 6, alignItems: "flex-start",
          color: dudoso ? "var(--warn)" : "var(--success)",
        }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            {dudoso ? <IconoAlerta size={13} /> : <IconoCheck size={13} />}
          </span>
          {explicar(sugerencia)}
        </p>

        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="fg-input"
            value={elegido}
            onChange={e => setElegido(e.target.value)}
            style={{ flex: 1, minWidth: 190, fontFamily: "var(--font-dm), sans-serif" }}
          >
            <option value="">Elige un memo…</option>
            {memos.map(m => (
              <option key={m.id} value={m.id}>
                {m.correlativo}{m.destino ? ` · ${m.destino}` : ""}
              </option>
            ))}
          </select>

          <button
            className="btn-primary" onClick={asignar}
            disabled={!elegido || guardando}
            style={{
              padding: "10px 16px", fontSize: 12.5,
              opacity: elegido ? 1 : 0.5,
              cursor: elegido ? "pointer" : "not-allowed",
            }}
          >
            {guardando ? "Moviendo…" : <><IconoCheck size={15} />Asignar</>}
          </button>

          {g.drive_url && (
            <a href={g.drive_url} target="_blank" rel="noreferrer" className="btn-ghost"
              style={{ fontSize: 12.5, padding: "9px 13px", textDecoration: "none" }}>
              <IconoEnlace size={15} />
              Ver foto
            </a>
          )}
        </div>

        {!memos.length && (
          <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 9, lineHeight: 1.45 }}>
            No tienes memos abiertos. Cuando te asignen uno podrás mover este comprobante.
          </p>
        )}
      </div>
    </Tarjeta>
  );
}
