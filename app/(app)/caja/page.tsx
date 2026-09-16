import { redirect } from "next/navigation";
import Link from "next/link";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { estadoDeLaCaja, type CicloDeCaja } from "@/lib/dominio/cajachica";
import { Encabezado, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { IconoBandeja } from "@/components/v2/Iconos";
import NuevaCaja from "@/components/v2/NuevaCaja";

/**
 * Los fondos de caja chica.
 *
 * La caja dura; lo que nace y muere son sus ciclos. Acá se ve cuánto queda
 * del ciclo abierto de cada fondo y cada cuánto se está reponiendo.
 */
export default async function Cajas() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();
  const administra = autoriza(solicitante, "crear_memo").ok;

  const [{ data: cajas }, { data: personas }, { data: centros }] = await Promise.all([
    sb.from("cajas_chicas")
      .select(`
        id, codigo, nombre, activa,
        usuarios!cajas_chicas_responsable_id_fkey ( nombre ),
        memos ( id, correlativo, ciclo, estado, monto_autorizado, creado_en,
                gastos ( total ) )
      `)
      .order("codigo"),
    administra
      ? sb.from("usuarios").select("id, nombre").eq("activo", true).order("nombre")
      : Promise.resolve({ data: [] }),
    administra
      ? sb.from("centros_costo").select("id, codigo, nombre").eq("activo", true).order("codigo")
      : Promise.resolve({ data: [] }),
  ]);

  const filas = (cajas ?? []).map(c => {
    const memos = (c.memos ?? []) as Array<{
      id: string; correlativo: string; ciclo: string | null; estado: string;
      monto_autorizado: number; creado_en: string;
      gastos: Array<{ total: number | null }>;
    }>;

    const ciclos: CicloDeCaja[] = memos.map(m => ({
      id: m.id,
      correlativo: m.correlativo,
      ciclo: m.ciclo,
      estado: m.estado,
      monto: Number(m.monto_autorizado),
      rendido: (m.gastos ?? []).reduce((s, g) => s + Number(g.total ?? 0), 0),
      fecha: m.creado_en?.slice(0, 10) ?? null,
    }));

    return {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      activa: c.activa,
      responsable: (c.usuarios as unknown as { nombre: string } | null)?.nombre ?? "—",
      estado: estadoDeLaCaja(ciclos),
      ciclos: ciclos.length,
    };
  });

  return (
    <>
      <Encabezado
        titulo="Caja chica"
        bajada="El fondo no se cierra: se repone. Cada reposición es un ciclo con su propio memo"
      />

      {administra && (
        <div style={{ marginBottom: 16 }}>
          <NuevaCaja personas={personas ?? []} centros={centros ?? []} />
        </div>
      )}

      {filas.length === 0 ? (
        <Vacio
          icono={<IconoBandeja size={26} />}
          titulo="No hay cajas registradas"
          texto="Se conocen seis administradores de caja por nombre, pero sus cuentas no están confirmadas. Se registran acá cuando se sepan, en vez de sembrar datos inventados."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {filas.map(f => (
            <Link key={f.id} href={`/caja/${f.id}`} style={{ textDecoration: "none" }}>
              <Tarjeta padding={15}>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="font-display" style={{
                      fontSize: 14.5, fontWeight: 800, color: "var(--text)",
                    }}>
                      {f.nombre}
                    </span>
                    <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                      <span className="mono">{f.codigo}</span> · {f.responsable}
                      {f.estado.cadenciaDias != null &&
                        ` · se repone cada ${f.estado.cadenciaDias} días`}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {f.estado.abierto ? (
                      <>
                        <div className="font-display" style={{
                          fontSize: 15, fontWeight: 800,
                          color: f.estado.saldo > 0 ? "var(--accent)" : "var(--danger)",
                        }}>
                          {soles(f.estado.saldo)}
                        </div>
                        <p style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>
                          queda del ciclo {f.estado.abierto.ciclo ?? "—"}
                        </p>
                      </>
                    ) : (
                      <p style={{ fontSize: 11.5, color: "var(--warn)", fontWeight: 600 }}>
                        sin ciclo abierto
                      </p>
                    )}
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
