"use client";
import { GastoItem } from "@/lib/types";

interface Props { items: GastoItem[] }

const moneda = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const estadoStyle = (estado: string) => {
  if (estado === "PAGADO")  return { background: "rgba(16,223,160,0.12)", color: "var(--accent)" };
  if (estado === "ANULADO") return { background: "rgba(255,90,90,0.12)",  color: "var(--danger)" };
  return { background: "rgba(245,166,35,0.12)", color: "var(--warn)" };
};

export default function TablaResumen({ items }: Props) {
  const procesados = items.filter(i => i.procesado && !i.error);
  const total = procesados.reduce((s, i) => s + (i.extraido?.monto_total ?? 0), 0);
  if (!procesados.length) return null;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "20px",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <p className="font-display" style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)" }}>
          Resumen de Gastos
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text2)" }}>{procesados.length} comprobantes</span>
          <span style={{
            fontSize: "15px", fontWeight: 800, color: "var(--accent)",
            fontFamily: "var(--font-sora), sans-serif", letterSpacing: "-0.02em",
          }}>
            {moneda(total)}
          </span>
        </div>
      </div>

      {/* Table — scroll on mobile */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["N° Sol.", "Proveedor", "Detalle", "Comprobante", "Fecha", "Total S/", "Estado", "Imagen"].map(h => (
                <th key={h} style={{
                  padding: "10px 16px", textAlign: h === "Total S/" ? "right" : "left",
                  fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em",
                  textTransform: "uppercase", color: "var(--text3)",
                  fontFamily: "var(--font-sora), sans-serif", whiteSpace: "nowrap",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {procesados.map((item, idx) => {
              const ex = item.extraido!;
              return (
                <tr key={item.id} style={{
                  borderBottom: idx < procesados.length - 1 ? "1px solid var(--border)" : "none",
                  transition: "background 0.15s",
                }}
                  onMouseOver={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                  onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "12px 16px", color: "var(--text3)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {item.numero_solicitud || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text)", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ex.proveedor || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--text2)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ex.detalle || item.motivo || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <span style={{
                      background: "rgba(255,255,255,0.05)", padding: "3px 8px",
                      borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                      color: "var(--text2)", letterSpacing: "0.05em",
                      fontFamily: "var(--font-sora), sans-serif",
                    }}>
                      {ex.tipo_comprobante}
                    </span>
                    {ex.numero_comprobante && (
                      <span style={{ marginLeft: "6px", color: "var(--text3)", fontSize: "11px" }}>
                        {ex.numero_comprobante}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--text2)", whiteSpace: "nowrap" }}>
                    {ex.fecha_comprobante || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", fontFamily: "var(--font-sora), sans-serif" }}>
                    {ex.monto_total ? moneda(ex.monto_total) : "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className="badge" style={estadoStyle(item.estado)}>
                      {item.estado}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {item.drive_url ? (
                      <a href={item.drive_url} target="_blank" rel="noreferrer"
                        style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none", fontSize: "12px" }}>
                        ↗ Ver
                      </a>
                    ) : (
                      <span style={{ color: "var(--text3)" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
              <td colSpan={5} style={{ padding: "12px 16px", textAlign: "right", fontSize: "11px", fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sora), sans-serif" }}>
                Total General
              </td>
              <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "16px", fontWeight: 800, color: "var(--accent)", fontFamily: "var(--font-sora), sans-serif", letterSpacing: "-0.02em" }}>
                {moneda(total)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
