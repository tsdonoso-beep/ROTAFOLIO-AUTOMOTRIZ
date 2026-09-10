import Link from "next/link";
import { EstadoMemo, Medidor, Vacio, soles } from "./Encabezado";
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
 * Lista compartida por las bandejas de revisión, contabilidad y
 * administración. Cambia el destino y el texto del vacío, no la forma de
 * leer la información: así las tres pantallas se entienden igual.
 */
export function BandejaMemos({ memos, base, vacio }: {
  memos: FilaMemo[];
  base: string;
  vacio: { icono: React.ReactNode; titulo: string; texto: string };
}) {
  if (!memos.length) return <Vacio {...vacio} />;

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {memos.map(m => {
        const c = consolidar(Number(m.monto_autorizado), m.gastos ?? []);
        const personas = (m.memo_asignados ?? [])
          .map(a => a.usuarios?.nombre).filter(Boolean).join(", ");
        const excedido = c.rendido > c.autorizado;

        return (
          <Link key={m.id} href={`${base}/${m.id}`}
            className="animate-fadein" style={{ textDecoration: "none" }}>
            <div className="tarjeta tarjeta-int" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span className="mono" style={{
                      fontSize: 11.5, color: "var(--text2)", background: "var(--surface2)",
                      padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)",
                    }}>
                      {m.correlativo}
                    </span>
                    <EstadoMemo estado={m.estado} />
                    {c.bloqueantes > 0 && (
                      <span className="badge badge-error">
                        {c.bloqueantes} bloqueante{c.bloqueantes > 1 ? "s" : ""}
                      </span>
                    )}
                    {c.con_alertas > 0 && c.bloqueantes === 0 && (
                      <span className="badge badge-warn">{c.con_alertas} con alerta</span>
                    )}
                  </div>

                  <p className="font-display" style={{
                    fontSize: 15, fontWeight: 700, color: "var(--text)",
                    marginTop: 9, letterSpacing: "-0.02em", lineHeight: 1.3,
                  }}>
                    {m.destino || m.centros_costo?.nombre || "Sin destino"}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 3, lineHeight: 1.5 }}>
                    {personas || "Sin asignar"}
                    {m.centros_costo && <> · <span className="mono">{m.centros_costo.codigo}</span></>}
                    {m.fecha_salida && ` · ${m.fecha_salida}`}
                  </p>
                </div>

                <div style={{ minWidth: 172 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "baseline", marginBottom: 7,
                  }}>
                    <span className="cifra cifra-l" style={{
                      color: excedido ? "var(--danger)" : "var(--text)",
                    }}>
                      {soles(c.rendido)}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--text3)" }}>
                      de {soles(c.autorizado)}
                    </span>
                  </div>

                  {/* Sin adelanto no hay barra que llenar: el medidor mide
                      consumo de un monto autorizado, y acá no hay ninguno. */}
                  {!c.sinAdelanto && <Medidor rendido={c.rendido} autorizado={c.autorizado} />}

                  <p style={{
                    fontSize: 11.5, marginTop: 8, fontWeight: 600,
                    color: excedido && !c.sinAdelanto ? "var(--danger)" : "var(--text2)",
                  }}>
                    {c.sinAdelanto || excedido
                      ? `Reembolsar ${soles(c.reembolso)}`
                      : c.devolucion > 0 ? `Devolver ${soles(c.devolucion)}` : "Sin saldo"}
                    <span style={{ color: "var(--text3)", fontWeight: 400 }}>
                      {" · "}{c.cantidad_gastos} comprobante{c.cantidad_gastos === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
              </div>
            </div>
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
