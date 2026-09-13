import { Tarjeta, Cifra, soles } from "./Encabezado";
import type { ConsultaSunat } from "@/lib/datos/consultas-sunat";

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

/**
 * Historial de consultas al registro de compras.
 *
 * Es la respuesta a «cómo va la empresa en esto»: cuándo se consultó cada
 * período, qué salió y si la lectura fue confiable. Una consulta cuyo
 * resultado no valía se marca, porque un cero en «no están en SUNAT» se lee
 * como buena noticia y puede ser que no se leyó nada.
 */
export default function BitacoraSunat({ consultas }: { consultas: ConsultaSunat[] }) {
  if (!consultas.length) {
    return (
      <Tarjeta>
        <p className="rotulo" style={{ marginBottom: 8 }}>Consultas anteriores</p>
        <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.55 }}>
          Todavía no se ha consultado ningún período. Cada vez que se cruce un mes
          contra SUNAT queda anotado acá: qué se preguntó, qué salió y si la
          lectura fue confiable.
        </p>
      </Tarjeta>
    );
  }

  const ultima = consultas[0];

  return (
    <Tarjeta>
      <p className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        Consultas anteriores
      </p>
      <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.55, marginBottom: 14 }}>
        Las últimas {consultas.length} consultas al registro de compras.
      </p>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 14, paddingBottom: 16, borderBottom: "1px solid var(--borde)", marginBottom: 4,
      }}>
        <Cifra rotulo="última consulta" valor={ultima.periodo} tono="acento" tamano="m" />
        <Cifra rotulo="períodos consultados"
          valor={String(new Set(consultas.map(c => c.periodo)).size)} tamano="m" />
        <Cifra rotulo="lecturas no confiables"
          valor={String(consultas.filter(c => c.identidadSospechosa).length)}
          tono={consultas.some(c => c.identidadSospechosa) ? "peligro" : "tenue"} tamano="m" />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--borde)" }}>
              {["Período", "Cuándo", "En SUNAT", "Nuestros", "Cuadran", "Sin rendir", "Monto"]
                .map((h, i) => (
                  <th key={h} className="rotulo" style={{
                    textAlign: i >= 2 ? "right" : "left",
                    padding: "8px 10px 8px 0", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {consultas.map(c => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--borde)" }}>
                <td className="mono" style={{ padding: "8px 10px 8px 0", color: "var(--text)" }}>
                  {c.periodo}
                  {c.identidadSospechosa && (
                    <span className="badge" style={{
                      marginLeft: 7, background: "var(--danger-bg)", color: "var(--danger)",
                    }}>no confiable</span>
                  )}
                  {!c.identidadSospechosa && c.columnasFaltantes.length > 0 && (
                    <span className="badge" style={{
                      marginLeft: 7, background: "var(--warn-bg)", color: "var(--warn)",
                    }}>faltaron columnas</span>
                  )}
                </td>
                <td style={{ padding: "8px 10px 8px 0", color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {cuando(c.consultadoEn)}
                  {c.quien && (
                    <span style={{ display: "block", fontSize: 10.5 }}>{c.quien}</span>
                  )}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--text2)" }}>
                  {c.comprobantesSunat}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--text2)" }}>
                  {c.comprobantesNuestros}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--text2)" }}>
                  {c.comprobantesNuestros === 0 ? "—" : c.cuadran}
                </td>
                <td className="mono" style={{ padding: "8px 10px 8px 0", textAlign: "right", color: "var(--text2)" }}>
                  {c.soloEnSunat}
                </td>
                <td className="mono" style={{ padding: "8px 0", textAlign: "right", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {soles(c.montoSoloEnSunat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
        «Cuadran» sale en raya cuando no había ningún comprobante nuestro de ese mes:
        sin nada que comparar, un cero no significa que nada cuadre.
      </p>
    </Tarjeta>
  );
}
