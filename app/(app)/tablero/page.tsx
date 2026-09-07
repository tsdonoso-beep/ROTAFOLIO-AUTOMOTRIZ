import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { consolidar } from "@/lib/dominio/memo";
import type { Alerta, ClaseGasto, EstadoGasto } from "@/lib/dominio/tipos";

interface MemoTablero {
  id: string;
  correlativo: string;
  estado: string;
  monto_autorizado: number;
  fecha_retorno_prev: string | null;
  memo_asignados: Array<{ usuarios: { id: string; nombre: string } | null }>;
  gastos: Array<{ estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[] }>;
}

export default async function Tablero() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "autorizar_apertura_con_pendientes").ok) redirect("/");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("memos")
    .select(`
      id, correlativo, estado, monto_autorizado, fecha_retorno_prev,
      memo_asignados ( usuarios ( id, nombre ) ),
      gastos ( estado, clase, total, alertas )
    `)
    .in("estado", ["ABIERTO", "EN_RENDICION"]);

  const memos = (data ?? []) as unknown as MemoTablero[];

  // Agrupado por persona: es la pregunta que hace una jefatura, no el
  // detalle memo por memo.
  const porPersona = new Map<string, {
    nombre: string; memos: number; sinRendir: number; atraso: number;
  }>();

  for (const m of memos) {
    const c = consolidar(Number(m.monto_autorizado), m.gastos ?? []);
    const dias = m.fecha_retorno_prev
      ? Math.floor((Date.now() - new Date(m.fecha_retorno_prev).getTime()) / 86_400_000)
      : 0;

    for (const a of m.memo_asignados ?? []) {
      if (!a.usuarios) continue;
      const actual = porPersona.get(a.usuarios.id) ?? {
        nombre: a.usuarios.nombre, memos: 0, sinRendir: 0, atraso: 0,
      };
      actual.memos += 1;
      actual.sinRendir += Math.max(0, c.saldo);
      actual.atraso = Math.max(actual.atraso, dias);
      porPersona.set(a.usuarios.id, actual);
    }
  }

  const filas = [...porPersona.values()].sort((a, b) => b.atraso - a.atraso);
  const totalSinRendir = filas.reduce((s, f) => s + f.sinRendir, 0);

  return (
    <>
      <Encabezado
        titulo="Tablero de pendientes"
        bajada="Quién tiene memos abiertos, por cuánto y desde hace cuánto."
      />

      {!filas.length ? (
        <Vacio
          icono="📊"
          titulo="Nadie tiene memos abiertos"
          texto="Cuando se abran memos en tu área, aquí verás el consolidado por persona y los días de atraso."
        />
      ) : (
        <>
          <div style={{
            display: "grid", gap: 10, marginBottom: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          }}>
            {[
              { e: "Personas con memos", v: String(filas.length), a: false },
              { e: "Memos abiertos", v: String(memos.length), a: false },
              { e: "Sin rendir", v: soles(totalSinRendir), a: totalSinRendir > 0 },
              { e: "Mayor atraso", v: `${Math.max(0, ...filas.map(f => f.atraso))} días`, a: filas.some(f => f.atraso > 15) },
            ].map(k => (
              <Tarjeta key={k.e} padding={14}>
                <p className="font-display" style={{
                  fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", textAlign: "center",
                  color: k.a ? "var(--danger)" : "var(--text)",
                }}>
                  {k.v}
                </p>
                <p style={{
                  fontSize: 9.5, color: "var(--text3)", marginTop: 3, textAlign: "center",
                  fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  fontFamily: "var(--font-sora), sans-serif",
                }}>
                  {k.e}
                </p>
              </Tarjeta>
            ))}
          </div>

          <Tarjeta padding={0}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                    {["Persona", "Memos", "Sin rendir", "Atraso"].map((h, i) => (
                      <th key={h} style={{
                        padding: "10px 16px", textAlign: i === 0 ? "left" : "right",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                        textTransform: "uppercase", color: "var(--text3)",
                        fontFamily: "var(--font-sora), sans-serif", whiteSpace: "nowrap",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f.nombre} style={{
                      borderBottom: i < filas.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      <td style={{ padding: "11px 16px", fontWeight: 600, color: "var(--text)" }}>
                        {f.nombre}
                      </td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text2)" }}>
                        {f.memos}
                      </td>
                      <td style={{
                        padding: "11px 16px", textAlign: "right", fontWeight: 700,
                        fontFamily: "var(--font-sora), sans-serif", color: "var(--text)",
                      }}>
                        {soles(f.sinRendir)}
                      </td>
                      <td style={{ padding: "11px 16px", textAlign: "right" }}>
                        <span className="badge" style={
                          f.atraso > 15
                            ? { background: "var(--danger-bg)", color: "var(--danger)" }
                            : f.atraso > 0
                            ? { background: "var(--warn-bg)", color: "var(--warn)" }
                            : { background: "var(--success-bg)", color: "var(--success)" }
                        }>
                          {f.atraso > 0 ? `${f.atraso} días` : "al día"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </>
      )}
    </>
  );
}
