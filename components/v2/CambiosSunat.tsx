import { Tarjeta, Aviso, soles } from "./Encabezado";
import { IconoAlerta } from "./Iconos";
import { nombreDeTipo } from "@/lib/export/comprobantes-sunat";
import type { CambioDetectado } from "@/lib/datos/consultas-sunat";

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

const ROTULO: Record<string, string> = {
  estado: "Cambió de estado",
  total: "Cambió el importe",
};

/** Un importe se muestra como importe; un estado, como el código que es. */
function valor(campo: string, v: string | null): string {
  if (v == null || v === "") return "—";
  if (campo !== "total") return v;
  const n = Number(v);
  return Number.isFinite(n) ? soles(n) : v;
}

/**
 * Comprobantes que llegaron distintos de como estaban.
 *
 * Va en esta pantalla y no escondido en la hoja porque es lo único que pide
 * una acción: si una factura que alguien rindió cambió de importe o la
 * anularon, hay algo que corregir aguas abajo.
 */
export default function CambiosSunat({ cambios }: { cambios: CambioDetectado[] }) {
  if (!cambios.length) {
    return (
      <Tarjeta>
        <p className="rotulo" style={{ marginBottom: 8 }}>Comprobantes que cambiaron</p>
        <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.55 }}>
          Ningún comprobante ha llegado distinto de como estaba. Esto se llena al
          volver a consultar un período que ya se había traído: si SUNAT reporta
          otro importe, o el comprobante pasa a anulado, queda acá con el antes y
          el después.
        </p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta>
      <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        Comprobantes que cambiaron
      </p>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        Llegaron distintos de como estaban la última vez que se consultó su período.
      </p>

      <div style={{ marginBottom: 12 }}>
        <Aviso tono="aviso" icono={<IconoAlerta size={16} />}>
          {cambios.length === 1
            ? "Un comprobante cambió desde la última consulta."
            : `${cambios.length} cambios desde la última consulta.`}
          <span style={{ display: "block", marginTop: 4, fontSize: 11.5, opacity: 0.9 }}>
            Si alguno se rindió y ya se pagó, hay algo que corregir aguas abajo.
          </span>
        </Aviso>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--borde)" }}>
              {["Comprobante", "Qué cambió", "Antes", "Ahora", "Cuándo"].map((h, i) => (
                <th key={h} className="rotulo" style={{
                  textAlign: i === 2 || i === 3 ? "right" : "left",
                  padding: "8px 10px 8px 0", whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cambios.map(c => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--borde)" }}>
                <td style={{ padding: "8px 10px 8px 0", color: "var(--text)" }}>
                  {c.proveedorNombre ?? c.proveedorRuc ?? "—"}
                  <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--text3)" }}>
                    {nombreDeTipo(c.tipoComprobante)} {c.comprobante} · {c.periodo}
                  </span>
                </td>
                <td style={{ padding: "8px 10px 8px 0", color: "var(--text2)", whiteSpace: "nowrap" }}>
                  {ROTULO[c.campo] ?? c.campo}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {valor(c.campo, c.antes)}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--warn)", whiteSpace: "nowrap" }}>
                  {valor(c.campo, c.despues)}
                </td>
                <td style={{ padding: "8px 0", color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {cuando(c.notadoEn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}
