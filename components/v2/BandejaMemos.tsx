import Link from "next/link";
import { EstadoMemo, Tarjeta, Vacio, soles } from "./Encabezado";
import { consolidar } from "@/lib/dominio/memo";
import type { Alerta, ClaseGasto, EstadoGasto } from "@/lib/dominio/tipos";

export interface FilaMemo {
  id: string;
  correlativo: string;
  destino: string | null;
  estado: string;
  monto_autorizado: number;
  fecha_salida: string | null;
  fecha_retorno_prev: string | null;
  centros_costo: { codigo: string; nombre: string } | null;
  memo_asignados: Array<{ usuarios: { nombre: string } | null }>;
  gastos: Array<{ estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[] }>;
}

/**
 * Lista de memos compartida por las bandejas de revisión, contabilidad y
 * administración. Cambia el texto del vacío y la ruta, no la forma de leer
 * la información: así las tres pantallas se ven y se entienden igual.
 */
export function BandejaMemos({ memos, base, vacio }: {
  memos: FilaMemo[];
  base: string;
  vacio: { icono: string; titulo: string; texto: string };
}) {
  if (!memos.length) return <Vacio {...vacio} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {memos.map(m => {
        const c = consolidar(Number(m.monto_autorizado), m.gastos ?? []);
        const personas = (m.memo_asignados ?? [])
          .map(a => a.usuarios?.nombre).filter(Boolean).join(", ");
        const excedido = c.rendido > c.autorizado;

        return (
          <Link key={m.id} href={`${base}/${m.id}`} style={{ textDecoration: "none" }}>
            <Tarjeta padding={15}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 210 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11.5, fontFamily: "monospace", color: "var(--text2)",
                      background: "var(--surface2)", padding: "2px 7px", borderRadius: 5,
                    }}>
                      {m.correlativo}
                    </span>
                    <EstadoMemo estado={m.estado} />
                    {c.bloqueantes > 0 && (
                      <span className="badge badge-error">{c.bloqueantes} bloqueante{c.bloqueantes > 1 ? "s" : ""}</span>
                    )}
                    {c.con_alertas > 0 && c.bloqueantes === 0 && (
                      <span className="badge badge-warn">{c.con_alertas} con alerta</span>
                    )}
                  </div>

                  <p className="font-display" style={{
                    fontSize: 14, fontWeight: 700, color: "var(--text)", marginTop: 6,
                  }}>
                    {m.destino || m.centros_costo?.nombre || "Sin destino"}
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 2 }}>
                    {personas || "Sin asignar"}
                    {m.centros_costo && ` · ${m.centros_costo.codigo}`}
                    {m.fecha_salida && ` · ${m.fecha_salida}`}
                  </p>
                </div>

                <div style={{ textAlign: "right", minWidth: 130 }}>
                  <p className="font-display" style={{
                    fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em",
                    color: excedido ? "var(--danger)" : "var(--text)",
                  }}>
                    {soles(c.rendido)}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>
                    de {soles(c.autorizado)}
                  </p>
                  <p style={{
                    fontSize: 11, marginTop: 3, fontWeight: 600,
                    color: excedido ? "var(--danger)" : "var(--text2)",
                  }}>
                    {excedido
                      ? `Reembolsar ${soles(c.reembolso)}`
                      : c.devolucion > 0 ? `Devolver ${soles(c.devolucion)}` : "Sin saldo"}
                  </p>
                  <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 3 }}>
                    {c.cantidad_gastos} comprobante{c.cantidad_gastos === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </Tarjeta>
          </Link>
        );
      })}
    </div>
  );
}

/** Consulta compartida: mismos campos para las tres bandejas. */
export const CAMPOS_MEMO = `
  id, correlativo, destino, estado, monto_autorizado,
  fecha_salida, fecha_retorno_prev,
  centros_costo ( codigo, nombre ),
  memo_asignados ( usuarios ( nombre ) ),
  gastos ( estado, clase, total, alertas )
`;
