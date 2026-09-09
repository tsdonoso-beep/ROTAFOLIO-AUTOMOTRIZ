import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { IconoChevron, IconoLiquidacion } from "@/components/v2/Iconos";
import { liquidar, type MemoLiquidable } from "@/lib/dominio/liquidacion";

interface MemoCrudo {
  id: string;
  correlativo: string;
  estado: string;
  destino: string | null;
  fecha_salida: string | null;
  monto_autorizado: number;
  memo_asignados: Array<{ usuarios: { id: string; nombre: string; dni: string } | null }>;
  gastos: MemoLiquidable["gastos"];
}

/**
 * Saldos por persona, a lo largo de todos sus memos.
 *
 * Lo pidió Finanzas: el resto de la app razona por memo, y la pregunta
 * "¿cuánto le debo o me debe a esta persona?" no se puede responder así.
 */
export default async function Liquidaciones() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "exportar").ok) redirect("/");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("memos")
    .select(`
      id, correlativo, estado, destino, fecha_salida, monto_autorizado,
      memo_asignados ( usuarios ( id, nombre, dni ) ),
      gastos ( estado, clase, total, alertas )
    `)
    .not("estado", "in", "(BORRADOR,ANULADO)");

  // Un memo grupal pertenece a cada una de las personas asignadas, así que
  // el mismo memo puede aparecer en varias liquidaciones.
  const porPersona = new Map<string, {
    nombre: string; dni: string; memos: MemoLiquidable[];
  }>();

  for (const m of ((data ?? []) as unknown as MemoCrudo[])) {
    const memo: MemoLiquidable = {
      id: m.id,
      correlativo: m.correlativo,
      estado: m.estado as MemoLiquidable["estado"],
      destino: m.destino,
      fecha_salida: m.fecha_salida,
      monto_autorizado: Number(m.monto_autorizado),
      gastos: m.gastos ?? [],
    };
    for (const a of m.memo_asignados ?? []) {
      if (!a.usuarios) continue;
      const actual = porPersona.get(a.usuarios.id)
        ?? { nombre: a.usuarios.nombre, dni: a.usuarios.dni, memos: [] };
      actual.memos.push(memo);
      porPersona.set(a.usuarios.id, actual);
    }
  }

  const filas = [...porPersona.entries()]
    .map(([id, p]) => ({ id, ...p, liq: liquidar(p.memos) }))
    // Primero quien tiene saldo pendiente, de mayor a menor.
    .sort((a, b) => Math.abs(b.liq.neto) - Math.abs(a.liq.neto));

  const totalDevolver = filas.reduce((s, f) => s + Math.max(0, f.liq.neto), 0);
  const totalReembolsar = filas.reduce((s, f) => s + Math.max(0, -f.liq.neto), 0);

  return (
    <>
      <Encabezado
        titulo="Liquidaciones"
        bajada="Lo entregado contra lo rendido, persona por persona. Solo se netean las rendiciones ya revisadas: mientras un memo siga abierto su monto puede cambiar."
      />

      {!filas.length ? (
        <Vacio
          icono={<IconoLiquidacion size={26} />}
          titulo="Todavía no hay nada que liquidar"
          texto="Cuando haya memos con personas asignadas aparecerá aquí el saldo de cada una."
        />
      ) : (
        <>
          <div style={{
            display: "grid", gap: 10, marginBottom: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          }}>
            <Tarjeta padding={15}>
              <p className="rotulo">Por devolver a la empresa</p>
              <p className="cifra cifra-l" style={{
                marginTop: 4, color: totalDevolver > 0 ? "var(--accent-texto)" : "var(--text3)",
              }}>
                {soles(totalDevolver)}
              </p>
            </Tarjeta>
            <Tarjeta padding={15}>
              <p className="rotulo">Por reembolsar al personal</p>
              <p className="cifra cifra-l" style={{
                marginTop: 4, color: totalReembolsar > 0 ? "var(--danger)" : "var(--text3)",
              }}>
                {soles(totalReembolsar)}
              </p>
            </Tarjeta>
          </div>

          <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filas.map(f => {
              const debe = f.liq.neto > 0;
              const leDeben = f.liq.neto < 0;

              return (
                <Link key={f.id} href={`/liquidaciones/${f.id}`}
                  className="animate-fadein" style={{ textDecoration: "none" }}>
                  <div className="tarjeta tarjeta-int" style={{
                    padding: "15px 18px", display: "flex", alignItems: "center", gap: 13,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="font-display" style={{
                        fontSize: 14.5, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.015em",
                      }}>
                        {f.nombre}
                      </p>
                      <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                        <span className="mono">{f.dni}</span>
                        {" · "}{f.liq.lineas.length} memo{f.liq.lineas.length === 1 ? "" : "s"}
                        {f.liq.sinCerrar > 0 && (
                          <span style={{ color: "var(--warn)" }}>
                            {" · "}{f.liq.sinCerrar} sin cerrar
                          </span>
                        )}
                      </p>
                    </div>

                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <p className="cifra cifra-m" style={{
                        color: debe ? "var(--accent-texto)"
                          : leDeben ? "var(--danger)" : "var(--text3)",
                      }}>
                        {f.liq.neto === 0 ? "—" : soles(Math.abs(f.liq.neto))}
                      </p>
                      <p style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                        {debe ? "devuelve" : leDeben ? "se le reembolsa" : "sin saldo"}
                      </p>
                    </div>

                    <span style={{ color: "var(--text3)", display: "flex", flexShrink: 0 }}>
                      <IconoChevron size={17} direccion="derecha" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
