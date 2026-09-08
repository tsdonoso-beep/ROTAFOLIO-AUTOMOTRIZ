import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { seccionesDe, seccionInicial, NOMBRE_ROL } from "@/lib/dominio/navegacion";
import { Encabezado, Tarjeta, soles } from "@/components/v2/Encabezado";

export default async function Inicio() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const secciones = seccionesDe(solicitante.roles);

  // Con una sola sección disponible no tiene sentido un menú de entrada:
  // se va directo al trabajo.
  if (secciones.length === 1) redirect(secciones[0].ruta);

  const sb = await clienteServidor();
  const { data: usuario } = await sb
    .from("usuarios").select("nombre").eq("id", solicitante.usuarioId).single();

  // Números de un vistazo. Las políticas de fila ya limitan qué memos ve
  // cada rol, así que esta consulta devuelve lo que corresponde sin filtrar.
  const { data: memos } = await sb
    .from("memos")
    .select("estado, monto_autorizado")
    .in("estado", ["ABIERTO", "EN_RENDICION", "PRESENTADA", "APROBADA"]);

  const cuenta = (e: string) => memos?.filter(m => m.estado === e).length ?? 0;
  const abiertos = cuenta("ABIERTO") + cuenta("EN_RENDICION");
  const montoAbierto = (memos ?? [])
    .filter(m => m.estado === "ABIERTO" || m.estado === "EN_RENDICION")
    .reduce((s, m) => s + Number(m.monto_autorizado), 0);

  const inicial = seccionInicial(solicitante.roles);
  const nombreCorto = (usuario?.nombre ?? "").split(" ")[0];

  return (
    <>
      <Encabezado
        titulo={`Hola, ${nombreCorto}`}
        bajada={`Entraste como ${solicitante.roles.map(r => NOMBRE_ROL[r]).join(" · ")}`}
      />

      <div className="stagger" style={{
        display: "grid", gap: 10, marginBottom: 24,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}>
        {[
          { etiqueta: "Memos abiertos", valor: String(abiertos), acento: abiertos > 0 },
          { etiqueta: "Por revisar", valor: String(cuenta("PRESENTADA")), acento: cuenta("PRESENTADA") > 0 },
          { etiqueta: "Por contabilizar", valor: String(cuenta("APROBADA")), acento: cuenta("APROBADA") > 0 },
          { etiqueta: "Monto sin rendir", valor: montoAbierto > 0 ? soles(montoAbierto) : "—", acento: false },
        ].map(k => (
          <div key={k.etiqueta} className="animate-fadein" style={{
            background: "#FFFFFF", border: "1px solid var(--border)",
            borderRadius: 12, padding: "16px 14px", textAlign: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <p className="font-display" style={{
              fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em",
              color: k.acento ? "var(--accent)" : "var(--text)",
            }}>
              {k.valor}
            </p>
            <p style={{
              fontSize: 9.5, color: "var(--text3)", marginTop: 3, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              fontFamily: "var(--font-sora), sans-serif",
            }}>
              {k.etiqueta}
            </p>
          </div>
        ))}
      </div>

      <div style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      }}>
        {secciones.map(s => (
          <Link key={s.clave} href={s.ruta} style={{ textDecoration: "none" }}>
            <Tarjeta>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                }}>
                  {s.icono}
                </div>
                <div>
                  <p className="font-display" style={{
                    fontSize: 14, fontWeight: 700, color: "var(--text)",
                    letterSpacing: "-0.01em",
                  }}>
                    {s.etiqueta}
                    {inicial?.clave === s.clave && (
                      <span style={{
                        marginLeft: 7, fontSize: 9, fontWeight: 700, padding: "1px 6px",
                        borderRadius: 999, background: "rgba(0,162,152,0.1)",
                        color: "var(--accent)", verticalAlign: "middle",
                      }}>
                        INICIO
                      </span>
                    )}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 3, lineHeight: 1.5 }}>
                    {s.resumen}
                  </p>
                </div>
              </div>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </>
  );
}
