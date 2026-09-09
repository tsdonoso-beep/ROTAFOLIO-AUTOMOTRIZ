"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoEnlace } from "./Iconos";
import { asignarPorFecha, explicar, memoDe } from "@/lib/dominio/asignacion";
import { validarGasto } from "@/lib/dominio/validaciones";
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
}

interface Props {
  gastos: Gasto[];
  memos: MemoDestino[];
  parametros: Parametros;
}

const NOMBRE_COMPROBANTE: Record<string, string> = {
  "00": "Constancia", "01": "Factura", "03": "Boleta",
  "07": "Nota de crédito", "08": "Nota de débito", "12": "Ticket",
};

export default function BandejaSinAsignar({ gastos, memos, parametros }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

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
            onResultado={(tono, texto) => { setAviso({ tono, texto }); router.refresh(); }}
          />
        ))}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════

function Fila({ gasto: g, memos, parametros, onResultado }: {
  gasto: Gasto;
  memos: MemoDestino[];
  parametros: Parametros;
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
            carpeta1: destino.centroCostoFolder,
            carpeta2: destino.correlativo,
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

    onResultado("ok", `Comprobante movido a ${destino.correlativo}.`);
  };

  const dudoso = sugerencia.tipo !== "exacta";

  return (
    <Tarjeta padding={0} className="animate-fadein" style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 17px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
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
