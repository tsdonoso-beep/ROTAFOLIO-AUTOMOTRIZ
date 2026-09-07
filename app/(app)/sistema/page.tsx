import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta } from "@/components/v2/Encabezado";
import { NOMBRE_ROL } from "@/lib/dominio/navegacion";
import type { Rol } from "@/lib/dominio/tipos";

export default async function Sistema() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "editar_catalogos").ok) redirect("/");

  const sb = await clienteServidor();

  const [usuarios, centros, parametros, eventos] = await Promise.all([
    sb.from("usuarios").select("id, nombre, email, activo, roles_usuario(rol)").order("nombre"),
    sb.from("centros_costo").select("codigo, nombre, activo, drive_folder").order("codigo"),
    sb.from("parametros").select("clave, valor, descripcion").order("clave"),
    sb.from("eventos").select("accion, entidad, ocurrido_en").order("ocurrido_en", { ascending: false }).limit(10),
  ]);

  return (
    <>
      <Encabezado
        titulo="Sistema"
        bajada="Usuarios y roles, catálogos, parámetros de las reglas y bitácora de eventos."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* ── Usuarios ── */}
        <section>
          <Titulo texto="Usuarios y roles" />
          <Tarjeta padding={0}>
            {(usuarios.data ?? []).map((u, i, arr) => (
              <div key={u.id} style={{
                padding: "13px 16px",
                borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
              }}>
                <div style={{ flex: 1, minWidth: 190 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                    {u.nombre}
                    {!u.activo && <span style={{ marginLeft: 7, fontSize: 11, color: "var(--text3)" }}>(inactivo)</span>}
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 1 }}>{u.email}</p>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {((u.roles_usuario ?? []) as Array<{ rol: Rol }>).map(r => (
                    <span key={r.rol} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                      background: "var(--surface2)", color: "var(--text2)",
                      border: "1px solid var(--border)",
                      fontFamily: "var(--font-sora), sans-serif",
                    }}>
                      {NOMBRE_ROL[r.rol]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Tarjeta>
        </section>

        {/* ── Centros de costo ── */}
        <section>
          <Titulo texto="Centros de costo" />
          <div style={{
            marginBottom: 8, padding: "10px 13px", borderRadius: 9,
            background: "var(--warn-bg)", border: "1px solid rgba(180,83,9,0.2)",
          }}>
            <p style={{ fontSize: 11.5, color: "var(--warn)", lineHeight: 1.5 }}>
              Catálogo <strong>provisional</strong>: se dedujo de las carpetas de la unidad
              compartida de Drive. Falta el oficial de Control de Gestión.
            </p>
          </div>
          <Tarjeta padding={0}>
            {(centros.data ?? []).map((c, i, arr) => (
              <div key={c.codigo} style={{
                padding: "11px 16px",
                borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex", gap: 12, alignItems: "center",
              }}>
                <span style={{
                  fontSize: 11.5, fontFamily: "monospace", color: "var(--text2)",
                  background: "var(--surface2)", padding: "2px 7px", borderRadius: 5,
                }}>
                  {c.codigo}
                </span>
                <span style={{ fontSize: 13, color: "var(--text)", flex: 1 }}>{c.nombre}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>📁 {c.drive_folder}</span>
              </div>
            ))}
          </Tarjeta>
        </section>

        {/* ── Parámetros ── */}
        <section>
          <Titulo texto="Parámetros de las reglas" />
          <Tarjeta padding={0}>
            {(parametros.data ?? []).map((p, i, arr) => {
              const pendiente = p.valor === null;
              return (
                <div key={p.clave} style={{
                  padding: "12px 16px",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 12, fontFamily: "monospace", color: "var(--text)", fontWeight: 600,
                    }}>
                      {p.clave}
                    </span>
                    {pendiente ? (
                      <span className="badge badge-warn">Sin definir</span>
                    ) : (
                      <span style={{
                        fontSize: 12, fontWeight: 700, color: "var(--accent)",
                        fontFamily: "var(--font-sora), sans-serif",
                      }}>
                        {String(p.valor)}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3, lineHeight: 1.45 }}>
                    {p.descripcion}
                  </p>
                </div>
              );
            })}
          </Tarjeta>
        </section>

        {/* ── Bitácora ── */}
        <section>
          <Titulo texto="Últimos eventos" />
          <Tarjeta>
            {!eventos.data?.length ? (
              <p style={{ fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5 }}>
                Todavía no hay eventos registrados. Cada cambio de estado dejará
                aquí su rastro, con usuario y hora del servidor, y no se puede
                editar ni borrar.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {eventos.data.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 12 }}>
                    <span style={{ color: "var(--text3)", fontFamily: "monospace", fontSize: 11 }}>
                      {new Date(e.ocurrido_en).toLocaleString("es-PE", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    <span style={{ color: "var(--text2)" }}>{e.accion} · {e.entidad}</span>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        </section>
      </div>
    </>
  );
}

function Titulo({ texto }: { texto: string }) {
  return (
    <p className="font-display" style={{
      fontSize: 11, fontWeight: 700, color: "var(--text3)",
      textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 9,
    }}>
      {texto}
    </p>
  );
}
