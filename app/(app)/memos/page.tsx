import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { Encabezado, EstadoMemo, Medidor, Vacio, soles, Atraso } from "@/components/v2/Encabezado";
import { IconoBandeja, IconoMas, IconoMemos } from "@/components/v2/Iconos";
import { consolidar } from "@/lib/dominio/memo";
import { leerParametros } from "@/lib/dominio/parametros";
import { MEMO_EDITABLE } from "@/lib/dominio/estados";
import { diasDeAtraso } from "@/lib/dominio/equipo";
import CapturaRapida from "@/components/v2/CapturaRapida";
import type { EstadoGasto, ClaseGasto, Alerta, EstadoMemo as TEstadoMemo } from "@/lib/dominio/tipos";

/** Vista inicial del rendidor: sus memos, no un formulario de creación. */
export default async function MisMemos() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  // La fila del anexo trae lo que le tocó a esta persona. Es contra eso que
  // se mide su rendición: el memo 594-2026 autoriza S/ 9,064.00 a once
  // personas, y mostrarle ese número a cada una le dice que le sobran ocho
  // mil ochocientos soles.
  const { data: asignaciones } = await sb
    .from("memo_asignados")
    .select("memo_id, monto, fecha_desde, fecha_hasta")
    .eq("usuario_id", solicitante.usuarioId);

  const ids = (asignaciones ?? []).map(a => a.memo_id);
  const miAnexo = new Map(
    (asignaciones ?? []).map(a => [a.memo_id, {
      monto: a.monto == null ? null : Number(a.monto),
      desde: a.fecha_desde as string | null,
      hasta: a.fecha_hasta as string | null,
    }])
  );

  const { data: memos } = ids.length
    ? await sb
        .from("memos")
        .select(`
          id, correlativo, tipo, destino, estado, monto_autorizado,
          fecha_salida, fecha_retorno_prev,
          centros_costo ( codigo, nombre, drive_folder ),
          empresas ( ruc, abreviatura ),
          gastos ( id, usuario_id, estado, clase, total, alertas, tipo_comprobante ),
          memo_asignados ( usuario_id ),
          pagos ( banco, planilla, fecha, pago_lineas ( usuario_id, monto, procesada ) )
        `)
        .in("id", ids)
        .not("estado", "in", "(BORRADOR,ANULADO)")
        .order("creado_en", { ascending: false })
    : { data: [] };

  // Comprobantes todavía sin memo: se capturan y se asignan después.
  const { count: sinAsignar } = await sb
    .from("gastos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", solicitante.usuarioId)
    .is("memo_id", null);

  // Los pedidos que esta persona tiene en juego. Un pedido no es un memo
  // todavía, así que va aparte y con su propio lenguaje.
  const { data: pedidos } = await sb
    .from("solicitudes_memo")
    .select("id, tipo, motivo, estado, monto_estimado, jefe:usuarios!solicitudes_memo_jefatura_id_fkey ( nombre )")
    .eq("solicitante_id", solicitante.usuarioId)
    .in("estado", ["PENDIENTE", "APROBADA"])
    .order("creado_en", { ascending: false });

  const { data: filasParam } = await sb.from("parametros").select("clave, valor");

  // El reloj se lee una sola vez acá y se pasa como dato. Leerlo dentro del
  // render hace impura la función y React lo marca con razón.
  const hoy = new Date();

  // Los memos que todavía admiten gastos, en la forma que necesita la
  // captura para validar y para archivar la foto sin volver a consultar.
  const disponibles = (memos ?? [])
    .filter(m => MEMO_EDITABLE.includes(m.estado as TEstadoMemo))
    .map(m => {
      const cc = m.centros_costo as unknown as
        { codigo: string; nombre: string; drive_folder: string | null } | null;
      const emp = m.empresas as unknown as { ruc: string; abreviatura: string } | null;
      const g = ((m.gastos ?? []) as Array<{
        usuario_id: string; estado: EstadoGasto; clase: ClaseGasto;
        total: number | null; alertas: Alerta[];
      }>).filter(x => x.usuario_id === solicitante.usuarioId);
      const mio = miAnexo.get(m.id);
      return {
        id: m.id,
        correlativo: m.correlativo,
        destino: m.destino,
        estado: m.estado as TEstadoMemo,
        fecha_salida: m.fecha_salida,
        fecha_retorno_prev: m.fecha_retorno_prev,
        monto_autorizado: mio?.monto ?? Number(m.monto_autorizado),
        rendido: consolidar(mio?.monto ?? Number(m.monto_autorizado), g).rendido,
        centroCostoFolder: cc?.drive_folder || cc?.codigo || "SIN-CENTRO",
        empresaRuc: emp?.ruc ?? null,
        empresaAbrev: emp?.abreviatura ?? "SIN-EMPRESA",
      };
    });

  return (
    <>
      <Encabezado
        titulo="Mis memos"
        bajada="Lo que te asignaron y lo que pediste. Entra en un memo para cargar comprobantes."
        accion={
          <Link href="/solicitudes/nueva" className="btn-ghost" style={{ textDecoration: "none" }}>
            <IconoMas size={16} />
            Pedir un memo
          </Link>
        }
      />

      <CapturaRapida memos={disponibles} parametros={leerParametros(filasParam)} />

      {/* Los pedidos en juego. Un pedido no es un memo: no tiene correlativo
          ni plata comprometida, así que se ve distinto y va antes — es lo
          que todavía puede cambiar. */}
      {(pedidos ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
          {(pedidos ?? []).map(s => {
            const jefe = s.jefe as unknown as { nombre: string } | null;
            const aprobado = s.estado === "APROBADA";
            return (
              <Link key={s.id} href="/solicitudes" style={{ textDecoration: "none" }}>
                <div className="tarjeta tarjeta-int" style={{
                  padding: "13px 16px", display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>
                        Pedido · {String(s.tipo).toLowerCase().replace("_", " ")}
                      </span>
                      <span className={`badge ${aprobado ? "badge-ok" : "badge-warn"}`}>
                        {aprobado ? "Autorizado, falta emitir" : "Esperando firma"}
                      </span>
                    </div>
                    <p className="font-display" style={{
                      fontSize: 13.5, fontWeight: 700, color: "var(--text)",
                      marginTop: 6, letterSpacing: "-0.01em", lineHeight: 1.35,
                    }}>
                      {s.motivo}
                    </p>
                    {!aprobado && jefe && (
                      <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                        Lo firma {jefe.nombre}
                      </p>
                    )}
                  </div>
                  {s.monto_estimado != null && (
                    <span className="cifra cifra-m" style={{ color: "var(--text2)" }}>
                      {soles(Number(s.monto_estimado))}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {(sinAsignar ?? 0) > 0 && (
        <Link href="/memos/sin-asignar" style={{ textDecoration: "none", display: "block", marginBottom: 14 }}>
          <div className="tarjeta tarjeta-int" style={{
            background: "var(--warn-bg)", borderColor: "var(--warn-borde)",
            padding: "14px 17px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ color: "var(--warn)", display: "flex" }}>
              <IconoBandeja size={22} />
            </span>
            <div style={{ flex: 1 }}>
              <p className="font-display" style={{
                fontSize: 13.5, fontWeight: 700, color: "var(--warn)", letterSpacing: "-0.01em",
              }}>
                {sinAsignar} comprobante{sinAsignar === 1 ? "" : "s"} sin asignar
              </p>
              <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                Muévelos a un memo para poder presentarlos
              </p>
            </div>
          </div>
        </Link>
      )}

      {!memos?.length ? (
        <Vacio
          icono={<IconoMemos size={26} />}
          titulo="Todavía no tienes memos"
          texto="Aparecen aquí en cuanto te asignan uno. Si necesitas viajar, puedes pedirlo tú: le llega a tu jefatura para el visto bueno."
          accion={
            <Link href="/solicitudes/nueva" className="btn-primary" style={{ textDecoration: "none" }}>
              <IconoMas size={16} />
              Pedir un memo
            </Link>
          }
        />
      ) : (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {memos.map(m => {
            // Sólo los gastos de esta persona: en un memo de cuadrilla, los
            // de los demás no son suyos ni para bien ni para mal.
            const gastos = ((m.gastos ?? []) as Array<{
              usuario_id: string; estado: EstadoGasto; clase: ClaseGasto;
              total: number | null; alertas: Alerta[]; tipo_comprobante: string | null;
            }>).filter(g => g.usuario_id === solicitante.usuarioId);

            const mio = miAnexo.get(m.id);
            const cuadrilla = ((m.memo_asignados ?? []) as unknown[]).length;
            const c = consolidar(mio?.monto ?? Number(m.monto_autorizado), gastos);

            // Qué cobró de verdad esta persona de este memo. Sin ninguna
            // constancia registrada no se sabe: no se dice nada.
            const lineas = ((m.pagos ?? []) as Array<{
              banco: string; planilla: string | null; fecha: string | null;
              pago_lineas: Array<{ usuario_id: string; monto: number; procesada: boolean }>;
            }>).flatMap(p => (p.pago_lineas ?? [])
              .filter(l => l.usuario_id === solicitante.usuarioId)
              .map(l => ({ ...l, banco: p.banco, planilla: p.planilla, fecha: p.fecha })));

            const cobrado = lineas.filter(l => l.procesada)
              .reduce((s, l) => s + Number(l.monto), 0);
            const rechazado = lineas.some(l => !l.procesada);
            const abono = lineas.find(l => l.procesada);
            const excedido = c.rendido > c.autorizado;
            const cc = m.centros_costo as unknown as { codigo: string; nombre: string } | null;

            const dias = ["ABIERTO", "EN_RENDICION"].includes(m.estado)
              ? diasDeAtraso(m.fecha_retorno_prev, hoy)
              : 0;

            return (
              <Link key={m.id} href={`/memos/${m.id}`}
                className="animate-fadein" style={{ textDecoration: "none" }}>
                <div className="tarjeta tarjeta-int" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "17px 19px 15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                      <Atraso dias={dias} />
                    </div>

                    <p className="font-display" style={{
                      fontSize: 16.5, fontWeight: 700, color: "var(--text)",
                      marginTop: 10, letterSpacing: "-0.02em", lineHeight: 1.25,
                    }}>
                      {m.destino || cc?.nombre || "Sin destino"}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>
                      {cc && <span className="mono">{cc.codigo}</span>}
                      {cc && ` · ${cc.nombre}`}
                    </p>
                  </div>

                  <div style={{
                    background: "var(--surface2)", borderTop: "1px solid var(--border)",
                    padding: "14px 19px 16px",
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "baseline", marginBottom: 9, gap: 12,
                    }}>
                      <span>
                        <span className="cifra cifra-l" style={{
                          color: excedido ? "var(--danger)" : "var(--text)",
                        }}>
                          {soles(c.rendido)}
                        </span>
                        <span style={{ fontSize: 12.5, color: "var(--text3)", marginLeft: 6 }}>
                          de {soles(c.autorizado)}
                        </span>
                      </span>
                      <span className="cifra" style={{
                        fontSize: 12.5,
                        color: excedido ? "var(--danger)" : "var(--accent-texto)",
                      }}>
                        {excedido ? `+${soles(c.reembolso)}` : `${soles(c.saldo)} libre`}
                      </span>
                    </div>

                    <Medidor rendido={c.rendido} autorizado={c.autorizado} />

                    <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 9 }}>
                      {c.cantidad_gastos === 0
                        ? "Sin comprobantes todavía"
                        : `${c.cantidad_gastos} comprobante${c.cantidad_gastos === 1 ? "" : "s"}`}
                      {mio?.hasta
                        ? ` · tu tramo termina el ${mio.hasta}`
                        : m.fecha_retorno_prev && ` · retorno ${m.fecha_retorno_prev}`}
                    </p>

                    {/* Un memo de cuadrilla autoriza un total que no es de
                        nadie. Sin esta línea, la cifra de arriba parece un
                        error de la aplicación. */}
                    {cuadrilla > 1 && mio?.monto != null && (
                      <p style={{
                        fontSize: 11, color: "var(--text3)", marginTop: 7, lineHeight: 1.45,
                      }}>
                        Este memo cubre a {cuadrilla} personas por{" "}
                        {soles(Number(m.monto_autorizado))}. Lo de arriba es lo tuyo.
                      </p>
                    )}

                    {/* Si su plata todavía no salió del banco, decírselo: sin
                        esto no tiene forma de saber si el problema es suyo. */}
                    {rechazado ? (
                      <p style={{
                        fontSize: 11.5, color: "var(--danger)", marginTop: 8,
                        fontWeight: 600, lineHeight: 1.45,
                      }}>
                        El banco rechazó tu abono. Avisa a Administración: no tienes
                        nada que rendir hasta que te llegue.
                      </p>
                    ) : abono ? (
                      <p style={{
                        fontSize: 11.5, color: "var(--accent-texto)", marginTop: 8,
                        fontWeight: 600,
                      }}>
                        Te abonaron {soles(cobrado)}
                        {abono.banco && ` · ${abono.banco}`}
                        {abono.planilla && ` ${abono.planilla}`}
                        {abono.fecha && ` · ${abono.fecha}`}
                      </p>
                    ) : lineas.length === 0 && ["ABIERTO", "EN_RENDICION"].includes(m.estado) ? (
                      <p style={{
                        fontSize: 11.5, color: "var(--warn)", marginTop: 8, fontWeight: 600,
                      }}>
                        Todavía sin constancia de abono
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
