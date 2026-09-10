import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { seccionesDe, seccionInicial, NOMBRE_ROL } from "@/lib/dominio/navegacion";
import { Cifra, Encabezado, Tarjeta, soles } from "@/components/v2/Encabezado";
import { ICONOS_SECCION, IconoChevron } from "@/components/v2/Iconos";

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
        display: "grid", gap: 10, marginBottom: 26,
        gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
      }}>
        {[
          { etiqueta: "Memos abiertos", valor: String(abiertos), acento: abiertos > 0 },
          { etiqueta: "Por revisar", valor: String(cuenta("PRESENTADA")), acento: cuenta("PRESENTADA") > 0 },
          { etiqueta: "Por contabilizar", valor: String(cuenta("APROBADA")), acento: cuenta("APROBADA") > 0 },
          { etiqueta: "Monto sin rendir", valor: montoAbierto > 0 ? soles(montoAbierto) : "—", acento: false },
        ].map(k => (
          <Tarjeta key={k.etiqueta} padding={15} className="animate-fadein">
            <Cifra
              rotulo={k.etiqueta}
              valor={k.valor}
              tono={k.acento ? "acento" : k.valor === "—" ? "tenue" : "neutro"}
            />
          </Tarjeta>
        ))}
      </div>

      <div style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      }}>
        {secciones.map(seccion => {
          const Icono = ICONOS_SECCION[seccion.clave];
          const esInicio = inicial?.clave === seccion.clave;
          return (
            <Link key={seccion.clave} href={seccion.ruta} style={{ textDecoration: "none" }}>
              <Tarjeta className="tarjeta-int">
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: esInicio ? "var(--accent-suave)" : "var(--surface2)",
                    border: `1px solid ${esInicio ? "var(--accent-borde)" : "var(--border)"}`,
                    color: esInicio ? "var(--accent-texto)" : "var(--text2)",
                  }}>
                    {Icono ? <Icono size={20} /> : null}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="font-display" style={{
                      fontSize: 14.5, fontWeight: 700, color: "var(--text)",
                      letterSpacing: "-0.01em", display: "flex",
                      alignItems: "center", gap: 7, flexWrap: "wrap",
                    }}>
                      {seccion.etiqueta}
                      {esInicio && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "2px 6px",
                          borderRadius: 999, background: "var(--accent-suave)",
                          color: "var(--accent-texto)", letterSpacing: "0.06em",
                        }}>
                          INICIO
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 3, lineHeight: 1.5 }}>
                      {seccion.resumen}
                    </p>
                  </div>

                  <span style={{ color: "var(--text3)", flexShrink: 0, display: "flex" }}>
                    <IconoChevron size={17} direccion="derecha" />
                  </span>
                </div>
              </Tarjeta>
            </Link>
          );
        })}
      </div>
    </>
  );
}
