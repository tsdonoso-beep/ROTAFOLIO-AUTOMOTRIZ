import { redirect } from "next/navigation";
import Link from "next/link";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { Encabezado, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { IconoComprobante } from "@/components/v2/Iconos";
import NuevaPlanilla from "@/components/v2/NuevaPlanilla";

/**
 * Las planillas de movilidad.
 *
 * El talonario es físico y numerado de fábrica: acá se lleva el registro de
 * qué hoja usó quién, qué desplazamientos anotó y si la jefatura ya firmó.
 */
export default async function Movilidad() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  // Las políticas de fila deciden qué se ve: la propia planilla siempre, y
  // las ajenas solo con rol para ello.
  const { data: planillas } = await sb
    .from("planillas_movilidad")
    .select(`
      id, numero, periodo, fecha_emision, autorizado_en,
      usuarios!planillas_movilidad_usuario_id_fkey ( nombre ),
      gastos ( total )
    `)
    .order("fecha_emision", { ascending: false, nullsFirst: false });

  const filas = (planillas ?? []).map(p => {
    const gastos = (p.gastos ?? []) as Array<{ total: number | null }>;
    return {
      id: p.id,
      numero: p.numero,
      periodo: p.periodo,
      fecha: p.fecha_emision,
      autorizada: p.autorizado_en !== null,
      duenoNombre: (p.usuarios as unknown as { nombre: string } | null)?.nombre ?? "—",
      desplazamientos: gastos.length,
      total: Math.round(gastos.reduce((s, g) => s + Number(g.total ?? 0), 0) * 100) / 100,
    };
  });

  return (
    <>
      <Encabezado
        titulo="Planillas de movilidad"
        bajada="Una fila por desplazamiento, como lo exige el artículo 37° a1) de la Ley del Impuesto a la Renta"
      />

      <div style={{ marginBottom: 16 }}>
        <NuevaPlanilla />
      </div>

      {filas.length === 0 ? (
        <Vacio
          icono={<IconoComprobante size={26} />}
          titulo="Todavía no hay planillas"
          texto="Abre una con el número impreso del talonario y ve anotando cada desplazamiento con su fecha, motivo, destino y monto."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {filas.map(f => (
            <Link key={f.id} href={`/movilidad/${f.id}`} style={{ textDecoration: "none" }}>
              <Tarjeta padding={15}>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span className="font-display mono" style={{
                        fontSize: 14.5, fontWeight: 800, color: "var(--text)",
                      }}>
                        N° {f.numero}
                      </span>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                        background: f.autorizada ? "rgba(0,162,152,0.10)" : "var(--warn-bg, rgba(217,119,6,0.08))",
                        color: f.autorizada ? "var(--accent)" : "var(--warn)",
                      }}>
                        {f.autorizada ? "AUTORIZADA" : "SIN FIRMAR"}
                      </span>
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                      {f.duenoNombre}
                      {f.periodo && ` · ${f.periodo}`}
                      {f.fecha && ` · ${f.fecha}`}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="font-display" style={{
                      fontSize: 15, fontWeight: 800, color: "var(--text)",
                    }}>
                      {soles(f.total)}
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>
                      {f.desplazamientos} desplazamiento{f.desplazamientos === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              </Tarjeta>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
