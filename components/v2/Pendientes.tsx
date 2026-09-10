import Link from "next/link";
import { IconoAlerta, IconoChevron } from "./Iconos";
import { pendientesDe, type ConteosPendientes } from "@/lib/dominio/pendientes";

/**
 * Lo que espera a esta persona, arriba de todo.
 *
 * La app no manda correos, así que este es el único momento en que algo le
 * sale al encuentro a alguien en vez de esperar a que vaya a buscarlo. Por
 * eso va primero y por eso cada línea dice qué pasa si no se hace: sin eso
 * es una lista de números y no una razón para actuar.
 */
export default function Pendientes({ conteos }: { conteos: ConteosPendientes }) {
  const lista = pendientesDe(conteos);

  // Nada esperando no es una noticia. Va en el marco de todas las
  // pantallas, así que un cartel de "todo en orden" repetido molesta más
  // de lo que informa.
  if (!lista.length) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <p className="rotulo" style={{ marginBottom: 10 }}>
        Te está esperando
      </p>

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lista.map(p => (
          <Link key={p.clave} href={p.ruta} className="tarjeta tarjeta-int animate-fadein"
            style={{
              textDecoration: "none", padding: "13px 15px",
              display: "flex", gap: 11, alignItems: "flex-start",
              borderLeft: `3px solid ${p.urgente ? "var(--warn)" : "var(--border2)"}`,
            }}>
            {p.urgente && (
              <span style={{ color: "var(--warn)", display: "flex", marginTop: 1, flexShrink: 0 }}>
                <IconoAlerta size={16} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: "block", fontSize: 13.5, fontWeight: 600,
                color: "var(--text)", lineHeight: 1.4,
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                {p.titulo}
              </span>
              <span style={{
                display: "block", fontSize: 11.5, color: "var(--text3)",
                marginTop: 3, lineHeight: 1.45,
              }}>
                {p.detalle}
              </span>
            </span>
            <span style={{ color: "var(--text3)", display: "flex", marginTop: 2, flexShrink: 0 }}>
              <IconoChevron size={15} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
